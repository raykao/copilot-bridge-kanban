export interface AppConfig {
  port: number;
  bridgeApiUrl: string;
  bridgeApiKey: string;
  sessionSecret: string;
  dbPath: string;
}

export function loadConfig(): AppConfig {
  const bridgeApiUrl = process.env.BRIDGE_API_URL;
  if (!bridgeApiUrl) {
    throw new Error('BRIDGE_API_URL environment variable is required');
  }

  const bridgeApiKey = process.env.BRIDGE_API_KEY;
  if (!bridgeApiKey) {
    throw new Error('BRIDGE_API_KEY environment variable is required');
  }

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET environment variable is required');
  }

  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    bridgeApiUrl: bridgeApiUrl.replace(/\/+$/, ''),
    bridgeApiKey,
    sessionSecret,
    dbPath: process.env.DB_PATH ?? './data/kanban.db',
  };
}
