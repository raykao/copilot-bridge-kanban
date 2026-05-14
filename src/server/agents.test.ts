import { afterEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { COOKIE_NAME, createSession, createUser, registerSessionMiddleware } from './auth.js';
import { registerAgentRoutes } from './agents.js';
import type { AppConfig } from './config.js';
import { createDatabase, initializeSchema } from './db.js';
import { createServer } from './server.js';

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();

  for (const { db, server } of apps.splice(0)) {
    await server.close();
    db.close();
  }
});

async function createAgentApp(): Promise<{
  server: FastifyInstance;
  sessionId: string;
}> {
  const db = createDatabase(':memory:');
  initializeSchema(db);

  const server = await createServer(config);
  registerSessionMiddleware(server, db);
  registerAgentRoutes(server, config);

  const user = await createUser(db, 'ray', 'secret-password');
  const sessionId = createSession(db, user.id);

  apps.push({ db, server });
  return { server, sessionId };
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
});
