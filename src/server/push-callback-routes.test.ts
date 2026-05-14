import { afterEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { mintAgentTokenForCard } from './agent-tokens.js';
import { addComment, createCard, createRun, listComments, listRuns, updateRun } from './cards.js';
import { type AppConfig } from './config.js';
import { createDatabase, initializeSchema } from './db.js';
import { registerPushCallbackRoutes } from './push-callback-routes.js';
import { createServer } from './server.js';
import { SseManager } from './sse.js';

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

  for (const { db, server } of apps.splice(0)) {
    await server.close();
    db.close();
  }
});

async function createTestApp(): Promise<{
  db: Database.Database;
  server: FastifyInstance;
  sseManager: SseManager;
}> {
  const db = createDatabase(':memory:');
  initializeSchema(db);
  const server = await createServer(config);
  const sseManager = new SseManager();
  registerPushCallbackRoutes(server, db, sseManager);
  apps.push({ db, server });
  return { db, server, sseManager };
}

function seedRun(db: Database.Database, bridgeRunId = 'task-1'): { cardId: string; token: string; runId: string } {
  const card = createCard(db, { title: 'Callback card', created_by: 'alice', agent_bot: 'bob' });
  const token = mintAgentTokenForCard(db, card.id, 'bob').token;
  const run = createRun(db, { card_id: card.id, agent_name: 'bob' });
  updateRun(db, run.id, { bridge_run_id: bridgeRunId });
  return { cardId: card.id, token, runId: run.id };
}

async function postCallback(
  server: FastifyInstance,
  cardId: string,
  bot: string,
  token: string | null,
  payload: unknown,
  contentType = 'application/json',
) {
  return server.inject({
    method: 'POST',
    url: `/api/internal/push-callback/${cardId}/${bot}`,
    headers: token ? { authorization: `Bearer ${token}`, 'content-type': contentType } : { 'content-type': contentType },
    payload,
  });
}

