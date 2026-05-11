import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { AppConfig } from './config.js';
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
  listRuns,
  type CardFilter,
} from './cards.js';
import { dispatchToBridge } from './dispatch.js';
import type { SseManager } from './sse.js';

export function registerCardRoutes(app: FastifyInstance, db: Database.Database, config?: AppConfig, sseManager?: SseManager): void {
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

        dispatchToBridge(config, db, {
          bot: card.agent_bot,
          prompt: card.description,
          cardId: card.id,
          runId: run.id,
        }).catch((err) => {
          app.log.error({ err, cardId: card.id, runId: run.id }, 'dispatch failed');
        });
      }
    }

    return reply.status(201).send({
      card: { ...card, labels: getLabels(db, card.id) },
    });
  });

  // -----------------------------------------------------------------------
  // SSE events
  // -----------------------------------------------------------------------

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

    // If card has an assigned agent, create a run for dispatch
    let run_id: string | undefined;
    if (card.agent_bot) {
      const run = createRun(db, {
        card_id: id,
        agent_name: card.agent_bot,
        input_comment_id: comment.id,
      });
      run_id = run.id;

      if (config) {
        // Fire-and-forget dispatch -- don't block the response
        dispatchToBridge(config, db, {
          bot: card.agent_bot,
          prompt: body.content as string,
          cardId: id,
          runId: run.id,
        }).catch((err) => {
          app.log.error({ err, cardId: id, runId: run.id }, 'dispatch failed');
        });
      }
    }

    return reply.status(201).send({ comment, run_id });
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
}
