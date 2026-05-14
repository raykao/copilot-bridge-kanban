import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import {
  createGlobalAgentToken,
  listAgentTokens,
  revokeGlobalAgentToken,
  type AgentTokenSummary,
} from './agent-tokens.js';

interface AgentTokenCreateBody {
  agent_name?: unknown;
}

interface AgentTokenDeleteParams {
  agent_name: string;
}

function validateAgentName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const agentName = value.trim();
  if (agentName.length === 0 || agentName.length > 64) {
    return null;
  }

  return agentName;
}

export function registerAdminRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/admin/agent-tokens', async (request, reply) => {
    const tokens: AgentTokenSummary[] = listAgentTokens(db);
    return reply.send({ tokens });
  });

  app.post('/api/admin/agent-tokens', async (request, reply) => {
    const body = request.body as AgentTokenCreateBody;
    const agentName = validateAgentName(body?.agent_name);

    if (!agentName) {
      return reply.status(400).send({ error: 'agent_name is required and must be 1-64 characters' });
    }

    const token = createGlobalAgentToken(db, agentName);
    return reply.status(201).send(token);
  });

  app.delete('/api/admin/agent-tokens/:agent_name', async (request, reply) => {
    const { agent_name } = request.params as AgentTokenDeleteParams;
    const agentName = validateAgentName(agent_name);

    if (!agentName) {
      return reply.status(400).send({ error: 'Invalid agent_name' });
    }

    const revoked = revokeGlobalAgentToken(db, agentName);

    if (!revoked) {
      return reply.status(404).send({ error: 'Agent token not found' });
    }

    return reply.status(204).send();
  });
}
