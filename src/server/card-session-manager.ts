import { streamBridgeRun, type BridgeEvent } from './bridge-stream.js';
import type { AppConfig } from './config.js';

export interface DispatchCallbacks {
  onRunCreated: (kanbanRunId: string, bridgeRunId: string) => void;
  onEvent: (cardId: string, eventType: string, data: Record<string, unknown>) => void;
  onComplete: (cardId: string, kanbanRunId: string, status: 'completed' | 'failed', error?: string) => void;
  onAgentMessage: (cardId: string, kanbanRunId: string, bot: string, content: string) => void;
  onPermissionRequest: (cardId: string, kanbanRunId: string, wsReqId: number, tool: string | undefined) => void;
  onInterrupted: (cardId: string, kanbanRunId: string) => void;
}

interface ActiveSession {
  kanbanRunId: string;
  bridgeRunId: string;
  cancel: () => void;
}

interface ActiveRun {
  card_id: string;
  id: string;
  bridge_run_id: string;
  agent_name: string;
}

export class CardSessionManager {
  private sessions = new Map<string, ActiveSession>();

  constructor(
    private config: AppConfig,
    private callbacks: DispatchCallbacks,
  ) {}

  dispatch(cardId: string, bot: string, prompt: string, kanbanRunId: string): void {
    void this.dispatchAsync(cardId, bot, prompt, kanbanRunId);
  }

  reconnectAll(activeRuns: ActiveRun[]): void {
    for (const run of activeRuns) {
      this.openStream(run.card_id, run.id, run.agent_name, run.bridge_run_id);
    }
  }

  close(cardId: string): void {
    const session = this.sessions.get(cardId);
    if (!session) return;

    this.sessions.delete(cardId);
    session.cancel();
  }

  private async dispatchAsync(cardId: string, bot: string, prompt: string, kanbanRunId: string): Promise<void> {
    try {
      const dispatchTimeout = new AbortController();
      const dispatchTimeoutId = setTimeout(() => dispatchTimeout.abort(), 15_000);
      let response: Response;
      try {
        response = await fetch(`${this.config.bridgeApiUrl}/runs`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.bridgeApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            agent_name: bot,
            input: [{ role: 'user', parts: [{ content: prompt }] }],
            session_id: cardId,
          }),
          signal: dispatchTimeout.signal,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        this.callbacks.onComplete(cardId, kanbanRunId, 'failed', `Bridge POST /runs failed: ${message}`);
        return;
      } finally {
        clearTimeout(dispatchTimeoutId);
      }

      if (response.status === 409) {
        console.warn('session already active for card, skipping dispatch');
        return;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const message = body
          ? `Bridge POST /runs failed: ${response.status} ${body}`
          : `Bridge POST /runs failed: ${response.status}`;
        this.callbacks.onComplete(cardId, kanbanRunId, 'failed', message);
        return;
      }

      const payload: unknown = await response.json();
      const bridgeRunId = this.extractRunId(payload);
      if (!bridgeRunId) {
        this.callbacks.onComplete(cardId, kanbanRunId, 'failed', 'Bridge POST /runs returned invalid run_id');
        return;
      }

      this.callbacks.onRunCreated(kanbanRunId, bridgeRunId);
      this.openStream(cardId, kanbanRunId, bot, bridgeRunId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      this.callbacks.onComplete(cardId, kanbanRunId, 'failed', `Bridge POST /runs failed: ${message}`);
    }
  }

  private extractRunId(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

    const runId = (payload as { run_id?: unknown }).run_id;
    return typeof runId === 'string' ? runId : null;
  }

  private openStream(cardId: string, kanbanRunId: string, bot: string, bridgeRunId: string): void {
    this.close(cardId);

    const cancel = streamBridgeRun({
      bridgeApiUrl: this.config.bridgeApiUrl,
      bridgeApiKey: this.config.bridgeApiKey,
      bridgeRunId,
      onEvent: (event) => this.handleEvent(cardId, kanbanRunId, bot, event),
      onClose: () => {
        this.sessions.delete(cardId);
      },
      onError: (status, body) => {
        const message = status === 0
          ? `Bridge stream failed: ${body}`
          : `Bridge stream failed: ${status} ${body}`;
        this.callbacks.onComplete(cardId, kanbanRunId, 'failed', message);
        this.close(cardId);
      },
    });

    this.sessions.set(cardId, { kanbanRunId, bridgeRunId, cancel });
  }

  private handleEvent(cardId: string, kanbanRunId: string, bot: string, event: BridgeEvent): void {
    const { type, data } = event;

    if (type === 'message.part') {
      this.callbacks.onEvent(cardId, 'message.part', data);
      return;
    }

    if (type === 'message.completed') {
      this.callbacks.onEvent(cardId, 'message.completed', data);
      const content = data.content;
      if (typeof content === 'string' && content.trim() !== '') {
        this.callbacks.onAgentMessage(cardId, kanbanRunId, bot, content);
      }
      return;
    }

    if (type === 'run.awaiting') {
      this.callbacks.onEvent(cardId, 'run.awaiting', data);
      return;
    }

    if (type === 'run.completed') {
      this.callbacks.onComplete(cardId, kanbanRunId, 'completed');
      this.close(cardId);
      return;
    }

    if (type === 'run.failed') {
      const error = typeof data.error === 'string' ? data.error : undefined;
      this.callbacks.onComplete(cardId, kanbanRunId, 'failed', error);
      this.close(cardId);
    }
  }
}
