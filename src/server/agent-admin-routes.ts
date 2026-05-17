import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import {
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  updateAgent,
  type NewAgent,
} from './agents-db.js';

function deriveLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
}

export function registerAgentAdminRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/admin/agents', async (_request, reply) => {
    return reply.send({ agents: listAgents(db) });
  });

  app.post('/api/admin/agents', async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    if (typeof body.url !== 'string' || body.url.trim() === '') {
      return reply.status(400).send({ error: 'url is required' });
    }

    const url = body.url.trim();
    const name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : deriveLabel(url);
    const input: NewAgent = {
      name,
      url,
      protocol: typeof body.protocol === 'string' ? body.protocol : 'acp',
      auto_approve: body.auto_approve === true,
      api_key: typeof body.api_key === 'string' ? body.api_key : undefined,
    };

    const agent = createAgent(db, input);
    return reply.status(201).send({ agent });
  });

  app.get('/api/admin/agents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = getAgent(db, id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return reply.send({ agent });
  });

  app.patch('/api/admin/agents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    if (!getAgent(db, id)) return reply.status(404).send({ error: 'Agent not found' });

    const patch: Parameters<typeof updateAgent>[2] = {};
    if ('name' in body) patch.name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : null;
    if (typeof body.protocol === 'string') patch.protocol = body.protocol;
    if (typeof body.url === 'string') patch.url = body.url.trim();
    if (typeof body.auto_approve === 'boolean') patch.auto_approve = body.auto_approve;
    if ('api_key' in body) patch.api_key = typeof body.api_key === 'string' ? body.api_key : null;

    const agent = updateAgent(db, id, patch);
    return reply.send({ agent });
  });

  app.delete('/api/admin/agents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getAgent(db, id)) return reply.status(404).send({ error: 'Agent not found' });
    deleteAgent(db, id);
    return reply.status(204).send();
  });
}
