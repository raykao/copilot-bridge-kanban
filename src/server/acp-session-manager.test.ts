import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { WebSocket as WsType } from 'ws';
import { AcpSessionManager } from './acp-session-manager.js';
import type { DispatchCallbacks } from './card-session-manager.js';

function makeCallbacks(): { cbs: DispatchCallbacks; calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {
    onRunCreated: [], onEvent: [], onComplete: [], onAgentMessage: [], onPermissionRequest: [], onInterrupted: [],
  };
  const cbs: DispatchCallbacks = {
    onRunCreated: (...args) => { calls.onRunCreated.push(args); },
    onEvent: (...args) => { calls.onEvent.push(args); },
    onComplete: (...args) => { calls.onComplete.push(args); },
    onAgentMessage: (...args) => { calls.onAgentMessage.push(args); },
    onPermissionRequest: (...args) => { calls.onPermissionRequest.push(args); },
    onInterrupted: (...args) => { calls.onInterrupted.push(args); },
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
  it('waits for resume, sends decision, and completes run', async () => {
    let permissionResponseDecision: string | null = null;
    wss.once('connection', (client: WsType) => {
      client.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { id: number; method?: string; result?: { decision: string } };
        if (msg.method === 'initialize')    client.send(rpcResult(msg.id, { serverCapabilities: {} }));
        if (msg.method === 'session/new')   client.send(rpcResult(msg.id, { sessionId: 'ses-3' }));
        if (msg.method === 'session/prompt') {
          client.send(rpcServerRequest(77, 'session/request_permission', { sessionId: 'ses-3', tool: { name: 'bash', description: 'rm -rf /' } }));
        }
        if (msg.result && msg.id === 77) {
          permissionResponseDecision = msg.result.decision;
          client.send(notify('session/update', { sessionId: 'ses-3', type: 'completed', content: 'resumed' }));
        }
      });
    });

    const { cbs, calls } = makeCallbacks();
    const mgr = new AcpSessionManager({ url: `ws://localhost:${port}`, auto_approve: false }, cbs);
    mgr.dispatch('card-3', 'bob', 'dangerous task', 'run-3');

    await waitFor(() => calls.onPermissionRequest.length > 0);
    expect(calls.onPermissionRequest[0]).toEqual(['card-3', 'run-3', 77, 'bash']);

    mgr.resume('allow');

    await waitFor(() => calls.onComplete.length > 0);
    expect(permissionResponseDecision).toBe('allow');
    expect(calls.onComplete.length).toBe(1);
    expect(calls.onComplete[0][2]).toBe('completed');
  });

  it('cancelPendingPermission sends deny and suppresses later completion', async () => {
    let permissionResponseDecision: string | null = null;
    wss.once('connection', (client: WsType) => {
      client.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { id: number; method?: string; result?: { decision: string } };
        if (msg.method === 'initialize') client.send(rpcResult(msg.id, { serverCapabilities: {} }));
        if (msg.method === 'session/new') client.send(rpcResult(msg.id, { sessionId: 'ses-cancel' }));
        if (msg.method === 'session/prompt') {
          client.send(rpcServerRequest(88, 'session/request_permission', { sessionId: 'ses-cancel', tool: { name: 'bash' } }));
        }
        if (msg.result && msg.id === 88) {
          permissionResponseDecision = msg.result.decision;
          client.send(notify('session/update', { sessionId: 'ses-cancel', type: 'completed', content: 'too late' }));
          setTimeout(() => client.close(), 0);
        }
      });
    });

    const { cbs, calls } = makeCallbacks();
    const mgr = new AcpSessionManager({ url: `ws://localhost:${port}`, auto_approve: false }, cbs);
    mgr.dispatch('card-cancel', 'bob', 'dangerous task', 'run-cancel');

    await waitFor(() => calls.onPermissionRequest.length > 0);
    mgr.cancelPendingPermission();

    await waitFor(() => permissionResponseDecision === 'deny');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(calls.onComplete).toHaveLength(0);
    expect(calls.onAgentMessage).toHaveLength(0);
  });

  it('fork isolates concurrent permission requests from the same base manager', async () => {
    let connectionCount = 0;
    const permissionResponses = new Map<string, string>();

    wss.on('connection', (client: WsType) => {
      connectionCount += 1;
      const sessionId = `ses-fork-${connectionCount}`;
      const permissionRequestId = 500 + connectionCount;

      client.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { id: number; method?: string; result?: { decision: string } };
        if (msg.method === 'initialize') client.send(rpcResult(msg.id, { serverCapabilities: {} }));
        if (msg.method === 'session/new') client.send(rpcResult(msg.id, { sessionId }));
        if (msg.method === 'session/prompt') {
          client.send(rpcServerRequest(
            permissionRequestId,
            'session/request_permission',
            { sessionId, tool: { name: 'bash', description: `tool-${sessionId}` } },
          ));
        }
        if (msg.result && msg.id === permissionRequestId) {
          permissionResponses.set(sessionId, msg.result.decision);
          client.send(notify('session/update', { sessionId, type: 'completed', content: msg.result.decision }));
        }
      });
    });

    const { cbs, calls } = makeCallbacks();
    const baseMgr = new AcpSessionManager({ url: `ws://localhost:${port}`, auto_approve: false }, cbs);
    const runMgr1 = baseMgr.fork(cbs);
    const runMgr2 = baseMgr.fork(cbs);

    runMgr1.dispatch('card-6', 'bob', 'first dangerous task', 'run-6a');
    runMgr2.dispatch('card-6', 'bob', 'second dangerous task', 'run-6b');

    await waitFor(() => calls.onPermissionRequest.length === 2);
    expect(new Set(calls.onPermissionRequest.map((args) => args[1]))).toEqual(new Set(['run-6a', 'run-6b']));

    runMgr2.resume('deny');
    runMgr1.resume('allow');

    await waitFor(() => calls.onComplete.length === 2);
    expect([...permissionResponses.values()].sort()).toEqual(['allow', 'deny']);
    expect(calls.onComplete.every((args) => args[2] === 'completed')).toBe(true);
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


