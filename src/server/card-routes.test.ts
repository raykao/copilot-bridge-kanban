import { afterEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import { createUser, registerAuthRoutes, registerSessionMiddleware } from './auth.js';
import { createRun, listComments, listRuns, updateRun } from './cards.js';
import { createDatabase, initializeSchema } from './db.js';
import { createServer } from './server.js';
import { registerCardRoutes } from './card-routes.js';

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

async function createTestApp(options: { registerBridge?: boolean } = {}): Promise<{
  db: Database.Database;
  server: FastifyInstance;
  sessionCookie: string;
}> {
  const db = createDatabase(':memory:');
  initializeSchema(db);

  const server = await createServer(config);
  registerSessionMiddleware(server, db);
  registerAuthRoutes(server, db);
  registerCardRoutes(server, db, options.registerBridge ? config : undefined);

  await createUser(db, 'alice', 'password');

  // Login to get session cookie
  const loginRes = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'alice', password: 'password' },
  });
  const cookie = loginRes.headers['set-cookie'] as string;

  apps.push({ db, server });
  return { db, server, sessionCookie: cookie };
}

describe('card routes', () => {
  it('returns 401 without auth', async () => {
    const { server } = await createTestApp();
    const res = await server.inject({ method: 'GET', url: '/api/cards' });
    expect(res.statusCode).toBe(401);
  });

  it('creates and retrieves a card', async () => {
    const { server, sessionCookie } = await createTestApp();

    const createRes = await server.inject({
      method: 'POST',
      url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Test card', description: 'Do the thing', labels: ['backend'] },
    });

    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.body);
    expect(created.card.title).toBe('Test card');
    expect(created.card.labels).toEqual(['backend']);
    expect(created.card.status).toBe('idea');

    const getRes = await server.inject({
      method: 'GET',
      url: `/api/cards/${created.card.id}`,
      headers: { cookie: sessionCookie },
    });

    expect(getRes.statusCode).toBe(200);
    const detail = JSON.parse(getRes.body);
    expect(detail.card.title).toBe('Test card');
    expect(detail.comments).toEqual([]);
    expect(detail.runs).toEqual([]);
  });

  it('lists cards with filters', async () => {
    const { server, sessionCookie } = await createTestApp();

    await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'A', agent: 'bob', status: 'in_progress' },
    });
    await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'B', status: 'idea' },
    });

    const allRes = await server.inject({
      method: 'GET', url: '/api/cards',
      headers: { cookie: sessionCookie },
    });
    expect(JSON.parse(allRes.body).cards).toHaveLength(2);

    const bobRes = await server.inject({
      method: 'GET', url: '/api/cards?agent=bob',
      headers: { cookie: sessionCookie },
    });
    expect(JSON.parse(bobRes.body).cards).toHaveLength(1);

    const unassignedRes = await server.inject({
      method: 'GET', url: '/api/cards?agent=none',
      headers: { cookie: sessionCookie },
    });
    expect(JSON.parse(unassignedRes.body).cards).toHaveLength(1);
  });

  it('updates a card', async () => {
    const { server, sessionCookie } = await createTestApp();

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Original' },
    });
    const { card } = JSON.parse(createRes.body);

    const patchRes = await server.inject({
      method: 'PATCH', url: `/api/cards/${card.id}`,
      headers: { cookie: sessionCookie },
      payload: { title: 'Updated', status: 'in_progress' },
    });

    expect(patchRes.statusCode).toBe(200);
    const updated = JSON.parse(patchRes.body).card;
    expect(updated.title).toBe('Updated');
    expect(updated.status).toBe('in_progress');
  });

  it('deletes a card', async () => {
    const { server, sessionCookie } = await createTestApp();

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Doomed' },
    });
    const { card } = JSON.parse(createRes.body);

    const delRes = await server.inject({
      method: 'DELETE', url: `/api/cards/${card.id}`,
      headers: { cookie: sessionCookie },
    });
    expect(delRes.statusCode).toBe(204);

    const getRes = await server.inject({
      method: 'GET', url: `/api/cards/${card.id}`,
      headers: { cookie: sessionCookie },
    });
    expect(getRes.statusCode).toBe(404);
  });

  it('returns 404 for nonexistent card', async () => {
    const { server, sessionCookie } = await createTestApp();

    const res = await server.inject({
      method: 'GET', url: '/api/cards/nonexistent',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('comment routes', () => {
  it('adds and lists comments', async () => {
    const { server, sessionCookie } = await createTestApp();

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Commented' },
    });
    const { card } = JSON.parse(createRes.body);

    const commentRes = await server.inject({
      method: 'POST', url: `/api/cards/${card.id}/comments`,
      headers: { cookie: sessionCookie },
      payload: { content: 'hello world' },
    });
    expect(commentRes.statusCode).toBe(201);
    const { comment } = JSON.parse(commentRes.body);
    expect(comment.content).toBe('hello world');
    expect(comment.author_kind).toBe('human');

    const listRes = await server.inject({
      method: 'GET', url: `/api/cards/${card.id}/comments`,
      headers: { cookie: sessionCookie },
    });
    expect(JSON.parse(listRes.body).comments).toHaveLength(1);
  });

  it('creates a run when commenting on an assigned card', async () => {
    const { server, sessionCookie } = await createTestApp();

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Assigned', agent: 'bob' },
    });
    const { card } = JSON.parse(createRes.body);

    const commentRes = await server.inject({
      method: 'POST', url: `/api/cards/${card.id}/comments`,
      headers: { cookie: sessionCookie },
      payload: { content: 'do the thing' },
    });
    const body = JSON.parse(commentRes.body);
    expect(body.run_id).toBeTruthy();

    const runsRes = await server.inject({
      method: 'GET', url: `/api/cards/${card.id}/runs`,
      headers: { cookie: sessionCookie },
    });
    const { runs } = JSON.parse(runsRes.body);
    expect(runs).toHaveLength(1);
    expect(runs[0].agent_name).toBe('bob');
    expect(runs[0].input_comment_id).toBe(body.comment.id);
  });
});

