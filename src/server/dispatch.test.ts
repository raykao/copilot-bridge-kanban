import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { AppConfig } from './config.js';
import { createDatabase, initializeSchema } from './db.js';
import { createCard, createRun, listRuns } from './cards.js';
import { dispatchToBridge } from './dispatch.js';

const config: AppConfig = {
  port: 3000,
  bridgeApiUrl: 'http://bridge',
  bridgeApiKey: 'test-key',
  sessionSecret: 'secret',
  dbPath: ':memory:',
  logLevel: 'silent',
};

let db: Database.Database;

beforeEach(() => {
  db = createDatabase(':memory:');
  initializeSchema(db);
});

afterEach(() => {
  vi.unstubAllGlobals();
  db.close();
});

function seedRun(): { cardId: string; runId: string } {
  const card = createCard(db, { title: 'Test card', created_by: 'alice' });
  const run = createRun(db, { card_id: card.id, agent_name: 'bob' });
  return { cardId: card.id, runId: run.id };
}

describe('dispatchToBridge', () => {
  it('dispatches to bridge with correct A2A body', async () => {
    const { cardId, runId } = seedRun();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ id: 'br-1', contextId: cardId, kind: 'task' }),
    });
    vi.stubGlobal('fetch', mockFetch);
    const result = await dispatchToBridge(config, db, { bot: 'bob', prompt: 'hello', cardId, runId });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://bridge/agents/bob/message:send');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-key',
    });
    expect(JSON.parse(init.body)).toEqual({
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: 'hello' }],
        messageId: runId,
        contextId: cardId,
      },
    });
    expect(result).toEqual({ ok: true, bridgeRunId: 'br-1' });
  });

  it('marks run as failed when bridge returns non-ok', async () => {
    const { cardId, runId } = seedRun();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Missing agent_name',
    }));
    const result = await dispatchToBridge(config, db, { bot: 'bob', prompt: 'hi', cardId, runId });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('400');
    const runs = listRuns(db, cardId);
    const updated = runs.find((r) => r.id === runId)!;
    expect(updated.status).toBe('failed');
    expect(updated.error).toContain('400');
  });

  it('marks run as failed when bridge returns malformed task response', async () => {
    const { cardId, runId } = seedRun();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'br-1', contextId: cardId, kind: 'message' }),
    }));
    const result = await dispatchToBridge(config, db, { bot: 'bob', prompt: 'hi', cardId, runId });
    expect(result).toEqual({ ok: false, error: 'Bridge returned malformed task response' });
    const runs = listRuns(db, cardId);
    const updated = runs.find((r) => r.id === runId)!;
    expect(updated.status).toBe('failed');
    expect(updated.error).toBe('Bridge returned malformed task response');
  });
});
