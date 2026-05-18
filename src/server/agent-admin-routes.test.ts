import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { COOKIE_NAME, createSession, createUser, registerSessionMiddleware } from './auth.js';
import { registerAgentAdminRoutes } from './agent-admin-routes.js';
import { createDatabase, initializeSchema } from './db.js';
import { createServer } from './server.js';
import type { AppConfig } from './config.js';
import { createProvider } from './providers-db.js';
import { upsertDiscoveredAgent } from './agents-db.js';

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
}> {
  const db = createDatabase(':memory:');
  initializeSchema(db);
  const server = await createServer(config);
  registerSessionMiddleware(server, db);
  registerAgentAdminRoutes(server, db);

  const user = await createUser(db, 'alice', 'password');
  const session = createSession(db, user.id);
  const cookie = `${COOKIE_NAME}=${session}`;

  apps.push({ db, server });
  return { db, server, cookie };
}

function seedAgent(
  db: Database.Database,
  providerId: string,
  name: string,
): void {
  const card = { name, providerType: 'acp', providerBaseUrl: 'http://x' };
  upsertDiscoveredAgent(db, providerId, card, 'http://x', null, false);
}

describe('GET /api/admin/agents (auth)', () => {
  it('returns 401 without a session cookie', async () => {
    const db = createDatabase(':memory:');
    initializeSchema(db);
    const server = await createServer(config);
    registerSessionMiddleware(server, db);
    registerAgentAdminRoutes(server, db);
    apps.push({ db, server });

    const res = await server.inject({ method: 'GET', url: '/api/admin/agents' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/admin/agents', () => {
  it('returns empty list when no agents', async () => {
    const { server, cookie } = await createTestApp();
    const res = await server.inject({ method: 'GET', url: '/api/admin/agents', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ agents: [] });
  });

  it('returns all agents from all providers', async () => {
    const { db, server, cookie } = await createTestApp();
    const p1 = createProvider(db, { type: 'acp', label: 'p1', url: 'http://a:1' });
    const p2 = createProvider(db, { type: 'acp', label: 'p2', url: 'http://b:2' });
    seedAgent(db, p1.id, 'agent-a');
    seedAgent(db, p2.id, 'agent-b');

    const res = await server.inject({ method: 'GET', url: '/api/admin/agents', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { agents: Array<{ name: string }> };
    const names = body.agents.map((a) => a.name).sort();
    expect(names).toEqual(['agent-a', 'agent-b']);
  });

  it('filters by provider_id when query is present', async () => {
    const { db, server, cookie } = await createTestApp();
    const p1 = createProvider(db, { type: 'acp', label: 'p1', url: 'http://a:1' });
    const p2 = createProvider(db, { type: 'acp', label: 'p2', url: 'http://b:2' });
    seedAgent(db, p1.id, 'only-p1');
    seedAgent(db, p2.id, 'only-p2');

    const res = await server.inject({
      method: 'GET',
      url: `/api/admin/agents?provider_id=${encodeURIComponent(p1.id)}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { agents: Array<{ name: string }> };
    expect(body.agents.map((a) => a.name)).toEqual(['only-p1']);
  });

  it('returns empty array when provider_id matches nothing', async () => {
    const { server, cookie } = await createTestApp();
    const res = await server.inject({
      method: 'GET',
      url: '/api/admin/agents?provider_id=does-not-exist',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ agents: [] });
  });

  it('ignores empty provider_id', async () => {
    const { db, server, cookie } = await createTestApp();
    const p1 = createProvider(db, { type: 'acp', label: 'p1', url: 'http://a:1' });
    seedAgent(db, p1.id, 'a');

    const res = await server.inject({
      method: 'GET',
      url: '/api/admin/agents?provider_id=',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { agents: Array<{ name: string }> };
    expect(body.agents.map((a) => a.name)).toEqual(['a']);
  });
});

describe('GET /api/admin/agents/:id', () => {
  it('returns the agent by id', async () => {
    const { db, server, cookie } = await createTestApp();
    const p1 = createProvider(db, { type: 'acp', label: 'p1', url: 'http://a:1' });
    seedAgent(db, p1.id, 'lookup-me');
    const list = await server.inject({ method: 'GET', url: '/api/admin/agents', headers: { cookie } });
    const id = (JSON.parse(list.body) as { agents: Array<{ id: string }> }).agents[0].id;

    const res = await server.inject({ method: 'GET', url: `/api/admin/agents/${id}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { agent: { id: string; name: string } };
    expect(body.agent.id).toBe(id);
    expect(body.agent.name).toBe('lookup-me');
  });

  it('returns 404 for unknown id', async () => {
    const { server, cookie } = await createTestApp();
    const res = await server.inject({ method: 'GET', url: '/api/admin/agents/does-not-exist', headers: { cookie } });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Agent not found' });
  });
});

describe('POST/PATCH/DELETE /api/admin/agents (removed)', () => {
  it('POST /api/admin/agents returns 404 (route removed)', async () => {
    const { server, cookie } = await createTestApp();
    const res = await server.inject({
      method: 'POST',
      url: '/api/admin/agents',
      headers: { cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ url: 'http://x' }),
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /api/admin/agents/:id returns 404 (route removed)', async () => {
    const { server, cookie } = await createTestApp();
    const res = await server.inject({
      method: 'PATCH',
      url: '/api/admin/agents/any-id',
      headers: { cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'x' }),
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/admin/agents/:id returns 404 (route removed)', async () => {
    const { server, cookie } = await createTestApp();
    const res = await server.inject({
      method: 'DELETE',
      url: '/api/admin/agents/any-id',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
