import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('loadConfig', () => {
  it('loads config from environment variables', () => {
    process.env.BRIDGE_API_URL = 'http://localhost:7878///';
    process.env.BRIDGE_API_KEY = 'test-key';
    process.env.SESSION_SECRET = 'secret';
    process.env.PORT = '4321';
    process.env.DB_PATH = './data/test.db';

    expect(loadConfig()).toEqual({
      port: 4321,
      bridgeApiUrl: 'http://localhost:7878',
      bridgeApiKey: 'test-key',
      kanbanBaseUrl: 'http://localhost:4321',
      sessionSecret: 'secret',
      dbPath: './data/test.db',
      logLevel: 'info',
    });
  });

  it('uses defaults for optional values', () => {
    process.env.BRIDGE_API_URL = 'http://localhost:7878';
    process.env.BRIDGE_API_KEY = 'test-key';
    process.env.SESSION_SECRET = 'secret';
    delete process.env.PORT;
    delete process.env.DB_PATH;

    expect(loadConfig()).toEqual({
      port: 3000,
      bridgeApiUrl: 'http://localhost:7878',
      bridgeApiKey: 'test-key',
      kanbanBaseUrl: 'http://localhost:3000',
      sessionSecret: 'secret',
      dbPath: './data/kanban.db',
      logLevel: 'info',
    });
  });

  it('throws when BRIDGE_API_URL is missing', () => {
    delete process.env.BRIDGE_API_URL;
    process.env.BRIDGE_API_KEY = 'test-key';
    process.env.SESSION_SECRET = 'secret';

    expect(() => loadConfig()).toThrowError(
      'BRIDGE_API_URL environment variable is required',
    );
  });

  it('throws when BRIDGE_API_KEY is missing', () => {
    process.env.BRIDGE_API_URL = 'http://localhost:7878';
    delete process.env.BRIDGE_API_KEY;
    process.env.SESSION_SECRET = 'secret';

    expect(() => loadConfig()).toThrowError(
      'BRIDGE_API_KEY environment variable is required',
    );
  });

  it('throws when SESSION_SECRET is missing', () => {
    process.env.BRIDGE_API_URL = 'http://localhost:7878';
    process.env.BRIDGE_API_KEY = 'test-key';
    delete process.env.SESSION_SECRET;

    expect(() => loadConfig()).toThrowError(
      'SESSION_SECRET environment variable is required',
    );
  });
});
