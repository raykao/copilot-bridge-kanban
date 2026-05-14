import type Database from 'better-sqlite3';
import type { Migration } from '../migrations.js';

const migration: Migration = {
  version: 2,
  name: 'agent-tokens-per-card',
  up: (db: Database.Database) => {
    const cols = (
      db.prepare('PRAGMA table_info(agent_tokens)').all() as Array<{ name: string }>
    ).map((r) => r.name);

    if (cols.includes('card_id')) {
      return;
    }

    db.exec('DELETE FROM agent_tokens');

    db.exec('ALTER TABLE agent_tokens ADD COLUMN card_id TEXT');
    db.exec('DROP INDEX IF EXISTS idx_agent_tokens_name');
    db.exec('CREATE UNIQUE INDEX idx_agent_tokens_card_bot ON agent_tokens(card_id, agent_name)');
  },
};

export default migration;
