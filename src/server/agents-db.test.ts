import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createAgent, deleteAgent, getAgent, getAgentByName, listAgents, updateAgent } from './agents-db.js';
import { createDatabase, initializeSchema } from './db.js';

let db: Database.Database;

beforeEach(() => {
  db = createDatabase(':memory:');
  initializeSchema(db);
});

describe('agents-db', () => {
  it('creates and retrieves an agent', () => {
    const agent = createAgent(db, { name: 'bob', url: 'ws://localhost:3030/bob' });
    expect(agent.id).toBeTruthy();
    expect(agent.name).toBe('bob');
    expect(agent.protocol).toBe('acp');
    expect(agent.url).toBe('ws://localhost:3030/bob');
    expect(agent.auto_approve).toBe(false);
    expect(agent.created_at).toBeTruthy();

    const fetched = getAgent(db, agent.id);
    expect(fetched).toEqual(agent);
  });

  it('getAgentByName returns null for unknown name', () => {
    expect(getAgentByName(db, 'nobody')).toBeNull();
  });

  it('getAgentByName finds by name', () => {
    const agent = createAgent(db, { name: 'alice', url: 'ws://localhost:3031/alice' });
    expect(getAgentByName(db, 'alice')).toEqual(agent);
  });

  it('listAgents returns all agents ordered by name', () => {
    createAgent(db, { name: 'zed', url: 'ws://localhost:3032/zed' });
    createAgent(db, { name: 'alice', url: 'ws://localhost:3031/alice' });
    const list = listAgents(db);
    expect(list.map((a) => a.name)).toEqual(['alice', 'zed']);
  });

  it('auto_approve round-trips correctly', () => {
    const a = createAgent(db, { name: 'bot', url: 'ws://localhost:3030/bot', auto_approve: true });
    expect(a.auto_approve).toBe(true);
    const b = createAgent(db, { name: 'bot2', url: 'ws://localhost:3030/bot2', auto_approve: false });
    expect(b.auto_approve).toBe(false);
  });

  it('updateAgent patches fields', () => {
    const agent = createAgent(db, { name: 'bob', url: 'ws://localhost:3030/bob' });
    const updated = updateAgent(db, agent.id, { url: 'ws://localhost:9999/bob', auto_approve: true });
    expect(updated.url).toBe('ws://localhost:9999/bob');
    expect(updated.auto_approve).toBe(true);
    expect(updated.name).toBe('bob');
  });

  it('updateAgent throws if agent not found', () => {
    expect(() => updateAgent(db, 'nonexistent', { url: 'ws://x' })).toThrow();
  });

  it('deleteAgent removes the agent', () => {
    const agent = createAgent(db, { name: 'bob', url: 'ws://localhost:3030/bob' });
    deleteAgent(db, agent.id);
    expect(getAgent(db, agent.id)).toBeNull();
  });

  it('deleteAgent is a no-op for unknown id', () => {
    expect(() => deleteAgent(db, 'nonexistent')).not.toThrow();
  });
});
