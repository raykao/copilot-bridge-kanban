import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderRegistry } from './registry.js';
import type { AgentProvider, ProviderAgentCard } from './types.js';

const card: ProviderAgentCard = {
  name: 'bob',
  description: 'Bob agent',
  version: '1.0.0',
  supportedInterfaces: [{
    url: 'http://provider.example/agents/bob',
    protocolBinding: 'jsonrpc',
    protocolVersion: '1.0',
  }],
  capabilities: {
    streaming: true,
    pushNotifications: false,
  },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{
    id: 'chat',
    name: 'Chat',
    description: 'Chat with Bob',
    tags: ['chat'],
  }],
  providerType: 'generic-acp',
  providerBaseUrl: 'http://provider.example',
};

const registries: ProviderRegistry[] = [];

afterEach(() => {
  for (const registry of registries.splice(0)) {
    registry.shutdown();
  }
  vi.restoreAllMocks();
});

function createRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registries.push(registry);
  return registry;
}

function createProvider(discover: () => Promise<ProviderAgentCard[]>): AgentProvider {
  return {
    id: 'test-provider',
    type: 'generic-acp',
    baseUrl: 'http://provider.example',
    discover,
    dispatch: () => undefined,
    resumeRun: () => undefined,
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitForDiscovery(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ProviderRegistry health monitoring', () => {
  it('sets health status to discovering after register', () => {
    const registry = createRegistry();

    registry.register(createProvider(async () => [card]));

    expect(registry.getHealth('test-provider')).toEqual({
      status: 'discovering',
      agents: [],
      lastError: null,
      lastDiscoveredAt: null,
    });
  });

  it('sets status to connected and populates agents after successful health discovery', async () => {
    const registry = createRegistry();
    const discover = vi.fn(async () => [card]);
    registry.register(createProvider(discover));

    registry.startHealthMonitor();
    await waitForDiscovery();

    const health = registry.getHealth('test-provider');
    expect(discover).toHaveBeenCalledTimes(1);
    expect(health?.status).toBe('connected');
    expect(health?.agents).toEqual([card]);
    expect(health?.lastError).toBeNull();
    expect(health?.lastDiscoveredAt).toEqual(expect.any(String));
    await expect(registry.fanoutDiscover()).resolves.toEqual([card]);
  });

  it('sets status to disconnected and records lastError after failed health discovery', async () => {
    const registry = createRegistry();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registry.register(createProvider(async () => {
      throw new Error('provider unavailable');
    }));

    registry.startHealthMonitor();
    await waitForDiscovery();

    const health = registry.getHealth('test-provider');
    expect(health?.status).toBe('disconnected');
    expect(health?.agents).toEqual([]);
    expect(health?.lastError).toBe('provider unavailable');
    expect(health?.lastDiscoveredAt).toBeNull();
  });

  it('clears health and name index entries when removing a provider', async () => {
    const registry = createRegistry();
    registry.register(createProvider(async () => [card]));
    registry.startHealthMonitor();
    await waitForDiscovery();

    expect(registry.getByName('bob')).toBeDefined();

    registry.removeProvider('test-provider');

    expect(registry.getHealth('test-provider')).toBeUndefined();
    expect(registry.getByName('bob')).toBeUndefined();
  });

  it('does not restore health when removing a provider during discovery', async () => {
    const registry = createRegistry();
    const deferred = createDeferred<ProviderAgentCard[]>();
    const provider = createProvider(() => deferred.promise);

    registry.register(provider);
    registry.startHealthMonitor();
    registry.removeProvider(provider.id);
    deferred.resolve([card]);
    await waitForDiscovery();

    expect(registry.getHealth(provider.id)).toBeUndefined();
    await expect(registry.fanoutDiscover()).resolves.toEqual([]);
  });

  it('discovers immediately when adding a provider', async () => {
    const registry = createRegistry();
    const discover = vi.fn(async () => [card]);

    registry.addProvider(createProvider(discover));
    await waitForDiscovery();

    expect(discover).toHaveBeenCalledTimes(1);
    expect(registry.getHealth('test-provider')?.status).toBe('connected');
    expect(registry.getHealth('test-provider')?.agents).toEqual([card]);
  });

  it('fires state change callback when status transitions from discovering to connected', async () => {
    const registry = createRegistry();
    const onStateChange = vi.fn();
    registry.register(createProvider(async () => [card]));
    registry.setStateChangeCallback(onStateChange);

    registry.startHealthMonitor();
    await waitForDiscovery();

    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenCalledWith('test-provider', expect.objectContaining({
      status: 'connected',
      agents: [card],
    }));
  });
});
