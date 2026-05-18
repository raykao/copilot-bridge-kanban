import type Database from 'better-sqlite3';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderType = 'acp' | 'copilot-bridge';
export type ProviderStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface Provider {
  id: string;
  type: ProviderType;
  label: string;
  url: string;
  ws_url: string | null;
  api_key: string | null;
  status: ProviderStatus;
  last_discovered_at: string | null;
  created_at: string;
}

export interface NewProvider {
  type: ProviderType;
  label: string;
  url: string;
  ws_url?: string | null;
  api_key?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToProvider(row: Record<string, unknown>): Provider {
  return {
    id: row.id as string,
    type: row.type as ProviderType,
    label: row.label as string,
    url: row.url as string,
    ws_url: (row.ws_url as string | null) ?? null,
    api_key: (row.api_key as string | null) ?? null,
    status: (row.status as ProviderStatus) ?? 'disconnected',
    last_discovered_at: (row.last_discovered_at as string | null) ?? null,
    created_at: row.created_at as string,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createProvider(db: Database.Database, input: NewProvider): Provider {
  const id = crypto.randomUUID();
  const ts = new Date().toISOString();

  db.prepare(
    `INSERT INTO providers (id, type, label, url, ws_url, api_key, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'disconnected', ?)`,
  ).run(
    id,
    input.type,
    input.label,
    input.url,
    input.ws_url ?? null,
    input.api_key ?? null,
    ts,
  );

  return getProvider(db, id)!;
}

export function getProvider(db: Database.Database, id: string): Provider | null {
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToProvider(row) : null;
}

export function listProviders(db: Database.Database): Provider[] {
  const rows = db.prepare('SELECT * FROM providers ORDER BY label ASC').all() as Array<Record<string, unknown>>;
  return rows.map(rowToProvider);
}

export function updateProvider(
  db: Database.Database,
  id: string,
  patch: Partial<Pick<Provider, 'label' | 'url' | 'ws_url' | 'api_key' | 'status' | 'last_discovered_at'>>,
): Provider {
  const sets: string[] = [];
  const params: unknown[] = [];

  if ('label' in patch) { sets.push('label = ?'); params.push(patch.label); }
  if ('url' in patch) { sets.push('url = ?'); params.push(patch.url); }
  if ('ws_url' in patch) { sets.push('ws_url = ?'); params.push(patch.ws_url ?? null); }
  if ('api_key' in patch) { sets.push('api_key = ?'); params.push(patch.api_key ?? null); }
  if ('status' in patch) { sets.push('status = ?'); params.push(patch.status); }
  if ('last_discovered_at' in patch) { sets.push('last_discovered_at = ?'); params.push(patch.last_discovered_at ?? null); }

  if (sets.length === 0) {
    const existing = getProvider(db, id);
    if (!existing) throw new Error(`Provider ${id} not found`);
    return existing;
  }

  params.push(id);
  db.prepare(`UPDATE providers SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  const updated = getProvider(db, id);
  if (!updated) throw new Error(`Provider ${id} not found`);
  return updated;
}

export function deleteProvider(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM providers WHERE id = ?').run(id);
}
