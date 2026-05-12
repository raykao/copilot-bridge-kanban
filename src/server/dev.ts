import type { FastifyInstance } from 'fastify';
import type { ViteDevServer } from 'vite';

export async function registerViteDevMiddleware(app: FastifyInstance): Promise<void> {
  const { createServer: createViteServer } = await import('vite');

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom',
  });

  await app.register(import('@fastify/middie'));
  app.use(vite.middlewares);

  // SPA fallback for non-API routes (appType: 'custom' disables Vite's built-in fallback)
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send({ error: 'Not found' });
    }

    const fs = await import('node:fs');
    const path = await import('node:path');
    const template = fs.readFileSync(path.resolve('index.html'), 'utf-8');
    const html = await vite.transformIndexHtml(request.url, template);
    return reply.type('text/html').send(html);
  });
}
