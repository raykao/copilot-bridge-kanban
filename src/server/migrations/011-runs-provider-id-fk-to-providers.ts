import type Database from 'better-sqlite3';
import type { Migration } from '../migrations.js';

const migration: Migration = {
  version: 11,
  name: 'runs-provider-id-fk-to-providers',
  up: (db: Database.Database) => {
    // SQLite cannot ALTER a FOREIGN KEY in place. The migration runner wraps
    // up() in a transaction, so defer FK checks instead of toggling foreign_keys.
    db.pragma('defer_foreign_keys = ON');

    db.exec(`
      CREATE TABLE runs_new (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        bridge_run_id TEXT,
        input_comment_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        acp_session_id TEXT,
        provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
        FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
      );

      INSERT INTO runs_new (
        id, card_id, agent_name, status, bridge_run_id, input_comment_id,
        error, created_at, finished_at, acp_session_id, provider_id
      )
      SELECT
        id, card_id, agent_name, status, bridge_run_id, input_comment_id,
        error, created_at, finished_at, acp_session_id,
        CASE
          WHEN provider_id IS NULL THEN NULL
          WHEN provider_id IN (SELECT id FROM providers) THEN provider_id
          ELSE NULL
        END
      FROM runs;

      DROP TABLE runs;
      ALTER TABLE runs_new RENAME TO runs;

      CREATE INDEX idx_runs_card ON runs(card_id);
      CREATE INDEX idx_runs_status ON runs(status);
    `);
  },
};

export default migration;
