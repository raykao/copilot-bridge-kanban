import { AcpSessionManager } from '../acp-session-manager.js';
import type { DispatchCallbacks } from '../dispatch-types.js';
import type { AgentProvider, ProviderAgentCard, ProviderType } from './types.js';

export class CopilotBridgeProvider implements AgentProvider {
  readonly type: ProviderType = 'copilot-bridge';
  readonly id: string;
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultCallbacks: DispatchCallbacks;

  // Populated by discover(). Maps agent name -> ACP WebSocket URL.
  // e.g. 'bob' -> 'ws://localhost:3030/bob'
  private agentWsUrls: Map<string, string> = new Map();

  constructor(
    id: string,
    baseUrl: string,
    apiKey: string | null,
    callbacks: DispatchCallbacks,
  ) {
    this.id = id;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey ?? '';
    this.defaultCallbacks = callbacks;
  }

  async discover(): Promise<ProviderAgentCard[]> {
    const res = await fetch(`${this.baseUrl}/v1/agents/cards`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!res.ok) {
      throw new Error('CopilotBridgeProvider discover failed: ' + res.status);
    }

    const body = await res.json() as { cards: ProviderAgentCard[] };
    const cards = body.cards.map((card) => ({
      ...card,
      providerType: 'copilot-bridge' as ProviderType,
      providerBaseUrl: this.baseUrl,
    }));

    // Extract per-agent WS URLs from the ACP+WS supportedInterface entry.
    for (const card of cards) {
      const wsInterface = card.supportedInterfaces?.find(
        (i) => i.protocolBinding === 'ACP+WS',
      );
      if (wsInterface?.url) {
        this.agentWsUrls.set(card.name, wsInterface.url);
      }
    }

    return cards;
  }

  dispatch(
    agentName: string,
    input: string,
    cardId: string,
    kanbanRunId: string,
    callbacks: DispatchCallbacks,
  ): void {
    const wsUrl = this.agentWsUrls.get(agentName);
    if (!wsUrl) {
      callbacks.onComplete(
        cardId,
        kanbanRunId,
        'failed',
        `CopilotBridgeProvider: no WS URL for agent '${agentName}'. Run discovery first.`,
      );
      return;
    }
    const manager = new AcpSessionManager(
      {
        url: wsUrl,
        auto_approve: false,
        bearerToken: this.apiKey || undefined,
      },
      callbacks,
    );
    manager.dispatch(cardId, agentName, input, kanbanRunId);
  }

  resumeRun(): void {
    console.warn('CopilotBridgeProvider.resumeRun: use card-routes resume endpoint instead');
  }
}
