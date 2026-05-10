import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import {
  COOKIE_NAME,
  createSession,
  createUser,
  deleteSession,
  getSessionUser,
  registerAuthRoutes,
  registerSessionMiddleware,
  verifyPassword,
} from './auth.js';
import { createDatabase, initializeSchema } from './db.js';
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
  server.get('/api/protected', async (request) => ({ user: request.user }));

  apps.push({ db, server });
  return { db, server };
}

describe('auth helpers', () => {
  it('creates users and verifies passwords', async () => {
    const db = createDatabase(':memory:');
    initializeSchema(db);

    const createdUser = await createUser(db, 'ray', 'secret-password');

    await expect(verifyPassword(db, 'ray', 'secret-password')).resolves.toEqual(createdUser);
    await expect(verifyPassword(db, 'ray', 'wrong-password')).resolves.toBeNull();
    await expect(verifyPassword(db, 'missing', 'secret-password')).resolves.toBeNull();

    db.close();
  });

  it('creates sessions and resolves the logged-in user', async () => {
    const db = createDatabase(':memory:');
    initializeSchema(db);
    const user = await createUser(db, 'ray', 'secret-password');

    const sessionId = createSession(db, user.id);

    expect(getSessionUser(db, sessionId)).toEqual(user);

    deleteSession(db, sessionId);
    db.close();
  });

  it('returns null for expired sessions', async () => {
    const db = createDatabase(':memory:');
    initializeSchema(db);
    const user = await createUser(db, 'ray', 'secret-password');
    const sessionId = createSession(db, user.id);

    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), sessionId);

    expect(getSessionUser(db, sessionId)).toBeNull();

    deleteSession(db, sessionId);
    db.close();
  });
});

describe('auth routes', () => {
  it('returns 200 and a session cookie for valid login', async () => {
    const { db, server } = await createTestApp();
    const user = await createUser(db, 'ray', 'secret-password');

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: 'ray',
        password: 'secret-password',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user });
    expect(response.headers['set-cookie']).toContain(`${COOKIE_NAME}=`);
  });

  it('returns 401 for invalid credentials', async () => {
    const { db, server } = await createTestApp();
    await createUser(db, 'ray', 'secret-password');

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: 'ray',
        password: 'wrong-password',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Invalid credentials' });
  });

  it('returns 400 when login body is missing required fields', async () => {
    const { server } = await createTestApp();

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Username and password are required' });
  });

  it('returns the current user when the session is valid', async () => {
    const { db, server } = await createTestApp();
    const user = await createUser(db, 'ray', 'secret-password');
    const sessionId = createSession(db, user.id);

    const response = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ user });
  });

  it('returns 401 when no session cookie is present', async () => {
    const { server } = await createTestApp();

    const response = await server.inject({
      method: 'GET',
      url: '/api/auth/me',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Not authenticated' });
  });

  it('logs out the current session and clears the cookie', async () => {
    const { db, server } = await createTestApp();
    const user = await createUser(db, 'ray', 'secret-password');
    const sessionId = createSession(db, user.id);

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: {
        [COOKIE_NAME]: sessionId,
      },
    });

    const remainingSessions = db
      .prepare('SELECT COUNT(*) AS count FROM sessions WHERE id = ?')
      .get(sessionId) as { count: number };

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(response.headers['set-cookie']).toContain(`${COOKIE_NAME}=;`);
    expect(remainingSessions.count).toBe(0);
  });

  it('rejects protected routes without a valid session cookie', async () => {
    const { server } = await createTestApp();

    const response = await server.inject({
      method: 'GET',
      url: '/api/protected',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Not authenticated' });
  });
});
