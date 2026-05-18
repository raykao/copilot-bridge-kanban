import WebSocket from 'ws';
import type { DispatchCallbacks } from './dispatch-types.js';

export interface AcpAgentConfig {
  url: string;
  auto_approve: boolean;
  bearerToken?: string;
}

// ---------------------------------------------------------------------------
// Internal JSON-RPC types
// ---------------------------------------------------------------------------

interface RpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: unknown;
}

interface RpcResult {
  jsonrpc: '2.0';
  id: number;
  result: unknown;
}

interface RpcError {
  jsonrpc: '2.0';
  id: number;
  error: { code: number; message: string };
}

interface RpcNotification {
  jsonrpc: '2.0';
  method: string;
  params: unknown;
}

type InboundMessage = RpcResult | RpcError | RpcNotification;

interface InitializeResult {
  serverCapabilities?: {
    session?: {
      resume?: boolean;
    };
  };
}

type RunLoopAction = (deps: {
  ws: WebSocket;
  call: (method: string, params: unknown) => Promise<unknown>;
  nextId: () => number;
  setSessionId: (id: string) => void;
  setServerAdvertisesResume: (v: boolean) => void;
}) => Promise<void>;

function isRpcResult(m: InboundMessage): m is RpcResult {
  return 'result' in m && !('error' in m) && !('method' in m);
}

function isRpcError(m: InboundMessage): m is RpcError {
  return 'error' in m;
}

function isRpcNotification(m: InboundMessage): m is RpcNotification {
  return !('id' in m) && 'method' in m;
}

// ---------------------------------------------------------------------------
// AcpSessionManager
// ---------------------------------------------------------------------------

export class AcpSessionManager {
  private pendingPermission: { wsReqId: number; ws: WebSocket; resolve: (acpDecision: string) => void } | null = null;
  private cancelActiveRun: (() => void) | null = null;

  constructor(
    private readonly agentConfig: AcpAgentConfig,
    private readonly callbacks: DispatchCallbacks,
    private readonly timeoutMs: number = 300_000,
  ) {}

  fork(callbacks: DispatchCallbacks = this.callbacks): AcpSessionManager {
    return new AcpSessionManager(this.agentConfig, callbacks, this.timeoutMs);
  }

  resume(acpDecision: string): void {
    if (!this.pendingPermission) return;
    const { wsReqId, ws, resolve } = this.pendingPermission;
    this.pendingPermission = null;
    resolve(acpDecision);
    this._send(ws, { jsonrpc: '2.0', id: wsReqId, result: { decision: acpDecision } });
  }

  cancelPendingPermission(acpDecision: string = 'deny'): void {
    this.resume(acpDecision);
    this.cancelActiveRun?.();
    this.cancelActiveRun = null;
  }

