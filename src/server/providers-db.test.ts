import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createDatabase, initializeSchema } from './db.js';
import {
  createProvider,
  getProvider,
  listProviders,
  updateProvider,
  deleteProvider,
  type NewProvider,
} from './providers-db.js';

function makeDb(): Database.Database {
  const db = createDatabase(':memory:');
  initializeSchema(db);
  return db;
}

describe('providers-db', () => {
  let db: Database.Database;
  beforeEach(() => { db = makeDb(); });

  it('createProvider inserts a row and returns it with status=disconnected', () => {
    const input: NewProvider = { type: 'acp', label: 'My ACP Agent', url: 'ws://localhost:3030/bob' };
    const p = createProvider(db, input);
    expect(p.id).toBeTruthy();
    expect(p.type).toBe('acp');
    expect(p.label).toBe('My ACP Agent');
    expect(p.url).toBe('ws://localhost:3030/bob');
    expect(p.ws_url).toBeNull();
    expect(p.api_key).toBeNull();
    expect(p.status).toBe('disconnected');
    expect(p.last_discovered_at).toBeNull();
    expect(p.created_at).toBeTruthy();
  });

  it('createProvider stores ws_url and api_key when provided', () => {
    const input: NewProvider = {
      type: 'copilot-bridge',
      label: 'My Bridge',
      url: 'http://localhost:7878',
      ws_url: 'ws://localhost:3030',
      api_key: 'secret-key',
    };
    const p = createProvider(db, input);
    expect(p.ws_url).toBe('ws://localhost:3030');
    expect(p.api_key).toBe('secret-key');
  });

  it('getProvider returns null for unknown id', () => {
    expect(getProvider(db, 'no-such-id')).toBeNull();
  });

  it('listProviders returns all providers sorted by label', () => {
    createProvider(db, { type: 'acp', label: 'Zed', url: 'ws://a' });
    createProvider(db, { type: 'acp', label: 'Alpha', url: 'ws://b' });
    const list = listProviders(db);
    expect(list).toHaveLength(2);
    expect(list[0].label).toBe('Alpha');
    expect(list[1].label).toBe('Zed');
  });

  it('updateProvider updates only specified fields', () => {
    const p = createProvider(db, { type: 'acp', label: 'Original', url: 'ws://x' });
    const updated = updateProvider(db, p.id, { status: 'connected', label: 'Updated' });
    expect(updated.status).toBe('connected');
    expect(updated.label).toBe('Updated');
    expect(updated.url).toBe('ws://x');
  });

  it('updateProvider with empty patch returns existing row unchanged', () => {
    const p = createProvider(db, { type: 'acp', label: 'Same', url: 'ws://y' });
    const result = updateProvider(db, p.id, {});
    expect(result).toEqual(p);
  });

  it('updateProvider throws for unknown id', () => {
    expect(() => updateProvider(db, 'bad-id', { status: 'connected' })).toThrow();
  });

  it('deleteProvider removes the row', () => {
    const p = createProvider(db, { type: 'acp', label: 'Del', url: 'ws://z' });
    deleteProvider(db, p.id);
    expect(getProvider(db, p.id)).toBeNull();
  });
});
