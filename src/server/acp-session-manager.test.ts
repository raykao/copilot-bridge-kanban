import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { WebSocket as WsType } from 'ws';
import { AcpSessionManager } from './acp-session-manager.js';
import type { DispatchCallbacks } from './card-session-manager.js';

function makeCallbacks(): { cbs: DispatchCallbacks; calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {
    onRunCreated: [], onEvent: [], onComplete: [], onAgentMessage: [],
  };
  const cbs: DispatchCallbacks = {
    onRunCreated: (...args) => { calls.onRunCreated.push(args); },
    onEvent: (...args) => { calls.onEvent.push(args); },
    onComplete: (...args) => { calls.onComplete.push(args); },
    onAgentMessage: (...args) => { calls.onAgentMessage.push(args); },
  };
  return { cbs, calls };
}

function rpcResult(id: number, result: unknown) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}
function rpcServerRequest(id: number, method: string, params: unknown) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}
function notify(method: string, params: unknown) {
  return JSON.stringify({ jsonrpc: '2.0', method, params });
}

let wss: InstanceType<typeof WebSocketServer>;
let port: number;

beforeEach(async () => {
  wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  port = (wss.address() as { port: number }).port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => wss.close(() => resolve()));
});

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('AcpSessionManager - happy path', () => {
  it('runs a full session and calls onComplete(completed)', async () => {
    wss.once('connection', (client: WsType) => {
      client.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { id: number; method: string };
        if (msg.method === 'initialize')    client.send(rpcResult(msg.id, { serverCapabilities: {} }));
        if (msg.method === 'session/new')   client.send(rpcResult(msg.id, { sessionId: 'ses-1' }));
        if (msg.method === 'session/prompt') {
          client.send(notify('session/update', { sessionId: 'ses-1', type: 'streaming', content: 'Hello ' }));
          client.send(notify('session/update', { sessionId: 'ses-1', type: 'completed', content: 'world' }));
        }
      });
    });

    const { cbs, calls } = makeCallbacks();
    const mgr = new AcpSessionManager({ url: `ws://localhost:${port}`, auto_approve: false }, cbs);
    mgr.dispatch('card-1', 'bob', 'do the thing', 'run-1');

    await waitFor(() => calls.onComplete.length > 0);

    expect(calls.onRunCreated[0]).toEqual(['run-1', 'ses-1']);
    expect(calls.onComplete[0]).toEqual(['card-1', 'run-1', 'completed']);
    expect(calls.onAgentMessage[0]).toEqual(['card-1', 'run-1', 'bob', 'Hello world']);
  });
});

describe('AcpSessionManager - auto_approve=true', () => {
  it('responds allow to session/request_permission and continues', async () => {
    let permissionResponseDecision: string | null = null;

    wss.once('connection', (client: WsType) => {
      client.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { id: number; method?: string; result?: { decision: string } };
        if (msg.method === 'initialize')    client.send(rpcResult(msg.id, { serverCapabilities: {} }));
        if (msg.method === 'session/new')   client.send(rpcResult(msg.id, { sessionId: 'ses-2' }));
        if (msg.method === 'session/prompt') {
          client.send(rpcServerRequest(99, 'session/request_permission', { sessionId: 'ses-2', tool: { name: 'bash', description: 'ls' } }));
        }
        if (msg.result && msg.id === 99) {
          permissionResponseDecision = msg.result.decision;
          client.send(notify('session/update', { sessionId: 'ses-2', type: 'completed', content: 'done' }));
        }
      });
    });

    const { cbs, calls } = makeCallbacks();
    const mgr = new AcpSessionManager({ url: `ws://localhost:${port}`, auto_approve: true }, cbs);
    mgr.dispatch('card-2', 'bob', 'run bash', 'run-2');

    await waitFor(() => calls.onComplete.length > 0);
    expect(permissionResponseDecision).toBe('allow');
    expect(calls.onComplete[0][2]).toBe('completed');
  });
});

describe('AcpSessionManager - auto_approve=false', () => {
  it('emits run.permission_request SSE and fails run', async () => {
    wss.once('connection', (client: WsType) => {
      client.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { id: number; method: string };
        if (msg.method === 'initialize')    client.send(rpcResult(msg.id, { serverCapabilities: {} }));
        if (msg.method === 'session/new')   client.send(rpcResult(msg.id, { sessionId: 'ses-3' }));
        if (msg.method === 'session/prompt') {
          client.send(rpcServerRequest(77, 'session/request_permission', { sessionId: 'ses-3', tool: { name: 'bash', description: 'rm -rf /' } }));
        }
      });
    });

    const { cbs, calls } = makeCallbacks();
    const mgr = new AcpSessionManager({ url: `ws://localhost:${port}`, auto_approve: false }, cbs);
    mgr.dispatch('card-3', 'bob', 'dangerous task', 'run-3');

    await waitFor(() => calls.onComplete.length > 0);

    const permEvents = calls.onEvent.filter((a) => a[1] === 'run.permission_request');
    expect(permEvents).toHaveLength(1);
    expect(calls.onComplete.length).toBe(1);
    expect(calls.onComplete[0][2]).toBe('failed');
  });
});

describe('AcpSessionManager - timeout', () => {
  it('fails run if no response within timeoutMs', async () => {
    wss.once('connection', (client: WsType) => {
      client.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { id: number; method: string };
        if (msg.method === 'initialize')  client.send(rpcResult(msg.id, { serverCapabilities: {} }));
        if (msg.method === 'session/new') client.send(rpcResult(msg.id, { sessionId: 'ses-4' }));
        // no response to session/prompt
      });
    });

    const { cbs, calls } = makeCallbacks();
    const mgr = new AcpSessionManager({ url: `ws://localhost:${port}`, auto_approve: false }, cbs, 200);
    mgr.dispatch('card-4', 'bob', 'slow task', 'run-4');

    await waitFor(() => calls.onComplete.length > 0, 3000);
    expect(calls.onComplete[0][2]).toBe('failed');
    expect(String(calls.onComplete[0][3])).toContain('timed out');
  });
});

describe('AcpSessionManager - WS error', () => {
  it('fails run if server closes immediately', async () => {
    wss.once('connection', (client: WsType) => {
      client.close();
    });

    const { cbs, calls } = makeCallbacks();
    const mgr = new AcpSessionManager({ url: `ws://localhost:${port}`, auto_approve: false }, cbs);
    mgr.dispatch('card-5', 'bob', 'any', 'run-5');

    await waitFor(() => calls.onComplete.length > 0);
    expect(calls.onComplete[0][2]).toBe('failed');
  });
});
