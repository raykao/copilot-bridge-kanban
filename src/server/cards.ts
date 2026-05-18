import type Database from 'better-sqlite3';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Card {
  id: string;
  type: 'work' | 'chat';
  agent_bot: string | null;
  agent_id: string | null;
  title: string;
  description: string | null;
  status: string;
  created_by: string;
  workspace_subdir: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface NewCard {
  title: string;
  description?: string;
  type?: 'work' | 'chat';
  agent_bot?: string | null;
  status?: string;
  created_by: string;
  workspace_subdir?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CardFilter {
  agent_bot?: string | null;
  status?: string;
  label?: string;
  type?: 'work' | 'chat';
}

export interface CardComment {
  id: string;
  card_id: string;
  author_kind: string;
  author_id: string;
  content: string;
  run_id: string | null;
  created_at: string;
}

export interface NewCardComment {
  card_id: string;
  author_kind: 'human' | 'agent' | 'system';
  author_id: string;
  content: string;
  run_id?: string;
}

export interface Run {
  id: string;
  card_id: string;
  agent_name: string;
  status: 'created' | 'running' | 'awaiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  bridge_run_id: string | null;
  acp_session_id: string | null;
  input_comment_id: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  provider_id: string | null;
}

export interface NewRun {
  card_id: string;
  agent_name: string;
  input_comment_id?: string;
  provider_id?: string;
}

export interface Checkpoint {
  id: string;
  card_id: string;
  name: string | null;
  turn_index: number;
  git_ref: string | null;
  created_by: string;
  created_at: string;
}

export interface NewCheckpoint {
  card_id: string;
  created_by: string;
  name?: string;
  turn_index?: number;
  git_ref?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function rowToCard(row: any): Card {
  return {
    ...row,
    metadata: parseMetadata(row.metadata),
  };
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export function createCard(db: Database.Database, input: NewCard): Card {
  const id = crypto.randomUUID();
  const ts = now();
  const metadata = JSON.stringify(input.metadata ?? {});

  db.prepare(
    `INSERT INTO cards (id, type, agent_bot, title, description, status, created_by, workspace_subdir, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.type ?? 'work',
    input.agent_bot ?? null,
    input.title,
    input.description ?? null,
    input.status ?? 'idea',
    input.created_by,
    input.workspace_subdir ?? null,
    metadata,
    ts,
    ts,
  );

  return getCard(db, id)!;
}

export function getCard(db: Database.Database, id: string): Card | null {
  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as any;
  return row ? rowToCard(row) : null;
}

export function listCards(db: Database.Database, filter: CardFilter = {}): Card[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.agent_bot !== undefined) {
    if (filter.agent_bot === null) {
      conditions.push('c.agent_bot IS NULL');
    } else {
      conditions.push('c.agent_bot = ?');
      params.push(filter.agent_bot);
    }
  }
  if (filter.status) {
    conditions.push('c.status = ?');
    params.push(filter.status);
  }
  if (filter.type) {
    conditions.push('c.type = ?');
    params.push(filter.type);
  }
  if (filter.label) {
    conditions.push('EXISTS (SELECT 1 FROM card_labels cl WHERE cl.card_id = c.id AND cl.label = ?)');
    params.push(filter.label);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT c.* FROM cards c ${where} ORDER BY c.created_at DESC`).all(...params) as any[];
  return rows.map(rowToCard);
}

export function updateCard(db: Database.Database, id: string, patch: Partial<Card>): Card {
  const allowed = ['type', 'agent_bot', 'agent_id', 'title', 'description', 'status', 'workspace_subdir', 'archived_at'] as const;
  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [now()];

  for (const key of allowed) {
    if (key in patch) {
      sets.push(`${key} = ?`);
      params.push((patch as any)[key] ?? null);
    }
  }
  if (patch.metadata !== undefined) {
    sets.push('metadata = ?');
    params.push(JSON.stringify(patch.metadata));
  }

  params.push(id);
  db.prepare(`UPDATE cards SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  const card = getCard(db, id);
  if (!card) throw new Error(`Card ${id} not found`);
  return card;
}

export function deleteCard(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM cards WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export function addLabels(db: Database.Database, cardId: string, labels: string[]): void {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO card_labels (card_id, label) VALUES (?, ?)',
  );
  const tx = db.transaction(() => {
    for (const label of labels) {
      stmt.run(cardId, label);
    }
  });
  tx();
}

export function removeLabel(db: Database.Database, cardId: string, label: string): void {
  db.prepare('DELETE FROM card_labels WHERE card_id = ? AND label = ?').run(cardId, label);
}

export function getLabels(db: Database.Database, cardId: string): string[] {
  const rows = db.prepare('SELECT label FROM card_labels WHERE card_id = ? ORDER BY label').all(cardId) as Array<{ label: string }>;
  return rows.map((r) => r.label);
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export function addComment(db: Database.Database, input: NewCardComment): CardComment {
  const id = crypto.randomUUID();
  const ts = now();

  db.prepare(
    `INSERT INTO card_comments (id, card_id, author_kind, author_id, content, run_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.card_id, input.author_kind, input.author_id, input.content, input.run_id ?? null, ts);

  return db.prepare('SELECT * FROM card_comments WHERE id = ?').get(id) as CardComment;
}

export function listComments(db: Database.Database, cardId: string): CardComment[] {
  return db.prepare('SELECT * FROM card_comments WHERE card_id = ? ORDER BY created_at ASC').all(cardId) as CardComment[];
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export function createRun(db: Database.Database, input: NewRun): Run {
  const id = crypto.randomUUID();
  const ts = now();

  db.prepare(
    `INSERT INTO runs (id, card_id, agent_name, status, input_comment_id, provider_id, created_at)
     VALUES (?, ?, ?, 'created', ?, ?, ?)`,
  ).run(id, input.card_id, input.agent_name, input.input_comment_id ?? null, input.provider_id ?? null, ts);

  return db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Run;
}

export function updateRun(db: Database.Database, id: string, patch: Partial<Run>): Run {
  const allowed = ['status', 'bridge_run_id', 'acp_session_id', 'error', 'finished_at', 'provider_id'] as const;
  const sets: string[] = [];
  const params: unknown[] = [];

  for (const key of allowed) {
    if (key in patch) {
      sets.push(`${key} = ?`);
      params.push((patch as any)[key] ?? null);
    }
  }

  if (sets.length === 0) {
    return db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Run;
  }

  params.push(id);
  db.prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Run;
  if (!run) throw new Error(`Run ${id} not found`);
  return run;
}

export function getRunByBridgeRunId(db: Database.Database, bridgeRunId: string): Run | null {
  const row = db.prepare('SELECT * FROM runs WHERE bridge_run_id = ?').get(bridgeRunId) as Run | undefined;
  return row ?? null;
}

export function listRuns(db: Database.Database, cardId: string): Run[] {
  return db.prepare('SELECT * FROM runs WHERE card_id = ? ORDER BY created_at ASC').all(cardId) as Run[];
}

export function listActiveRunsGlobal(db: Database.Database): Run[] {
  return db.prepare(
    `SELECT * FROM runs WHERE status IN ('running', 'awaiting') AND bridge_run_id IS NOT NULL ORDER BY created_at ASC`,
  ).all() as Run[];
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

export function createCheckpoint(db: Database.Database, input: NewCheckpoint): Checkpoint {
  const id = crypto.randomUUID();
  const ts = now();

  db.prepare(
    `INSERT INTO checkpoints (id, card_id, name, turn_index, git_ref, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.card_id,
    input.name ?? null,
    input.turn_index ?? 0,
    input.git_ref ?? null,
    input.created_by,
    ts,
  );

  return db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(id) as Checkpoint;
}

export function listCheckpoints(db: Database.Database, cardId: string): Checkpoint[] {
  return db.prepare('SELECT * FROM checkpoints WHERE card_id = ? ORDER BY created_at ASC').all(cardId) as Checkpoint[];
}

export function getCheckpoint(db: Database.Database, id: string): Checkpoint | null {
  const row = db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(id) as Checkpoint | undefined;
  return row ?? null;
}

export function deleteCheckpoint(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM checkpoints WHERE id = ?').run(id);
}
