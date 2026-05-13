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
});

describe('migration 001 - drop-bridge-session-id', () => {
  it('fresh DB (from initializeSchema): bridge_run_id present, no bridge_session_id, user_version=1', () => {
    const db = createDatabase(':memory:');
    initializeSchema(db);

    const cols = getColumnNames(db, 'runs');
    expect(cols).toContain('bridge_run_id');
    expect(cols).not.toContain('bridge_session_id');
    expect(getUserVersion(db)).toBe(1);
  });

  it('pre-Phase-B DB: renames bridge_session_id to bridge_run_id', () => {
    const db = new Database(':memory:');
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
    expect(cols).not.toContain('bridge_session_id');
    expect(getUserVersion(db)).toBe(1);

    const row = db.prepare('SELECT bridge_run_id FROM runs WHERE id = ?').get('r1') as { bridge_run_id: string };
    expect(row.bridge_run_id).toBe('abc');
  });

  it('both-cols DB: drops bridge_session_id and preserves bridge_run_id', () => {
    const db = new Database(':memory:');
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
    expect(cols).not.toContain('bridge_session_id');
    expect(getUserVersion(db)).toBe(1);

    const row = db.prepare('SELECT bridge_run_id FROM runs WHERE id = ?').get('r1') as { bridge_run_id: string };
    expect(row.bridge_run_id).toBe('new');
  });
});
