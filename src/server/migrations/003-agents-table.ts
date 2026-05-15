import type Database from 'better-sqlite3';
import type { Migration } from '../migrations.js';

function getAgentTokenCardIdColumn(db: Database.Database): { name: string; notnull: number } | undefined {
  return (
    db.prepare('PRAGMA table_info(agent_tokens)').all() as Array<{ name: string; notnull: number }>
  ).find((row) => row.name === 'card_id');
}

const migration: Migration = {
  version: 3,
  name: 'agents-table',
  up: (db: Database.Database) => {
    const cardIdColumn = getAgentTokenCardIdColumn(db);

    if (cardIdColumn?.notnull === 0) {
      db.exec("UPDATE agent_tokens SET card_id = NULL WHERE card_id = ''");
    } else if (cardIdColumn) {
      db.exec(`
        CREATE TABLE agent_tokens_new (
          id TEXT PRIMARY KEY,
          agent_name TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          card_id TEXT,
          created_at TEXT NOT NULL
        );

        INSERT INTO agent_tokens_new (id, agent_name, token_hash, card_id, created_at)
        SELECT id, agent_name, token_hash, NULLIF(card_id, ''), created_at
        FROM agent_tokens;

        DROP TABLE agent_tokens;
        ALTER TABLE agent_tokens_new RENAME TO agent_tokens;

        CREATE UNIQUE INDEX idx_agent_tokens_card_bot ON agent_tokens(card_id, agent_name);
        CREATE INDEX idx_agent_tokens_hash ON agent_tokens(token_hash);
      `);
    }

    const tableNames = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    ).map((r) => r.name);

    if (!tableNames.includes('agents')) {
      db.exec(`
        CREATE TABLE agents (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL UNIQUE,
          protocol   TEXT NOT NULL DEFAULT 'acp',
          url        TEXT NOT NULL,
          auto_approve INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        )
      `);
    }

    if (tableNames.includes('cards')) {
      const cardCols = (
        db.prepare('PRAGMA table_info(cards)').all() as Array<{ name: string }>
      ).map((r) => r.name);

      if (!cardCols.includes('agent_id')) {
        db.exec('ALTER TABLE cards ADD COLUMN agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL');
      }
    }
  },
};

export default migration;
