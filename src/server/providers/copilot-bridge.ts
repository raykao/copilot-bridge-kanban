import { CardSessionManager } from '../card-session-manager.js';
import type { AppConfig } from '../config.js';
import type { DispatchCallbacks } from '../card-session-manager.js';
import type { AgentProvider, ProviderAgentCard, ProviderType } from './types.js';

export class CopilotBridgeProvider implements AgentProvider {
  readonly type: ProviderType = 'copilot-bridge';
  readonly id: string;
  readonly baseUrl: string;
  private readonly manager: CardSessionManager;
  private readonly apiKey: string;

  constructor(id: string, config: AppConfig, callbacks: DispatchCallbacks) {
    this.id = id;
    this.baseUrl = config.bridgeApiUrl;
    this.apiKey = config.bridgeApiKey;
    this.manager = new CardSessionManager(config, callbacks);
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
    return body.cards.map((card) => ({
      ...card,
      providerType: 'copilot-bridge',
      providerBaseUrl: this.baseUrl,
    }));
  }

  dispatch(
    agentName: string,
    input: string,
    cardId: string,
    kanbanRunId: string,
    callbacks: DispatchCallbacks,
  ): void {
    this.manager.dispatch(cardId, agentName, input, kanbanRunId);
  }

  resumeRun(): void {
    console.warn('CopilotBridgeProvider.resumeRun: use card-routes resume endpoint instead');
  }
}
