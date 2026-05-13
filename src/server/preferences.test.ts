import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { COOKIE_NAME, createUser, registerAuthRoutes, registerSessionMiddleware } from './auth.js';
import { createDatabase, initializeSchema } from './db.js';
import { registerPreferencesRoutes } from './preferences.js';
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
  for (const { db, server } of apps.splice(0)) {
    await server.close();
    db.close();
  }
});

async function createTestApp(): Promise<{
  db: Database.Database;
  server: FastifyInstance;
}> {
  const db = createDatabase(':memory:');
  initializeSchema(db);

  const server = await createServer(config);
  registerSessionMiddleware(server, db);
  registerAuthRoutes(server, db);
  registerPreferencesRoutes(server, db);

  apps.push({ db, server });
  return { db, server };
}

async function login(server: FastifyInstance, username: string, password: string): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });

  expect(response.statusCode).toBe(200);
  return response.cookies.find((cookie) => cookie.name === COOKIE_NAME)?.value ?? '';
}

describe('preferences routes', () => {
  it('returns an empty preferences object for a new user', async () => {
    const { db, server } = await createTestApp();
    await createUser(db, 'ray', 'secret-password');
    const sessionCookie = await login(server, 'ray', 'secret-password');

    const response = await server.inject({
      method: 'GET',
      url: '/api/prefs',
      cookies: {
        [COOKIE_NAME]: sessionCookie,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ preferences: {} });
  });

  it('stores preferences and returns them', async () => {
    const { db, server } = await createTestApp();
    await createUser(db, 'ray', 'secret-password');
    const sessionCookie = await login(server, 'ray', 'secret-password');

    const response = await server.inject({
      method: 'PUT',
      url: '/api/prefs',
      cookies: {
        [COOKIE_NAME]: sessionCookie,
      },
      payload: {
        theme: 'dark',
        showArchived: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      preferences: {
        theme: 'dark',
        showArchived: true,
      },
    });
  });

  it('merges updates with existing preferences', async () => {
    const { db, server } = await createTestApp();
    await createUser(db, 'ray', 'secret-password');
    const sessionCookie = await login(server, 'ray', 'secret-password');

    const firstPut = await server.inject({
      method: 'PUT',
      url: '/api/prefs',
      cookies: {
        [COOKIE_NAME]: sessionCookie,
      },
      payload: {
        theme: 'dark',
      },
    });

    const secondPut = await server.inject({
      method: 'PUT',
      url: '/api/prefs',
      cookies: {
        [COOKIE_NAME]: sessionCookie,
      },
      payload: {
        boardView: 'agent',
      },
    });

    const getResponse = await server.inject({
      method: 'GET',
      url: '/api/prefs',
      cookies: {
        [COOKIE_NAME]: sessionCookie,
      },
    });

    expect(firstPut.statusCode).toBe(200);
    expect(firstPut.json()).toEqual({
      preferences: {
        theme: 'dark',
      },
    });
    expect(secondPut.statusCode).toBe(200);
    expect(secondPut.json()).toEqual({
      preferences: {
        theme: 'dark',
        boardView: 'agent',
      },
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual({
      preferences: {
        theme: 'dark',
        boardView: 'agent',
      },
    });
  });

  it('returns 401 without a session cookie', async () => {
    const { server } = await createTestApp();

    const getResponse = await server.inject({
      method: 'GET',
      url: '/api/prefs',
    });
    const putResponse = await server.inject({
      method: 'PUT',
      url: '/api/prefs',
      payload: {
        theme: 'dark',
      },
    });

    expect(getResponse.statusCode).toBe(401);
    expect(getResponse.json()).toEqual({ error: 'Not authenticated' });
    expect(putResponse.statusCode).toBe(401);
    expect(putResponse.json()).toEqual({ error: 'Not authenticated' });
  });
});
