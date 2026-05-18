import { afterEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { COOKIE_NAME, createSession, createUser, registerSessionMiddleware } from './auth.js';
import { registerAgentRoutes } from './agents.js';
import type { AppConfig } from './config.js';
import { createDatabase, initializeSchema } from './db.js';
import { createServer } from './server.js';
import { ProviderRegistry } from './providers/registry.js';
import type { AgentProvider, ProviderAgentCard } from './providers/types.js';
import { SseManager } from './sse.js';

const config: AppConfig = {
  port: 3000,
  bridgeApiUrl: 'http://localhost:7878',
  bridgeApiKey: 'test-key',
  kanbanBaseUrl: 'http://localhost:3000',
  sessionSecret: 'secret',
  dbPath: ':memory:',
  logLevel: 'silent',
};

const apps: Array<{ db: Database.Database; server: FastifyInstance; sseManager: SseManager }> = [];
const registries: ProviderRegistry[] = [];

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

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();

  for (const { db, server, sseManager } of apps.splice(0)) {
    sseManager.shutdown();
    await server.close();
    db.close();
  }

  for (const registry of registries.splice(0)) {
    registry.shutdown();
  }
});

function createRegistry(discover: () => Promise<ProviderAgentCard[]>): ProviderRegistry {
  const registry = new ProviderRegistry();
  registries.push(registry);
  const provider: AgentProvider = {
    id: 'test-provider',
    type: 'generic-acp',
    baseUrl: 'http://provider.example',
    discover,
    dispatch: () => undefined,
    resumeRun: () => undefined,
  };
  registry.register(provider);
  return registry;
}

async function waitForDiscovery(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function createAgentApp(registry: ProviderRegistry = createRegistry(async () => [])): Promise<{
  server: FastifyInstance;
  sessionId: string;
}> {
  const db = createDatabase(':memory:');
  initializeSchema(db);

  const server = await createServer(config);
  registerSessionMiddleware(server, db);
  const sseManager = new SseManager();
  registerAgentRoutes(server, config, registry, db, sseManager);

  const user = await createUser(db, 'ray', 'secret-password');
  const sessionId = createSession(db, user.id);

  apps.push({ db, server, sseManager });
  return { server, sessionId };
}

describe('registerAgentRoutes agent cards', () => {
  it('returns cards from registry fanout discovery', async () => {
    const discover = vi.fn(async () => [card]);
    vi.stubGlobal('fetch', vi.fn());
    const registry = createRegistry(discover);
    registry.startHealthMonitor();
    await waitForDiscovery();

    const { server, sessionId } = await createAgentApp(registry);

    const response = await server.inject({
      method: 'GET',
      url: '/api/agents/cards',
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ cards: [card] });
    expect(discover).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns empty cards when registry discovery has no providers', async () => {
    const discover = vi.fn(async () => []);
    const registry = createRegistry(discover);
    registry.startHealthMonitor();
    await waitForDiscovery();

    const { server, sessionId } = await createAgentApp(registry);

    const response = await server.inject({
      method: 'GET',
      url: '/api/agents/cards',
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ cards: [] });
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it('returns 502 when registry discovery throws', async () => {
    const registry = new ProviderRegistry();
    const fanoutDiscover = vi.fn(async () => {
      throw new Error('registry unavailable');
    });
    registry.fanoutDiscover = fanoutDiscover;

    const { server, sessionId } = await createAgentApp(registry);

    const response = await server.inject({
      method: 'GET',
      url: '/api/agents/cards',
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      error: 'Agent discovery failed',
      detail: 'registry unavailable',
    });
    expect(fanoutDiscover).toHaveBeenCalledTimes(1);
  });

  it('resolves /api/agents/cards before /api/agents/:name', async () => {
    const discover = vi.fn(async () => [card]);
    vi.stubGlobal('fetch', vi.fn());
    const registry = createRegistry(discover);
    registry.startHealthMonitor();
    await waitForDiscovery();

    const { server, sessionId } = await createAgentApp(registry);

    const response = await server.inject({
      method: 'GET',
      url: '/api/agents/cards',
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ cards: [card] });
    expect(discover).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