describe('run routes', () => {
  it('resumes a run through the bridge', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { db, server, sessionCookie } = await createTestApp({ registerBridge: true });
    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Awaiting permission' },
    });
    const { card } = JSON.parse(createRes.body);
    const run = createRun(db, { card_id: card.id, agent_name: 'bob' });
    updateRun(db, run.id, { bridge_run_id: 'br-test-1' });

    const resumeRes = await server.inject({
      method: 'POST',
      url: `/api/cards/${card.id}/runs/${run.id}/resume`,
      headers: { cookie: sessionCookie },
      payload: { decision: 'allow-once' },
    });

    expect(resumeRes.statusCode).toBe(200);
    expect(JSON.parse(resumeRes.body)).toEqual({
      run_id: run.id,
      decision: 'allow-once',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:7878/v1/runs/br-test-1/resume',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ decision: 'allow-once' }),
      },
    );
  });

  it('returns 409 when run has no bridge_run_id', async () => {
    const { db, server, sessionCookie } = await createTestApp({ registerBridge: true });
    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'No bridge run' },
    });
    const { card } = JSON.parse(createRes.body);
    const run = createRun(db, { card_id: card.id, agent_name: 'bob' });

    const res = await server.inject({
      method: 'POST',
      url: `/api/cards/${card.id}/runs/${run.id}/resume`,
      headers: { cookie: sessionCookie },
      payload: { decision: 'allow-once' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: 'run not yet dispatched to bridge' });
  });

  it('returns 404 when resuming a run for a nonexistent card', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { server, sessionCookie } = await createTestApp({ registerBridge: true });

    const res = await server.inject({
      method: 'POST',
      url: '/api/cards/missing/runs/run-1/resume',
      headers: { cookie: sessionCookie },
      payload: { decision: 'allow-once' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Card not found' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the run does not belong to the card', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { db, server, sessionCookie } = await createTestApp({ registerBridge: true });
    const cardARes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Card A' },
    });
    const cardBRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Card B' },
    });
    const { card: cardA } = JSON.parse(cardARes.body);
    const { card: cardB } = JSON.parse(cardBRes.body);
    const run = createRun(db, { card_id: cardB.id, agent_name: 'bob' });

    const res = await server.inject({
      method: 'POST',
      url: `/api/cards/${cardA.id}/runs/${run.id}/resume`,
      headers: { cookie: sessionCookie },
      payload: { decision: 'allow-once' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Run not found' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the resume decision is invalid', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { db, server, sessionCookie } = await createTestApp({ registerBridge: true });
    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Invalid decision' },
    });
    const { card } = JSON.parse(createRes.body);
    const run = createRun(db, { card_id: card.id, agent_name: 'bob' });

    const res = await server.inject({
      method: 'POST',
      url: `/api/cards/${card.id}/runs/${run.id}/resume`,
      headers: { cookie: sessionCookie },
      payload: { decision: 'forever' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'invalid decision' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 502 when the bridge resume request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    }));

    const { db, server, sessionCookie } = await createTestApp({ registerBridge: true });
    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Bridge down' },
    });
    const { card } = JSON.parse(createRes.body);
    const run = createRun(db, { card_id: card.id, agent_name: 'bob' });
    updateRun(db, run.id, { bridge_run_id: 'br-test-2' });

    const res = await server.inject({
      method: 'POST',
      url: `/api/cards/${card.id}/runs/${run.id}/resume`,
      headers: { cookie: sessionCookie },
      payload: { decision: 'deny' },
    });

    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body)).toEqual({ error: 'bridge unavailable' });
  });
});

