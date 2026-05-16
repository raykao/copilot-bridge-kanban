import type Database from 'better-sqlite3';
import type { Migration } from '../migrations.js';

const migration: Migration = {
  version: 5,
  name: 'agents-api-key',
  up: (db: Database.Database) => {
    const cols = (db.prepare('PRAGMA table_info(agents)').all() as Array<{ name: string }>).map(r => r.name);
    if (!cols.includes('api_key')) {
      db.exec('ALTER TABLE agents ADD COLUMN api_key TEXT');
    }
  },
};

export default migration;
