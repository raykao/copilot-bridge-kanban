import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { AppConfig } from './config.js';
import { addComment, getCard, updateRun, listRuns } from './cards.js';
import type { SseManager } from './sse.js';

/**
 * Internal callback routes used by copilot-bridge to deliver agent responses.
 * These are NOT behind session auth -- they use the bridge API key for auth.
 */
export function registerAgentCallbackRoutes(
  app: FastifyInstance,
  db: Database.Database,
  config: AppConfig,
  sseManager?: SseManager,
): void {
  app.post('/api/internal/cards/:id/agent-response', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const expectedToken = `Bearer ${config.bridgeApiKey}`;

    if (authHeader !== expectedToken) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const body = request.body as {
      content: string;
      run_id?: string;
      session_id?: string;
      status?: 'completed' | 'failed';
      error?: string;
    };

    const card = getCard(db, id);
    if (!card) {
      return reply.status(404).send({ error: 'Card not found' });
    }

    // Insert agent comment
    const comment = addComment(db, {
      card_id: id,
      author_kind: 'agent',
      author_id: card.agent_bot ?? 'unknown',
      content: body.content,
      run_id: body.run_id,
    });

    sseManager?.emit(id, 'comment.created', comment);

    // Update run status if run_id provided
    if (body.run_id) {
      const status = body.status ?? 'completed';
      updateRun(db, body.run_id, {
        status,
        bridge_session_id: body.session_id ?? null,
        ...(status === 'completed' || status === 'failed'
          ? { finished_at: new Date().toISOString() }
          : {}),
        ...(body.error ? { error: body.error } : {}),
      });
      sseManager?.emit(id, 'run.status', { run_id: body.run_id, status });
    } else {
      // If no run_id, find the latest running run for this card and complete it
      const runs = listRuns(db, id);
      const activeRun = runs.find((r) => r.status === 'running' || r.status === 'created');
      if (activeRun) {
        const status = body.status ?? 'completed';
        updateRun(db, activeRun.id, {
          status,
          bridge_session_id: body.session_id ?? null,
          finished_at: new Date().toISOString(),
        });
        sseManager?.emit(id, 'run.status', { run_id: activeRun.id, status });
      }
    }

    return reply.status(201).send({ comment });
  });
}
