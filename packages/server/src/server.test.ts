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

    const response = await server.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
