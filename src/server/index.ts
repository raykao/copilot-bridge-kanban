import { loadConfig } from './config.js';
import { createDatabase, initializeSchema } from './db.js';
import { registerAuthRoutes, registerSessionMiddleware } from './auth.js';
import { registerAgentRoutes } from './agents.js';
import { registerAdminRoutes } from './admin-routes.js';
import { registerAgentAdminRoutes } from './agent-admin-routes.js';
import { registerProviderAdminRoutes } from './provider-admin-routes.js';
import { buildSessionCallbacks, registerCardRoutes } from './card-routes.js';
import { registerPreferencesRoutes } from './preferences.js';
import { registerPushCallbackRoutes } from './push-callback-routes.js';
import { createServer } from './server.js';
import { upsertDiscoveredAgent } from './agents-db.js';
import { AcpSessionManager } from './acp-session-manager.js';
import { SseManager } from './sse.js';
import { ProviderRegistry } from './providers/registry.js';
import { buildProviderInstance } from './providers/build.js';
import { listProviders } from './providers-db.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDatabase(config.dbPath);
  initializeSchema(db);

  const registry = new ProviderRegistry();

  const sseManager = new SseManager();
  sseManager.startHeartbeat();

  const callbacks = buildSessionCallbacks(db, sseManager);

  const acpManagers = new Map<string, AcpSessionManager>();
  const dbProviders = listProviders(db);

  for (const provider of dbProviders) {
    const instance = buildProviderInstance(provider, callbacks);
    if (instance) {
      registry.register(instance);
    }
  }

  registry.startHealthMonitor();
  registry.setStateChangeCallback((id, health) => {
    sseManager.emitGlobal('provider.status_changed', {
      id,
      status: health.status,
      agents: health.agents,
      lastError: health.lastError,
      lastDiscoveredAt: health.lastDiscoveredAt,
    });
  });
  registry.setAgentsDiscoveredCallback((providerId, cards) => {
    const provider = listProviders(db).find((p) => p.id === providerId);
    if (!provider) return;
    for (const card of cards) {
      upsertDiscoveredAgent(db, providerId, card, provider.url, provider.api_key, false);
    }
  });

  const server = await createServer(config);
  registerSessionMiddleware(server, db);
  registerAuthRoutes(server, db);
  registerCardRoutes(server, db, config, sseManager, acpManagers, registry);
  registerPushCallbackRoutes(server, db, sseManager);
  registerAgentRoutes(server, config, registry, db, sseManager);
  registerAdminRoutes(server, db);
  registerAgentAdminRoutes(server, db);
  registerProviderAdminRoutes(server, db, registry, callbacks);
  registerPreferencesRoutes(server, db);

  await server.listen({ host: '0.0.0.0', port: config.port });

  server.log.info(
    {
      pid: process.pid,
      port: config.port,
      logLevel: config.logLevel,
      dbPath: config.dbPath,
    },
    'kanban server started',
  );
  console.log(`[kanban] pid=${process.pid} listening on port ${config.port}`);

  let shuttingDown = false;
  const shutdown = async (signal: 'SIGTERM' | 'SIGINT'): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    server.log.info(`Received ${signal}, shutting down gracefully`);
    registry.shutdown();
    sseManager.shutdown();

    try {
      await server.close();
    } catch (err) {
      server.log.warn({ err }, 'Error closing HTTP server');
    }

    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      server.log.info('Database checkpointed and closed');
    } catch (err) {
      server.log.warn({ err }, 'Error closing database');
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
