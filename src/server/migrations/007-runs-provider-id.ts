import type Database from 'better-sqlite3';
import type { Migration } from '../migrations.js';

const migration: Migration = {
  version: 7,
  name: 'runs-provider-id',
  up: (db: Database.Database) => {
    db.exec(`ALTER TABLE runs ADD COLUMN provider_id TEXT REFERENCES agents(id) ON DELETE SET NULL`);
  },
};

export default migration;
