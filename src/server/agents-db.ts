import type Database from 'better-sqlite3';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Agent {
  id: string;
  name: string | null;
  protocol: string;
  url: string;
  auto_approve: boolean;
  api_key: string | null;
  created_at: string;
  provider_id: string | null;
}

export interface NewAgent {
  name?: string | null;
  protocol?: string;
  url: string;
  auto_approve?: boolean;
  api_key?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToAgent(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    name: (row.name as string | null) ?? null,
    protocol: row.protocol as string,
    url: row.url as string,
    auto_approve: (row.auto_approve as number) === 1,
    api_key: (row.api_key as string | null) ?? null,
    created_at: row.created_at as string,
    provider_id: (row.provider_id as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createAgent(db: Database.Database, input: NewAgent): Agent {
  const id = crypto.randomUUID();
  const ts = new Date().toISOString();

  db.prepare(
    `INSERT INTO agents (id, name, protocol, url, auto_approve, api_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name ?? null,
    input.protocol ?? 'acp',
    input.url,
    input.auto_approve === true ? 1 : 0,
    input.api_key ?? null,
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
  patch: Partial<Pick<Agent, 'name' | 'protocol' | 'url' | 'auto_approve' | 'api_key'>>,
): Agent {
  const sets: string[] = [];
  const params: unknown[] = [];

  if ('name' in patch) { sets.push('name = ?'); params.push(patch.name ?? null); }
  if ('protocol' in patch) { sets.push('protocol = ?'); params.push(patch.protocol); }
  if ('url' in patch) { sets.push('url = ?'); params.push(patch.url); }
  if ('auto_approve' in patch) { sets.push('auto_approve = ?'); params.push(patch.auto_approve === true ? 1 : 0); }
  if ('api_key' in patch) { sets.push('api_key = ?'); params.push(patch.api_key ?? null); }

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

export function upsertDiscoveredAgent(
  db: Database.Database,
  providerId: string,
  card: { name: string; providerType?: string; providerBaseUrl?: string },
  providerUrl: string,
  apiKey: string | null,
  autoApprove: boolean,
): Agent {
  const protocol = card.providerType ?? 'unknown';
  const existing = db.prepare(
    `SELECT * FROM agents WHERE provider_id = ? AND name = ? LIMIT 1`,
  ).get(providerId, card.name) as Record<string, unknown> | undefined;
  if (existing) {
    db.prepare(
      `UPDATE agents
       SET protocol = ?, url = ?, auto_approve = ?, api_key = ?
       WHERE id = ?`,
    ).run(protocol, providerUrl, autoApprove ? 1 : 0, apiKey, existing.id as string);
    return rowToAgent({ ...existing, protocol, url: providerUrl, auto_approve: autoApprove ? 1 : 0, api_key: apiKey });
  }
  const id = crypto.randomUUID();
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO agents (id, name, protocol, url, auto_approve, api_key, created_at, provider_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, card.name, protocol, providerUrl, autoApprove ? 1 : 0, apiKey, ts, providerId);
  return {
    id,
    name: card.name,
    protocol,
    url: providerUrl,
    auto_approve: autoApprove,
    api_key: apiKey,
    created_at: ts,
    provider_id: providerId,
  };
}

export function listAgentsByProvider(db: Database.Database, providerId: string): Agent[] {
  const rows = db.prepare(
    `SELECT * FROM agents WHERE provider_id = ? ORDER BY name ASC`,
  ).all(providerId) as Array<Record<string, unknown>>;
  return rows.map(rowToAgent);
}

export function deleteAgentsByProvider(db: Database.Database, providerId: string): number {
  const result = db.prepare(`DELETE FROM agents WHERE provider_id = ?`).run(providerId);
  return result.changes;
}
