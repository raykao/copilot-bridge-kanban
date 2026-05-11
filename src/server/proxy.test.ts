import { afterEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { COOKIE_NAME, createSession, createUser, registerSessionMiddleware } from './auth.js';
import type { AppConfig } from './config.js';
import { createDatabase, initializeSchema } from './db.js';
import { registerBridgeProxy } from './proxy.js';
import { createServer } from './server.js';

const config: AppConfig = {
  port: 3000,
  bridgeApiUrl: 'http://localhost:7878',
  bridgeApiKey: 'test-key',
  sessionSecret: 'secret',
  dbPath: ':memory:',
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

async function createProxyApp(): Promise<{
  server: FastifyInstance;
  sessionId: string;
}> {
  const db = createDatabase(':memory:');
  initializeSchema(db);

  const server = await createServer(config);
  registerSessionMiddleware(server, db);
  registerBridgeProxy(server, config);

  const user = await createUser(db, 'ray', 'secret-password');
  const sessionId = createSession(db, user.id);

  apps.push({ db, server });
  return { server, sessionId };
}

describe('registerBridgeProxy', () => {
  it('proxies JSON requests and injects bridge auth headers', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: {
        'content-type': 'application/json',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { server, sessionId } = await createProxyApp();
    const payload = { title: 'Build proxy' };

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/cards',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:7878/v1/cards',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
        headers: expect.objectContaining({
          authorization: 'Bearer test-key',
          accept: 'application/json',
          'content-type': 'application/json',
        }),
      }),
    );
  });

  it('forwards query strings to the bridge adapter', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ cards: [] }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { server, sessionId } = await createProxyApp();

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/cards?agent=bob',
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:7878/v1/cards?agent=bob',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('proxies SSE streams without buffering', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: first\n\n'));
        controller.enqueue(new TextEncoder().encode('data: second\n\n'));
        controller.close();
      },
    });

    const fetchMock = vi.fn(async () => new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { server, sessionId } = await createProxyApp();

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/events',
      headers: {
        accept: 'text/event-stream',
      },
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toBe('data: first\n\ndata: second\n\n');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:7878/v1/events',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          authorization: 'Bearer test-key',
          accept: 'text/event-stream',
        }),
      }),
    );
  });

  it('returns 502 when the bridge adapter is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    }));

    const { server, sessionId } = await createProxyApp();

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/cards',
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
});
