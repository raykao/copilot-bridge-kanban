import type Database from 'better-sqlite3';

export interface Migration {
  /** Sequential integer, must equal index+1 in the ordered list. */
  version: number;
  /** Short slug for logging, e.g. 'drop-bridge-session-id'. */
  name: string;
  /** Idempotent forward migration. Receives an already-open db. Run inside a transaction. */
  up: (db: Database.Database) => void;
}

export function runMigrations(db: Database.Database, migrations: Migration[]): void {
  // Validate that versions are 1..N consecutive.
  for (let i = 0; i < migrations.length; i++) {
    if (migrations[i].version !== i + 1) {
      throw new Error(
        `Migration list is not consecutive: expected version ${i + 1} at index ${i}, got ${migrations[i].version}`,
      );
    }
  }

  const current = db.pragma('user_version', { simple: true }) as number;

  for (const migration of migrations) {
    if (migration.version <= current) continue;

    const tx = db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    });

    tx();
  }
}
