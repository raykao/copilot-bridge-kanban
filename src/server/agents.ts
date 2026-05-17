import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { ProviderRegistry } from './providers/registry.js';

export function registerAgentRoutes(
  app: FastifyInstance,
  config: AppConfig,
  registry: ProviderRegistry,
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
      const cards = await registry.fanoutDiscover();
      return reply.send({ cards });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Discovery error';
      return reply.status(502).send({ error: 'Agent discovery failed', detail: message });
    }
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
