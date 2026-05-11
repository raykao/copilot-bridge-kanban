import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { createUser, registerAuthRoutes, registerSessionMiddleware } from './auth.js';
import { createDatabase, initializeSchema } from './db.js';
import { createServer } from './server.js';
import { registerCardRoutes } from './card-routes.js';
import { registerAgentCallbackRoutes } from './agent-callback.js';
import { createCard, createRun, addComment, listComments, listRuns } from './cards.js';

const config: AppConfig = {
  port: 3000,
  bridgeApiUrl: 'http://localhost:7878',
  bridgeApiKey: 'test-bridge-key',
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
  sessionCookie: string;
}> {
  const db = createDatabase(':memory:');
  initializeSchema(db);

  const server = await createServer(config);
  registerSessionMiddleware(server, db);
  registerAuthRoutes(server, db);
  registerAgentCallbackRoutes(server, db, config);
  registerCardRoutes(server, db);

  await createUser(db, 'alice', 'password');

  const loginRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'alice', password: 'password' },
  });
  const cookie = loginRes.headers['set-cookie'] as string;

  apps.push({ db, server });
  return { db, server, sessionCookie: cookie };
}

describe('agent callback routes', () => {
  it('rejects requests without auth', async () => {
    const { server, db } = await createTestApp();
    const card = createCard(db, { title: 'Test', created_by: 'alice', agent_bot: 'bob' });

    const res = await server.inject({
      method: 'POST',
      url: `/api/internal/cards/${card.id}/agent-response`,
      payload: { content: 'response' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with wrong auth', async () => {
    const { server, db } = await createTestApp();
    const card = createCard(db, { title: 'Test', created_by: 'alice', agent_bot: 'bob' });

    const res = await server.inject({
      method: 'POST',
      url: `/api/internal/cards/${card.id}/agent-response`,
      headers: { authorization: 'Bearer wrong-key' },
      payload: { content: 'response' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('inserts agent comment on valid callback', async () => {
    const { server, db } = await createTestApp();
    const card = createCard(db, { title: 'Test', created_by: 'alice', agent_bot: 'bob' });

    const res = await server.inject({
      method: 'POST',
      url: `/api/internal/cards/${card.id}/agent-response`,
      headers: { authorization: `Bearer ${config.bridgeApiKey}` },
      payload: { content: 'I did the thing' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.comment.author_kind).toBe('agent');
    expect(body.comment.author_id).toBe('bob');
    expect(body.comment.content).toBe('I did the thing');

    const comments = listComments(db, card.id);
    expect(comments).toHaveLength(1);
    expect(comments[0].content).toBe('I did the thing');
  });

  it('completes run when run_id provided', async () => {
    const { server, db } = await createTestApp();
    const card = createCard(db, { title: 'Test', created_by: 'alice', agent_bot: 'bob' });
    const run = createRun(db, { card_id: card.id, agent_name: 'bob' });

    const res = await server.inject({
      method: 'POST',
      url: `/api/internal/cards/${card.id}/agent-response`,
      headers: { authorization: `Bearer ${config.bridgeApiKey}` },
      payload: {
        content: 'Done',
        run_id: run.id,
        session_id: 'sess-123',
        status: 'completed',
      },
    });

    expect(res.statusCode).toBe(201);

    const runs = listRuns(db, card.id);
    expect(runs[0].status).toBe('completed');
    expect(runs[0].bridge_session_id).toBe('sess-123');
    expect(runs[0].finished_at).toBeTruthy();
  });

  it('completes active run when no run_id provided', async () => {
    const { server, db } = await createTestApp();
    const card = createCard(db, { title: 'Test', created_by: 'alice', agent_bot: 'bob' });
    createRun(db, { card_id: card.id, agent_name: 'bob' });

    const res = await server.inject({
      method: 'POST',
      url: `/api/internal/cards/${card.id}/agent-response`,
      headers: { authorization: `Bearer ${config.bridgeApiKey}` },
      payload: { content: 'Done' },
    });

    expect(res.statusCode).toBe(201);
    const runs = listRuns(db, card.id);
    expect(runs[0].status).toBe('completed');
  });

  it('returns 404 for nonexistent card', async () => {
    const { server } = await createTestApp();

    const res = await server.inject({
      method: 'POST',
      url: `/api/internal/cards/nonexistent/agent-response`,
      headers: { authorization: `Bearer ${config.bridgeApiKey}` },
      payload: { content: 'response' },
    });
    expect(res.statusCode).toBe(404);
  });
});
