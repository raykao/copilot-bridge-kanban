import type Database from 'better-sqlite3';
import type { Migration } from '../migrations.js';

const migration: Migration = {
  version: 8,
  name: 'providers-table',
  up: (db: Database.Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS providers (
        id                 TEXT PRIMARY KEY,
        type               TEXT NOT NULL CHECK(type IN ('acp', 'copilot-bridge')),
        label              TEXT NOT NULL,
        url                TEXT NOT NULL,
        ws_url             TEXT,
        api_key            TEXT,
        status             TEXT NOT NULL DEFAULT 'disconnected'
                                CHECK(status IN ('disconnected', 'connecting', 'connected', 'reconnecting', 'error')),
        last_discovered_at TEXT,
        created_at         TEXT NOT NULL
      )
    `);
  },
};

export default migration;
