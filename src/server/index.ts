import { loadConfig } from './config.js';
import { createDatabase, initializeSchema } from './db.js';
import { registerAuthRoutes, registerSessionMiddleware } from './auth.js';
import { registerAgentRoutes } from './agents.js';
import { registerAdminRoutes } from './admin-routes.js';
import { registerAgentAdminRoutes } from './agent-admin-routes.js';
import { buildSessionCallbacks, registerCardRoutes } from './card-routes.js';
import { registerPreferencesRoutes } from './preferences.js';
import { registerPushCallbackRoutes } from './push-callback-routes.js';
import { createServer } from './server.js';
import { CardSessionManager } from './card-session-manager.js';
import { listAgents } from './agents-db.js';
import { AcpSessionManager } from './acp-session-manager.js';
import { listActiveRunsGlobal } from './cards.js';
import { SseManager } from './sse.js';
import { ProviderRegistry } from './providers/registry.js';
import { GenericAcpProvider } from './providers/generic-acp.js';
import { CopilotBridgeProvider } from './providers/copilot-bridge.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDatabase(config.dbPath);
  initializeSchema(db);

  const registry = new ProviderRegistry();

  const sseManager = new SseManager();
  sseManager.startHeartbeat();

  const callbacks = buildSessionCallbacks(db, sseManager);
  const cardSessionManager = new CardSessionManager(config, callbacks);

  registry.register(new CopilotBridgeProvider('copilot-bridge-default', config, callbacks));

  const acpManagers = new Map<string, AcpSessionManager>();
  for (const agent of listAgents(db)) {
    if (agent.protocol === 'generic-acp') {
      registry.register(new GenericAcpProvider(agent.id, agent.url, agent.api_key));
      continue;
    }

    acpManagers.set(agent.id, new AcpSessionManager(
      { url: agent.url, auto_approve: agent.auto_approve },
      callbacks,
    ));
  }

  if (cardSessionManager) {
    const activeRuns = listActiveRunsGlobal(db).filter(
      (run): run is typeof run & { bridge_run_id: string } => run.bridge_run_id !== null,
    );
    cardSessionManager.reconnectAll(activeRuns);
  }

  const server = await createServer(config);
  registerSessionMiddleware(server, db);
  registerAuthRoutes(server, db);
  registerCardRoutes(server, db, config, sseManager, cardSessionManager, acpManagers, registry);
  registerPushCallbackRoutes(server, db, sseManager);
  registerAgentRoutes(server, config, registry);
  registerAdminRoutes(server, db);
  registerAgentAdminRoutes(server, db);
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
