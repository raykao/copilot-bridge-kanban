import type Database from 'better-sqlite3';
import crypto from 'node:crypto';

export interface AgentToken {
  id: string;
  agent_name: string;
  token_hash: string;
  created_at: string;
}

export interface AgentTokenCreateResult {
  id: string;
  agent_name: string;
  token: string;
  created_at: string;
}

export type AgentTokenSummary = Pick<AgentToken, 'id' | 'agent_name' | 'created_at'>;

function now(): string {
  return new Date().toISOString();
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createAgentToken(db: Database.Database, agentName: string): AgentTokenCreateResult {
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const createdAt = now();

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM agent_tokens WHERE agent_name = ?').run(agentName);
    db.prepare(
      `INSERT INTO agent_tokens (id, agent_name, token_hash, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(id, agentName, tokenHash, createdAt);
  });
  tx();

  return {
    id,
    agent_name: agentName,
    token,
    created_at: createdAt,
  };
}

export function validateAgentToken(db: Database.Database, token: string): string | null {
  const tokenHash = hashToken(token);
  const row = db.prepare('SELECT agent_name FROM agent_tokens WHERE token_hash = ?').get(tokenHash) as
    | { agent_name: string }
    | undefined;
  return row?.agent_name ?? null;
}

export function revokeAgentToken(db: Database.Database, agentName: string): boolean {
  const result = db.prepare('DELETE FROM agent_tokens WHERE agent_name = ?').run(agentName);
  return result.changes > 0;
}

export function listAgentTokens(db: Database.Database): AgentTokenSummary[] {
  return db.prepare('SELECT id, agent_name, created_at FROM agent_tokens ORDER BY agent_name ASC').all() as AgentTokenSummary[];
}

export interface AgentTokenMintResult {
  id: string;
  agent_name: string;
  card_id: string;
  token: string;
  created_at: string;
}

export function mintAgentTokenForCard(
  db: Database.Database,
  cardId: string,
  agentName: string,
): AgentTokenMintResult {
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const createdAt = now();

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM agent_tokens WHERE card_id = ? AND agent_name = ?').run(cardId, agentName);
    db.prepare(
      `INSERT INTO agent_tokens (id, agent_name, card_id, token_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, agentName, cardId, tokenHash, createdAt);
  });
  tx();

  return { id, agent_name: agentName, card_id: cardId, token, created_at: createdAt };
}

export function validateAgentTokenForCard(
  db: Database.Database,
  token: string,
  cardId: string,
  agentName: string,
): boolean {
  const tokenHash = hashToken(token);
  const row = db.prepare(
    'SELECT 1 FROM agent_tokens WHERE token_hash = ? AND card_id = ? AND agent_name = ?',
  ).get(tokenHash, cardId, agentName) as { '1': number } | undefined;
  return row !== undefined;
}

export function revokeAgentTokensForCard(db: Database.Database, cardId: string): number {
  const result = db.prepare('DELETE FROM agent_tokens WHERE card_id = ?').run(cardId);
  return result.changes;
}
