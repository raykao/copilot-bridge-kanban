import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import {
  getAgent,
  listAgents,
  listAgentsByProvider,
} from './agents-db.js';

export function registerAgentAdminRoutes(
  app: FastifyInstance,
  db: Database.Database,
): void {
  app.get('/api/admin/agents', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const providerId = typeof query.provider_id === 'string' && query.provider_id.trim() !== ''
      ? query.provider_id.trim()
      : null;
    const agents = providerId ? listAgentsByProvider(db, providerId) : listAgents(db);
    return reply.send({ agents });
  });

  app.get('/api/admin/agents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = getAgent(db, id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return reply.send({ agent });
  });
}
