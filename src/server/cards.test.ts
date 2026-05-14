import { describe, expect, it, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, initializeSchema } from './db.js';
import {
  createCard,
  getCard,
  listCards,
  updateCard,
  deleteCard,
  addLabels,
  removeLabel,
  getLabels,
  addComment,
  listComments,
  createRun,
  updateRun,
  listRuns,
  listActiveRunsGlobal,
  createCheckpoint,
  listCheckpoints,
  deleteCheckpoint,
} from './cards.js';

let db: Database.Database;

beforeEach(() => {
  db = createDatabase(':memory:');
  initializeSchema(db);
});

describe('cards', () => {
  it('creates and retrieves a card', () => {
    const card = createCard(db, { title: 'Test card', created_by: 'alice' });

    expect(card.id).toBeTruthy();
    expect(card.title).toBe('Test card');
    expect(card.type).toBe('work');
    expect(card.status).toBe('idea');
    expect(card.created_by).toBe('alice');
    expect(card.agent_bot).toBeNull();
    expect(card.metadata).toEqual({});

    const fetched = getCard(db, card.id);
    expect(fetched).toEqual(card);
  });

  it('creates a card with all fields', () => {
    const card = createCard(db, {
      title: 'Full card',
      description: 'Do the thing',
      type: 'chat',
      agent_bot: 'bob',
      status: 'in_progress',
      created_by: 'alice',
      workspace_subdir: 'card-123',
      metadata: { priority: 'high' },
    });

    expect(card.type).toBe('chat');
    expect(card.agent_bot).toBe('bob');
    expect(card.status).toBe('in_progress');
    expect(card.description).toBe('Do the thing');
    expect(card.workspace_subdir).toBe('card-123');
    expect(card.metadata).toEqual({ priority: 'high' });
  });

  it('lists cards with filters', () => {
    createCard(db, { title: 'A', agent_bot: 'bob', status: 'in_progress', created_by: 'alice' });
    createCard(db, { title: 'B', agent_bot: 'lal', status: 'idea', created_by: 'alice' });
    createCard(db, { title: 'C', agent_bot: 'bob', status: 'idea', created_by: 'alice' });

    expect(listCards(db, { agent_bot: 'bob' })).toHaveLength(2);
    expect(listCards(db, { status: 'idea' })).toHaveLength(2);
    expect(listCards(db, { agent_bot: 'bob', status: 'idea' })).toHaveLength(1);
    expect(listCards(db)).toHaveLength(3);
  });

  it('lists unassigned cards with agent_bot=null filter', () => {
    createCard(db, { title: 'Assigned', agent_bot: 'bob', created_by: 'alice' });
    createCard(db, { title: 'Unassigned', created_by: 'alice' });

    const unassigned = listCards(db, { agent_bot: null });
    expect(unassigned).toHaveLength(1);
    expect(unassigned[0].title).toBe('Unassigned');
  });

  it('filters cards by label', () => {
    const c1 = createCard(db, { title: 'A', created_by: 'alice' });
    const c2 = createCard(db, { title: 'B', created_by: 'alice' });
    addLabels(db, c1.id, ['backend']);
    addLabels(db, c2.id, ['frontend']);

    const backend = listCards(db, { label: 'backend' });
    expect(backend).toHaveLength(1);
    expect(backend[0].title).toBe('A');
  });

  it('updates a card', () => {
    const card = createCard(db, { title: 'Original', created_by: 'alice' });
    const updated = updateCard(db, card.id, { status: 'in_progress', title: 'Updated' });

    expect(updated.status).toBe('in_progress');
    expect(updated.title).toBe('Updated');
    expect(updated.updated_at).toBeTruthy();
  });

  it('updates card metadata', () => {
    const card = createCard(db, { title: 'Meta', created_by: 'alice' });
    const updated = updateCard(db, card.id, { metadata: { foo: 'bar' } });
    expect(updated.metadata).toEqual({ foo: 'bar' });
  });

  it('deletes a card and cascades', () => {
    const card = createCard(db, { title: 'Doomed', created_by: 'alice' });
    addLabels(db, card.id, ['test']);
    addComment(db, { card_id: card.id, author_kind: 'human', author_id: 'alice', content: 'hi' });
    createRun(db, { card_id: card.id, agent_name: 'bob' });
    createCheckpoint(db, { card_id: card.id, created_by: 'alice' });

    deleteCard(db, card.id);

    expect(getCard(db, card.id)).toBeNull();
    expect(getLabels(db, card.id)).toEqual([]);
    expect(listComments(db, card.id)).toEqual([]);
    expect(listRuns(db, card.id)).toEqual([]);
    expect(listCheckpoints(db, card.id)).toEqual([]);
  });

  it('returns null for nonexistent card', () => {
    expect(getCard(db, 'nope')).toBeNull();
  });
});

