import type Database from 'better-sqlite3';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Agent {
  id: string;
  name: string;
  protocol: string;
  url: string;
  auto_approve: boolean;
  created_at: string;
}

export interface NewAgent {
  name: string;
  protocol?: string;
  url: string;
  auto_approve?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToAgent(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    name: row.name as string,
    protocol: row.protocol as string,
    url: row.url as string,
    auto_approve: (row.auto_approve as number) === 1,
    created_at: row.created_at as string,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createAgent(db: Database.Database, input: NewAgent): Agent {
  const id = crypto.randomUUID();
  const ts = new Date().toISOString();

  db.prepare(
    `INSERT INTO agents (id, name, protocol, url, auto_approve, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.protocol ?? 'acp',
    input.url,
    input.auto_approve === true ? 1 : 0,
    ts,
  );

  return getAgent(db, id)!;
}

export function getAgent(db: Database.Database, id: string): Agent | null {
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToAgent(row) : null;
}

export function getAgentByName(db: Database.Database, name: string): Agent | null {
  const row = db.prepare('SELECT * FROM agents WHERE name = ?').get(name) as Record<string, unknown> | undefined;
  return row ? rowToAgent(row) : null;
}

export function listAgents(db: Database.Database): Agent[] {
  const rows = db.prepare('SELECT * FROM agents ORDER BY name ASC').all() as Array<Record<string, unknown>>;
  return rows.map(rowToAgent);
}

export function updateAgent(
  db: Database.Database,
  id: string,
  patch: Partial<Pick<Agent, 'name' | 'protocol' | 'url' | 'auto_approve'>>,
): Agent {
  const sets: string[] = [];
  const params: unknown[] = [];

  if ('name' in patch) { sets.push('name = ?'); params.push(patch.name); }
  if ('protocol' in patch) { sets.push('protocol = ?'); params.push(patch.protocol); }
  if ('url' in patch) { sets.push('url = ?'); params.push(patch.url); }
  if ('auto_approve' in patch) { sets.push('auto_approve = ?'); params.push(patch.auto_approve === true ? 1 : 0); }

  if (sets.length === 0) {
    const existing = getAgent(db, id);
    if (!existing) throw new Error(`Agent ${id} not found`);
    return existing;
  }

  params.push(id);
  db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  const updated = getAgent(db, id);
  if (!updated) throw new Error(`Agent ${id} not found`);
  return updated;
}

export function deleteAgent(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM agents WHERE id = ?').run(id);
}
