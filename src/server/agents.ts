import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { ProviderRegistry } from './providers/registry.js';
import { listAgents } from './agents-db.js';
import type { SseManager } from './sse.js';

export function registerAgentRoutes(
  app: FastifyInstance,
  config: AppConfig,
  registry: ProviderRegistry,
  db: Database.Database,
  sseManager: SseManager,
): void {
  app.get('/api/agents', async (request, reply) => {
    try {
      const res = await fetch(`${config.bridgeApiUrl}/v1/agents`, {
        headers: { Authorization: `Bearer ${config.bridgeApiKey}` },
      });
      const body = await res.text();
      return reply.status(res.status)
        .header('content-type', res.headers.get('content-type') ?? 'application/json')
        .send(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bridge request error';
      request.log.error({ err }, 'agent bridge request error');
      return reply.status(502).send({ error: 'Bridge unavailable', detail: message });
    }
  });

  app.get('/api/agents/cards', async (_request, reply) => {
    try {
      let cards = await registry.fanoutDiscover();
      if (cards.length === 0) {
        registry.startHealthMonitor();
        await Promise.resolve();
        cards = await registry.fanoutDiscover();
      }
      return reply.send({ cards });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Discovery error';
      return reply.status(502).send({ error: 'Agent discovery failed', detail: message });
    }
  });

  app.get('/api/agents/provider-status', async (_request, reply) => {
    const agents = listAgents(db);
    const allHealth = registry.getAllHealth();
    const providers = agents
      .filter(a => a.protocol === 'generic-acp' || a.protocol === 'copilot-bridge')
      .map(agent => {
        const entry = allHealth.find(e => e.id === agent.id);
        return {
          id: agent.id,
          label: agent.name,
          protocol: agent.protocol,
          url: agent.url,
          status: entry?.health.status ?? 'disconnected',
          agents: entry?.health.agents ?? [],
          lastError: entry?.health.lastError ?? null,
          lastDiscoveredAt: entry?.health.lastDiscoveredAt ?? null,
        };
      });
    return reply.send({ providers });
  });

  app.get('/api/sse/system', (request, reply) => {
    const raw = reply.raw;
    raw.setHeader('content-type', 'text/event-stream');
    raw.setHeader('cache-control', 'no-cache');
    raw.setHeader('connection', 'keep-alive');
    raw.flushHeaders();
    sseManager.subscribeGlobal(raw);
    request.raw.on('close', () => sseManager.unsubscribeGlobal(raw));
    return reply;
  });

  app.get('/api/agents/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    try {
      const res = await fetch(
        `${config.bridgeApiUrl}/v1/agents/${encodeURIComponent(name)}`,
        { headers: { Authorization: `Bearer ${config.bridgeApiKey}` } },
      );
      const body = await res.text();
      return reply.status(res.status)
        .header('content-type', res.headers.get('content-type') ?? 'application/json')
        .send(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bridge request error';
      request.log.error({ err }, 'agent bridge request error');
      return reply.status(502).send({ error: 'Bridge unavailable', detail: message });
    }
  });
}
