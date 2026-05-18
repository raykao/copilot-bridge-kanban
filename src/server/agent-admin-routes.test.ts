import { afterEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { COOKIE_NAME, createSession, createUser, registerSessionMiddleware } from './auth.js';
import { registerAgentAdminRoutes } from './agent-admin-routes.js';
import { createDatabase, initializeSchema } from './db.js';
import { createServer } from './server.js';
import type { AppConfig } from './config.js';
import type { DispatchCallbacks } from './card-session-manager.js';
import type { ProviderRegistry } from './providers/registry.js';

const config: AppConfig = {
  port: 3000,
  bridgeApiUrl: 'http://localhost:7878',
  bridgeApiKey: 'test-key',
  kanbanBaseUrl: 'http://localhost:3000',
  sessionSecret: 'secret',
  dbPath: ':memory:',
  logLevel: 'silent',
};

const apps: Array<{ db: Database.Database; server: FastifyInstance }> = [];

afterEach(async () => {
  for (const { db, server } of apps.splice(0)) {
    await server.close();
    db.close();
  }
});

async function createTestApp(): Promise<{
  db: Database.Database;
  server: FastifyInstance;
  cookie: string;
  registry: { addProvider: ReturnType<typeof vi.fn>; removeProvider: ReturnType<typeof vi.fn> };
}> {
  const db = createDatabase(':memory:');
  initializeSchema(db);
  const server = await createServer(config);
  registerSessionMiddleware(server, db);
  const registry = {
    addProvider: vi.fn(),
    removeProvider: vi.fn(),
  };
  const providerRegistry = {
    ...registry,
    getAllHealth: () => [],
  } as unknown as ProviderRegistry;
  const callbacks = {
    onRunCreated: vi.fn(),
    onEvent: vi.fn(),
    onComplete: vi.fn(),
    onAgentMessage: vi.fn(),
    onPermissionRequest: vi.fn(),
    onInterrupted: vi.fn(),
  } as DispatchCallbacks;
  registerAgentAdminRoutes(server, db, providerRegistry, callbacks, new Map());

  const user = await createUser(db, 'alice', 'password');
  const session = createSession(db, user.id);
  const cookie = `${COOKIE_NAME}=${session}`;

  apps.push({ db, server });
  return { db, server, cookie, registry };
}

describe('GET /api/admin/agents', () => {
  it('returns empty list', async () => {
    const { server, cookie } = await createTestApp();
    const res = await server.inject({ method: 'GET', url: '/api/admin/agents', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ agents: [] });
  });

  it('returns created agents', async () => {
    const { server, cookie } = await createTestApp();
    await server.inject({
      method: 'POST', url: '/api/admin/agents', headers: { cookie },
      payload: { name: 'bob', url: 'ws://localhost:3030/bob' },
    });
    const res = await server.inject({ method: 'GET', url: '/api/admin/agents', headers: { cookie } });
    const body = JSON.parse(res.body);
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].name).toBe('bob');
  });
});

