import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { createDatabase, initializeSchema } from './db.js';
import { ProviderRegistry } from './providers/registry.js';
import { registerProviderAdminRoutes } from './provider-admin-routes.js';
import { createProvider, getProvider } from './providers-db.js';
import { listAgentsByProvider } from './agents-db.js';
import type { DispatchCallbacks } from './card-session-manager.js';

let db: Database.Database;
let app: FastifyInstance;
let registry: ProviderRegistry;

function makeCallbacks(): DispatchCallbacks {
  return {
    onRunCreated: () => {},
    onEvent: () => {},
    onAgentMessage: () => {},
    onComplete: () => {},
    onPermissionRequest: () => {},
    onInterrupted: () => {},
  };
}

async function makeApp(): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  registerProviderAdminRoutes(server, db, registry, makeCallbacks());
  await server.ready();
  return server;
}

beforeEach(async () => {
  db = createDatabase(':memory:');
  initializeSchema(db);
  registry = new ProviderRegistry();
  app = await makeApp();
});

afterEach(async () => {
  registry.shutdown();
  await app.close();
  db.close();
});

describe('provider admin routes', () => {
  it('GET /api/admin/providers returns empty list when none registered', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/providers' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ providers: [] });
  });

  it('POST /api/admin/providers creates a provider and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/providers',
      payload: { type: 'acp', label: 'Local ACP', url: 'http://localhost:3030', api_key: 'secret' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.provider.type).toBe('acp');
    expect(body.provider.label).toBe('Local ACP');
    expect(body.provider.url).toBe('http://localhost:3030');
    expect(body.provider.api_key).toBe('secret');
    expect(getProvider(db, body.provider.id)).toMatchObject({
      type: 'acp',
      label: 'Local ACP',
      url: 'http://localhost:3030',
      api_key: 'secret',
    });
  });

  it('POST /api/admin/providers rejects when url missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/providers',
      payload: { type: 'acp', label: 'Local ACP' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'url is required' });
  });

  it('POST /api/admin/providers rejects unknown type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/providers',
      payload: { type: 'unknown', label: 'Local ACP', url: 'http://localhost:3030' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'type must be "acp" or "copilot-bridge"' });
  });

  it('POST /api/admin/providers derives label from url when label missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/providers',
      payload: { type: 'acp', url: 'http://localhost:3030' },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).provider.label).toBe('http://localhost:3030');
  });

  it('GET /api/admin/providers/:id returns 404 for unknown', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/providers/nope' });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Provider not found' });
  });

  it('GET /api/admin/providers/:id returns provider + agents list', async () => {
    const provider = createProvider(db, {
      type: 'acp',
      label: 'Local ACP',
      url: 'http://localhost:3030',
    });
    db.prepare(
      `INSERT INTO agents (id, name, protocol, url, auto_approve, api_key, created_at, provider_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('agent-1', 'bob', 'generic-acp', provider.url, 0, null, new Date().toISOString(), provider.id);

    const res = await app.inject({ method: 'GET', url: `/api/admin/providers/${provider.id}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.provider.id).toBe(provider.id);
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].name).toBe('bob');
    expect(body.registry_status).toBe('unknown');
    expect(body.last_error).toBeNull();
  });

  it('PATCH /api/admin/providers/:id updates label only', async () => {
    const provider = createProvider(db, {
      type: 'acp',
      label: 'Local ACP',
      url: 'http://localhost:3030',
      api_key: 'secret',
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/providers/${provider.id}`,
      payload: { label: 'Renamed ACP' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.provider.label).toBe('Renamed ACP');
    expect(body.provider.url).toBe(provider.url);
    expect(body.provider.api_key).toBe('secret');
  });

  it('DELETE /api/admin/providers/:id cascades to agents (rows tied to provider_id removed)', async () => {
    const provider = createProvider(db, {
      type: 'acp',
      label: 'Local ACP',
      url: 'http://localhost:3030',
    });
    db.prepare(
      `INSERT INTO agents (id, name, protocol, url, auto_approve, api_key, created_at, provider_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('agent-1', 'bob', 'generic-acp', provider.url, 0, null, new Date().toISOString(), provider.id);

    const res = await app.inject({ method: 'DELETE', url: `/api/admin/providers/${provider.id}` });
    expect(res.statusCode).toBe(204);
    expect(getProvider(db, provider.id)).toBeNull();
    expect(listAgentsByProvider(db, provider.id)).toEqual([]);
  });

  it('POST /api/admin/providers/:id/discover returns 409 when provider not in registry', async () => {
    const provider = createProvider(db, {
      type: 'acp',
      label: 'Local ACP',
      url: 'http://localhost:3030',
    });
    const res = await app.inject({ method: 'POST', url: `/api/admin/providers/${provider.id}/discover` });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: 'Provider not registered in runtime registry' });
  });

  it('POST /api/admin/providers/:id/discover returns 404 for unknown provider', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/providers/nope/discover' });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Provider not found' });
  });
});
