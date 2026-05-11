import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config.js';

export async function createServer(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport:
        process.env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
          : undefined,
    },
  });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      { method: request.method, url: request.url, status: reply.statusCode, ms: Math.round(reply.elapsedTime) },
      'request completed',
    );
  });

  await app.register(fastifyCookie, {
    secret: config.sessionSecret,
  });

  const healthHandler = async () => ({ status: 'ok' });

  app.get('/healthz', healthHandler);
  app.get('/api/health', healthHandler);

  const isProduction = process.env.NODE_ENV !== 'development';

  if (isProduction) {
    const clientDist = path.resolve(import.meta.dirname, '../../dist/client');
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
  } else {
    const { registerViteDevMiddleware } = await import('./dev.js');
    await registerViteDevMiddleware(app);
  }

  return app;
}
