import type Database from 'better-sqlite3';
import type { Migration } from '../migrations.js';

const migration: Migration = {
  version: 9,
  name: 'agents-provider-id',
  up: (db: Database.Database) => {
    db.exec(
      `ALTER TABLE agents ADD COLUMN provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL`,
    );
  },
};

export default migration;
