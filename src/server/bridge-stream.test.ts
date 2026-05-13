import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeToBridgeRunStream, type BridgeEvent } from './bridge-stream.js';

function createStream(chunks: string[], onCancel?: () => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
    cancel() {
      onCancel?.();
    },
  });
}

function mockFetchWithChunks(chunks: string[], options: { ok?: boolean; onCancel?: () => void } = {}) {
  const fetchMock = vi.fn(async () => ({
    ok: options.ok ?? true,
    body: createStream(chunks, options.onCancel),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('subscribeToBridgeRunStream', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires events when SSE frames arrive', async () => {
    const events: BridgeEvent[] = [];
    const onClose = vi.fn();
    const fetchMock = mockFetchWithChunks([
      'event: run.queued\ndata: {"run_id":"run-1"}\n\n',
      ':heartbeat\n\n',
      'event: message.part\ndata: {"content":"hello"}\n\n',
      'event: tool.start\ndata: {"name":"shell"}\n\n',
      'event: unknown\ndata: {"ignored":true}\n\n',
      'event: tool.end\ndata: {"ok":true}\n\n',
    ]);

    const cancel = subscribeToBridgeRunStream({
      bridgeApiUrl: 'http://bridge.example',
      bridgeApiKey: 'key-1',
      runId: 'run-1',
      onEvent: (event) => events.push(event),
      onClose,
    });

    expect(typeof cancel).toBe('function');
    await waitFor(() => onClose.mock.calls.length === 1);

    expect(events).toEqual([
      { type: 'run.queued', data: { run_id: 'run-1' } },
      { type: 'message.part', data: { content: 'hello' } },
      { type: 'tool.start', data: { name: 'shell' } },
      { type: 'tool.end', data: { ok: true } },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(new URL('http://bridge.example/v1/runs/run-1/stream'), {
      headers: { Authorization: 'Bearer key-1' },
      signal: expect.any(AbortSignal),
    });
  });

  it('calls onClose on terminal event run.completed', async () => {
    const events: BridgeEvent[] = [];
    const onClose = vi.fn();
    mockFetchWithChunks([
      'event: run.completed\ndata: {"result":"ok"}\n\n',
      'event: message.part\ndata: {"content":"ignored"}\n\n',
    ]);

    subscribeToBridgeRunStream({
      bridgeApiUrl: 'http://bridge.example',
      bridgeApiKey: 'key-1',
      runId: 'run-1',
      onEvent: (event) => events.push(event),
      onClose,
    });

    await waitFor(() => onClose.mock.calls.length === 1);
    expect(events).toEqual([{ type: 'run.completed', data: { result: 'ok' } }]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('passes message.completed events through', async () => {
    const events: BridgeEvent[] = [];
    const onClose = vi.fn();
    mockFetchWithChunks([
      'event: message.completed\ndata: {"role":"agent","content":"Done"}\n\n',
      'event: run.completed\ndata: {}\n\n',
    ]);

    subscribeToBridgeRunStream({
      bridgeApiUrl: 'http://bridge.example',
      bridgeApiKey: 'key-1',
      runId: 'run-1',
      onEvent: (event) => events.push(event),
      onClose,
    });

    await waitFor(() => onClose.mock.calls.length === 1);
    expect(events[0]).toEqual({
      type: 'message.completed',
      data: { role: 'agent', content: 'Done' },
    });
  });

  it('calls onClose on terminal event run.failed', async () => {
    const events: BridgeEvent[] = [];
    const onClose = vi.fn();
    mockFetchWithChunks(['event: run.failed\ndata: {"error":"boom"}\n\n']);

    subscribeToBridgeRunStream({
      bridgeApiUrl: 'http://bridge.example',
      bridgeApiKey: 'key-1',
      runId: 'run-1',
      onEvent: (event) => events.push(event),
      onClose,
    });

    await waitFor(() => onClose.mock.calls.length === 1);
    expect(events).toEqual([{ type: 'run.failed', data: { error: 'boom' } }]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('aborts the stream when cancel is called and sends an AbortSignal to fetch', async () => {
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return {
        ok: true,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
          },
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const onClose = vi.fn();
    const cancel = subscribeToBridgeRunStream({
      bridgeApiUrl: 'http://bridge.example/base',
      bridgeApiKey: 'key-1',
      runId: 'run with spaces/slash',
      onEvent: vi.fn(),
      onClose,
    });

    await waitFor(() => fetchMock.mock.calls.length === 1 && Boolean(signal));
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    cancel();

    await waitFor(() => onClose.mock.calls.length === 1);
    expect(signal?.aborted).toBe(true);
    expect(fetchMock.mock.calls[0][0].href).toBe('http://bridge.example/base/v1/runs/run%20with%20spaces%2Fslash/stream');
  });

  it('defaults empty, malformed, and non-object data to an empty object', async () => {
    const events: BridgeEvent[] = [];
    const onClose = vi.fn();
    mockFetchWithChunks([
      'event: run.awaiting\ndata:\n\n',
      'event: tool.start\ndata: not-json\n\n',
      'event: tool.end\ndata: ["not","object"]\n\n',
    ]);

    subscribeToBridgeRunStream({
      bridgeApiUrl: 'http://bridge.example',
      bridgeApiKey: 'key-1',
      runId: 'run-1',
      onEvent: (event) => events.push(event),
      onClose,
    });

    await waitFor(() => onClose.mock.calls.length === 1);
    expect(events).toEqual([
      { type: 'run.awaiting', data: {} },
      { type: 'tool.start', data: {} },
      { type: 'tool.end', data: {} },
    ]);
  });
});
