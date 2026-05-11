import type { FastifyInstance } from 'fastify';

export async function registerViteDevMiddleware(app: FastifyInstance): Promise<void> {
  const { createServer: createViteServer } = await import('vite');

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });

  await app.register(import('@fastify/middie'));
  app.use(vite.middlewares);
}
