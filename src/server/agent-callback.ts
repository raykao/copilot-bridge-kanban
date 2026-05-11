import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { AppConfig } from './config.js';
import { addComment, getCard, updateRun, listRuns } from './cards.js';

/**
 * Internal callback routes used by copilot-bridge to deliver agent responses.
 * These are NOT behind session auth -- they use the bridge API key for auth.
 */
export function registerAgentCallbackRoutes(
  app: FastifyInstance,
  db: Database.Database,
  config: AppConfig,
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
    } else {
      // If no run_id, find the latest running run for this card and complete it
      const runs = listRuns(db, id);
      const activeRun = runs.find((r) => r.status === 'running' || r.status === 'created');
      if (activeRun) {
        updateRun(db, activeRun.id, {
          status: body.status ?? 'completed',
          bridge_session_id: body.session_id ?? null,
          finished_at: new Date().toISOString(),
        });
      }
    }

    return reply.status(201).send({ comment });
  });
}
