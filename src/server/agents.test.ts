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

const providerCard: ProviderAgentCard = {
  name: 'bob',
  description: 'Bob agent',
  version: '1.0.0',
  supportedInterfaces: [{
    url: 'http://test:3030/agents/bob',
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
  providerBaseUrl: 'http://test:3030',
};

const apps: Array<{
  db: Database.Database;
  server: FastifyInstance;
  sseManager: SseManager;
  registry: ProviderRegistry;
}> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();

  for (const { db, server, sseManager, registry } of apps.splice(0)) {
    registry.shutdown();
    sseManager.shutdown();
    await server.close();
    db.close();
  }
});

async function createAgentApp(registry: ProviderRegistry = new ProviderRegistry()): Promise<{
  db: Database.Database;
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

  apps.push({ db, server, sseManager, registry });
  return { db, server, sessionId };
}

describe('registerAgentRoutes', () => {
  it('proxies agent list requests and injects bridge auth headers', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ agents: ['bob'] }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { server, sessionId } = await createAgentApp();

    const response = await server.inject({
      method: 'GET',
      url: '/api/agents',
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ agents: ['bob'] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:7878/v1/agents',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer test-key',
        },
      }),
    );
  });

  it('proxies named agent requests to the bridge', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ name: 'bob' }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { server, sessionId } = await createAgentApp();

    const response = await server.inject({
      method: 'GET',
      url: '/api/agents/bob',
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ name: 'bob' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:7878/v1/agents/bob',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer test-key',
        },
      }),
    );
  });

  it('returns 502 when the bridge adapter is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    }));

    const { server, sessionId } = await createAgentApp();

    const response = await server.inject({
      method: 'GET',
      url: '/api/agents',
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      error: 'Bridge unavailable',
      detail: 'connect ECONNREFUSED',
    });
  });

  it('forwards bridge error status codes', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'upstream failure' }), {
      status: 500,
      headers: {
        'content-type': 'application/json',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { server, sessionId } = await createAgentApp();

    const response = await server.inject({
      method: 'GET',
      url: '/api/agents',
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'upstream failure' });
  });

  it('GET /api/agents/provider-status returns provider list', async () => {
    const registry = new ProviderRegistry();
    const { server, sessionId } = await createAgentApp(registry);

    const response = await server.inject({
      method: 'GET',
      url: '/api/agents/provider-status',
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ providers: [] });
  });

  it('GET /api/agents/provider-status returns health data', async () => {
    const registry = new ProviderRegistry();
    const provider: AgentProvider = {
      id: 'p1',
      type: 'generic-acp',
      baseUrl: 'http://test:3030',
      discover: vi.fn(async () => [providerCard]),
      dispatch: () => undefined,
      resumeRun: () => undefined,
    };
    registry.register(provider);
    registry.startHealthMonitor();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    const { db, server, sessionId } = await createAgentApp(registry);
    db.prepare(
      `INSERT INTO agents (id, name, protocol, url, auto_approve, api_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('p1', 'Provider One', 'generic-acp', 'http://test:3030', 0, null, new Date().toISOString());

    const response = await server.inject({
      method: 'GET',
      url: '/api/agents/provider-status',
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().providers).toContainEqual(expect.objectContaining({ id: 'p1' }));
  });

  it('GET /api/sse/system returns SSE headers', async () => {
    const { server, sessionId } = await createAgentApp();

    const response = await server.inject({
      method: 'GET',
      url: '/api/sse/system',
      payloadAsStream: true,
      simulate: {
        close: true,
      },
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(String(response.headers['content-type'])).toContain('text/event-stream');
  });
});