describe('POST /api/admin/agents', () => {
  it('creates an agent with defaults', async () => {
    const { server, cookie } = await createTestApp();
    const res = await server.inject({
      method: 'POST', url: '/api/admin/agents', headers: { cookie },
      payload: { name: 'bob', url: 'ws://localhost:3030/bob' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.agent.name).toBe('bob');
    expect(body.agent.protocol).toBe('acp');
    expect(body.agent.auto_approve).toBe(false);
  });

  it('derives label from URL if name is missing', async () => {
    const { server, cookie } = await createTestApp();
    const res = await server.inject({
      method: 'POST', url: '/api/admin/agents', headers: { cookie },
      payload: { url: 'ws://localhost:3030/bob' },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).agent.name).toBe('localhost:3030');
  });

  it('derives label from URL if name is blank', async () => {
    const { server, cookie } = await createTestApp();
    const res = await server.inject({
      method: 'POST', url: '/api/admin/agents', headers: { cookie },
      payload: { name: '   ', url: 'not a url' },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).agent.name).toBe('not a url');
  });

  it('returns 400 if url is missing', async () => {
    const { server, cookie } = await createTestApp();
    const res = await server.inject({
      method: 'POST', url: '/api/admin/agents', headers: { cookie },
      payload: { name: 'bob' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/admin/agents calls registry.addProvider for generic-acp', async () => {
    const { server, cookie, registry } = await createTestApp();
    const res = await server.inject({
      method: 'POST', url: '/api/admin/agents', headers: { cookie },
      payload: { name: 'test', protocol: 'generic-acp', url: 'http://test:9999' },
    });
    expect(res.statusCode).toBe(201);
    expect(registry.addProvider).toHaveBeenCalledTimes(1);
    expect(registry.addProvider.mock.calls[0][0].baseUrl).toBe('http://test:9999');
  });

  it('POST /api/admin/agents calls registry.addProvider for copilot-bridge', async () => {
    const { server, cookie, registry } = await createTestApp();
    const res = await server.inject({
      method: 'POST', url: '/api/admin/agents', headers: { cookie },
      payload: { name: 'bridge', protocol: 'copilot-bridge', url: 'http://bridge:3030' },
    });
    expect(res.statusCode).toBe(201);
    expect(registry.addProvider).toHaveBeenCalledTimes(1);
    expect(registry.addProvider.mock.calls[0][0].type).toBe('copilot-bridge');
  });
});

describe('GET /api/admin/agents/:id', () => {
  it('returns the agent', async () => {
    const { server, cookie } = await createTestApp();
    const create = await server.inject({
      method: 'POST', url: '/api/admin/agents', headers: { cookie },
      payload: { name: 'bob', url: 'ws://localhost:3030/bob' },
    });
    const { agent } = JSON.parse(create.body);
    const res = await server.inject({ method: 'GET', url: `/api/admin/agents/${agent.id}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).agent.id).toBe(agent.id);
  });

  it('returns 404 for unknown id', async () => {
    const { server, cookie } = await createTestApp();
    const res = await server.inject({ method: 'GET', url: '/api/admin/agents/nope', headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /api/admin/agents/:id', () => {
  it('patches url and auto_approve', async () => {
    const { server, cookie } = await createTestApp();
    const create = await server.inject({
      method: 'POST', url: '/api/admin/agents', headers: { cookie },
      payload: { name: 'bob', url: 'ws://localhost:3030/bob' },
    });
    const { agent } = JSON.parse(create.body);
    const res = await server.inject({
      method: 'PATCH', url: `/api/admin/agents/${agent.id}`, headers: { cookie },
      payload: { url: 'ws://localhost:9999/bob', auto_approve: true },
    });
    expect(res.statusCode).toBe(200);
    const updated = JSON.parse(res.body).agent;
    expect(updated.url).toBe('ws://localhost:9999/bob');
    expect(updated.auto_approve).toBe(true);
    expect(updated.name).toBe('bob');
  });

  it('patches name to null', async () => {
    const { server, cookie } = await createTestApp();
    const create = await server.inject({
      method: 'POST', url: '/api/admin/agents', headers: { cookie },
      payload: { name: 'bob', url: 'ws://localhost:3030/bob' },
    });
    const { agent } = JSON.parse(create.body);
    const res = await server.inject({
      method: 'PATCH', url: `/api/admin/agents/${agent.id}`, headers: { cookie },
      payload: { name: null },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).agent.name).toBeNull();
  });

  it('patches empty string name to null', async () => {
    const { server, cookie } = await createTestApp();
    const create = await server.inject({
      method: 'POST', url: '/api/admin/agents', headers: { cookie },
      payload: { name: 'bob', url: 'ws://localhost:3030/bob' },
    });
    const { agent } = JSON.parse(create.body);
    const res = await server.inject({
      method: 'PATCH', url: `/api/admin/agents/${agent.id}`, headers: { cookie },
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).agent.name).toBeNull();
  });

  it('returns 404 for unknown id', async () => {
    const { server, cookie } = await createTestApp();
    const res = await server.inject({
      method: 'PATCH', url: '/api/admin/agents/nope', headers: { cookie },
      payload: { url: 'ws://x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /api/admin/agents/:id calls registry re-register when url changes', async () => {
    const { server, cookie, registry } = await createTestApp();
    const create = await server.inject({
      method: 'POST', url: '/api/admin/agents', headers: { cookie },
      payload: { name: 'bob', protocol: 'generic-acp', url: 'http://oldhost:3000' },
    });
    const { agent } = JSON.parse(create.body);
    registry.addProvider.mockClear();
    registry.removeProvider.mockClear();
    const res = await server.inject({
      method: 'PATCH', url: `/api/admin/agents/${agent.id}`, headers: { cookie },
      payload: { url: 'http://newhost:4000' },
    });
    expect(res.statusCode).toBe(200);
    expect(registry.removeProvider).toHaveBeenCalledWith(agent.id);
    expect(registry.addProvider).toHaveBeenCalledTimes(1);
    expect(registry.addProvider.mock.calls[0][0].baseUrl).toBe('http://newhost:4000');
  });

  it('PATCH /api/admin/agents/:id does NOT call registry when only name changes', async () => {
    const { server, cookie, registry } = await createTestApp();
    const create = await server.inject({
      method: 'POST', url: '/api/admin/agents', headers: { cookie },
      payload: { name: 'bob', protocol: 'generic-acp', url: 'http://oldhost:3000' },
    });
    const { agent } = JSON.parse(create.body);
    registry.addProvider.mockClear();
    registry.removeProvider.mockClear();
    const res = await server.inject({
      method: 'PATCH', url: `/api/admin/agents/${agent.id}`, headers: { cookie },
      payload: { name: 'new-label' },
    });
    expect(res.statusCode).toBe(200);
    expect(registry.removeProvider).not.toHaveBeenCalled();
    expect(registry.addProvider).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/agents/:id', () => {
  it('deletes the agent', async () => {
    const { server, cookie } = await createTestApp();
    const create = await server.inject({
      method: 'POST', url: '/api/admin/agents', headers: { cookie },
      payload: { name: 'bob', url: 'ws://localhost:3030/bob' },
    });
    const { agent } = JSON.parse(create.body);
    const del = await server.inject({ method: 'DELETE', url: `/api/admin/agents/${agent.id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
    const get = await server.inject({ method: 'GET', url: `/api/admin/agents/${agent.id}`, headers: { cookie } });
    expect(get.statusCode).toBe(404);
  });

  it('DELETE /api/admin/agents/:id calls registry.removeProvider', async () => {
    const { server, cookie, registry } = await createTestApp();
    const create = await server.inject({
      method: 'POST', url: '/api/admin/agents', headers: { cookie },
      payload: { name: 'bob', url: 'ws://localhost:3030/bob' },
    });
    const { agent } = JSON.parse(create.body);
    const del = await server.inject({ method: 'DELETE', url: `/api/admin/agents/${agent.id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
    expect(registry.removeProvider).toHaveBeenCalledWith(agent.id);
  });

  it('returns 404 for unknown id', async () => {
    const { server, cookie } = await createTestApp();
    const res = await server.inject({ method: 'DELETE', url: '/api/admin/agents/nope', headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });
});
