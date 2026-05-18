import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrations.js';
import type { Migration } from './migrations.js';
import { createDatabase, initializeSchema } from './db.js';
import { migrations } from './migrations/index.js';

function getUserVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

function getColumnNames(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).map((r) => r.name);
}

function getColumn(db: Database.Database, table: string, column: string): { name: string; notnull: number } {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number }>
  ).find((r) => r.name === column)!;
}

function createLegacyAgentTokensTable(db: Database.Database, withRow = false): void {
  db.exec(`
    CREATE TABLE agent_tokens (
      id TEXT PRIMARY KEY,
      agent_name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_agent_tokens_name ON agent_tokens(agent_name);
  `);

  if (withRow) {
    db.prepare(
      `INSERT INTO agent_tokens (id, agent_name, token_hash, created_at)
       VALUES ('tok-1', 'bob', 'hash', '2026-01-01T00:00:00.000Z')`,
    ).run();
  }
}

function createLegacyCardsTable(db: Database.Database, withRow = false): void {
  db.exec(`
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'work',
      agent_bot TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'idea',
      created_by TEXT NOT NULL,
      workspace_subdir TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );
  `);

  if (withRow) {
    db.prepare(
      `INSERT INTO cards (id, title, status, created_by, created_at, updated_at)
       VALUES ('c1', 'Legacy card', 'idea', 'user-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();
  }
}

describe('runMigrations', () => {
  it('sets user_version to N after running all migrations on a fresh DB', () => {
    const db = new Database(':memory:');
    const mig1: Migration = { version: 1, name: 'first', up: () => {} };
    const mig2: Migration = { version: 2, name: 'second', up: () => {} };

    runMigrations(db, [mig1, mig2]);

    expect(getUserVersion(db)).toBe(2);
  });

  it('is idempotent - second call does not invoke up() again', () => {
    const db = new Database(':memory:');
    const up = vi.fn();
    const mig: Migration = { version: 1, name: 'test', up };

    runMigrations(db, [mig]);
    expect(up).toHaveBeenCalledTimes(1);

    runMigrations(db, [mig]);
    expect(up).toHaveBeenCalledTimes(1);
  });

  it('throws when migration versions are not consecutive', () => {
    const db = new Database(':memory:');
    const mig1: Migration = { version: 1, name: 'first', up: () => {} };
    const mig3: Migration = { version: 3, name: 'third', up: () => {} };

    expect(() => runMigrations(db, [mig1, mig3])).toThrow(/consecutive/);
  });

  it('rolls back DDL when a migration throws', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE test_table (id TEXT PRIMARY KEY)');

    const badMig: Migration = {
      version: 1,
      name: 'bad',
      up: (d) => {
        d.exec('ALTER TABLE test_table ADD COLUMN new_col TEXT');
        throw new Error('migration failed');
      },
    };

    expect(() => runMigrations(db, [badMig])).toThrow('migration failed');

    const cols = getColumnNames(db, 'test_table');
    expect(cols).not.toContain('new_col');
    expect(getUserVersion(db)).toBe(0);
  });

  it('fresh DB starts user_version=11 and agent_tokens has nullable card_id and agents has nullable api_key', () => {
    const db = createDatabase(':memory:');
    initializeSchema(db);

    expect(getUserVersion(db)).toBe(11);
    expect(getColumnNames(db, 'agent_tokens')).toContain('card_id');
    expect(getColumn(db, 'agent_tokens', 'card_id').notnull).toBe(0);
    expect(getColumnNames(db, 'agents')).toContain('api_key');
    expect(getColumn(db, 'agents', 'api_key').notnull).toBe(0);
    expect(getColumn(db, 'agents', 'name').notnull).toBe(0);
  });

  it('version 1 DB clears stale agent token rows and creates the card bot index', () => {
    const db = new Database(':memory:');
    createLegacyAgentTokensTable(db, true);
    createLegacyCardsTable(db);
    db.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        bridge_run_id TEXT,
        input_comment_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT
      )
    `);
    db.pragma('user_version = 1');

    runMigrations(db, migrations);

    const count = db.prepare('SELECT COUNT(*) AS c FROM agent_tokens').get() as { c: number };
    const indexes = (db.prepare('PRAGMA index_list(agent_tokens)').all() as Array<{ name: string }>).map((r) => r.name);

    expect(getUserVersion(db)).toBe(11);
    expect(getColumnNames(db, 'agent_tokens')).toContain('card_id');
    expect(getColumn(db, 'agent_tokens', 'card_id').notnull).toBe(0);
    expect(getColumnNames(db, 'agents')).toContain('api_key');
    expect(getColumn(db, 'agents', 'api_key').notnull).toBe(0);
    expect(getColumn(db, 'agents', 'name').notnull).toBe(0);
    expect(count.c).toBe(0);
    expect(indexes).toContain('idx_agent_tokens_card_bot');
    expect(indexes).not.toContain('idx_agent_tokens_name');
  });

  it('version 2 DB relaxes agent_tokens.card_id and converts empty globals to NULL', () => {
    const db = new Database(':memory:');
    createLegacyCardsTable(db);
    db.exec(`
      CREATE TABLE agent_tokens (
        id TEXT PRIMARY KEY,
        agent_name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        card_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_agent_tokens_card_bot ON agent_tokens(card_id, agent_name);
      CREATE INDEX idx_agent_tokens_hash ON agent_tokens(token_hash);

      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        bridge_run_id TEXT,
        input_comment_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT
      );
    `);
    db.prepare(
      `INSERT INTO agent_tokens (id, agent_name, token_hash, card_id, created_at)
       VALUES
       ('global-1', 'bob', 'global-hash', '', '2026-01-01T00:00:00.000Z'),
       ('card-1', 'alice', 'card-hash', 'card-123', '2026-01-02T00:00:00.000Z')`,
    ).run();
    db.pragma('user_version = 2');

    runMigrations(db, migrations);

    const rows = db
      .prepare('SELECT id, agent_name, token_hash, card_id, created_at FROM agent_tokens ORDER BY id')
      .all();

    expect(getUserVersion(db)).toBe(11);
    expect(getColumn(db, 'agent_tokens', 'card_id').notnull).toBe(0);
    expect(getColumnNames(db, 'agents')).toContain('api_key');
    expect(getColumn(db, 'agents', 'api_key').notnull).toBe(0);
    expect(getColumn(db, 'agents', 'name').notnull).toBe(0);
    expect(rows).toEqual([
      {
        id: 'card-1',
        agent_name: 'alice',
        token_hash: 'card-hash',
        card_id: 'card-123',
        created_at: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'global-1',
        agent_name: 'bob',
        token_hash: 'global-hash',
        card_id: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });
});

describe('migrations', () => {
  it('fresh DB (from initializeSchema): bridge_run_id, acp_session_id, api_key, provider_id present, no bridge_session_id, user_version=11', () => {
    const db = createDatabase(':memory:');
    initializeSchema(db);

    const cols = getColumnNames(db, 'runs');
    expect(cols).toContain('bridge_run_id');
    expect(cols).toContain('acp_session_id');
    expect(cols).toContain('provider_id');
    expect(cols).not.toContain('bridge_session_id');
    expect(getColumnNames(db, 'agents')).toContain('api_key');
    expect(getColumn(db, 'agents', 'api_key').notnull).toBe(0);
    expect(getColumn(db, 'agents', 'name').notnull).toBe(0);
    expect(getUserVersion(db)).toBe(11);
  });

  it('migration 011 changes runs.provider_id FK from agents to providers', () => {
    const db = createDatabase(':memory:');
    initializeSchema(db);

    const fks = db.prepare(`PRAGMA foreign_key_list('runs')`).all() as Array<{ from: string; table: string }>;
    const providerFk = fks.find((fk) => fk.from === 'provider_id');

    expect(providerFk).toBeDefined();
    expect(providerFk?.table).toBe('providers');
  });

  it('pre-Phase-B DB: renames bridge_session_id to bridge_run_id', () => {
    const db = new Database(':memory:');
    createLegacyAgentTokensTable(db);
    createLegacyCardsTable(db, true);
    db.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        bridge_session_id TEXT,
        input_comment_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT
      )
    `);
    db.prepare(
      `INSERT INTO runs (id, card_id, agent_name, status, bridge_session_id, created_at)
       VALUES ('r1', 'c1', 'bob', 'created', 'abc', '2026-01-01T00:00:00.000Z')`,
    ).run();

    runMigrations(db, migrations);

    const cols = getColumnNames(db, 'runs');
    expect(cols).toContain('bridge_run_id');
    expect(cols).toContain('acp_session_id');
    expect(cols).toContain('provider_id');
    expect(cols).not.toContain('bridge_session_id');
    expect(getColumnNames(db, 'agents')).toContain('api_key');
    expect(getColumn(db, 'agents', 'api_key').notnull).toBe(0);
    expect(getColumn(db, 'agents', 'name').notnull).toBe(0);
    expect(getUserVersion(db)).toBe(11);

    const row = db.prepare('SELECT bridge_run_id FROM runs WHERE id = ?').get('r1') as { bridge_run_id: string };
    expect(row.bridge_run_id).toBe('abc');
  });

  it('both-cols DB: drops bridge_session_id and preserves bridge_run_id', () => {
    const db = new Database(':memory:');
    createLegacyAgentTokensTable(db);
    createLegacyCardsTable(db, true);
    db.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        bridge_run_id TEXT,
        bridge_session_id TEXT,
        input_comment_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT
      )
    `);
    db.prepare(
      `INSERT INTO runs (id, card_id, agent_name, status, bridge_run_id, bridge_session_id, created_at)
       VALUES ('r1', 'c1', 'bob', 'created', 'new', 'old', '2026-01-01T00:00:00.000Z')`,
    ).run();

    runMigrations(db, migrations);

    const cols = getColumnNames(db, 'runs');
    expect(cols).toContain('bridge_run_id');
    expect(cols).toContain('acp_session_id');
    expect(cols).toContain('provider_id');
    expect(cols).not.toContain('bridge_session_id');
    expect(getColumnNames(db, 'agents')).toContain('api_key');
    expect(getColumn(db, 'agents', 'api_key').notnull).toBe(0);
    expect(getColumn(db, 'agents', 'name').notnull).toBe(0);
    expect(getUserVersion(db)).toBe(11);

    const row = db.prepare('SELECT bridge_run_id FROM runs WHERE id = ?').get('r1') as { bridge_run_id: string };
    expect(row.bridge_run_id).toBe('new');
  });

  it('migration 008 creates providers table with required columns', () => {
    const db = createDatabase(':memory:');
    initializeSchema(db);
    const cols = getColumnNames(db, 'providers');
    expect(cols).toContain('id');
    expect(cols).toContain('type');
    expect(cols).toContain('label');
    expect(cols).toContain('url');
    expect(cols).toContain('ws_url');
    expect(cols).toContain('api_key');
    expect(cols).toContain('status');
    expect(cols).toContain('last_discovered_at');
    expect(cols).toContain('created_at');
  });

  it('migration 009 adds provider_id column to agents', () => {
    const db = createDatabase(':memory:');
    initializeSchema(db);
    const cols = getColumnNames(db, 'agents');
    expect(cols).toContain('provider_id');
  });

  it('migration 010 backfills providers from agents with NULL provider_id', async () => {
    const db = new Database(':memory:');
    // Manually run migrations 001-009 to set up a pre-010 state, then insert
    // an unlinked agent, then run migration 010.
    createLegacyAgentTokensTable(db);
    createLegacyCardsTable(db);
    db.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        bridge_run_id TEXT,
        input_comment_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT
      )
    `);
    const all = await import('./migrations/index.js');
    const pre = all.migrations.filter((m) => m.version <= 9);
    runMigrations(db, pre);
    db.prepare(
      `INSERT INTO agents (id, name, protocol, url, auto_approve, api_key, created_at)
       VALUES ('a1', 'Bob', 'copilot-bridge', 'http://bridge.local:7878', 0, 'sek', ?)`,
    ).run(new Date().toISOString());
    db.prepare(
      `INSERT INTO agents (id, name, protocol, url, auto_approve, api_key, created_at)
       VALUES ('a2', NULL, 'generic-acp', 'http://acp.local:9999', 0, NULL, ?)`,
    ).run(new Date().toISOString());
    const mig010 = all.migrations.find((m) => m.version === 10)!;
    runMigrations(db, [...pre, mig010]);
    const providerRows = db.prepare('SELECT * FROM providers ORDER BY label').all() as Array<{
      id: string; type: string; label: string; url: string; api_key: string | null;
    }>;
    expect(providerRows).toHaveLength(2);
    const bobP = providerRows.find((p) => p.label === 'Bob')!;
    expect(bobP.type).toBe('copilot-bridge');
    expect(bobP.url).toBe('http://bridge.local:7878');
    expect(bobP.api_key).toBe('sek');
    const acpP = providerRows.find((p) => p.label === 'http://acp.local:9999')!;
    expect(acpP.type).toBe('acp');
    expect(acpP.api_key).toBeNull();
    const agentRows = db.prepare('SELECT id, provider_id FROM agents ORDER BY id').all() as Array<{ id: string; provider_id: string }>;
    expect(agentRows[0].provider_id).toBe(bobP.id);
    expect(agentRows[1].provider_id).toBe(acpP.id);
  });
});
