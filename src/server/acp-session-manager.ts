import WebSocket from 'ws';
import type { DispatchCallbacks } from './card-session-manager.js';

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
  constructor(
    private readonly agentConfig: AcpAgentConfig,
    private readonly callbacks: DispatchCallbacks,
    private readonly timeoutMs: number = 300_000,
  ) {}

  dispatch(cardId: string, bot: string, prompt: string, kanbanRunId: string): void {
    void this._run(cardId, bot, prompt, kanbanRunId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.callbacks.onComplete(cardId, kanbanRunId, 'failed', message);
    });
  }

  private async _run(cardId: string, bot: string, prompt: string, kanbanRunId: string): Promise<void> {
    const ws = this._openWebSocket();

    let rpcIdCounter = 0;
    const nextId = (): number => ++rpcIdCounter;

    const pending = new Map<number, { resolve: (result: unknown) => void; reject: (err: Error) => void }>();

    let contentBuffer = '';
    let sessionId: string | null = null;
    let completed = false;

    const timeoutHandle = setTimeout(() => {
      if (completed) return;
      completed = true;
      if (sessionId) {
        this._send(ws, { jsonrpc: '2.0', id: nextId(), method: 'session/cancel', params: { sessionId } });
      }
      ws.close();
      this.callbacks.onComplete(cardId, kanbanRunId, 'failed', 'ACP session timed out');
    }, this.timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timeoutHandle);
      pending.forEach(({ reject }) => reject(new Error('WebSocket closed')));
      pending.clear();
    };

    const onError = (error: string): void => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutHandle);
      ws.close();
      this.callbacks.onComplete(cardId, kanbanRunId, 'failed', error);
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
          void this._handleServerRequest(ws, onError, msg as unknown as RpcRequest, cardId, kanbanRunId, nextId)
            .catch(() => { /* ignore */ });
          return;
        }
      }

      if (isRpcNotification(msg)) {
        this._handleNotification(
          msg,
          cardId,
          kanbanRunId,
          bot,
          (chunk) => { contentBuffer += chunk; },
          () => {
            if (completed) return;
            completed = true;
            clearTimeout(timeoutHandle);
            ws.close();
            if (contentBuffer.trim()) {
              this.callbacks.onAgentMessage(cardId, kanbanRunId, bot, contentBuffer.trim());
            }
            this.callbacks.onComplete(cardId, kanbanRunId, 'completed');
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
        this.callbacks.onComplete(cardId, kanbanRunId, 'failed', 'ACP WebSocket closed unexpectedly');
      }
    });

    ws.on('error', (err) => {
      if (!completed) {
        completed = true;
        clearTimeout(timeoutHandle);
        ws.close();
        this.callbacks.onComplete(cardId, kanbanRunId, 'failed', err.message);
      }
    });

    await wsReady;

    // 1. initialize
    await call('initialize', { clientCapabilities: {} });

    // 2. session/new
    const newResult = await call('session/new', {}) as { sessionId: string };
    sessionId = newResult.sessionId;
    this.callbacks.onRunCreated(kanbanRunId, sessionId);

    // 3. session/prompt - responses come as notifications
    this._send(ws, { jsonrpc: '2.0', id: nextId(), method: 'session/prompt', params: { sessionId, prompt } });
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
    onError: (msg: string) => void,
    req: RpcRequest,
    cardId: string,
    _kanbanRunId: string,
    nextId: () => number,
  ): Promise<void> {
    if (req.method !== 'session/request_permission') return;

    console.log(`[acp] <- session/request_permission (id:${req.id})`);

    const params = req.params as Record<string, unknown>;
    const tool = params.tool as Record<string, unknown> | undefined;

    if (this.agentConfig.auto_approve) {
      this._send(ws, { jsonrpc: '2.0', id: req.id, result: { decision: 'allow' } });
      return;
    }

    // Emit SSE event so the UI can show approve/deny
    this.callbacks.onEvent(cardId, 'run.permission_request', {
      permissionId: String(req.id),
      tool,
    });
    // Phase 1: auto_approve=false denies and fails the run.
    // Phase 3 will add a proper resume path.
    this._send(ws, { jsonrpc: '2.0', id: req.id, result: { decision: 'deny' } });
    onError('permission required - use resume to approve');
  }
}
