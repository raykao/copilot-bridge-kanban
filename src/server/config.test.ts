import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('loadConfig', () => {
  it('loads config from environment variables', () => {
    process.env.KANBAN_BASE_URL = 'http://localhost:3000///';
    process.env.SESSION_SECRET = 'secret';
    process.env.PORT = '4321';
    process.env.DB_PATH = './data/test.db';

    expect(loadConfig()).toEqual({
      port: 4321,
      kanbanBaseUrl: 'http://localhost:3000',
      sessionSecret: 'secret',
      dbPath: './data/test.db',
      logLevel: 'info',
    });
  });

  it('uses defaults for optional values', () => {
    process.env.KANBAN_BASE_URL = 'http://localhost:3000';
    process.env.SESSION_SECRET = 'secret';
    delete process.env.PORT;
    delete process.env.DB_PATH;

    expect(loadConfig()).toEqual({
      port: 3000,
      kanbanBaseUrl: 'http://localhost:3000',
      sessionSecret: 'secret',
      dbPath: './data/kanban.db',
      logLevel: 'info',
    });
  });

  it('throws when KANBAN_BASE_URL is missing', () => {
    delete process.env.KANBAN_BASE_URL;
    process.env.SESSION_SECRET = 'secret';

    expect(() => loadConfig()).toThrowError(
      'KANBAN_BASE_URL environment variable is required',
    );
  });

  it('throws when SESSION_SECRET is missing', () => {
    process.env.KANBAN_BASE_URL = 'http://localhost:3000';
    delete process.env.SESSION_SECRET;

    expect(() => loadConfig()).toThrowError(
      'SESSION_SECRET environment variable is required',
    );
  });
});
