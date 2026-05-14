import { loadConfig } from './config.js';
import { createDatabase, initializeSchema } from './db.js';
import { registerAuthRoutes, registerSessionMiddleware } from './auth.js';
import { registerAgentRoutes } from './agents.js';
import { registerCardRoutes } from './card-routes.js';
import { registerPreferencesRoutes } from './preferences.js';
import { registerPushCallbackRoutes } from './push-callback-routes.js';
import { createServer } from './server.js';
import { SseManager } from './sse.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDatabase(config.dbPath);
  initializeSchema(db);

  const sseManager = new SseManager();
  sseManager.startHeartbeat();

  const server = await createServer(config);
  registerSessionMiddleware(server, db);
  registerAuthRoutes(server, db);
  registerCardRoutes(server, db, config, sseManager);
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

  const shutdown = async (): Promise<void> => {
    server.log.info('shutting down');
    sseManager.shutdown();
    await server.close();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
