import { describe, expect, it } from 'vitest';
import { createDatabase, initializeSchema } from './db.js';

describe('database schema', () => {
  it('creates the expected tables and indexes in memory', () => {
    const db = createDatabase(':memory:');

    initializeSchema(db);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'sessions', 'preferences') ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_sessions_expires', 'idx_sessions_user') ORDER BY name",
      )
      .all() as Array<{ name: string }>;

    expect(tables).toEqual([
      { name: 'preferences' },
      { name: 'sessions' },
      { name: 'users' },
    ]);
    expect(indexes).toEqual([
      { name: 'idx_sessions_expires' },
      { name: 'idx_sessions_user' },
    ]);

    db.close();
  });
});
