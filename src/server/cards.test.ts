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

    deleteCard(db, card.id);

    expect(getCard(db, card.id)).toBeNull();
    expect(getLabels(db, card.id)).toEqual([]);
    expect(listComments(db, card.id)).toEqual([]);
    expect(listRuns(db, card.id)).toEqual([]);
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
    expect(run.bridge_session_id).toBeNull();
  });

  it('updates run status and session ID', () => {
    const card = createCard(db, { title: 'Update', created_by: 'alice' });
    const run = createRun(db, { card_id: card.id, agent_name: 'bob' });

    const updated = updateRun(db, run.id, {
      status: 'in_progress',
      bridge_session_id: 'session-123',
    });

    expect(updated.status).toBe('in_progress');
    expect(updated.bridge_session_id).toBe('session-123');
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
});
