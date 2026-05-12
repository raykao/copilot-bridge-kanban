import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import {
  createAgentToken,
  listAgentTokens,
  revokeAgentToken,
  validateAgentToken,
} from './agent-tokens.js';
import { createDatabase, initializeSchema } from './db.js';

let db: Database.Database;

beforeEach(() => {
  db = createDatabase(':memory:');
  initializeSchema(db);
});

describe('agent tokens', () => {
  it('creates, validates, lists, and revokes an agent token', () => {
    const created = createAgentToken(db, 'bob');

    expect(created.id).toBeTruthy();
    expect(created.agent_name).toBe('bob');
    expect(created.token).toMatch(/^[a-f0-9]{64}$/);
    expect(created.created_at).toBeTruthy();

    expect(validateAgentToken(db, created.token)).toBe('bob');

    const stored = db.prepare('SELECT token_hash FROM agent_tokens WHERE agent_name = ?').get('bob') as {
      token_hash: string;
    };
    expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.token_hash).not.toBe(created.token);

    expect(listAgentTokens(db)).toEqual([
      {
        id: created.id,
        agent_name: 'bob',
        created_at: created.created_at,
      },
    ]);

    expect(revokeAgentToken(db, 'bob')).toBe(true);
    expect(validateAgentToken(db, created.token)).toBeNull();
    expect(listAgentTokens(db)).toEqual([]);
  });

  it('replaces an existing token for the same agent', () => {
    const first = createAgentToken(db, 'bob');
    const second = createAgentToken(db, 'bob');

    expect(second.id).not.toBe(first.id);
    expect(second.token).not.toBe(first.token);
    expect(validateAgentToken(db, first.token)).toBeNull();
    expect(validateAgentToken(db, second.token)).toBe('bob');
    expect(listAgentTokens(db)).toEqual([
      {
        id: second.id,
        agent_name: 'bob',
        created_at: second.created_at,
      },
    ]);
  });

  it('returns null when validating the wrong token', () => {
    createAgentToken(db, 'bob');

    expect(validateAgentToken(db, 'not-the-token')).toBeNull();
  });

  it('returns false when revoking a missing token', () => {
    expect(revokeAgentToken(db, 'missing')).toBe(false);
  });

  it('lists tokens without hashes', () => {
    createAgentToken(db, 'charlie');
    createAgentToken(db, 'bob');

    expect(listAgentTokens(db)).toEqual([
      expect.objectContaining({ agent_name: 'bob' }),
      expect.objectContaining({ agent_name: 'charlie' }),
    ]);
    expect(listAgentTokens(db)[0]).not.toHaveProperty('token_hash');
  });
});