describe('labels', () => {
  it('adds and retrieves labels', () => {
    const card = createCard(db, { title: 'Labeled', created_by: 'alice' });
    addLabels(db, card.id, ['backend', 'urgent']);

    const labels = getLabels(db, card.id);
    expect(labels).toEqual(['backend', 'urgent']);
  });

  it('ignores duplicate labels', () => {
    const card = createCard(db, { title: 'Dup', created_by: 'alice' });
    addLabels(db, card.id, ['backend']);
    addLabels(db, card.id, ['backend', 'frontend']);

    expect(getLabels(db, card.id)).toEqual(['backend', 'frontend']);
  });

  it('removes a label', () => {
    const card = createCard(db, { title: 'Remove', created_by: 'alice' });
    addLabels(db, card.id, ['a', 'b', 'c']);
    removeLabel(db, card.id, 'b');

    expect(getLabels(db, card.id)).toEqual(['a', 'c']);
  });
});

describe('comments', () => {
  it('adds and lists comments in order', () => {
    const card = createCard(db, { title: 'Commented', created_by: 'alice' });

    const c1 = addComment(db, { card_id: card.id, author_kind: 'human', author_id: 'alice', content: 'hello' });
    const c2 = addComment(db, { card_id: card.id, author_kind: 'agent', author_id: 'bob', content: 'hi back' });

    expect(c1.author_kind).toBe('human');
    expect(c2.author_kind).toBe('agent');

    const comments = listComments(db, card.id);
    expect(comments).toHaveLength(2);
    expect(comments[0].content).toBe('hello');
    expect(comments[1].content).toBe('hi back');
  });

  it('links comment to a run', () => {
    const card = createCard(db, { title: 'Linked', created_by: 'alice' });
    const run = createRun(db, { card_id: card.id, agent_name: 'bob' });
    const comment = addComment(db, {
      card_id: card.id,
      author_kind: 'agent',
      author_id: 'bob',
      content: 'response',
      run_id: run.id,
    });

    expect(comment.run_id).toBe(run.id);
  });
});

describe('runs', () => {
  it('creates and retrieves a run', () => {
    const card = createCard(db, { title: 'Running', created_by: 'alice' });
    const run = createRun(db, { card_id: card.id, agent_name: 'bob' });

    expect(run.id).toBeTruthy();
    expect(run.card_id).toBe(card.id);
    expect(run.agent_name).toBe('bob');
    expect(run.status).toBe('created');
    expect(run.bridge_run_id).toBeNull();
  });

  it('updates run status and bridge run ID', () => {
    const card = createCard(db, { title: 'Update', created_by: 'alice' });
    const run = createRun(db, { card_id: card.id, agent_name: 'bob' });

    const updated = updateRun(db, run.id, {
      status: 'running',
      bridge_run_id: 'run-123',
    });

    expect(updated.status).toBe('running');
    expect(updated.bridge_run_id).toBe('run-123');
  });

  it('completes a run with finished_at', () => {
    const card = createCard(db, { title: 'Complete', created_by: 'alice' });
    const run = createRun(db, { card_id: card.id, agent_name: 'bob' });
    const ts = new Date().toISOString();

    const completed = updateRun(db, run.id, { status: 'completed', finished_at: ts });
    expect(completed.status).toBe('completed');
    expect(completed.finished_at).toBe(ts);
  });

  it('fails a run with error', () => {
    const card = createCard(db, { title: 'Fail', created_by: 'alice' });
    const run = createRun(db, { card_id: card.id, agent_name: 'bob' });

    const failed = updateRun(db, run.id, { status: 'failed', error: 'something broke' });
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('something broke');
  });

  it('lists runs for a card', () => {
    const card = createCard(db, { title: 'Multi', created_by: 'alice' });
    createRun(db, { card_id: card.id, agent_name: 'bob' });
    createRun(db, { card_id: card.id, agent_name: 'bob' });

    expect(listRuns(db, card.id)).toHaveLength(2);
  });

  it('lists active runs with bridge run IDs across all cards', () => {
    const card = createCard(db, { title: 'Active runs', created_by: 'alice' });
    const running = createRun(db, { card_id: card.id, agent_name: 'bob' });
    const awaiting = createRun(db, { card_id: card.id, agent_name: 'bob' });
    const completed = createRun(db, { card_id: card.id, agent_name: 'bob' });
    const runningWithoutBridgeRunId = createRun(db, { card_id: card.id, agent_name: 'bob' });

    updateRun(db, running.id, { status: 'running', bridge_run_id: 'bridge-running' });
    updateRun(db, awaiting.id, { status: 'awaiting', bridge_run_id: 'bridge-awaiting' });
    updateRun(db, completed.id, { status: 'completed', bridge_run_id: 'bridge-completed' });
    updateRun(db, runningWithoutBridgeRunId.id, { status: 'running' });

    db.prepare('UPDATE runs SET created_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', running.id);
    db.prepare('UPDATE runs SET created_at = ? WHERE id = ?').run('2026-01-01T00:00:01.000Z', awaiting.id);

    const activeRuns = listActiveRunsGlobal(db);
    expect(activeRuns.map((run) => run.id)).toEqual([running.id, awaiting.id]);
  });
});

