import { AcpSessionManager } from '../acp-session-manager.js';
import type { DispatchCallbacks } from '../dispatch-types.js';
import type { AgentProvider, ProviderAgentCard, ProviderType } from './types.js';

export class GenericAcpProvider implements AgentProvider {
  readonly type: ProviderType = 'generic-acp';

  // Set during discover(). null until first successful discovery.
  private wsUrl: string | null = null;

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

    // Extract WebSocket URL from the ACP+WS interface entry if present.
    // Fall back to converting the HTTP base URL to a WebSocket URL.
    const wsInterface = card.supportedInterfaces?.find(
      (i) => i.protocolBinding === 'ACP+WS',
    );
    if (wsInterface?.url) {
      this.wsUrl = wsInterface.url;
    } else {
      // Fallback: swap http(s) protocol to ws(s), keep host and port.
      this.wsUrl = this.baseUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://').replace(/\/+$/, '');
    }

    return [{ ...card, providerType: 'generic-acp', providerBaseUrl: this.baseUrl }];
  }

  dispatch(
    agentName: string,
    input: string,
    cardId: string,
    kanbanRunId: string,
    callbacks: DispatchCallbacks,
  ): void {
    if (!this.wsUrl) {
      callbacks.onComplete(cardId, kanbanRunId, 'failed', 'GenericAcpProvider: not yet discovered, no WS URL available');
      return;
    }
    const manager = new AcpSessionManager(
      {
        url: this.wsUrl,
        auto_approve: false,
        bearerToken: this.apiKey ?? undefined,
      },
      callbacks,
    );
    manager.dispatch(cardId, agentName, input, kanbanRunId);
  }

  resumeRun(runId: string, acpDecision: string, callbacks: DispatchCallbacks): void {
    // Session resumption requires the ACP session ID stored on the run row.
    // This is passed as acpDecision by card-routes.ts (reusing the parameter).
    // The full sessionId is needed; acpDecision here carries it via the resume
    // endpoint. If this.wsUrl is null, fail immediately.
    if (!this.wsUrl) {
      callbacks.onComplete(runId, runId, 'failed', 'GenericAcpProvider: not yet discovered, no WS URL available');
      return;
    }
    const manager = new AcpSessionManager(
      {
        url: this.wsUrl,
        auto_approve: false,
        bearerToken: this.apiKey ?? undefined,
      },
      callbacks,
    );
    manager.resumeSession(runId, '', runId, acpDecision);
  }
}
