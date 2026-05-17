import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { COOKIE_NAME, createSession, createUser, registerSessionMiddleware } from './auth.js';
import { registerAgentAdminRoutes } from './agent-admin-routes.js';
import { createDatabase, initializeSchema } from './db.js';
import { createServer } from './server.js';
import type { AppConfig } from './config.js';

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

async function createTestApp(): Promise<{ db: Database.Database; server: FastifyInstance; cookie: string }> {
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

  it('returns 404 for unknown id', async () => {
    const { server, cookie } = await createTestApp();
    const res = await server.inject({
      method: 'PATCH', url: '/api/admin/agents/nope', headers: { cookie },
      payload: { url: 'ws://x' },
    });
    expect(res.statusCode).toBe(404);
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

  it('returns 404 for unknown id', async () => {
    const { server, cookie } = await createTestApp();
    const res = await server.inject({ method: 'DELETE', url: '/api/admin/agents/nope', headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });
});
