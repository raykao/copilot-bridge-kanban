import type Database from 'better-sqlite3';
import type { Migration } from '../migrations.js';

const migration: Migration = {
  version: 4,
  name: 'add-acp-session-id',
  up: (db: Database.Database) => {
    const cols = (
      db.prepare('PRAGMA table_info(runs)').all() as Array<{ name: string }>
    ).map((r) => r.name);
    if (cols.includes('acp_session_id')) return;
    db.exec('ALTER TABLE runs ADD COLUMN acp_session_id TEXT');
  },
};

export default migration;