describe('push callback routes', () => {
  it('returns 401 for missing bearer token', async () => {
    const { server, db } = await createTestApp();
    const { cardId } = seedRun(db);

    const res = await postCallback(server, cardId, 'bob', null, { kind: 'task' });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Missing bearer token' });
  });

  it('returns 401 for a token minted for a different card', async () => {
    const { server, db } = await createTestApp();
    const { cardId } = seedRun(db);
    const otherCard = createCard(db, { title: 'Other', created_by: 'alice', agent_bot: 'bob' });
    const wrongToken = mintAgentTokenForCard(db, otherCard.id, 'bob').token;

    const res = await postCallback(server, cardId, 'bob', wrongToken, { kind: 'task' });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid token' });
  });

  it('returns 404 for a missing card after valid token auth', async () => {
    const { server, db } = await createTestApp();
    const token = mintAgentTokenForCard(db, 'missing-card', 'bob').token;

    const res = await postCallback(server, 'missing-card', 'bob', token, { kind: 'task' });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Card not found' });
  });

  it('updates runs for all A2A status states', async () => {
    const { server, db, sseManager } = await createTestApp();
    const emit = vi.spyOn(sseManager, 'emit');
    const cases = [
      { state: 'submitted', expected: 'created', terminal: false, event: 'run.created' },
      { state: 'working', expected: 'running', terminal: false, event: 'run.running' },
      { state: 'input-required', expected: 'awaiting', terminal: false, event: 'run.awaiting' },
      { state: 'completed', expected: 'completed', terminal: true, event: 'run.completed' },
      { state: 'failed', expected: 'failed', terminal: true, event: 'run.failed', error: 'boom' },
      { state: 'canceled', expected: 'cancelled', terminal: true, event: 'run.failed', error: 'stop' },
    ];

    for (const c of cases) {
      const taskId = `task-${c.state}`;
      const { cardId, token, runId } = seedRun(db, taskId);
      const res = await postCallback(server, cardId, 'bob', token, {
        kind: 'status-update',
        taskId,
        status: {
          state: c.state,
          message: { parts: [{ kind: 'text', text: c.error ?? 'ignored' }] },
        },
      });

      expect(res.statusCode).toBe(200);
      const run = listRuns(db, cardId).find((r) => r.id === runId)!;
      expect(run.status).toBe(c.expected);
      expect(run.finished_at === null).toBe(!c.terminal);
      if (c.error) expect(run.error).toBe(c.error);
      expect(emit).toHaveBeenCalledWith(cardId, c.event, {});
    }
  });

  it('returns 200 with no DB write for an unknown status taskId', async () => {
    const { server, db } = await createTestApp();
    const { cardId, token, runId } = seedRun(db, 'known-task');

    const res = await postCallback(server, cardId, 'bob', token, {
      kind: 'status-update',
      taskId: 'unknown-task',
      status: { state: 'completed' },
    });

    expect(res.statusCode).toBe(200);
    const run = listRuns(db, cardId).find((r) => r.id === runId)!;
    expect(run.status).toBe('created');
    expect(run.finished_at).toBeNull();
  });

  it('returns 200 without mutating another card run for a cross-card status taskId', async () => {
    const { server, db, sseManager } = await createTestApp();
    const emit = vi.spyOn(sseManager, 'emit');
    const cardA = seedRun(db, 'task-card-a');
    const cardB = seedRun(db, 'task-card-b');

    const res = await postCallback(server, cardA.cardId, 'bob', cardA.token, {
      kind: 'status-update',
      taskId: 'task-card-b',
      status: { state: 'completed' },
    });

    expect(res.statusCode).toBe(200);
    const runA = listRuns(db, cardA.cardId).find((r) => r.id === cardA.runId)!;
    const runB = listRuns(db, cardB.cardId).find((r) => r.id === cardB.runId)!;
    expect(runA.status).toBe('created');
    expect(runA.finished_at).toBeNull();
    expect(runB.status).toBe('created');
    expect(runB.finished_at).toBeNull();
    expect(listComments(db, cardA.cardId)).toEqual([]);
    expect(listComments(db, cardB.cardId)).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  it('inserts a comment for final text artifact updates', async () => {
    const { server, db, sseManager } = await createTestApp();
    const emit = vi.spyOn(sseManager, 'emit');
    const { cardId, token, runId } = seedRun(db);

    const res = await postCallback(server, cardId, 'bob', token, {
      kind: 'artifact-update',
      taskId: 'task-1',
      lastChunk: true,
      artifact: { parts: [{ kind: 'text', text: 'hello ' }, { kind: 'data', data: {} }, { kind: 'text', text: 'world' }] },
    });

    expect(res.statusCode).toBe(200);
    const comments = listComments(db, cardId);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ author_kind: 'agent', author_id: 'bob', content: 'hello world', run_id: runId });
    expect(emit).toHaveBeenCalledWith(cardId, 'comment.created', comments[0]);
  });

  it('returns 200 without adding comments for a cross-card artifact taskId', async () => {
    const { server, db, sseManager } = await createTestApp();
    const emit = vi.spyOn(sseManager, 'emit');
    const cardA = seedRun(db, 'task-card-a');
    const cardB = seedRun(db, 'task-card-b');

    const res = await postCallback(server, cardA.cardId, 'bob', cardA.token, {
      kind: 'artifact-update',
      taskId: 'task-card-b',
      lastChunk: true,
      artifact: { parts: [{ kind: 'text', text: 'cross-card text' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(listComments(db, cardA.cardId)).toEqual([]);
    expect(listComments(db, cardB.cardId)).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  it('ignores non-final artifact chunks', async () => {
    const { server, db } = await createTestApp();
    const { cardId, token } = seedRun(db);

    const res = await postCallback(server, cardId, 'bob', token, {
      kind: 'artifact-update',
      taskId: 'task-1',
      lastChunk: false,
      artifact: { parts: [{ kind: 'text', text: 'partial' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(listComments(db, cardId)).toEqual([]);
  });

  it('ignores artifact updates with empty text parts', async () => {
    const { server, db } = await createTestApp();
    const { cardId, token } = seedRun(db);

    const res = await postCallback(server, cardId, 'bob', token, {
      kind: 'artifact-update',
      taskId: 'task-1',
      lastChunk: true,
      artifact: { parts: [{ kind: 'data', data: {} }, { kind: 'text', text: '' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(listComments(db, cardId)).toEqual([]);
  });

  it('deduplicates matching agent comments for a run', async () => {
    const { server, db } = await createTestApp();
    const { cardId, token, runId } = seedRun(db);
    addComment(db, { card_id: cardId, author_kind: 'agent', author_id: 'bob', content: 'same text', run_id: runId });

    const res = await postCallback(server, cardId, 'bob', token, {
      kind: 'artifact-update',
      taskId: 'task-1',
      lastChunk: true,
      artifact: { parts: [{ kind: 'text', text: 'same text' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(listComments(db, cardId)).toHaveLength(1);
  });

  it('returns 200 for a non-object body without writing to the DB', async () => {
    const { server, db } = await createTestApp();
    const { cardId, token } = seedRun(db);

    const res = await postCallback(server, cardId, 'bob', token, 'not object', 'text/plain');

    expect(res.statusCode).toBe(200);
    expect(listComments(db, cardId)).toEqual([]);
    expect(listRuns(db, cardId)[0].status).toBe('created');
  });
});
