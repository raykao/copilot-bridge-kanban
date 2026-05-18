export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface AppConfig {
  port: number;
  kanbanBaseUrl: string;
  sessionSecret: string;
  dbPath: string;
  logLevel: LogLevel;
}

export function loadConfig(): AppConfig {
  const kanbanBaseUrl = process.env.KANBAN_BASE_URL;
  if (!kanbanBaseUrl) {
    throw new Error('KANBAN_BASE_URL environment variable is required');
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
    kanbanBaseUrl: kanbanBaseUrl.replace(/\/+$/, ''),
    sessionSecret,
    dbPath: process.env.DB_PATH ?? './data/kanban.db',
    logLevel,
  };
}
