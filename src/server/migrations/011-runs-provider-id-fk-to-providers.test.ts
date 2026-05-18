import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../migrations.js';
import { migrations } from './index.js';
import migration011 from './011-runs-provider-id-fk-to-providers.js';

function createPreMigrationDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE agent_tokens (
      id TEXT PRIMARY KEY,
      agent_name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

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

    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      bridge_run_id TEXT,
      input_comment_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_runs_card ON runs(card_id);
    CREATE INDEX idx_runs_status ON runs(status);
  `);
  return db;
}

function insertCard(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO cards (id, title, status, created_by, created_at, updated_at)
     VALUES (?, 'Test card', 'idea', 'user-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  ).run(id);
}

function insertAgent(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO agents (id, name, protocol, url, auto_approve, api_key, created_at)
     VALUES (?, 'Legacy Agent', 'copilot-bridge', 'http://bridge.local:7878', 0, NULL, '2026-01-01T00:00:00.000Z')`,
  ).run(id);
}

function insertProvider(db: Database.Database, id: string): void {
  db.prepare(
    `INSERT INTO providers (id, type, label, url, ws_url, api_key, status, created_at)
     VALUES (?, 'copilot-bridge', 'Provider', 'http://bridge.local:7878', NULL, NULL, 'connected', '2026-01-01T00:00:00.000Z')`,
  ).run(id);
}

function insertRun(db: Database.Database, id: string, providerId: string | null): void {
  db.prepare(
    `INSERT INTO runs (id, card_id, agent_name, status, provider_id, created_at)
     VALUES (?, 'card-1', 'bob', 'created', ?, '2026-01-01T00:00:00.000Z')`,
  ).run(id, providerId);
}

describe('migration 011 runs.provider_id FK rebuild', () => {
  it('retargets provider_id to providers, nulls orphan values, and preserves indexes', () => {
    const db = createPreMigrationDatabase();
    runMigrations(db, migrations.filter((migration) => migration.version <= 10));

    insertCard(db, 'card-1');
    insertAgent(db, 'agent-orphan');
    insertRun(db, 'run-orphan-agent-id', 'agent-orphan');
    insertRun(db, 'run-null-provider-id', null);

    const migrate = db.transaction(() => {
      migration011.up(db);
    });
    migrate();

    const fks = db.prepare(`PRAGMA foreign_key_list('runs')`).all() as Array<{ from: string; table: string; to: string }>;
    const providerFk = fks.find((fk) => fk.from === 'provider_id');
    expect(providerFk).toEqual(expect.objectContaining({ table: 'providers', to: 'id' }));

    const rows = db.prepare('SELECT id, provider_id FROM runs ORDER BY id').all() as Array<{ id: string; provider_id: string | null }>;
    expect(rows).toEqual([
      { id: 'run-null-provider-id', provider_id: null },
      { id: 'run-orphan-agent-id', provider_id: null },
    ]);

    insertProvider(db, 'provider-valid');
    insertRun(db, 'run-valid-provider-id', 'provider-valid');
    expect(() => insertRun(db, 'run-invalid-provider-id', 'not-a-provider')).toThrow(/FOREIGN KEY constraint failed/);

    const indexes = (db.prepare(`PRAGMA index_list('runs')`).all() as Array<{ name: string }>).map((row) => row.name);
    expect(indexes).toContain('idx_runs_card');
    expect(indexes).toContain('idx_runs_status');
  });
});
