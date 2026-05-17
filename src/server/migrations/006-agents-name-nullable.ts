import type Database from 'better-sqlite3';
import type { Migration } from '../migrations.js';

const migration: Migration = {
  version: 6,
  name: 'agents-name-nullable',
  up: (db: Database.Database) => {
    // SQLite doesn't support ALTER COLUMN - recreate the table
    db.exec(`
      CREATE TABLE IF NOT EXISTS agents_new (
        id TEXT PRIMARY KEY,
        name TEXT,
        protocol TEXT NOT NULL,
        url TEXT NOT NULL,
        auto_approve INTEGER NOT NULL DEFAULT 0,
        api_key TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO agents_new SELECT id, name, protocol, url, auto_approve, api_key, created_at FROM agents;
      DROP TABLE agents;
      ALTER TABLE agents_new RENAME TO agents;
    `);
  },
};

export default migration;
