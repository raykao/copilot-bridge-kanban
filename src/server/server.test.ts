import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from './config.js';
import { createServer } from './server.js';

const config: AppConfig = {
  port: 3000,
  bridgeApiUrl: 'http://localhost:7878',
  bridgeApiKey: 'test-key',
  sessionSecret: 'secret',
  dbPath: ':memory:',
};

const servers: Array<Awaited<ReturnType<typeof createServer>>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('createServer', () => {
  it('responds to health checks', async () => {
    const server = await createServer(config);
    servers.push(server);

    const healthz = await server.inject({
      method: 'GET',
      url: '/healthz',
    });
    const apiHealth = await server.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(healthz.statusCode).toBe(200);
    expect(healthz.json()).toEqual({ status: 'ok' });
    expect(apiHealth.statusCode).toBe(200);
    expect(apiHealth.json()).toEqual({ status: 'ok' });
  });
});