describe('label routes', () => {
  it('adds and lists labels', async () => {
    const { server, sessionCookie } = await createTestApp();

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Labeled' },
    });
    const { card } = JSON.parse(createRes.body);

    const labelRes = await server.inject({
      method: 'POST', url: `/api/cards/${card.id}/labels`,
      headers: { cookie: sessionCookie },
      payload: { labels: ['backend', 'urgent'] },
    });
    expect(labelRes.statusCode).toBe(200);
    expect(JSON.parse(labelRes.body).labels).toEqual(['backend', 'urgent']);
  });

  it('removes a label', async () => {
    const { server, sessionCookie } = await createTestApp();

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Remove', labels: ['a', 'b'] },
    });
    const { card } = JSON.parse(createRes.body);

    const delRes = await server.inject({
      method: 'DELETE', url: `/api/cards/${card.id}/labels/a`,
      headers: { cookie: sessionCookie },
    });
    expect(delRes.statusCode).toBe(204);

    const getRes = await server.inject({
      method: 'GET', url: `/api/cards/${card.id}`,
      headers: { cookie: sessionCookie },
    });
    expect(JSON.parse(getRes.body).card.labels).toEqual(['b']);
  });
});

describe('checkpoint routes', () => {
  it('returns checkpoint list', async () => {
    const { server, sessionCookie } = await createTestApp();

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Checkpointed' },
    });
    const { card } = JSON.parse(createRes.body);

    await server.inject({
      method: 'POST', url: `/api/cards/${card.id}/checkpoints`,
      headers: { cookie: sessionCookie },
      payload: { name: 'first' },
    });
    await server.inject({
      method: 'POST', url: `/api/cards/${card.id}/checkpoints`,
      headers: { cookie: sessionCookie },
      payload: { name: 'second' },
    });

    const listRes = await server.inject({
      method: 'GET', url: `/api/cards/${card.id}/checkpoints`,
      headers: { cookie: sessionCookie },
    });

    expect(listRes.statusCode).toBe(200);
    const { checkpoints } = JSON.parse(listRes.body);
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints.map((checkpoint: { name: string }) => checkpoint.name)).toEqual(['first', 'second']);
  });

  it('creates a checkpoint with a name', async () => {
    const { server, sessionCookie } = await createTestApp();

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Named checkpoint' },
    });
    const { card } = JSON.parse(createRes.body);

    const checkpointRes = await server.inject({
      method: 'POST', url: `/api/cards/${card.id}/checkpoints`,
      headers: { cookie: sessionCookie },
      payload: { name: 'snapshot' },
    });

    expect(checkpointRes.statusCode).toBe(201);
    const checkpoint = JSON.parse(checkpointRes.body);
    expect(checkpoint.card_id).toBe(card.id);
    expect(checkpoint.name).toBe('snapshot');
    expect(checkpoint.turn_index).toBe(0);
  });

  it('creates a checkpoint without a name', async () => {
    const { server, sessionCookie } = await createTestApp();

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Unnamed checkpoint' },
    });
    const { card } = JSON.parse(createRes.body);

    const checkpointRes = await server.inject({
      method: 'POST', url: `/api/cards/${card.id}/checkpoints`,
      headers: { cookie: sessionCookie },
      payload: {},
    });

    expect(checkpointRes.statusCode).toBe(201);
    const checkpoint = JSON.parse(checkpointRes.body);
    expect(checkpoint.card_id).toBe(card.id);
    expect(checkpoint.name).toBeNull();
  });

  it('deletes a checkpoint', async () => {
    const { server, sessionCookie } = await createTestApp();

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Delete checkpoint' },
    });
    const { card } = JSON.parse(createRes.body);

    const checkpointRes = await server.inject({
      method: 'POST', url: `/api/cards/${card.id}/checkpoints`,
      headers: { cookie: sessionCookie },
      payload: { name: 'remove me' },
    });
    const checkpoint = JSON.parse(checkpointRes.body);

    const deleteRes = await server.inject({
      method: 'DELETE', url: `/api/cards/${card.id}/checkpoints/${checkpoint.id}`,
      headers: { cookie: sessionCookie },
    });
    expect(deleteRes.statusCode).toBe(204);

    const listRes = await server.inject({
      method: 'GET', url: `/api/cards/${card.id}/checkpoints`,
      headers: { cookie: sessionCookie },
    });
    expect(JSON.parse(listRes.body).checkpoints).toEqual([]);
  });

  it('returns 404 and preserves checkpoint for cross-card delete', async () => {
    const { server, sessionCookie } = await createTestApp();

    const cardARes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Card A' },
    });
    const { card: cardA } = JSON.parse(cardARes.body);

    const cardBRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Card B' },
    });
    const { card: cardB } = JSON.parse(cardBRes.body);

    const checkpointRes = await server.inject({
      method: 'POST', url: `/api/cards/${cardA.id}/checkpoints`,
      headers: { cookie: sessionCookie },
      payload: { name: 'belongs to A' },
    });
    const checkpoint = JSON.parse(checkpointRes.body);

    const deleteRes = await server.inject({
      method: 'DELETE', url: `/api/cards/${cardB.id}/checkpoints/${checkpoint.id}`,
      headers: { cookie: sessionCookie },
    });
    expect(deleteRes.statusCode).toBe(404);

    const listRes = await server.inject({
      method: 'GET', url: `/api/cards/${cardA.id}/checkpoints`,
      headers: { cookie: sessionCookie },
    });
    const { checkpoints } = JSON.parse(listRes.body);
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].id).toBe(checkpoint.id);
  });

  it('returns 404 for checkpoint routes with nonexistent card', async () => {
    const { server, sessionCookie } = await createTestApp();

    const getRes = await server.inject({
      method: 'GET', url: '/api/cards/nonexistent/checkpoints',
      headers: { cookie: sessionCookie },
    });
    expect(getRes.statusCode).toBe(404);

    const postRes = await server.inject({
      method: 'POST', url: '/api/cards/nonexistent/checkpoints',
      headers: { cookie: sessionCookie },
      payload: { name: 'missing' },
    });
    expect(postRes.statusCode).toBe(404);

    const deleteRes = await server.inject({
      method: 'DELETE', url: '/api/cards/nonexistent/checkpoints/checkpoint-1',
      headers: { cookie: sessionCookie },
    });
    expect(deleteRes.statusCode).toBe(404);
  });
});

