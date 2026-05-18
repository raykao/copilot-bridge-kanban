import { describe, expect, it } from 'vitest';
import { createDatabase, initializeSchema } from './db.js';

describe('database schema', () => {
  it('creates the expected tables and indexes in memory', () => {
    const db = createDatabase(':memory:');

    initializeSchema(db);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;

    expect(tables.map((t) => t.name)).toEqual([
      'agent_tokens',
      'agents',
      'card_comments',
      'card_labels',
      'cards',
      'checkpoints',
      'preferences',
      'providers',
      'runs',
      'sessions',
      'users',
    ]);
    expect(indexes.map((i) => i.name)).toEqual([
      'idx_agent_tokens_card_bot',
      'idx_agent_tokens_hash',
      'idx_card_comments_card',
      'idx_card_labels_label',
      'idx_cards_agent_status',
      'idx_cards_status',
      'idx_checkpoints_card',
      'idx_runs_card',
      'idx_runs_status',
      'idx_sessions_expires',
      'idx_sessions_user',
    ]);

    db.close();
  });

  it('enforces foreign keys with cascade delete on cards', () => {
    const db = createDatabase(':memory:');
    initializeSchema(db);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO cards (id, title, status, created_by, created_at, updated_at)
       VALUES ('c1', 'Test', 'idea', 'user1', ?, ?)`,
    ).run(now, now);

    db.prepare(
      `INSERT INTO card_labels (card_id, label) VALUES ('c1', 'backend')`,
    ).run();

    db.prepare(
      `INSERT INTO card_comments (id, card_id, author_kind, author_id, content, created_at)
       VALUES ('cm1', 'c1', 'human', 'user1', 'hello', ?)`,
    ).run(now);

    db.prepare(
      `INSERT INTO runs (id, card_id, agent_name, status, created_at)
       VALUES ('r1', 'c1', 'bob', 'created', ?)`,
    ).run(now);

    db.prepare(
      `INSERT INTO checkpoints (id, card_id, created_by, created_at)
       VALUES ('cp1', 'c1', 'user1', ?)`,
    ).run(now);

    // Delete card - cascades should remove labels, comments, runs, checkpoints
    db.prepare('DELETE FROM cards WHERE id = ?').run('c1');

    expect(db.prepare('SELECT COUNT(*) as c FROM card_labels').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) as c FROM card_comments').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) as c FROM runs').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) as c FROM checkpoints').get()).toEqual({ c: 0 });

    db.close();
  });
});
