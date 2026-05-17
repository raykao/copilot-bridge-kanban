import type { AgentProvider, ProviderAgentCard } from './types.js';

export class ProviderRegistry {
  private providers = new Map<string, AgentProvider>();
  private nameIndex = new Map<string, string>(); // agentName -> providerId

  register(provider: AgentProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): AgentProvider | undefined {
    return this.providers.get(id);
  }

  getByName(agentName: string): AgentProvider | undefined {
    const providerId = this.nameIndex.get(agentName);
    if (providerId === undefined) return undefined;
    return this.providers.get(providerId);
  }

  async fanoutDiscover(): Promise<ProviderAgentCard[]> {
    const results = await Promise.allSettled(
      [...this.providers.values()].map(p => p.discover()),
    );
    const cards: ProviderAgentCard[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        cards.push(...result.value);
        // update name index
        for (const card of result.value) {
          // find which provider produced this card
          const provider = [...this.providers.values()].find(
            p => p.baseUrl === card.providerBaseUrl,
          );
          if (provider) this.nameIndex.set(card.name, provider.id);
        }
      } else {
        console.error('ProviderRegistry.fanoutDiscover error:', result.reason);
      }
    }
    return cards;
  }
}
