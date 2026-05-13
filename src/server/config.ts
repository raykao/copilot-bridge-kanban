export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface AppConfig {
  port: number;
  bridgeApiUrl: string;
  bridgeApiKey: string;
  sessionSecret: string;
  dbPath: string;
  logLevel: LogLevel;
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

  const rawLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  const validLevels: LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
  const logLevel: LogLevel = validLevels.includes(rawLevel as LogLevel)
    ? (rawLevel as LogLevel)
    : 'info';

  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    bridgeApiUrl: bridgeApiUrl.replace(/\/+$/, ''),
    bridgeApiKey,
    sessionSecret,
    dbPath: process.env.DB_PATH ?? './data/kanban.db',
    logLevel,
  };
}
