import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { AppConfig } from './config.js';
import type { CardSessionManager, DispatchCallbacks } from './card-session-manager.js';
import { AcpSessionManager } from './acp-session-manager.js';
import {
  createCard,
  getCard,
  listCards,
  updateCard,
  deleteCard,
  addLabels,
  removeLabel,
  getLabels,
  addComment,
  listComments,
  createRun,
  updateRun,
  listRuns,
  createCheckpoint,
  getCheckpoint,
  listCheckpoints,
  deleteCheckpoint,
  type CardFilter,
} from './cards.js';
import type { SseManager } from './sse.js';

const resumeDecisions = new Set([
  'allow-once',
  'allow-session',
  'allow-all-session',
  'allow-all',
  'deny',
  'deny-session',
  'deny-all',
]);

async function readBridgeResponseBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

export function buildSessionCallbacks(db: Database.Database, sseManager?: SseManager): DispatchCallbacks {
  return {
    onRunCreated: (kanbanRunId, bridgeRunId) => {
      updateRun(db, kanbanRunId, { status: 'running', bridge_run_id: bridgeRunId });
    },
    onEvent: (cardId, eventType, data) => {
      sseManager?.emit(cardId, eventType, data);
    },
    onComplete: (cardId, kanbanRunId, status, error) => {
      updateRun(db, kanbanRunId, { status, finished_at: new Date().toISOString(), ...(error ? { error } : {}) });
    },
    onAgentMessage: (cardId, kanbanRunId, bot, content) => {
      if (!content) return;
      const dup = db.prepare(
        "SELECT 1 FROM card_comments WHERE run_id = ? AND author_kind = 'agent' AND content = ? LIMIT 1",
      ).get(kanbanRunId, content);
      if (dup) return;
      const agentComment = addComment(db, {
        card_id: cardId,
        author_kind: 'agent',
        author_id: bot,
        content,
        run_id: kanbanRunId,
      });
      sseManager?.emit(cardId, 'comment.created', agentComment);
    },
  };
}

