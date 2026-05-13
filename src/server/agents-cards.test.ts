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

describe('registerAgentRoutes agent cards', () => {
  it('proxies to bridge /v1/agents/cards with bearer token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ cards: [] }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { server, sessionId } = await createAgentApp();

    const response = await server.inject({
      method: 'GET',
      url: '/api/agents/cards',
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:7878/v1/agents/cards',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer test-key',
        },
      }),
    );
  });

  it('returns body and status from bridge unchanged', async () => {
    const bridgeBody = { error: 'upstream failure' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(bridgeBody), {
      status: 503,
      headers: {
        'content-type': 'application/problem+json',
      },
    })));

    const { server, sessionId } = await createAgentApp();

    const response = await server.inject({
      method: 'GET',
      url: '/api/agents/cards',
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toBe(JSON.stringify(bridgeBody));
  });

  it('returns 502 when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    }));

    const { server, sessionId } = await createAgentApp();

    const response = await server.inject({
      method: 'GET',
      url: '/api/agents/cards',
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

  it('resolves /api/agents/cards before /api/agents/:name', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ cards: [] }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { server, sessionId } = await createAgentApp();

    const response = await server.inject({
      method: 'GET',
      url: '/api/agents/cards',
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:7878/v1/agents/cards');
  });
});
