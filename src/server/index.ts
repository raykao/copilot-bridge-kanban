import { loadConfig } from './config.js';
import { createDatabase, initializeSchema } from './db.js';
import { registerAuthRoutes, registerSessionMiddleware } from './auth.js';
import { registerPreferencesRoutes } from './preferences.js';
import { registerBridgeProxy } from './proxy.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDatabase(config.dbPath);
  initializeSchema(db);

  const server = await createServer(config);
  registerSessionMiddleware(server, db);
  registerAuthRoutes(server, db);
  registerBridgeProxy(server, config);
  registerPreferencesRoutes(server, db);

  await server.listen({ host: '0.0.0.0', port: config.port });
  server.log.info(
    { port: config.port, logLevel: config.logLevel, dbPath: config.dbPath, bridgeApiUrl: config.bridgeApiUrl },
    'kanban server started',
  );

  const shutdown = async (): Promise<void> => {
    server.log.info('shutting down');
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