  dispatch(cardId: string, bot: string, prompt: string, kanbanRunId: string): void {
    void this._run(cardId, bot, prompt, kanbanRunId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.callbacks.onComplete(cardId, kanbanRunId, 'failed', message);
    });
  }

  resumeSession(cardId: string, bot: string, runId: string, sessionId: string): void {
    void this._resumeRun(cardId, bot, runId, sessionId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.callbacks.onComplete(cardId, runId, 'failed', message);
    });
  }

  private async _run(cardId: string, bot: string, prompt: string, kanbanRunId: string): Promise<void> {
    return this._runLoop(cardId, kanbanRunId, bot, null, async ({ ws, call, nextId, setSessionId, setServerAdvertisesResume }) => {
      const initResult = await call('initialize', { clientCapabilities: {} }) as InitializeResult;
      setServerAdvertisesResume(initResult?.serverCapabilities?.session?.resume === true);
      const newResult = await call('session/new', {}) as { sessionId: string };
      const sessionId = newResult.sessionId;
      setSessionId(sessionId);
      this.callbacks.onRunCreated(kanbanRunId, sessionId);
      this._send(ws, { jsonrpc: '2.0', id: nextId(), method: 'session/prompt', params: { sessionId, prompt } });
    });
  }

  private async _resumeRun(cardId: string, bot: string, runId: string, sessionId: string): Promise<void> {
    return this._runLoop(cardId, runId, bot, sessionId, async ({ call, setServerAdvertisesResume }) => {
      const initResult = await call('initialize', { clientCapabilities: {} }) as InitializeResult;
      setServerAdvertisesResume(initResult?.serverCapabilities?.session?.resume === true);
      await call('session/resume', { sessionId });
      // No session/prompt - agent resumes autonomously
    });
  }

  private async _runLoop(
    cardId: string,
    runId: string,
    bot: string,
    initialSessionId: string | null,
    action: RunLoopAction,
  ): Promise<void> {
    const ws = this._openWebSocket();

    let rpcIdCounter = 0;
    const nextId = (): number => ++rpcIdCounter;

    const pending = new Map<number, { resolve: (result: unknown) => void; reject: (err: Error) => void }>();

    let contentBuffer = '';
    let sessionId: string | null = initialSessionId;
    let completed = false;
    let serverAdvertisesResume = false;

    const setSessionId = (id: string): void => { sessionId = id; };
    const setServerAdvertisesResume = (v: boolean): void => { serverAdvertisesResume = v; };

    const timeoutHandle = setTimeout(() => {
      if (completed) return;
      completed = true;
      this.cancelActiveRun = null;
      if (sessionId) {
        this._send(ws, { jsonrpc: '2.0', id: nextId(), method: 'session/cancel', params: { sessionId } });
      }
      ws.close();
      this.callbacks.onComplete(cardId, runId, 'failed', 'ACP session timed out');
    }, this.timeoutMs);

    this.cancelActiveRun = (): void => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutHandle);
      ws.close();
    };

    const cleanup = (): void => {
      clearTimeout(timeoutHandle);
      this.cancelActiveRun = null;
      pending.forEach(({ reject }) => reject(new Error('WebSocket closed')));
      pending.clear();
    };

    const onError = (error: string): void => {
      if (completed) return;
      completed = true;
      this.cancelActiveRun = null;
      clearTimeout(timeoutHandle);
      ws.close();
      this.callbacks.onComplete(cardId, runId, 'failed', error);
    };

    const call = (method: string, params: unknown): Promise<unknown> => {
      const id = nextId();
      return new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        this._send(ws, { jsonrpc: '2.0', id, method, params });
      });
    };

    ws.on('message', (raw: Buffer | string) => {
      let msg: InboundMessage;
      try {
        msg = JSON.parse(raw.toString()) as InboundMessage;
      } catch {
        return;
      }

      if ('id' in msg && msg.id != null) {
        const msgWithId = msg as { id: number; result?: unknown; error?: unknown; method?: string };
        const handler = pending.get(msgWithId.id);
        if (handler) {
          pending.delete(msgWithId.id);
          if (isRpcError(msg)) {
            handler.reject(new Error(msg.error.message));
          } else if (isRpcResult(msg)) {
            handler.resolve(msg.result);
          }
          return;
        }

        // Server-initiated request (e.g. session/request_permission)
        if ('method' in msg) {
          if (completed) return;
          void this._handleServerRequest(ws, onError, msg as unknown as RpcRequest, cardId, runId, nextId)
            .catch(() => { /* ignore */ });
          return;
        }
      }

      if (isRpcNotification(msg)) {
        this._handleNotification(
          msg,
          cardId,
          runId,
          bot,
          (chunk) => { contentBuffer += chunk; },
          () => {
            if (completed) return;
            completed = true;
            this.cancelActiveRun = null;
            clearTimeout(timeoutHandle);
            ws.close();
            if (contentBuffer.trim()) {
              this.callbacks.onAgentMessage(cardId, runId, bot, contentBuffer.trim());
            }
            this.callbacks.onComplete(cardId, runId, 'completed');
          },
          onError,
        );
      }
    });

    const wsReady = new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', (err) => reject(err instanceof Error ? err : new Error(String(err))));
    });

    ws.on('close', () => {
      cleanup();
      if (!completed) {
        completed = true;
        this.cancelActiveRun = null;
        if (serverAdvertisesResume && sessionId !== null) {
          this.callbacks.onInterrupted(cardId, runId);
        } else {
          this.callbacks.onComplete(cardId, runId, 'failed', 'ACP WebSocket closed unexpectedly');
        }
      }
    });

    ws.on('error', (err) => {
      if (!completed) {
        completed = true;
        this.cancelActiveRun = null;
        clearTimeout(timeoutHandle);
        ws.close();
        this.callbacks.onComplete(cardId, runId, 'failed', err.message);
      }
    });

    try {
      await wsReady;
      await action({ ws, call, nextId, setSessionId, setServerAdvertisesResume });
    } catch (err) {
      if (completed) return;
      completed = true;
      this.cancelActiveRun = null;
      clearTimeout(timeoutHandle);
      ws.close();
      throw err;
    }
  }

  private _openWebSocket(): WebSocket {
    const headers: Record<string, string> = {};
    if (this.agentConfig.bearerToken) {
      headers['Authorization'] = `Bearer ${this.agentConfig.bearerToken}`;
    }
    return new WebSocket(this.agentConfig.url, { headers });
  }

  private _send(ws: WebSocket, msg: object): void {
    const method = (msg as { method?: string }).method;
    const id = (msg as { id?: number }).id;
    const label = method ?? 'result';
    console.log(`[acp] -> ${label}${id != null ? ` (id:${id})` : ''}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private _handleNotification(
    msg: RpcNotification,
    cardId: string,
    kanbanRunId: string,
    _bot: string,
    onChunk: (text: string) => void,
    onCompleted: () => void,
    onError: (err: string) => void,
  ): void {
    if (msg.method !== 'session/update') return;

    const params = msg.params as Record<string, unknown>;
    const type = params.type as string | undefined;
    const content = typeof params.content === 'string' ? params.content : '';

    console.log(`[acp] <- session/update type=${type ?? 'unknown'}`);

    if (type === 'streaming') {
      onChunk(content);
      this.callbacks.onEvent(cardId, 'message.part', { content });
      return;
    }

    if (type === 'completed') {
      if (content) onChunk(content);
      onCompleted();
      return;
    }

    if (type === 'error') {
      onError(content || 'ACP session error');
      return;
    }

    this.callbacks.onEvent(cardId, 'run.status', params as Record<string, unknown>);
  }

  private async _handleServerRequest(
    ws: WebSocket,
    _onError: (msg: string) => void,
    req: RpcRequest,
    cardId: string,
    kanbanRunId: string,
    _nextId: () => number,
  ): Promise<void> {
    if (req.method !== 'session/request_permission') return;

    console.log(`[acp] <- session/request_permission (id:${req.id})`);

    const params = req.params as Record<string, unknown>;
    const tool = params.tool as Record<string, unknown> | undefined;
    const toolName = typeof tool?.name === 'string' ? tool.name : undefined;

    if (this.agentConfig.auto_approve) {
      this._send(ws, { jsonrpc: '2.0', id: req.id, result: { decision: 'allow' } });
      return;
    }

    await new Promise<string>((resolve) => {
      this.pendingPermission = { wsReqId: req.id, ws, resolve };
      this.callbacks.onPermissionRequest(cardId, kanbanRunId, req.id, toolName);
    });
  }
}