describe('card creation with agent', () => {
  it('inserts description as first comment when agent is assigned', async () => {
    const { server, sessionCookie } = await createTestApp();

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Agent card', description: 'Build the thing', agent: 'bob' },
    });
    const { card } = JSON.parse(createRes.body);

    const detailRes = await server.inject({
      method: 'GET', url: `/api/cards/${card.id}`,
      headers: { cookie: sessionCookie },
    });
    const detail = JSON.parse(detailRes.body);
    expect(detail.comments).toHaveLength(1);
    expect(detail.comments[0].content).toBe('Build the thing');
    expect(detail.comments[0].author_kind).toBe('human');
  });
});

describe('bridge streaming integration', () => {
  function makeSseStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
  }

  async function waitForCondition(condition: () => boolean, timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    while (!condition()) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('Timed out waiting for condition');
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  it('persists agent reply as card comment and sets bridge_run_id when message.completed fires', async () => {
    const sseChunks = [
      'event: task\ndata: {"kind":"task","id":"bridge-run-99","contextId":"PLACEHOLDER"}\n\n',
      'event: artifact-update\ndata: {"taskId":"bridge-run-99","artifact":{"parts":[{"kind":"text","text":"hello"}]},"lastChunk":true}\n\n',
      'event: status-update\ndata: {"taskId":"bridge-run-99","status":{"state":"completed"}}\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      body: makeSseStream(sseChunks),
    })));

    const { db, server, sessionCookie } = await createTestApp({ registerBridge: true });

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Stream card', agent: 'bob' },
    });
    const { card } = JSON.parse(createRes.body);

    const commentRes = await server.inject({
      method: 'POST', url: `/api/cards/${card.id}/comments`,
      headers: { cookie: sessionCookie },
      payload: { content: 'do the thing' },
    });
    expect(commentRes.statusCode).toBe(201);
    const { run_id } = JSON.parse(commentRes.body);

    // Wait for async SSE processing to complete
    await waitForCondition(() => {
      const comments = listComments(db, card.id);
      return comments.some((c) => c.author_kind === 'agent');
    });

    const comments = listComments(db, card.id);
    const agentComment = comments.find((c) => c.author_kind === 'agent');
    expect(agentComment).toBeDefined();
    expect(agentComment!.content).toBe('hello');
    expect(agentComment!.author_id).toBe('bob');
    expect(agentComment!.run_id).toBe(run_id);

    const runs = listRuns(db, card.id);
    const run = runs.find((r) => r.id === run_id)!;
    expect(run.bridge_run_id).toBe('bridge-run-99');
    expect(run.status).toBe('completed');
  });

  it('sets run status to running with bridge_run_id when onReady fires', async () => {
    // Stream stalls after task frame - we verify the run is updated before completion
    let resolveStream!: () => void;
    const streamDone = new Promise<void>((resolve) => { resolveStream = resolve; });
    const encoder = new TextEncoder();

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(
            'event: task\ndata: {"kind":"task","id":"bridge-run-55","contextId":"PLACEHOLDER"}\n\n',
          ));
          // Wait briefly then close
          await streamDone;
          controller.close();
        },
      }),
    })));

    const { db, server, sessionCookie } = await createTestApp({ registerBridge: true });

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Ready test card', agent: 'bob' },
    });
    const { card } = JSON.parse(createRes.body);

    const commentRes = await server.inject({
      method: 'POST', url: `/api/cards/${card.id}/comments`,
      headers: { cookie: sessionCookie },
      payload: { content: 'ping' },
    });
    const { run_id } = JSON.parse(commentRes.body);

    // Wait for onReady to update the run
    await waitForCondition(() => {
      const runs = listRuns(db, card.id);
      const run = runs.find((r) => r.id === run_id);
      return run?.bridge_run_id === 'bridge-run-55';
    });

    resolveStream();

    const runs = listRuns(db, card.id);
    const run = runs.find((r) => r.id === run_id)!;
    expect(run.bridge_run_id).toBe('bridge-run-55');
    expect(run.status).toBe('running');
  });
});
