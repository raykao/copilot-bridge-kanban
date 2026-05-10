import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';

export function registerBridgeProxy(app: FastifyInstance, config: AppConfig): void {
  app.all('/api/v1/*', async (request, reply) => {
    const bridgePath = request.url.replace(/^\/api/, '');
    const bridgeUrl = `${config.bridgeApiUrl}${bridgePath}`;

    const headers: Record<string, string> = {
      authorization: `Bearer ${config.bridgeApiKey}`,
    };

    if (request.headers['content-type']) {
      headers['content-type'] = request.headers['content-type'];
    }
    if (request.headers.accept) {
      headers.accept = request.headers.accept;
    }
    if (request.headers['last-event-id']) {
      headers['last-event-id'] = request.headers['last-event-id'] as string;
    }

    const isSSE = request.headers.accept === 'text/event-stream';

    try {
      const response = await fetch(bridgeUrl, {
        method: request.method,
        headers,
        body: ['POST', 'PATCH', 'PUT'].includes(request.method)
          ? JSON.stringify(request.body)
          : undefined,
      });

      if (isSSE && response.ok && response.body) {
        reply.hijack();
        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        const pump = async (): Promise<void> => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              const trailingChunk = decoder.decode();
              if (trailingChunk) {
                reply.raw.write(trailingChunk);
              }
              reply.raw.end();
              return;
            }

            const ok = reply.raw.write(decoder.decode(value, { stream: true }));
            if (!ok) {
              await new Promise<void>((resolve) => reply.raw.once('drain', resolve));
            }
          }
        };

        request.raw.on('close', () => {
          reader.cancel().catch(() => {});
        });

        await pump();
        return;
      }

      const contentType = response.headers.get('content-type') ?? 'application/json';
      const body = await response.text();

      reply.status(response.status).header('content-type', contentType).send(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bridge proxy error';
      reply.status(502).send({ error: 'Bridge unavailable', detail: message });
    }
  });
}
