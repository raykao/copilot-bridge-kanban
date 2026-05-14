import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import {
  mintAgentTokenForCard,
  revokeAgentTokensForCard,
  validateAgentTokenForCard,
} from './agent-tokens.js';
import { createDatabase, initializeSchema } from './db.js';

let db: Database.Database;

beforeEach(() => {
  db = createDatabase(':memory:');
  initializeSchema(db);
});

describe('agent tokens', () => {
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
