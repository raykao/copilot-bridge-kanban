import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config.js';

export async function createServer(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyCookie, {
    secret: config.sessionSecret,
  });

  const healthHandler = async () => ({ status: 'ok' });

  app.get('/healthz', healthHandler);
  app.get('/api/health', healthHandler);

  const clientDist = path.resolve(import.meta.dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: '/',
      wildcard: false,
    });

    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Not found' });
      }

      return reply.sendFile('index.html');
    });
  }

  return app;
}
