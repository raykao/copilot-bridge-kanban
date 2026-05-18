import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import type { Migration } from '../migrations.js';

// Map the legacy agent.protocol values to the providers.type enum.
// providers.type CHECK constraint accepts only 'acp' | 'copilot-bridge'.
function mapProtocolToProviderType(protocol: string): 'acp' | 'copilot-bridge' {
  if (protocol === 'copilot-bridge') return 'copilot-bridge';
  return 'acp';
}

const migration: Migration = {
  version: 10,
  name: 'backfill-providers-from-agents',
  up: (db: Database.Database) => {
    const ts = new Date().toISOString();
    const rows = db.prepare(
      `SELECT id, name, protocol, url, api_key
       FROM agents
       WHERE provider_id IS NULL`,
    ).all() as Array<{
      id: string;
      name: string | null;
      protocol: string;
      url: string;
      api_key: string | null;
    }>;

    const insertProvider = db.prepare(
      `INSERT INTO providers (id, type, label, url, ws_url, api_key, status, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, 'disconnected', ?)`,
    );
    const updateAgent = db.prepare(
      `UPDATE agents SET provider_id = ? WHERE id = ?`,
    );

    for (const row of rows) {
      const providerId = crypto.randomUUID();
      const type = mapProtocolToProviderType(row.protocol);
      const label = row.name && row.name.trim() !== '' ? row.name : row.url;
      insertProvider.run(providerId, type, label, row.url, row.api_key, ts);
      updateAgent.run(providerId, row.id);
    }
  },
};

export default migration;
