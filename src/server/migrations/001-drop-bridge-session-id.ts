import type Database from 'better-sqlite3';
import type { Migration } from '../migrations.js';

const migration: Migration = {
  version: 1,
  name: 'drop-bridge-session-id',
  up: (db: Database.Database) => {
    const cols = (
      db.prepare('PRAGMA table_info(runs)').all() as Array<{ name: string }>
    ).map((r) => r.name);

    const hasBridgeSessionId = cols.includes('bridge_session_id');
    const hasBridgeRunId = cols.includes('bridge_run_id');

    if (!hasBridgeSessionId) {
      // Fresh DB or already migrated - no DDL required.
      return;
    }

    if (!hasBridgeRunId) {
      // Pre-Phase-B DB: has bridge_session_id but no bridge_run_id.
      db.exec('ALTER TABLE runs ADD COLUMN bridge_run_id TEXT');
      db.exec('UPDATE runs SET bridge_run_id = bridge_session_id WHERE bridge_run_id IS NULL');
    }

    // Drop the dead column. Preserves bridge_run_id data.
    db.exec('ALTER TABLE runs DROP COLUMN bridge_session_id');
  },
};

export default migration;