export function registerCardRoutes(
  app: FastifyInstance,
  db: Database.Database,
  config?: AppConfig,
  sseManager?: SseManager,
  cardSessionManager?: CardSessionManager,
  acpManagers?: Map<string, AcpSessionManager>,
): void {
  function resolveAndDispatch(cardId: string, cardAgentId: string | null, bot: string, prompt: string, runId: string): void {
    if (cardAgentId) {
      const mgr = acpManagers?.get(cardAgentId);
      if (mgr) {
        mgr.dispatch(cardId, bot, prompt, runId);
        return;
      }
    }
    cardSessionManager?.dispatch(cardId, bot, prompt, runId);
  }

  // -----------------------------------------------------------------------
  // Cards
  // -----------------------------------------------------------------------

  app.get('/api/cards', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const filter: CardFilter = {};

    if (query.agent === 'none') {
      filter.agent_bot = null;
    } else if (query.agent) {
      filter.agent_bot = query.agent;
    }
    if (query.status) filter.status = query.status;
    if (query.label) filter.label = query.label;
    if (query.type === 'work' || query.type === 'chat') filter.type = query.type;

    const cards = listCards(db, filter);

    // Attach labels to each card
    const result = cards.map((card) => ({
      ...card,
      labels: getLabels(db, card.id),
    }));

    return reply.send({ cards: result });
  });

  app.post('/api/cards', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const userId = request.user!.id;

    const card = createCard(db, {
      title: body.title as string,
      description: body.description as string | undefined,
      type: (body.type as 'work' | 'chat') ?? 'work',
      agent_bot: (body.agent as string) ?? null,
      status: (body.status as string) ?? undefined,
      created_by: userId,
      metadata: (body.metadata as Record<string, unknown>) ?? {},
    });

    if (Array.isArray(body.labels) && body.labels.length > 0) {
      addLabels(db, card.id, body.labels as string[]);
    }

    // If agent assigned, insert description as first comment and dispatch
    if (card.agent_bot && card.description) {
      const comment = addComment(db, {
        card_id: card.id,
        author_kind: 'human',
        author_id: userId,
        content: card.description,
      });

      if (config) {
        const run = createRun(db, {
          card_id: card.id,
          agent_name: card.agent_bot,
          input_comment_id: comment.id,
        });
        const bot = card.agent_bot;
        const prompt = card.description;

        resolveAndDispatch(card.id, card.agent_id, bot, prompt, run.id);
      }
    }

    return reply.status(201).send({
      card: { ...card, labels: getLabels(db, card.id) },
    });
  });

  // -----------------------------------------------------------------------
  // SSE events
  // -----------------------------------------------------------------------

  app.get('/api/events', async (_request, reply) => {
    if (!sseManager) {
      return reply.status(503).send({ error: 'SSE not available' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    sseManager.subscribeGlobal(reply.raw);
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ scope: 'global' })}\n\n`);

    reply.hijack();
  });

  app.get('/api/cards/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getCard(db, id)) {
      return reply.status(404).send({ error: 'Card not found' });
    }

    if (!sseManager) {
      return reply.status(503).send({ error: 'SSE not available' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    sseManager.subscribe(id, reply.raw);

    // Send initial connection event
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ card_id: id })}\n\n`);

    // Fastify must not send its own response after we hijack the socket
    reply.hijack();
  });

  app.get('/api/cards/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const card = getCard(db, id);

    if (!card) {
      return reply.status(404).send({ error: 'Card not found' });
    }

    return reply.send({
      card: { ...card, labels: getLabels(db, card.id) },
      comments: listComments(db, card.id),
      runs: listRuns(db, card.id),
    });
  });

  app.patch('/api/cards/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    const existing = getCard(db, id);
    if (!existing) {
      return reply.status(404).send({ error: 'Card not found' });
    }

    const patch: Record<string, unknown> = {};
    for (const key of ['title', 'description', 'status', 'agent_bot', 'type', 'workspace_subdir']) {
      if (key in body) {
        const mappedKey = key === 'agent_bot' ? 'agent_bot' : key;
        patch[mappedKey] = body[key];
      }
    }
    // Also accept "agent" as alias for "agent_bot"
    if ('agent' in body) {
      patch.agent_bot = body.agent;
    }
    if ('metadata' in body) {
      patch.metadata = body.metadata;
    }

    const updated = updateCard(db, id, patch);
    const result = { ...updated, labels: getLabels(db, id) };
    sseManager?.emit(id, 'card.updated', result);
    return reply.send({ card: result });
  });

  app.delete('/api/cards/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = getCard(db, id);
    if (!existing) {
      return reply.status(404).send({ error: 'Card not found' });
    }

    deleteCard(db, id);
    return reply.status(204).send();
  });

  // -----------------------------------------------------------------------
  // Comments
  // -----------------------------------------------------------------------

  app.get('/api/cards/:id/comments', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getCard(db, id)) {
      return reply.status(404).send({ error: 'Card not found' });
    }

    return reply.send({ comments: listComments(db, id) });
  });

  app.post('/api/cards/:id/comments', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const userId = request.user!.id;

    const card = getCard(db, id);
    if (!card) {
      return reply.status(404).send({ error: 'Card not found' });
    }

    const comment = addComment(db, {
      card_id: id,
      author_kind: 'human',
      author_id: userId,
      content: body.content as string,
    });

    sseManager?.emit(id, 'comment.created', comment);

    // If card has an assigned agent, create a run and stream the response
    let run_id: string | undefined;
    if (card.agent_bot) {
      const run = createRun(db, {
        card_id: id,
        agent_name: card.agent_bot,
        input_comment_id: comment.id,
      });
      run_id = run.id;

      if (config) {
        const bot = card.agent_bot;
        // Mark stale runs as failed before dispatching a new one
        const staleRuns = listRuns(db, id).filter(
          (candidate) =>
            (candidate.status === 'running' || candidate.status === 'awaiting') &&
            candidate.id !== run.id,
        );
        for (const staleRun of staleRuns) {
          updateRun(db, staleRun.id, {
            status: 'failed',
            error: 'cancelled before new dispatch',
            finished_at: new Date().toISOString(),
          });
        }
        resolveAndDispatch(id, card.agent_id, bot, body.content as string, run.id);
      }
    }

    return reply.status(202).send({ comment, run_id });
  });

  // -----------------------------------------------------------------------
  // Labels
  // -----------------------------------------------------------------------

  app.post('/api/cards/:id/labels', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { labels: string[] };

    if (!getCard(db, id)) {
      return reply.status(404).send({ error: 'Card not found' });
    }

    addLabels(db, id, body.labels);
    const labels = getLabels(db, id);
    sseManager?.emit(id, 'labels.updated', { card_id: id, labels });
    return reply.send({ labels });
  });

  app.delete('/api/cards/:id/labels/:label', async (request, reply) => {
    const { id, label } = request.params as { id: string; label: string };

    if (!getCard(db, id)) {
      return reply.status(404).send({ error: 'Card not found' });
    }

    removeLabel(db, id, label);
    sseManager?.emit(id, 'labels.updated', { card_id: id, labels: getLabels(db, id) });
    return reply.status(204).send();
  });

  // -----------------------------------------------------------------------
  // Runs
  // -----------------------------------------------------------------------

  app.get('/api/cards/:id/runs', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getCard(db, id)) {
      return reply.status(404).send({ error: 'Card not found' });
    }

    return reply.send({ runs: listRuns(db, id) });
  });

  app.get('/api/cards/:id/runs/:run_id', async (request, reply) => {
    const { id, run_id } = request.params as { id: string; run_id: string };
    if (!getCard(db, id)) {
      return reply.status(404).send({ error: 'Card not found' });
    }

    const run = listRuns(db, id).find((candidate) => candidate.id === run_id);
    if (!run) {
      return reply.status(404).send({ error: 'run not found' });
    }

    return reply.send({ run });
  });

  app.post('/api/cards/:id/runs/:run_id/resume', async (request, reply) => {
    const { id, run_id } = request.params as { id: string; run_id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;

    if (!getCard(db, id)) {
      return reply.status(404).send({ error: 'Card not found' });
    }

    const run = listRuns(db, id).find((candidate) => candidate.id === run_id);
    if (!run) {
      return reply.status(404).send({ error: 'Run not found' });
    }

    if (typeof body.decision !== 'string' || !resumeDecisions.has(body.decision)) {
      return reply.status(400).send({ error: 'invalid decision' });
    }

    if (!config) {
      return reply.status(503).send({ error: 'bridge not configured' });
    }

    const bridgeRunId = run.bridge_run_id;
    if (!bridgeRunId) {
      return reply.status(409).send({ error: 'run not yet dispatched to bridge' });
    }

    try {
      const bridgeResponse = await fetch(`${config.bridgeApiUrl}/runs/${bridgeRunId}/resume`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.bridgeApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ decision: body.decision }),
      });

      if (bridgeResponse.status === 404 || bridgeResponse.status === 409) {
        const bridgeBody = await readBridgeResponseBody(bridgeResponse);
        return reply.status(bridgeResponse.status).send(bridgeBody);
      }

      if (!bridgeResponse.ok) {
        return reply.status(502).send({ error: 'bridge unavailable' });
      }

      return reply.send({ run_id, decision: body.decision });
    } catch {
      return reply.status(502).send({ error: 'bridge unavailable' });
    }
  });

  // -----------------------------------------------------------------------
  // Checkpoints
  // -----------------------------------------------------------------------

  app.get('/api/cards/:id/checkpoints', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getCard(db, id)) {
      return reply.status(404).send({ error: 'Card not found' });
    }

    return reply.send({ checkpoints: listCheckpoints(db, id) });
  });

  app.post('/api/cards/:id/checkpoints', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const userId = request.user!.id;
    if (!getCard(db, id)) {
      return reply.status(404).send({ error: 'Card not found' });
    }

    const checkpoint = createCheckpoint(db, {
      card_id: id,
      created_by: userId,
      name: (body.name as string) ?? undefined,
    });
    return reply.status(201).send(checkpoint);
  });

  app.delete('/api/cards/:id/checkpoints/:checkpointId', async (request, reply) => {
    const { id, checkpointId } = request.params as { id: string; checkpointId: string };
    if (!getCard(db, id)) {
      return reply.status(404).send({ error: 'Card not found' });
    }

    const checkpoint = getCheckpoint(db, checkpointId);
    if (!checkpoint || checkpoint.card_id !== id) {
      return reply.status(404).send({ error: 'Checkpoint not found' });
    }

    deleteCheckpoint(db, checkpointId);
    return reply.status(204).send();
  });
}
