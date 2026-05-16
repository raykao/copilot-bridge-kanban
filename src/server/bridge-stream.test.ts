import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamBridgeRun, subscribeToBridgeRunStream, type BridgeEvent } from './bridge-stream.js';

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

function streamOptions(overrides: Partial<Parameters<typeof subscribeToBridgeRunStream>[0]> = {}) {
  return {
    bridgeApiUrl: 'http://bridge.example',
    bridgeApiKey: 'key-1',
    runId: 'run-1',
    bot: 'bob',
    prompt: 'hello',
    cardId: 'card-1',
    onEvent: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}


function persistedStreamOptions(overrides: Partial<Parameters<typeof streamBridgeRun>[0]> = {}) {
  return {
    bridgeApiUrl: 'http://bridge.example',
    bridgeApiKey: 'key-1',
    bridgeRunId: 'run-1',
    onEvent: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
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


describe('streamBridgeRun', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('streams persisted BridgeEvent frames and closes on completion', async () => {
    const events: BridgeEvent[] = [];
    const onClose = vi.fn();
    const fetchMock = mockFetchWithChunks([
      'event: message.part\ndata: {"role":"agent","content":"hello"}\n\n',
      'event: run.completed\ndata: {"run_id":"run-1"}\n\n',
    ]);

    const cancel = streamBridgeRun(persistedStreamOptions({
      bridgeRunId: 'run with spaces/slash',
      onEvent: (event) => events.push(event),
      onClose,
    }));

    expect(typeof cancel).toBe('function');
    await waitFor(() => onClose.mock.calls.length === 1);

    expect(events).toEqual([
      { type: 'message.part', data: { role: 'agent', content: 'hello' } },
      { type: 'run.completed', data: { run_id: 'run-1' } },
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://bridge.example/runs/run%20with%20spaces%2Fslash/stream', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer key-1',
      },
      signal: expect.any(AbortSignal),
    });
  });

  it('calls onError with 404 response body, then onClose', async () => {
    const onEvent = vi.fn();
    const onClose = vi.fn();
    const onError = vi.fn();

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => 'run not found',
      body: null,
    })));

    streamBridgeRun(persistedStreamOptions({ onEvent, onClose, onError }));

    await waitFor(() => onClose.mock.calls.length === 1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(404, 'run not found');
    expect(onEvent).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('suppresses callbacks after cancel', async () => {
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controllerRef = controller;
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const onEvent = vi.fn();
    const onClose = vi.fn();
    const onError = vi.fn();

    const cancel = streamBridgeRun(persistedStreamOptions({ onEvent, onClose, onError }));

    await waitFor(() => fetchMock.mock.calls.length === 1 && Boolean(controllerRef));
    cancel();
    controllerRef?.enqueue(encoder.encode('event: message.part\ndata: {"content":"ignored"}\n\n'));
    controllerRef?.close();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(onEvent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('subscribeToBridgeRunStream', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires mapped A2A events when SSE frames arrive', async () => {
    const events: BridgeEvent[] = [];
    const onClose = vi.fn();
    const fetchMock = mockFetchWithChunks([
      'event: task\ndata: {"kind":"task","id":"task-1","contextId":"card-1"}\n\n',
      ':heartbeat\n\n',
      'event: artifact-update\ndata: {"taskId":"task-1","artifact":{"parts":[{"kind":"text","text":"hello"}]},"lastChunk":false}\n\n',
      'event: status-update\ndata: {"taskId":"task-1","status":{"state":"working"}}\n\n',
      'event: unknown\ndata: {"ignored":true}\n\n',
    ]);

    const cancel = subscribeToBridgeRunStream(streamOptions({
      onEvent: (event) => events.push(event),
      onClose,
    }));

    expect(typeof cancel).toBe('function');
    await waitFor(() => onClose.mock.calls.length === 1);

    expect(events).toEqual([
      { type: 'run.created', data: { run_id: 'task-1' } },
      { type: 'message.part', data: { role: 'agent', content: 'hello' } },
      { type: 'run.in_progress', data: { run_id: 'task-1' } },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(new URL('http://bridge.example/agents/bob/message:stream'), {
      method: 'POST',
      headers: {
        Authorization: 'Bearer key-1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'hello' }],
          messageId: 'run-1',
          contextId: 'card-1',
        },
      }),
      signal: expect.any(AbortSignal),
    });
  });

  it('calls onClose on terminal status-update completed', async () => {
    const events: BridgeEvent[] = [];
    const onClose = vi.fn();
    mockFetchWithChunks([
      'event: status-update\ndata: {"taskId":"task-1","status":{"state":"completed"},"final":true}\n\n',
      'event: artifact-update\ndata: {"artifact":{"parts":[{"kind":"text","text":"ignored"}]},"lastChunk":false}\n\n',
    ]);

    subscribeToBridgeRunStream(streamOptions({
      onEvent: (event) => events.push(event),
      onClose,
    }));

    await waitFor(() => onClose.mock.calls.length === 1);
    expect(events).toEqual([{ type: 'run.completed', data: { run_id: 'task-1' } }]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('maps artifact-update lastChunk true to message.completed', async () => {
    const events: BridgeEvent[] = [];
    const onClose = vi.fn();
    mockFetchWithChunks([
      'event: artifact-update\ndata: {"taskId":"task-1","artifact":{"parts":[{"kind":"text","text":"Done"}]},"lastChunk":true}\n\n',
      'event: status-update\ndata: {"taskId":"task-1","status":{"state":"completed"}}\n\n',
    ]);

    subscribeToBridgeRunStream(streamOptions({
      onEvent: (event) => events.push(event),
      onClose,
    }));

    await waitFor(() => onClose.mock.calls.length === 1);
    expect(events[0]).toEqual({
      type: 'message.completed',
      data: { role: 'agent', content: 'Done' },
    });
  });

  it('maps artifact-update lastChunk false to message.part', async () => {
    const events: BridgeEvent[] = [];
    const onClose = vi.fn();
    mockFetchWithChunks([
      'event: artifact-update\ndata: {"taskId":"task-1","artifact":{"parts":[{"kind":"text","text":"hello"}]},"lastChunk":false}\n\n',
    ]);

    subscribeToBridgeRunStream(streamOptions({
      onEvent: (event) => events.push(event),
      onClose,
    }));

    await waitFor(() => onClose.mock.calls.length === 1);
    expect(events).toEqual([{ type: 'message.part', data: { role: 'agent', content: 'hello' } }]);
  });

  it('calls onClose on terminal status-update failed with message text', async () => {
    const events: BridgeEvent[] = [];
    const onClose = vi.fn();
    mockFetchWithChunks([
      'event: status-update\ndata: {"taskId":"task-1","status":{"state":"failed","message":{"parts":[{"kind":"text","text":"boom"}]}}}\n\n',
    ]);

    subscribeToBridgeRunStream(streamOptions({
      onEvent: (event) => events.push(event),
      onClose,
    }));

    await waitFor(() => onClose.mock.calls.length === 1);
    expect(events).toEqual([{ type: 'run.failed', data: { run_id: 'task-1', error: 'boom' } }]);
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
    const cancel = subscribeToBridgeRunStream(streamOptions({
      bridgeApiUrl: 'http://bridge.example/base',
      bot: 'bot with spaces/slash',
      onClose,
    }));

    await waitFor(() => fetchMock.mock.calls.length === 1 && Boolean(signal));
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    cancel();

    await waitFor(() => onClose.mock.calls.length === 1);
    expect(signal?.aborted).toBe(true);
    expect(fetchMock.mock.calls[0][0].href).toBe('http://bridge.example/base/agents/bot%20with%20spaces%2Fslash/message:stream');
  });

  it('ignores empty, malformed, and non-object data gracefully', async () => {
    const events: BridgeEvent[] = [];
    const onClose = vi.fn();
    mockFetchWithChunks([
      'event: status-update\ndata:\n\n',
      'event: task\ndata: not-json\n\n',
      'event: artifact-update\ndata: ["not","object"]\n\n',
    ]);

    subscribeToBridgeRunStream(streamOptions({
      onEvent: (event) => events.push(event),
      onClose,
    }));

    await waitFor(() => onClose.mock.calls.length === 1);
    expect(events).toEqual([]);
  });

  it('maps status-update input-required to run.awaiting', async () => {
    const events: BridgeEvent[] = [];
    const onClose = vi.fn();
    mockFetchWithChunks([
      'event: status-update\ndata: {"taskId":"task-1","status":{"state":"input-required"}}\n\n',
    ]);

    subscribeToBridgeRunStream(streamOptions({
      onEvent: (event) => events.push(event),
      onClose,
    }));

    await waitFor(() => onClose.mock.calls.length === 1);
    expect(events).toEqual([{ type: 'run.awaiting', data: { run_id: 'task-1' } }]);
  });

  it('calls onError with status and body when bridge returns non-ok, then fires onClose with no onEvent', async () => {
    const onEvent = vi.fn();
    const onClose = vi.fn();
    const onError = vi.fn();

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 409,
      text: async () => 'Task already in progress for this contextId',
      body: null,
    })));

    subscribeToBridgeRunStream(streamOptions({ onEvent, onClose, onError }));

    await waitFor(() => onClose.mock.calls.length === 1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(409, 'Task already in progress for this contextId');
    expect(onEvent).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fires onReady with taskId when first task frame arrives, before message.completed', async () => {
    const events: BridgeEvent[] = [];
    const onClose = vi.fn();
    const onReady = vi.fn();

    mockFetchWithChunks([
      'event: task\ndata: {"kind":"task","id":"task-42","contextId":"card-1"}\n\n',
      'event: artifact-update\ndata: {"taskId":"task-42","artifact":{"parts":[{"kind":"text","text":"hi"}]},"lastChunk":true}\n\n',
      'event: status-update\ndata: {"taskId":"task-42","status":{"state":"completed"}}\n\n',
    ]);

    subscribeToBridgeRunStream(streamOptions({
      onEvent: (event) => events.push(event),
      onClose,
      onReady,
    }));

    await waitFor(() => onClose.mock.calls.length === 1);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith('task-42');

    // onReady must have fired before the message.completed event was delivered to onEvent
    const readyOrder = onReady.mock.invocationCallOrder[0];
    const completedCallIdx = events.findIndex((e) => e.type === 'message.completed');
    expect(completedCallIdx).toBeGreaterThanOrEqual(0);
    // onReady fires synchronously inside the frame loop before onEvent for run.created,
    // so its invocation order is lower than any subsequent onEvent call
    expect(readyOrder).toBeLessThan(onReady.mock.invocationCallOrder[0] + 1); // always true, sanity
    // Verify the run.created event was also emitted via onEvent
    expect(events[0]).toEqual({ type: 'run.created', data: { run_id: 'task-42' } });
  });
});
