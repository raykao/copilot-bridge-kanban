import { randomUUID } from 'node:crypto';
import '@fastify/cookie';
import bcrypt from 'bcrypt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Database from 'better-sqlite3';

const SALT_ROUNDS = 12;
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const DUMMY_PASSWORD_HASH = '$2b$12$Jr4fVq3g0P8u5r5VQj0s4e6j2m7O6R8tP8X0Jm2G1aN9Q7rK6lG9S';
export const COOKIE_NAME = 'kanban_session';

export interface AuthUser {
  id: string;
  username: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export async function createUser(
  db: Database.Database,
  username: string,
  password: string,
): Promise<AuthUser> {
  const id = randomUUID();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
  ).run(id, username, passwordHash, now);

  return { id, username };
}

export async function verifyPassword(
  db: Database.Database,
  username: string,
  password: string,
): Promise<AuthUser | null> {
  const row = db
    .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
    .get(username) as { id: string; username: string; password_hash: string } | undefined;

  if (!row) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    return null;
  }

  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) {
    return null;
  }

  return { id: row.id, username: row.username };
}

export function createSession(db: Database.Database, userId: string): string {
  const id = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

  db.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ).run(id, userId, expiresAt.toISOString(), now.toISOString());

  return id;
}

export function getSessionUser(db: Database.Database, sessionId: string): AuthUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.username
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sessionId, new Date().toISOString()) as { id: string; username: string } | undefined;

  return row ? { id: row.id, username: row.username } : null;
}

export function deleteSession(db: Database.Database, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function cleanExpiredSessions(db: Database.Database): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}

function getRequestPath(request: FastifyRequest): string {
  return request.url.split('?', 1)[0] ?? request.url;
}

export function registerAuthRoutes(app: FastifyInstance, db: Database.Database): void {
  app.post('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body as {
      username?: string;
      password?: string;
    };

    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password are required' });
    }

    const user = await verifyPassword(db, username, password);
    if (!user) {
      request.log.warn({ username }, 'login failed: invalid credentials');
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const sessionId = createSession(db, user.id);
    request.log.info({ username, userId: user.id }, 'login successful');

    reply.setCookie(COOKIE_NAME, sessionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: SESSION_DURATION_MS / 1000,
    });

    return reply.send({ user });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const sessionId = request.cookies[COOKIE_NAME];
    if (sessionId) {
      deleteSession(db, sessionId);
      reply.clearCookie(COOKIE_NAME, { path: '/' });
      request.log.info({ userId: request.user?.id }, 'logout');
    }

    return reply.send({ ok: true });
  });

  app.get('/api/auth/me', async (request, reply) => {
    return reply.send({ user: request.user });
  });
}

export function registerSessionMiddleware(app: FastifyInstance, db: Database.Database): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestPath = getRequestPath(request);

    if (
      requestPath === '/healthz' ||
      requestPath === '/api/health' ||
      requestPath === '/api/auth/login' ||
      !requestPath.startsWith('/api/')
    ) {
      return;
    }

    const sessionId = request.cookies[COOKIE_NAME];
    if (!sessionId) {
      request.log.debug({ url: requestPath }, 'rejected: no session cookie');
      return reply.status(401).send({ error: 'Not authenticated' });
    }

    const user = getSessionUser(db, sessionId);
    if (!user) {
      request.log.debug({ url: requestPath }, 'rejected: session expired or invalid');
      reply.clearCookie(COOKIE_NAME, { path: '/' });
      return reply.status(401).send({ error: 'Session expired' });
    }

    request.user = user;
  });
}
