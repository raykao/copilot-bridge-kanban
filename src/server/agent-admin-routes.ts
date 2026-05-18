import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { CardSessionManager, type BridgeConfig, type DispatchCallbacks } from './card-session-manager.js';
import {
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  updateAgent,
  type NewAgent,
} from './agents-db.js';
import { ProviderRegistry } from './providers/registry.js';
import { GenericAcpProvider } from './providers/generic-acp.js';
import { CopilotBridgeProvider } from './providers/copilot-bridge.js';

function deriveLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
}

export function registerAgentAdminRoutes(
  app: FastifyInstance,
  db: Database.Database,
  registry: ProviderRegistry,
  callbacks: DispatchCallbacks,
  providerManagers: Map<string, CardSessionManager>,
): void {
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
    if (agent.protocol === 'copilot-bridge') {
      const bridgeConfig: BridgeConfig = { bridgeApiUrl: agent.url, bridgeApiKey: agent.api_key ?? '' };
      const mgr = new CardSessionManager(bridgeConfig, callbacks);
      providerManagers.set(agent.id, mgr);
      registry.addProvider(new CopilotBridgeProvider(agent.id, agent.url, agent.api_key ?? null, mgr));
    } else if (agent.protocol === 'generic-acp') {
      registry.addProvider(new GenericAcpProvider(agent.id, agent.url, agent.api_key ?? null));
    }
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
    if (patch.url !== undefined || patch.api_key !== undefined) {
      registry.removeProvider(id);
      providerManagers.delete(id);
      if (agent.protocol === 'copilot-bridge') {
        const bridgeConfig: BridgeConfig = { bridgeApiUrl: agent.url, bridgeApiKey: agent.api_key ?? '' };
        const mgr = new CardSessionManager(bridgeConfig, callbacks);
        providerManagers.set(agent.id, mgr);
        registry.addProvider(new CopilotBridgeProvider(agent.id, agent.url, agent.api_key ?? null, mgr));
      } else if (agent.protocol === 'generic-acp') {
        registry.addProvider(new GenericAcpProvider(agent.id, agent.url, agent.api_key ?? null));
      }
    }
    return reply.send({ agent });
  });

  app.delete('/api/admin/agents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getAgent(db, id)) return reply.status(404).send({ error: 'Agent not found' });
    deleteAgent(db, id);
    registry.removeProvider(id);
    providerManagers.delete(id);
    return reply.status(204).send();
  });
}
