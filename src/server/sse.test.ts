import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import http from 'node:http';
import type { AppConfig } from './config.js';
import { createUser, registerAuthRoutes, registerSessionMiddleware } from './auth.js';
import { createDatabase, initializeSchema } from './db.js';
import { createServer } from './server.js';
import { registerCardRoutes } from './card-routes.js';
import { createCard } from './cards.js';
import { SseManager } from './sse.js';

const config: AppConfig = {
  port: 0, // random port
  bridgeApiUrl: 'http://localhost:7878',
  bridgeApiKey: 'test-bridge-key',
  sessionSecret: 'secret',
  dbPath: ':memory:',
  logLevel: 'silent',
};

// ---------------------------------------------------------------------------
// SseManager unit tests
// ---------------------------------------------------------------------------

describe('SseManager', () => {
  let manager: SseManager;

  beforeEach(() => {
    manager = new SseManager();
  });

  afterEach(() => {
    manager.shutdown();
  });

  it('subscribe and emit delivers SSE frame', () => {
    const chunks: string[] = [];
    const fakeRaw = {
      writableEnded: false,
      write: (data: string) => { chunks.push(data); return true; },
      on: vi.fn(),
      end: vi.fn(),
    } as any;

    manager.subscribe('card-1', fakeRaw);
    expect(manager.subscriberCount('card-1')).toBe(1);

    manager.emit('card-1', 'comment.created', { id: 'c1', content: 'hello' });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('event: comment.created');
    expect(chunks[0]).toContain('"id":"c1"');
  });

  it('emit to multiple subscribers on same card', () => {
    const chunks1: string[] = [];
    const chunks2: string[] = [];

    const raw1 = {
      writableEnded: false,
      write: (data: string) => { chunks1.push(data); return true; },
      on: vi.fn(),
      end: vi.fn(),
    } as any;

    const raw2 = {
      writableEnded: false,
      write: (data: string) => { chunks2.push(data); return true; },
      on: vi.fn(),
      end: vi.fn(),
    } as any;

    manager.subscribe('card-1', raw1);
    manager.subscribe('card-1', raw2);
    expect(manager.subscriberCount('card-1')).toBe(2);

    manager.emit('card-1', 'test', { ok: true });
    expect(chunks1).toHaveLength(1);
    expect(chunks2).toHaveLength(1);
  });

  it('emit to card with no subscribers is a no-op', () => {
    // Should not throw
    manager.emit('nonexistent', 'test', { ok: true });
    expect(manager.cardCount).toBe(0);
  });

  it('unsubscribe removes client and cleans up empty sets', () => {
    const raw = {
      writableEnded: false,
      write: vi.fn(),
      on: vi.fn(),
      end: vi.fn(),
    } as any;

    manager.subscribe('card-1', raw);
    expect(manager.cardCount).toBe(1);

    manager.unsubscribe('card-1', raw);
    expect(manager.cardCount).toBe(0);
  });

  it('auto-unsubscribes on connection close', () => {
    let closeHandler: (() => void) | undefined;
    const raw = {
      writableEnded: false,
      write: vi.fn(),
      on: (event: string, cb: () => void) => {
        if (event === 'close') closeHandler = cb;
      },
      end: vi.fn(),
    } as any;

    manager.subscribe('card-1', raw);
    expect(manager.subscriberCount('card-1')).toBe(1);

    // Simulate connection close
    closeHandler!();
    expect(manager.subscriberCount('card-1')).toBe(0);
    expect(manager.cardCount).toBe(0);
  });

  it('shutdown clears all connections', () => {
    const raw1 = {
      writableEnded: false,
      write: vi.fn(),
      on: vi.fn(),
      end: vi.fn(),
    } as any;
    const raw2 = {
      writableEnded: false,
      write: vi.fn(),
      on: vi.fn(),
      end: vi.fn(),
    } as any;

    manager.subscribe('card-1', raw1);
    manager.subscribe('card-2', raw2);
    expect(manager.cardCount).toBe(2);

    manager.shutdown();
    expect(manager.cardCount).toBe(0);
    expect(raw1.end).toHaveBeenCalled();
    expect(raw2.end).toHaveBeenCalled();
  });

  it('heartbeat writes comment to all connections', () => {
    vi.useFakeTimers();
    const chunks: string[] = [];
    const raw = {
      writableEnded: false,
      write: (data: string) => { chunks.push(data); return true; },
      on: vi.fn(),
      end: vi.fn(),
    } as any;

    manager.subscribe('card-1', raw);
    manager.startHeartbeat(1000);

    vi.advanceTimersByTime(1000);
    expect(chunks).toContain(':heartbeat\n\n');

    manager.shutdown();
    vi.useRealTimers();
  });

  it('does not write to ended responses', () => {
    const raw = {
      writableEnded: true,
      write: vi.fn(),
      on: vi.fn(),
      end: vi.fn(),
    } as any;

    manager.subscribe('card-1', raw);
    manager.emit('card-1', 'test', { ok: true });
    expect(raw.write).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Integration tests (real HTTP connections for SSE streaming)
// ---------------------------------------------------------------------------

describe('SSE integration', () => {
  const apps: Array<{ db: Database.Database; server: FastifyInstance; sseManager: SseManager }> = [];

  afterEach(async () => {
    for (const { db, server, sseManager } of apps.splice(0)) {
      sseManager.shutdown();
      await server.close();
      db.close();
    }
  });

  async function createTestApp(): Promise<{
    db: Database.Database;
    server: FastifyInstance;
    sseManager: SseManager;
    address: string;
    sessionCookie: string;
  }> {
    const db = createDatabase(':memory:');
    initializeSchema(db);

    const sseManager = new SseManager();
    const server = await createServer(config);
    registerSessionMiddleware(server, db);
    registerAuthRoutes(server, db);
    registerCardRoutes(server, db, config, sseManager);

    await createUser(db, 'alice', 'password');

    // Listen on random port
    const address = await server.listen({ host: '127.0.0.1', port: 0 });

    // Get session cookie via login
    const loginRes = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'password' },
    });
    const cookie = loginRes.headers['set-cookie'] as string;

    apps.push({ db, server, sseManager });
    return { db, server, sseManager, address, sessionCookie: cookie };
  }

  /**
   * Helper: open an SSE connection via raw HTTP and collect events.
   * Returns a promise that resolves with events after the connection is closed or
   * after a timeout. Use `close()` to end the connection early.
   */
  function connectSSE(
    address: string,
    cardId: string,
    cookie: string,
  ): { events: Array<{ event: string; data: string }>; close: () => void; waitForEvents: (n: number, timeoutMs?: number) => Promise<void> } {
    const events: Array<{ event: string; data: string }> = [];
    const url = new URL(`/api/cards/${cardId}/events`, address);

    const req = http.get(url.href, { headers: { cookie } }, (res) => {
      let buffer = '';
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        // Parse SSE frames
        const parts = buffer.split('\n\n');
        buffer = parts.pop()!; // keep incomplete frame in buffer
        for (const part of parts) {
          if (!part.trim()) continue;
          const lines = part.split('\n');
          let event = '';
          let data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7);
            else if (line.startsWith('data: ')) data = line.slice(6);
            else if (line.startsWith(':')) continue; // comment (heartbeat)
          }
          if (event) events.push({ event, data });
        }
      });
    });

    const close = () => { req.destroy(); };

    const waitForEvents = (n: number, timeoutMs = 2000): Promise<void> => {
      return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
          if (events.length >= n) return resolve();
          if (Date.now() - start > timeoutMs) return reject(new Error(`Timeout waiting for ${n} events, got ${events.length}`));
          setTimeout(check, 50);
        };
        check();
      });
    };

    return { events, close, waitForEvents };
  }

  it('returns 404 for SSE on nonexistent card', async () => {
    const { server, sessionCookie } = await createTestApp();

    const res = await server.inject({
      method: 'GET',
      url: '/api/cards/nonexistent/events',
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('sends connected event on SSE subscribe', async () => {
    const { db, address, sessionCookie } = await createTestApp();
    const card = createCard(db, { title: 'Test', created_by: 'alice' });

    const sse = connectSSE(address, card.id, sessionCookie);
    try {
      await sse.waitForEvents(1);
      expect(sse.events[0].event).toBe('connected');
      expect(JSON.parse(sse.events[0].data).card_id).toBe(card.id);
    } finally {
      sse.close();
    }
  });

  it('delivers card.updated event on PATCH', async () => {
    const { db, server, address, sessionCookie } = await createTestApp();
    const card = createCard(db, { title: 'Test', created_by: 'alice' });

    const sse = connectSSE(address, card.id, sessionCookie);
    try {
      await sse.waitForEvents(1); // connected

      await server.inject({
        method: 'PATCH',
        url: `/api/cards/${card.id}`,
        headers: { cookie: sessionCookie },
        payload: { status: 'in_progress' },
      });

      await sse.waitForEvents(2);
      const cardEvent = sse.events.find((e) => e.event === 'card.updated');
      expect(cardEvent).toBeDefined();
      expect(JSON.parse(cardEvent!.data).status).toBe('in_progress');
    } finally {
      sse.close();
    }
  });

  it('delivers comment.created event on POST comment', async () => {
    const { db, server, address, sessionCookie } = await createTestApp();
    const card = createCard(db, { title: 'Test', created_by: 'alice' });

    const sse = connectSSE(address, card.id, sessionCookie);
    try {
      await sse.waitForEvents(1); // connected

      await server.inject({
        method: 'POST',
        url: `/api/cards/${card.id}/comments`,
        headers: { cookie: sessionCookie },
        payload: { content: 'User comment' },
      });

      await sse.waitForEvents(2);
      const commentEvent = sse.events.find((e) => e.event === 'comment.created');
      expect(commentEvent).toBeDefined();
      expect(JSON.parse(commentEvent!.data).content).toBe('User comment');
    } finally {
      sse.close();
    }
  });

  it('delivers labels.updated event on label add', async () => {
    const { db, server, address, sessionCookie } = await createTestApp();
    const card = createCard(db, { title: 'Test', created_by: 'alice' });

    const sse = connectSSE(address, card.id, sessionCookie);
    try {
      await sse.waitForEvents(1); // connected

      await server.inject({
        method: 'POST',
        url: `/api/cards/${card.id}/labels`,
        headers: { cookie: sessionCookie },
        payload: { labels: ['urgent', 'bug'] },
      });

      await sse.waitForEvents(2);
      const labelEvent = sse.events.find((e) => e.event === 'labels.updated');
      expect(labelEvent).toBeDefined();
      const data = JSON.parse(labelEvent!.data);
      expect(data.labels).toContain('urgent');
      expect(data.labels).toContain('bug');
    } finally {
      sse.close();
    }
  });

  it('cleans up subscriber on disconnect', async () => {
    const { db, sseManager, address, sessionCookie } = await createTestApp();
    const card = createCard(db, { title: 'Test', created_by: 'alice' });

    const sse = connectSSE(address, card.id, sessionCookie);
    await sse.waitForEvents(1); // connected

    expect(sseManager.subscriberCount(card.id)).toBe(1);

    sse.close();

    // Wait for cleanup
    await new Promise((r) => setTimeout(r, 200));
    expect(sseManager.subscriberCount(card.id)).toBe(0);
  });
});