describe('checkpoints', () => {
  it('creates a checkpoint with default values', () => {
    const card = createCard(db, { title: 'Checkpointed', created_by: 'alice' });
    const checkpoint = createCheckpoint(db, { card_id: card.id, created_by: 'alice' });

    expect(checkpoint.id).toBeTruthy();
    expect(checkpoint.card_id).toBe(card.id);
    expect(checkpoint.name).toBeNull();
    expect(checkpoint.turn_index).toBe(0);
    expect(checkpoint.git_ref).toBeNull();
    expect(checkpoint.created_by).toBe('alice');
    expect(checkpoint.created_at).toBeTruthy();
  });

  it('creates a checkpoint with name and git_ref', () => {
    const card = createCard(db, { title: 'Named checkpoint', created_by: 'alice' });
    const checkpoint = createCheckpoint(db, {
      card_id: card.id,
      created_by: 'alice',
      name: 'Before refactor',
      turn_index: 3,
      git_ref: 'abc123',
    });

    expect(checkpoint.name).toBe('Before refactor');
    expect(checkpoint.turn_index).toBe(3);
    expect(checkpoint.git_ref).toBe('abc123');
  });

  it('lists checkpoints for a card ordered by created_at ascending', () => {
    const card = createCard(db, { title: 'Ordered checkpoints', created_by: 'alice' });
    const otherCard = createCard(db, { title: 'Other checkpoints', created_by: 'alice' });
    const first = createCheckpoint(db, { card_id: card.id, created_by: 'alice', name: 'First' });
    const second = createCheckpoint(db, { card_id: card.id, created_by: 'alice', name: 'Second' });
    createCheckpoint(db, { card_id: otherCard.id, created_by: 'alice', name: 'Other' });

    db.prepare('UPDATE checkpoints SET created_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', first.id);
    db.prepare('UPDATE checkpoints SET created_at = ? WHERE id = ?').run('2026-01-01T00:00:01.000Z', second.id);

    const checkpoints = listCheckpoints(db, card.id);
    expect(checkpoints.map((checkpoint) => checkpoint.id)).toEqual([first.id, second.id]);
  });

  it('deletes a checkpoint', () => {
    const card = createCard(db, { title: 'Delete checkpoint', created_by: 'alice' });
    const checkpoint = createCheckpoint(db, { card_id: card.id, created_by: 'alice' });

    deleteCheckpoint(db, checkpoint.id);

    expect(listCheckpoints(db, card.id)).toEqual([]);
  });

  it('cascade-deletes checkpoints when card is deleted', () => {
    const card = createCard(db, { title: 'Cascade checkpoint', created_by: 'alice' });
    createCheckpoint(db, { card_id: card.id, created_by: 'alice' });

    deleteCard(db, card.id);

    expect(listCheckpoints(db, card.id)).toEqual([]);
  });
});
