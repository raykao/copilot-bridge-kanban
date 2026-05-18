import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { DispatchCallbacks } from './dispatch-types.js';
import {
  createProvider,
  getProvider,
  listProviders,
  updateProvider,
  deleteProvider,
  type NewProvider,
  type Provider,
  type ProviderType as DbProviderType,
} from './providers-db.js';
import {
  listAgentsByProvider,
  deleteAgentsByProvider,
} from './agents-db.js';
import { ProviderRegistry } from './providers/registry.js';
import { buildProviderInstance } from './providers/build.js';

export function registerProviderAdminRoutes(
  app: FastifyInstance,
  db: Database.Database,
  registry: ProviderRegistry,
  callbacks: DispatchCallbacks,
): void {
  app.get('/api/admin/providers', async (_request, reply) => {
    const providers = listProviders(db);
    const result = providers.map((p) => {
      const health = registry.getHealth(p.id);
      return {
        ...p,
        registry_status: health?.status ?? 'unknown',
        agent_count: listAgentsByProvider(db, p.id).length,
        last_error: health?.lastError ?? null,
      };
    });
    return reply.send({ providers: result });
  });

  app.post('/api/admin/providers', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    if (typeof body.url !== 'string' || body.url.trim() === '') {
      return reply.status(400).send({ error: 'url is required' });
    }
    if (typeof body.type !== 'string' || (body.type !== 'acp' && body.type !== 'copilot-bridge')) {
      return reply.status(400).send({ error: 'type must be "acp" or "copilot-bridge"' });
    }
    const label = typeof body.label === 'string' && body.label.trim() !== ''
      ? body.label.trim()
      : body.url.trim();
    const input: NewProvider = {
      type: body.type as DbProviderType,
      label,
      url: body.url.trim(),
      api_key: typeof body.api_key === 'string' && body.api_key.trim() !== '' ? body.api_key.trim() : null,
    };
    const provider = createProvider(db, input);
    const instance = buildProviderInstance(provider, callbacks);
    if (instance) registry.addProvider(instance);
    return reply.status(201).send({ provider });
  });

  app.get('/api/admin/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const provider = getProvider(db, id);
    if (!provider) return reply.status(404).send({ error: 'Provider not found' });
    const agents = listAgentsByProvider(db, id);
    const health = registry.getHealth(id);
    return reply.send({
      provider,
      agents,
      registry_status: health?.status ?? 'unknown',
      last_error: health?.lastError ?? null,
    });
  });

  app.patch('/api/admin/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const existing = getProvider(db, id);
    if (!existing) return reply.status(404).send({ error: 'Provider not found' });

    const patch: Parameters<typeof updateProvider>[2] = {};
    if (typeof body.label === 'string' && body.label.trim() !== '') patch.label = body.label.trim();
    if (typeof body.url === 'string' && body.url.trim() !== '') patch.url = body.url.trim();
    if ('api_key' in body) {
      patch.api_key = typeof body.api_key === 'string' && body.api_key.trim() !== ''
        ? body.api_key.trim()
        : null;
    }
    const updated = updateProvider(db, id, patch);
    const urlOrKeyChanged = patch.url !== undefined || 'api_key' in patch;
    if (urlOrKeyChanged) {
      registry.removeProvider(id);
      const instance = buildProviderInstance(updated, callbacks);
      if (instance) registry.addProvider(instance);
    }
    return reply.send({ provider: updated });
  });

  app.delete('/api/admin/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getProvider(db, id)) return reply.status(404).send({ error: 'Provider not found' });
    deleteAgentsByProvider(db, id);
    deleteProvider(db, id);
    registry.removeProvider(id);
    return reply.status(204).send();
  });

  app.post('/api/admin/providers/:id/discover', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getProvider(db, id)) return reply.status(404).send({ error: 'Provider not found' });
    const triggered = registry.triggerDiscover(id);
    if (!triggered) {
      return reply.status(409).send({ error: 'Provider not registered in runtime registry' });
    }
    return reply.status(202).send({ status: 'discovery_triggered' });
  });
}
