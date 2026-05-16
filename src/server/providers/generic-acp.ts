import { subscribeToBridgeRunStream, type BridgeEvent } from '../bridge-stream.js';
import type { DispatchCallbacks } from '../card-session-manager.js';
import type { AgentProvider, ProviderAgentCard, ProviderType } from './types.js';

export class GenericAcpProvider implements AgentProvider {
  readonly type: ProviderType = 'generic-acp';

  private readonly cancelByRunId = new Map<string, () => void>();

  constructor(
    readonly id: string,
    readonly baseUrl: string,
    private readonly apiKey: string | null,
  ) {}

  async discover(): Promise<ProviderAgentCard[]> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/.well-known/agent-card.json`;
    const headers: Record<string, string> = {};
    if (this.apiKey !== null) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      throw new Error('GenericAcpProvider discover failed: ' + res.status);
    }

    const payload: unknown = await res.json();
    const card = payload as ProviderAgentCard;
    return [{ ...card, providerType: 'generic-acp', providerBaseUrl: this.baseUrl }];
  }

  dispatch(
    agentName: string,
    input: string,
    cardId: string,
    kanbanRunId: string,
    callbacks: DispatchCallbacks,
  ): void {
    const cancel = subscribeToBridgeRunStream({
      bridgeApiUrl: this.baseUrl,
      bridgeApiKey: this.apiKey ?? '',
      runId: kanbanRunId,
      bot: agentName,
      prompt: input,
      cardId,
      onReady: (bridgeRunId) => {
        callbacks.onRunCreated(kanbanRunId, bridgeRunId);
      },
      onEvent: (event) => this.handleEvent(cardId, kanbanRunId, agentName, event, callbacks),
      onClose: () => {
        this.cancelByRunId.delete(kanbanRunId);
      },
      onError: (status, body) => {
        const errorMessage = status === 0 ? body : `${status} ${body}`;
        callbacks.onComplete(cardId, kanbanRunId, 'failed', errorMessage);
      },
    });

    this.cancelByRunId.set(kanbanRunId, cancel);
  }

  resumeRun(runId: string, _acpDecision: string, callbacks: DispatchCallbacks): void {
    // TODO: Resume support is deferred until generic ACP permission continuation is defined.
    console.warn('GenericAcpProvider.resumeRun not yet implemented');
    callbacks.onComplete(runId, runId, 'failed', 'resumeRun not supported');
  }

  private handleEvent(
    cardId: string,
    kanbanRunId: string,
    bot: string,
    event: BridgeEvent,
    callbacks: DispatchCallbacks,
  ): void {
    const { type, data } = event;

    if (type === 'message.part') {
      callbacks.onEvent(cardId, 'message.part', data);
      return;
    }

    if (type === 'message.completed') {
      callbacks.onEvent(cardId, 'message.completed', data);
      const content = data.content;
      if (typeof content === 'string' && content.trim() !== '') {
        callbacks.onAgentMessage(cardId, kanbanRunId, bot, content);
      }
      return;
    }

    if (type === 'run.in_progress') {
      callbacks.onEvent(cardId, 'run.in_progress', { ...data, run_id: kanbanRunId });
      return;
    }

    if (type === 'run.awaiting') {
      const tool = typeof data.tool === 'string' ? data.tool : undefined;
      callbacks.onPermissionRequest(cardId, kanbanRunId, 0, tool);
      return;
    }

    if (type === 'run.completed') {
      callbacks.onComplete(cardId, kanbanRunId, 'completed');
      this.closeRun(kanbanRunId);
      return;
    }

    if (type === 'run.failed') {
      const error = typeof data.error === 'string' ? data.error : undefined;
      callbacks.onComplete(cardId, kanbanRunId, 'failed', error);
      this.closeRun(kanbanRunId);
    }
  }

  private closeRun(kanbanRunId: string): void {
    const cancel = this.cancelByRunId.get(kanbanRunId);
    if (!cancel) return;

    this.cancelByRunId.delete(kanbanRunId);
    cancel();
  }
}
