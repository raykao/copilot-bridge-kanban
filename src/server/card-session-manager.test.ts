import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { streamBridgeRun, type BridgeEvent } from './bridge-stream.js';
import { CardSessionManager, type DispatchCallbacks } from './card-session-manager.js';
import type { AppConfig } from './config.js';

vi.mock('./bridge-stream.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./bridge-stream.js')>();
  return {
    ...actual,
    streamBridgeRun: vi.fn(),
  };
});

const streamBridgeRunMock = vi.mocked(streamBridgeRun);

const config: AppConfig = {
  port: 3000,
  bridgeApiUrl: 'http://bridge.example',
  bridgeApiKey: 'key-1',
  kanbanBaseUrl: 'http://kanban.example',
  sessionSecret: 'secret',
  dbPath: './data/test.db',
  logLevel: 'silent',
};

function createCallbacks(): DispatchCallbacks {
  return {
    onRunCreated: vi.fn(),
    onEvent: vi.fn(),
    onComplete: vi.fn(),
    onAgentMessage: vi.fn(),
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

describe('CardSessionManager', () => {
  beforeEach(() => {
    streamBridgeRunMock.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('dispatches to bridge, records created run, opens stream, and routes completed messages', async () => {
    const callbacks = createCallbacks();
    const cancel = vi.fn();
    streamBridgeRunMock.mockReturnValue(cancel);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ run_id: 'bridge-run-1' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const manager = new CardSessionManager(config, callbacks);
    manager.dispatch('card-1', 'bob', 'hello', 'kanban-run-1');

    await waitFor(() => streamBridgeRunMock.mock.calls.length === 1);

    expect(fetchMock).toHaveBeenCalledWith('http://bridge.example/runs', expect.objectContaining({
      method: 'POST',
      headers: {
        Authorization: 'Bearer key-1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agent_name: 'bob',
        input: [{ role: 'user', parts: [{ content: 'hello' }] }],
        session_id: 'card-1',
      }),
      signal: expect.any(AbortSignal),
    }));
    expect(callbacks.onRunCreated).toHaveBeenCalledWith('kanban-run-1', 'bridge-run-1');
    expect(streamBridgeRunMock).toHaveBeenCalledWith({
      bridgeApiUrl: 'http://bridge.example',
      bridgeApiKey: 'key-1',
      bridgeRunId: 'bridge-run-1',
      onEvent: expect.any(Function),
      onClose: expect.any(Function),
      onError: expect.any(Function),
    });

    const streamOptions = streamBridgeRunMock.mock.calls[0]?.[0];
    streamOptions?.onEvent({ type: 'message.completed', data: { content: 'done' } } satisfies BridgeEvent);

    expect(callbacks.onEvent).toHaveBeenCalledWith('card-1', 'message.completed', { content: 'done' });
    expect(callbacks.onAgentMessage).toHaveBeenCalledWith('card-1', 'kanban-run-1', 'bob', 'done');
  });

  it('skips dispatch on 409 without opening a stream or calling callbacks', async () => {
    const callbacks = createCallbacks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 409,
      text: async () => 'already active',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const manager = new CardSessionManager(config, callbacks);
    manager.dispatch('card-1', 'bob', 'hello', 'kanban-run-1');

    await waitFor(() => fetchMock.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('session already active'));
    expect(streamBridgeRunMock).not.toHaveBeenCalled();
    expect(callbacks.onRunCreated).not.toHaveBeenCalled();
    expect(callbacks.onEvent).not.toHaveBeenCalled();
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    expect(callbacks.onAgentMessage).not.toHaveBeenCalled();
  });

  it('marks dispatch failed on non-ok response', async () => {
    const callbacks = createCallbacks();
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'server error',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const manager = new CardSessionManager(config, callbacks);
    manager.dispatch('card-1', 'bob', 'hello', 'kanban-run-1');

    await waitFor(() => vi.mocked(callbacks.onComplete).mock.calls.length === 1);

    expect(callbacks.onComplete).toHaveBeenCalledWith(
      'card-1',
      'kanban-run-1',
      'failed',
      expect.stringContaining('Bridge POST /runs failed: 500'),
    );
    expect(streamBridgeRunMock).not.toHaveBeenCalled();
  });

  it('reconnects active runs without posting to bridge', () => {
    const callbacks = createCallbacks();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const manager = new CardSessionManager(config, callbacks);
    manager.reconnectAll([
      { card_id: 'card-1', id: 'kanban-run-1', bridge_run_id: 'bridge-run-1', agent_name: 'bob' },
      { card_id: 'card-2', id: 'kanban-run-2', bridge_run_id: 'bridge-run-2', agent_name: 'alice' },
    ]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(streamBridgeRunMock).toHaveBeenCalledTimes(2);
    expect(streamBridgeRunMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      bridgeRunId: 'bridge-run-1',
      onEvent: expect.any(Function),
    }));
    expect(streamBridgeRunMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      bridgeRunId: 'bridge-run-2',
      onEvent: expect.any(Function),
    }));
  });

  it('closes a stream once and removes the active session', () => {
    const callbacks = createCallbacks();
    const cancel = vi.fn();
    streamBridgeRunMock.mockReturnValue(cancel);

    const manager = new CardSessionManager(config, callbacks);
    manager.reconnectAll([
      { card_id: 'card-1', id: 'kanban-run-1', bridge_run_id: 'bridge-run-1', agent_name: 'bob' },
    ]);

    manager.close('card-1');
    manager.close('card-1');

    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
