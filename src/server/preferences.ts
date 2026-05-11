import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';

export function registerPreferencesRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get('/api/prefs', async (request, reply) => {
    const userId = request.user!.id;
    const row = db
      .prepare('SELECT data FROM preferences WHERE user_id = ?')
      .get(userId) as { data: string } | undefined;
    const preferences = row ? (JSON.parse(row.data) as Record<string, unknown>) : {};

    return reply.send({ preferences });
  });

  app.put('/api/prefs', async (request, reply) => {
    const userId = request.user!.id;
    const incoming = request.body as Record<string, unknown>;
    const now = new Date().toISOString();

    const existing = db
      .prepare('SELECT data FROM preferences WHERE user_id = ?')
      .get(userId) as { data: string } | undefined;
    const merged = {
      ...(existing ? (JSON.parse(existing.data) as Record<string, unknown>) : {}),
      ...incoming,
    };

    db.prepare(
      `INSERT INTO preferences (user_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET data = ?, updated_at = ?`,
    ).run(userId, JSON.stringify(merged), now, JSON.stringify(merged), now);

    return reply.send({ preferences: merged });
  });
}
