import type { AgentProvider, ProviderAgentCard } from './types.js';

export type ProviderStatus = 'discovering' | 'connected' | 'disconnected';

export interface ProviderHealth {
  status: ProviderStatus;
  agents: ProviderAgentCard[];
  lastError: string | null;
  lastDiscoveredAt: string | null;
}

export type ProviderStateChangeCallback = (
  providerId: string,
  health: ProviderHealth,
) => void;

export type AgentsDiscoveredCallback = (
  providerId: string,
  cards: ProviderAgentCard[],
) => void;

export class ProviderRegistry {
  private providers = new Map<string, AgentProvider>();
  private nameIndex = new Map<string, string>(); // agentName -> providerId
  private health = new Map<string, ProviderHealth>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private retryAttempts = new Map<string, number>();
  private onStateChange: ProviderStateChangeCallback | null = null;
  private onAgentsDiscovered: AgentsDiscoveredCallback | null = null;

  register(provider: AgentProvider): void {
    this.providers.set(provider.id, provider);
    if (!this.health.has(provider.id)) {
      this.health.set(provider.id, {
        status: 'discovering',
        agents: [],
        lastError: null,
        lastDiscoveredAt: null,
      });
    }
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
    const cards: ProviderAgentCard[] = [];
    for (const health of this.health.values()) {
      cards.push(...health.agents);
    }
    return cards;
  }

  setStateChangeCallback(cb: ProviderStateChangeCallback): void {
    this.onStateChange = cb;
  }

  setAgentsDiscoveredCallback(cb: AgentsDiscoveredCallback): void {
    this.onAgentsDiscovered = cb;
  }

  getHealth(id: string): ProviderHealth | undefined {
    return this.health.get(id);
  }

  getAllHealth(): Array<{ id: string; health: ProviderHealth }> {
    return [...this.health.entries()].map(([id, health]) => ({ id, health }));
  }

  addProvider(provider: AgentProvider): void {
    this.providers.set(provider.id, provider);
    if (!this.health.has(provider.id)) {
      this.health.set(provider.id, {
        status: 'discovering',
        agents: [],
        lastError: null,
        lastDiscoveredAt: null,
      });
    }
    void this.discoverOne(provider);
  }

  removeProvider(id: string): void {
    this.providers.delete(id);
    this.clearTimer(id);
    this.health.delete(id);
    this.retryAttempts.delete(id);
    for (const [name, pid] of this.nameIndex) {
      if (pid === id) this.nameIndex.delete(name);
    }
  }

  triggerDiscover(id: string): boolean {
    const provider = this.providers.get(id);
    if (!provider) return false;
    this.clearTimer(id);
    void this.discoverOne(provider);
    return true;
  }

  startHealthMonitor(): void {
    for (const provider of this.providers.values()) {
      void this.discoverOne(provider);
    }
  }

  shutdown(): void {
    for (const id of [...this.retryTimers.keys()]) {
      this.clearTimer(id);
    }
  }

  private async discoverOne(provider: AgentProvider): Promise<void> {
    if (!this.isCurrentProvider(provider)) return;
    const prev = this.health.get(provider.id);
    this.setHealth(provider.id, {
      status: 'discovering',
      agents: prev?.agents ?? [],
      lastError: prev?.lastError ?? null,
      lastDiscoveredAt: prev?.lastDiscoveredAt ?? null,
    });
    try {
      const cards = await provider.discover();
      if (!this.isCurrentProvider(provider)) return;
      for (const card of cards) {
        this.nameIndex.set(card.name, provider.id);
      }
      this.retryAttempts.set(provider.id, 0);
      if (!this.isCurrentProvider(provider)) return;
      this.setHealth(provider.id, {
        status: 'connected',
        agents: cards,
        lastError: null,
        lastDiscoveredAt: new Date().toISOString(),
      });
      if (this.onAgentsDiscovered) {
        try {
          this.onAgentsDiscovered(provider.id, cards);
        } catch (err) {
          console.error(`ProviderRegistry: onAgentsDiscovered callback threw for ${provider.id}:`, err);
        }
      }
      this.scheduleRetry(provider.id, 60_000);
    } catch (err) {
      if (!this.isCurrentProvider(provider)) return;
      const attempt = (this.retryAttempts.get(provider.id) ?? 0) + 1;
      this.retryAttempts.set(provider.id, attempt);
      const delay = Math.min(5_000 * Math.pow(2, attempt - 1), 60_000);
      const msg = err instanceof Error ? err.message : String(err);
      // Log attempt 1 and each doubling (1,2,4,8,16) then go silent - backoff already handles retries
      if (attempt <= 5 || (attempt & (attempt - 1)) === 0) {
        console.error(`ProviderRegistry: ${provider.id} discover failed (attempt ${attempt}):`, msg);
      }
      if (!this.isCurrentProvider(provider)) return;
      this.setHealth(provider.id, {
        status: 'disconnected',
        agents: prev?.agents ?? [],
        lastError: msg,
        lastDiscoveredAt: prev?.lastDiscoveredAt ?? null,
      });
      this.scheduleRetry(provider.id, delay);
    }
  }

  private isCurrentProvider(provider: AgentProvider): boolean {
    return this.providers.get(provider.id) === provider;
  }

  private scheduleRetry(id: string, delayMs: number): void {
    this.clearTimer(id);
    const provider = this.providers.get(id);
    if (!provider) return;
    const timer = setTimeout(() => { void this.discoverOne(provider); }, delayMs);
    const maybeUnrefTimer = timer as ReturnType<typeof setTimeout> & { unref?: () => void };
    if (maybeUnrefTimer.unref) maybeUnrefTimer.unref();
    this.retryTimers.set(id, timer);
  }

  private clearTimer(id: string): void {
    const timer = this.retryTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.retryTimers.delete(id);
    }
  }

  private setHealth(id: string, health: ProviderHealth): void {
    const prev = this.health.get(id);
    this.health.set(id, health);
    if (this.onStateChange && prev !== undefined && prev.status !== health.status) {
      this.onStateChange(id, health);
    }
  }
}
