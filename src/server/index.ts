import { loadConfig } from './config.js';
import { createDatabase, initializeSchema } from './db.js';
import { registerAuthRoutes, registerSessionMiddleware } from './auth.js';
import { registerAgentRoutes } from './agents.js';
import { buildSessionCallbacks, registerCardRoutes } from './card-routes.js';
import { registerPreferencesRoutes } from './preferences.js';
import { registerPushCallbackRoutes } from './push-callback-routes.js';
import { createServer } from './server.js';
import { CardSessionManager } from './card-session-manager.js';
import { listActiveRunsGlobal } from './cards.js';
import { SseManager } from './sse.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDatabase(config.dbPath);
  initializeSchema(db);

  const sseManager = new SseManager();
  sseManager.startHeartbeat();

  const cardSessionManager = config
    ? new CardSessionManager(config, buildSessionCallbacks(db, sseManager))
    : undefined;
  if (cardSessionManager) {
    const activeRuns = listActiveRunsGlobal(db).filter(
      (run): run is typeof run & { bridge_run_id: string } => run.bridge_run_id !== null,
    );
    cardSessionManager.reconnectAll(activeRuns);
  }

  const server = await createServer(config);
  registerSessionMiddleware(server, db);
  registerAuthRoutes(server, db);
  registerCardRoutes(server, db, config, sseManager, cardSessionManager);
  registerPushCallbackRoutes(server, db, sseManager);
  registerAgentRoutes(server, config);
  registerPreferencesRoutes(server, db);

  await server.listen({ host: '0.0.0.0', port: config.port });

  server.log.info(
    {
      pid: process.pid,
      port: config.port,
      logLevel: config.logLevel,
      dbPath: config.dbPath,
      bridgeApiUrl: config.bridgeApiUrl,
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
