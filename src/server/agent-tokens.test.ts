import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import {
  createAgentToken,
  createGlobalAgentToken,
  listAgentTokens,
  mintAgentTokenForCard,
  revokeGlobalAgentToken,
  revokeAgentToken,
  revokeAgentTokensForCard,
  validateAgentToken,
  validateAgentTokenForCard,
} from './agent-tokens.js';
import { createDatabase, initializeSchema } from './db.js';

let db: Database.Database;

beforeEach(() => {
  db = createDatabase(':memory:');
  initializeSchema(db);


});

describe('agent tokens', () => {
  it('keeps legacy agent token helpers working on a fresh schema', () => {
    const first = createAgentToken(db, 'bob');
    const second = createAgentToken(db, 'bob');
    const alice = createAgentToken(db, 'alice');

    expect(first.id).toBeTruthy();
    expect(first.agent_name).toBe('bob');
    expect(first.token).toMatch(/^[a-f0-9]{64}$/);
    expect(first.created_at).toBeTruthy();
    expect(second.id).not.toBe(first.id);
    expect(second.token).not.toBe(first.token);

    expect(validateAgentToken(db, first.token)).toBeNull();
    expect(validateAgentToken(db, second.token)).toBe('bob');
    expect(validateAgentToken(db, alice.token)).toBe('alice');

    expect(listAgentTokens(db)).toEqual([
      { id: alice.id, agent_name: 'alice', created_at: alice.created_at },
      { id: second.id, agent_name: 'bob', created_at: second.created_at },
    ]);

    const rows = db.prepare('SELECT card_id, agent_name FROM agent_tokens ORDER BY agent_name').all();
    expect(rows).toEqual([
      { card_id: null, agent_name: 'alice' },
      { card_id: null, agent_name: 'bob' },
    ]);

    expect(revokeAgentToken(db, 'bob')).toBe(true);
    expect(validateAgentToken(db, second.token)).toBeNull();
    expect(validateAgentToken(db, alice.token)).toBe('alice');
    expect(revokeAgentToken(db, 'bob')).toBe(false);
  });
  it('creates and revokes global tokens without removing card-scoped tokens', () => {
    const cardToken = mintAgentTokenForCard(db, 'card-1', 'bob');
    const firstGlobal = createGlobalAgentToken(db, 'bob');
    const secondGlobal = createGlobalAgentToken(db, 'bob');

    expect(validateAgentToken(db, firstGlobal.token)).toBeNull();
    expect(validateAgentToken(db, secondGlobal.token)).toBe('bob');
    expect(validateAgentTokenForCard(db, cardToken.token, 'card-1', 'bob')).toBe(true);
    expect(listAgentTokens(db)).toEqual([
      { id: secondGlobal.id, agent_name: 'bob', created_at: secondGlobal.created_at },
    ]);

    expect(revokeGlobalAgentToken(db, 'bob')).toBe(true);
    expect(validateAgentToken(db, secondGlobal.token)).toBeNull();
    expect(validateAgentTokenForCard(db, cardToken.token, 'card-1', 'bob')).toBe(true);
    expect(revokeGlobalAgentToken(db, 'bob')).toBe(false);
  });

  it('mints, replaces, validates, and revokes per-card agent tokens', () => {
    const first = mintAgentTokenForCard(db, 'card-1', 'bob');
    const second = mintAgentTokenForCard(db, 'card-1', 'bob');
    const other = mintAgentTokenForCard(db, 'card-2', 'bob');

    expect(first.id).toBeTruthy();
    expect(first.agent_name).toBe('bob');
    expect(first.card_id).toBe('card-1');
    expect(first.token).toMatch(/^[a-f0-9]{64}$/);
    expect(first.created_at).toBeTruthy();
    expect(second.id).not.toBe(first.id);
    expect(second.token).not.toBe(first.token);

    expect(validateAgentTokenForCard(db, first.token, 'card-1', 'bob')).toBe(false);
    expect(validateAgentTokenForCard(db, second.token, 'card-1', 'bob')).toBe(true);
    expect(validateAgentTokenForCard(db, second.token, 'card-2', 'bob')).toBe(false);
    expect(validateAgentTokenForCard(db, second.token, 'card-1', 'alice')).toBe(false);
    expect(validateAgentTokenForCard(db, other.token, 'card-2', 'bob')).toBe(true);

    const rows = db.prepare('SELECT card_id, agent_name FROM agent_tokens ORDER BY card_id').all();
    expect(rows).toEqual([
      { card_id: 'card-1', agent_name: 'bob' },
      { card_id: 'card-2', agent_name: 'bob' },
    ]);

    expect(revokeAgentTokensForCard(db, 'card-1')).toBe(1);
    expect(validateAgentTokenForCard(db, second.token, 'card-1', 'bob')).toBe(false);
    expect(validateAgentTokenForCard(db, other.token, 'card-2', 'bob')).toBe(true);
  });

});
