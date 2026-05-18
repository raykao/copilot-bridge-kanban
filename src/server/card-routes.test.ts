import { afterEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';

import { createUser, registerAuthRoutes, registerSessionMiddleware } from './auth.js';
import { createRun, listComments, listRuns, updateCard, updateRun } from './cards.js';
import { createDatabase, initializeSchema } from './db.js';
import { createServer } from './server.js';
import { buildSessionCallbacks, registerCardRoutes } from './card-routes.js';
import type { DispatchCallbacks } from './dispatch-types.js';
import type { AcpSessionManager } from './acp-session-manager.js';
import type { ProviderRegistry } from './providers/registry.js';
import type { AgentProvider } from './providers/types.js';

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


function createMockBridgeProvider(id = 'provider-1'): { provider: AgentProvider; dispatch: ReturnType<typeof vi.fn> } {
  const dispatch = vi.fn();
  return {
    provider: {
      id,
      type: 'copilot-bridge',
      baseUrl: 'http://localhost:7878',
      discover: vi.fn(async () => []),
      dispatch: vi.fn((agentName: string, input: string, cardId: string, kanbanRunId: string) => {
        dispatch(cardId, agentName, input, kanbanRunId);
      }),
      resumeRun: vi.fn(),
    },
    dispatch,
  };
}

function createMockProviderRegistry(provider: AgentProvider): ProviderRegistry {
  return {
    getByName: vi.fn((agentName: string) => (agentName === 'bob' ? provider : undefined)),
  } as unknown as ProviderRegistry;
}

type MockAcpRun = {
  dispatch: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  cancelPendingPermission: ReturnType<typeof vi.fn>;
  resumeSession: ReturnType<typeof vi.fn>;
  runId?: string;
};

function createMockAcpManager(): {
  manager: AcpSessionManager;
  fork: ReturnType<typeof vi.fn>;
  runs: MockAcpRun[];
} {
  const runs: MockAcpRun[] = [];
  const fork = vi.fn((callbacks: DispatchCallbacks) => {
    const run: MockAcpRun = {
      dispatch: vi.fn((cardId: string, _bot: string, _prompt: string, runId: string) => {
        run.runId = runId;
        callbacks.onRunCreated(runId, `acp-session-${runs.length + 1}`);
        callbacks.onPermissionRequest(cardId, runId, 1, 'bash');
      }),
      resume: vi.fn(),
      cancelPendingPermission: vi.fn(),
      resumeSession: vi.fn(),
    };
    runs.push(run);
    return {
      dispatch: run.dispatch,
      resume: run.resume,
      cancelPendingPermission: run.cancelPendingPermission,
      resumeSession: run.resumeSession,
    } as unknown as AcpSessionManager;
  });

  return { manager: { fork } as unknown as AcpSessionManager, fork, runs };
}

function createAcpAgentRow(db: Database.Database, id = 'agent-1'): void {
  db.prepare(
    `INSERT INTO agents (id, name, protocol, url, auto_approve, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, id, 'acp', 'ws://localhost/acp', 0, new Date().toISOString());
}

function createBridgeProviderRow(db: Database.Database, id = 'provider-1'): void {
  db.prepare(
    `INSERT INTO providers (id, type, label, url, ws_url, api_key, status, created_at)
     VALUES (?, 'copilot-bridge', ?, 'http://localhost:7878', NULL, NULL, 'connected', ?)`,
  ).run(id, id, new Date().toISOString());
}

async function createTestApp(options: {
  registerBridge?: boolean;
  acpManagers?: Map<string, AcpSessionManager>;
  registry?: ProviderRegistry;
} = {}): Promise<{
  db: Database.Database;
  server: FastifyInstance;
  sessionCookie: string;
}> {
  const db = createDatabase(':memory:');
  initializeSchema(db);

  const server = await createServer(config);
  registerSessionMiddleware(server, db);
  registerAuthRoutes(server, db);
  registerCardRoutes(
    server,
    db,
    options.registerBridge ? config : undefined,
    undefined,
    options.acpManagers,
    options.registry,
  );

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
    expect(commentRes.statusCode).toBe(202);
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

  it('dispatches comment-create run through provider registry', async () => {
    const { provider, dispatch: mockDispatch } = createMockBridgeProvider();
    const registry = createMockProviderRegistry(provider);
    const { db, server, sessionCookie } = await createTestApp({ registerBridge: true, registry });
    createBridgeProviderRow(db);

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
    expect(commentRes.statusCode).toBe(202);
    const { run_id } = JSON.parse(commentRes.body);

    expect(mockDispatch).toHaveBeenCalledWith(card.id, 'bob', 'do the thing', run_id);
    const [run] = listRuns(db, card.id);
    expect(run.status).toBe('created');
    expect(run.bridge_run_id).toBeNull();
    expect(run.provider_id).toBe('provider-1');
  });

  it('buildSessionCallbacks persists run status and agent comments', async () => {
    const { db, server, sessionCookie } = await createTestApp();

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Assigned', agent: 'bob' },
    });
    const { card } = JSON.parse(createRes.body);
    const run = createRun(db, { card_id: card.id, agent_name: 'bob' });

    const callbacks = buildSessionCallbacks(db);
    callbacks.onRunCreated(run.id, 'br-456');
    callbacks.onAgentMessage(card.id, run.id, 'bob', 'done');
    callbacks.onComplete(card.id, run.id, 'completed');

    const [updatedRun] = listRuns(db, card.id);
    expect(updatedRun.status).toBe('completed');
    expect(updatedRun.bridge_run_id).toBe('br-456');
    const comments = listComments(db, card.id);
    expect(comments.find((comment) => comment.author_kind === 'agent')?.content).toBe('done');
  });

  it('buildSessionCallbacks marks permission requests awaiting and emits SSE', async () => {
    const { db, server, sessionCookie } = await createTestApp();

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Permission card', agent: 'bob' },
    });
    const { card } = JSON.parse(createRes.body);
    const run = createRun(db, { card_id: card.id, agent_name: 'bob' });
    const sseManager = { emit: vi.fn() } as unknown as Parameters<typeof buildSessionCallbacks>[1];

    const callbacks = buildSessionCallbacks(db, sseManager);
    callbacks.onPermissionRequest(card.id, run.id, 0, 'bash');

    const [updatedRun] = listRuns(db, card.id);
    expect(updatedRun.status).toBe('awaiting');
    expect(sseManager?.emit).toHaveBeenCalledWith(card.id, 'run.awaiting', { run_id: run.id, tool: 'bash' });
  });

  it('buildSessionCallbacks marks run.in_progress events running', async () => {
    const { db, server, sessionCookie } = await createTestApp();

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Progress card', agent: 'bob' },
    });
    const { card } = JSON.parse(createRes.body);
    const run = createRun(db, { card_id: card.id, agent_name: 'bob' });
    updateRun(db, run.id, { status: 'awaiting' });
    const sseManager = { emit: vi.fn() } as unknown as Parameters<typeof buildSessionCallbacks>[1];

    const callbacks = buildSessionCallbacks(db, sseManager);
    callbacks.onEvent(card.id, 'run.in_progress', { run_id: run.id });

    const [updatedRun] = listRuns(db, card.id);
    expect(updatedRun.status).toBe('running');
    expect(sseManager?.emit).toHaveBeenCalledWith(card.id, 'run.in_progress', { run_id: run.id });
  });

  it('marks stale bridge runs as failed before dispatching a new run', async () => {
    const { db, server, sessionCookie } = await createTestApp({ registerBridge: true });

    // Create a card with an agent
    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Task', agent: 'bob' },
    });
    const { card } = JSON.parse(createRes.body);

    // Seed a stale run directly into the DB (simulates a run that was in-progress)
    const { createRun: _cr, updateRun: _ur } = await import('./cards.js');
    const staleRun = _cr(db, { card_id: card.id, agent_name: 'bob', input_comment_id: undefined });
    _ur(db, staleRun.id, { status: 'running', bridge_run_id: 'stale-br-999' });

    // Post a comment to trigger new dispatch
    await server.inject({
      method: 'POST', url: `/api/cards/${card.id}/comments`,
      headers: { cookie: sessionCookie },
      payload: { content: 'new prompt' },
    });

    // Stale run should be marked failed immediately (synchronous DB cleanup)
    const runs = listRuns(db, card.id);
    const stale = runs.find((r) => r.id === staleRun.id);
    expect(stale?.status).toBe('failed');
    expect(stale?.error).toBe('cancelled before new dispatch');
  });


  it('denies and removes stale ACP runs before dispatching a new run', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const acp = createMockAcpManager();
    const { db, server, sessionCookie } = await createTestApp({
      registerBridge: true,
      acpManagers: new Map([['agent-1', acp.manager]]),
    });

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'ACP task', agent: 'bob' },
    });
    const { card } = JSON.parse(createRes.body);
    createAcpAgentRow(db);
    updateCard(db, card.id, { agent_id: 'agent-1' });

    await server.inject({
      method: 'POST', url: `/api/cards/${card.id}/comments`,
      headers: { cookie: sessionCookie },
      payload: { content: 'first prompt' },
    });

    const firstRun = listRuns(db, card.id).find((run) => run.input_comment_id);
    expect(firstRun?.status).toBe('awaiting');
    expect(acp.runs).toHaveLength(1);

    await server.inject({
      method: 'POST', url: `/api/cards/${card.id}/comments`,
      headers: { cookie: sessionCookie },
      payload: { content: 'second prompt' },
    });

    const stale = listRuns(db, card.id).find((run) => run.id === firstRun?.id);
    expect(stale?.status).toBe('failed');
    expect(stale?.error).toBe('cancelled before new dispatch');
    expect(stale?.acp_session_id).toMatch(/^acp-session-/);
    expect(acp.runs[0].cancelPendingPermission).toHaveBeenCalledTimes(1);
    expect(acp.runs[0].cancelPendingPermission).toHaveBeenCalledWith('deny');

    const resumeRes = await server.inject({
      method: 'POST',
      url: `/api/cards/${card.id}/runs/${firstRun?.id}/resume`,
      headers: { cookie: sessionCookie },
      payload: { decision: 'allow-once' },
    });

    expect(resumeRes.statusCode).toBe(409);
    expect(JSON.parse(resumeRes.body)).toEqual({ error: 'run is not awaiting permission' });
    expect(acp.runs[0].resume).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
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
      'http://localhost:7878/runs/br-test-1/resume',
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

  it('resumes an awaiting ACP run through its active manager', async () => {
    const acp = createMockAcpManager();
    const { db, server, sessionCookie } = await createTestApp({
      registerBridge: true,
      acpManagers: new Map([['agent-1', acp.manager]]),
    });
    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'ACP awaiting permission', agent: 'bob' },
    });
    const { card } = JSON.parse(createRes.body);
    createAcpAgentRow(db);
    updateCard(db, card.id, { agent_id: 'agent-1' });

    await server.inject({
      method: 'POST', url: `/api/cards/${card.id}/comments`,
      headers: { cookie: sessionCookie },
      payload: { content: 'needs permission' },
    });

    const run = listRuns(db, card.id).find((candidate) => candidate.input_comment_id);
    expect(run?.status).toBe('awaiting');

    const resumeRes = await server.inject({
      method: 'POST',
      url: `/api/cards/${card.id}/runs/${run!.id}/resume`,
      headers: { cookie: sessionCookie },
      payload: { decision: 'allow-once' },
    });

    expect(resumeRes.statusCode).toBe(200);
    expect(JSON.parse(resumeRes.body)).toEqual({
      run_id: run!.id,
      decision: 'allow-once',
    });
    expect(acp.runs[0].resume.mock.calls.map(([decision]) => decision)).toEqual(['allow']);
    const resumedRun = listRuns(db, card.id).find((candidate) => candidate.id === run!.id);
    expect(resumedRun?.status).toBe('running');
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


  it('rejects ACP resume when active manager run is no longer awaiting', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const acp = createMockAcpManager();
    const { db, server, sessionCookie } = await createTestApp({
      registerBridge: true,
      acpManagers: new Map([['agent-1', acp.manager]]),
    });
    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'ACP not awaiting', agent: 'bob' },
    });
    const { card } = JSON.parse(createRes.body);
    createAcpAgentRow(db);
    updateCard(db, card.id, { agent_id: 'agent-1' });

    await server.inject({
      method: 'POST', url: `/api/cards/${card.id}/comments`,
      headers: { cookie: sessionCookie },
      payload: { content: 'needs permission' },
    });

    const run = listRuns(db, card.id).find((candidate) => candidate.input_comment_id);
    expect(run?.status).toBe('awaiting');
    updateRun(db, run!.id, { status: 'failed' });

    const res = await server.inject({
      method: 'POST',
      url: `/api/cards/${card.id}/runs/${run!.id}/resume`,
      headers: { cookie: sessionCookie },
      payload: { decision: 'allow-once' },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: 'run is not awaiting permission' });
    expect(acp.runs[0].resume).not.toHaveBeenCalled();
    expect(acp.runs[0].cancelPendingPermission).toHaveBeenCalledTimes(1);
    expect(acp.runs[0].cancelPendingPermission).toHaveBeenCalledWith('deny');
    const cancelledRun = listRuns(db, card.id).find((candidate) => candidate.id === run!.id);
    expect(cancelledRun?.status).toBe('failed');
    expect(cancelledRun?.error).toBe('cancelled by invalid resume');
    expect(cancelledRun?.finished_at).toEqual(expect.any(String));

    const retryRes = await server.inject({
      method: 'POST',
      url: `/api/cards/${card.id}/runs/${run!.id}/resume`,
      headers: { cookie: sessionCookie },
      payload: { decision: 'allow-once' },
    });

    expect(retryRes.statusCode).toBe(409);
    expect(JSON.parse(retryRes.body)).toEqual({ error: 'run is not awaiting permission' });
    expect(fetchMock).not.toHaveBeenCalled();
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


describe('POST /api/cards/:id/runs/:run_id/reconnect', () => {
  it('returns 404 if card not found', async () => {
    const { server, sessionCookie } = await createTestApp({ registerBridge: true });
    const res = await server.inject({
      method: 'POST',
      url: '/api/cards/nonexistent/runs/nonexistent/reconnect',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('Card not found');
  });

  it('returns 404 if run not found', async () => {
    const { server, sessionCookie, db } = await createTestApp({ registerBridge: true });
    createAcpAgentRow(db);
    const cardRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Test', agent: 'agent-1' },
    });
    const cardId = JSON.parse(cardRes.body).card.id;
    db.prepare('UPDATE cards SET agent_id = ? WHERE id = ?').run('agent-1', cardId);

    const res = await server.inject({
      method: 'POST',
      url: `/api/cards/${cardId}/runs/nonexistent/reconnect`,
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('Run not found');
  });

  it('returns 409 if run is not interrupted', async () => {
    const { server, sessionCookie, db } = await createTestApp({ registerBridge: true });
    createAcpAgentRow(db);
    const cardRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Test' },
    });
    const cardId = JSON.parse(cardRes.body).card.id;
    const run = createRun(db, { card_id: cardId, agent_name: 'bob' });
    updateRun(db, run.id, { status: 'failed' });

    const res = await server.inject({
      method: 'POST',
      url: `/api/cards/${cardId}/runs/${run.id}/reconnect`,
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('run is not interrupted');
  });

  it('returns 503 if no ACP manager for the agent', async () => {
    const { server, sessionCookie, db } = await createTestApp({ registerBridge: true });
    createAcpAgentRow(db);
    const cardRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Test' },
    });
    const cardId = JSON.parse(cardRes.body).card.id;
    db.prepare('UPDATE cards SET agent_id = ? WHERE id = ?').run('agent-1', cardId);

    const run = createRun(db, { card_id: cardId, agent_name: 'bob' });
    db.prepare("UPDATE runs SET status = 'interrupted', acp_session_id = ? WHERE id = ?").run('ses-xyz', run.id);

    const res = await server.inject({
      method: 'POST',
      url: `/api/cards/${cardId}/runs/${run.id}/reconnect`,
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(503);
  });

  it('forks manager, calls resumeSession, updates run to running, returns run_id', async () => {
    const { manager: acpManager, runs: acpRuns } = createMockAcpManager();
    const acpManagers = new Map([['agent-1', acpManager]]);
    const { server, sessionCookie, db } = await createTestApp({
      registerBridge: true,
      acpManagers,
    });
    createAcpAgentRow(db);
    const cardRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Test', agent: 'agent-1' },
    });
    const cardId = JSON.parse(cardRes.body).card.id;
    db.prepare('UPDATE cards SET agent_id = ? WHERE id = ?').run('agent-1', cardId);

    const run = createRun(db, { card_id: cardId, agent_name: 'agent-1' });
    db.prepare("UPDATE runs SET status = 'interrupted', acp_session_id = ? WHERE id = ?").run('ses-stored-1', run.id);

    const res = await server.inject({
      method: 'POST',
      url: `/api/cards/${cardId}/runs/${run.id}/reconnect`,
      headers: { cookie: sessionCookie },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).run_id).toBe(run.id);

    const updatedRun = listRuns(db, cardId).find((r) => r.id === run.id)!;
    expect(updatedRun.status).toBe('running');

    expect(acpRuns).toHaveLength(1);
    expect(acpRuns[0].resumeSession).toHaveBeenCalledWith(cardId, 'agent-1', run.id, 'ses-stored-1');
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

  it('dispatches card-create run through provider registry', async () => {
    const { provider, dispatch: mockDispatch } = createMockBridgeProvider();
    const registry = createMockProviderRegistry(provider);
    const { db, server, sessionCookie } = await createTestApp({ registerBridge: true, registry });
    createBridgeProviderRow(db);

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Agent card', description: 'Build the thing', agent: 'bob' },
    });
    expect(createRes.statusCode).toBe(201);
    const { card } = JSON.parse(createRes.body);

    const [run] = listRuns(db, card.id);
    expect(mockDispatch).toHaveBeenCalledWith(card.id, 'bob', 'Build the thing', run.id);
    expect(run.status).toBe('created');
    expect(run.bridge_run_id).toBeNull();
    expect(run.provider_id).toBe('provider-1');
  });

  it('keeps card-create response successful and fails run when agent is unknown', async () => {
    const { db, server, sessionCookie } = await createTestApp({ registerBridge: true });

    const createRes = await server.inject({
      method: 'POST', url: '/api/cards',
      headers: { cookie: sessionCookie },
      payload: { title: 'Agent card', description: 'Build the thing', agent: 'bob' },
    });
    expect(createRes.statusCode).toBe(201);
    const { card } = JSON.parse(createRes.body);

    const [run] = listRuns(db, card.id);
    expect(run.status).toBe('failed');
    expect(run.error).toBe("Agent 'bob' is not configured. Add it in Settings.");
    expect(run.finished_at).toEqual(expect.any(String));
    expect(run.bridge_run_id).toBeNull();
  });
});

describe('bridge streaming integration', () => {
  it('persists agent reply as card comment and sets bridge_run_id when message.completed fires', async () => {
    const { provider } = createMockBridgeProvider();
    const registry = createMockProviderRegistry(provider);
    const { db, server, sessionCookie } = await createTestApp({ registerBridge: true, registry });
    createBridgeProviderRow(db);

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
    expect(commentRes.statusCode).toBe(202);
    const { run_id } = JSON.parse(commentRes.body);

    const callbacks = buildSessionCallbacks(db);
    callbacks.onRunCreated(run_id, 'bridge-run-99');
    callbacks.onAgentMessage(card.id, run_id, 'bob', 'hello');
    callbacks.onComplete(card.id, run_id, 'completed');

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
    const { provider } = createMockBridgeProvider();
    const registry = createMockProviderRegistry(provider);
    const { db, server, sessionCookie } = await createTestApp({ registerBridge: true, registry });
    createBridgeProviderRow(db);

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

    const callbacks = buildSessionCallbacks(db);
    callbacks.onRunCreated(run_id, 'bridge-run-55');

    const runs = listRuns(db, card.id);
    const run = runs.find((r) => r.id === run_id)!;
    expect(run.bridge_run_id).toBe('bridge-run-55');
    expect(run.status).toBe('running');
  });
});