describe('AcpSessionManager - interrupted on WS close', () => {
  it('marks run as interrupted (not failed) when server advertises resume capability and WS closes mid-run', async () => {
    wss.once('connection', (client: WsType) => {
      client.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { id: number; method: string };
        if (msg.method === 'initialize') client.send(rpcResult(msg.id, { serverCapabilities: { session: { resume: true } } }));
        if (msg.method === 'session/new') client.send(rpcResult(msg.id, { sessionId: 'ses-int-1' }));
        if (msg.method === 'session/prompt') client.close();
      });
    });

    const { cbs, calls } = makeCallbacks();
    const mgr = new AcpSessionManager({ url: `ws://localhost:${port}`, auto_approve: false }, cbs);
    mgr.dispatch('card-int', 'bob', 'do something', 'run-int');
    await waitFor(() => calls.onInterrupted.length > 0);

    expect(calls.onInterrupted).toHaveLength(1);
    expect(calls.onInterrupted[0]).toEqual(['card-int', 'run-int']);
    expect(calls.onComplete).toHaveLength(0);
  });

  it('does not fail completion when WS closes while session/new is in flight after resume is advertised', async () => {
    wss.once('connection', (client: WsType) => {
      client.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { id: number; method: string };
        if (msg.method === 'initialize') client.send(rpcResult(msg.id, { serverCapabilities: { session: { resume: true } } }));
        if (msg.method === 'session/new') client.close();
      });
    });

    const { cbs, calls } = makeCallbacks();
    const mgr = new AcpSessionManager({ url: `ws://localhost:${port}`, auto_approve: false }, cbs);
    mgr.dispatch('card-int-new', 'bob', 'do something', 'run-int-new');
    await waitFor(() => calls.onInterrupted.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(calls.onInterrupted).toHaveLength(1);
    expect(calls.onInterrupted[0]).toEqual(['card-int-new', 'run-int-new']);
    expect(calls.onComplete).toHaveLength(0);
  });
});

describe('AcpSessionManager - resumeSession', () => {
  it('calls session/resume handshake and completes on session/update type=completed', async () => {
    let connectionCount = 0;
    wss.on('connection', (client: WsType) => {
      connectionCount += 1;
      const currentConnection = connectionCount;
      client.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { id: number; method: string };
        if (currentConnection === 1) {
          if (msg.method === 'initialize') client.send(rpcResult(msg.id, { serverCapabilities: { session: { resume: true } } }));
          if (msg.method === 'session/new') {
            client.send(rpcResult(msg.id, { sessionId: 'ses-resume-1' }));
            setTimeout(() => client.close(), 0);
          }
        } else {
          if (msg.method === 'initialize') client.send(rpcResult(msg.id, { serverCapabilities: { session: { resume: true } } }));
          if (msg.method === 'session/resume') {
            client.send(rpcResult(msg.id, { ok: true }));
            client.send(notify('session/update', { sessionId: 'ses-resume-1', type: 'completed', content: 'resumed done' }));
          }
        }
      });
    });

    const { cbs, calls } = makeCallbacks();
    const baseMgr = new AcpSessionManager({ url: `ws://localhost:${port}`, auto_approve: false }, cbs);
    const runMgr = baseMgr.fork(cbs);
    runMgr.dispatch('card-res', 'bob', 'initial prompt', 'run-res');

    await waitFor(() => calls.onInterrupted.length > 0);
    expect(calls.onRunCreated[0]).toEqual(['run-res', 'ses-resume-1']);

    const resumeMgr = baseMgr.fork(cbs);
    resumeMgr.resumeSession('card-res', 'bob', 'run-res', 'ses-resume-1');

    await waitFor(() => calls.onComplete.length > 0);
    expect(calls.onComplete[0]).toEqual(['card-res', 'run-res', 'completed']);
    expect(calls.onAgentMessage[0]).toEqual(['card-res', 'run-res', 'bob', 'resumed done']);
  });

  it('does not fail completion when WS closes while session/resume is in flight after resume is advertised', async () => {
    wss.once('connection', (client: WsType) => {
      client.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { id: number; method: string };
        if (msg.method === 'initialize') client.send(rpcResult(msg.id, { serverCapabilities: { session: { resume: true } } }));
        if (msg.method === 'session/resume') client.close();
      });
    });

    const { cbs, calls } = makeCallbacks();
    const mgr = new AcpSessionManager({ url: `ws://localhost:${port}`, auto_approve: false }, cbs);
    mgr.resumeSession('card-res-close', 'bob', 'run-res-close', 'ses-resume-close');
    await waitFor(() => calls.onInterrupted.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(calls.onInterrupted).toHaveLength(1);
    expect(calls.onInterrupted[0]).toEqual(['card-res-close', 'run-res-close']);
    expect(calls.onComplete).toHaveLength(0);
  });
});
