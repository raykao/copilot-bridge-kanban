import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { validateAgentTokenForCard } from './agent-tokens.js';
import { getCard, getRunByBridgeRunId, updateRun, addComment } from './cards.js';
import type { Run } from './cards.js';
import type { SseManager } from './sse.js';

interface CallbackParams { cardId: string; bot: string }

type RunStatus = Run['status'];

interface StatusTarget {
  status: RunStatus;
  terminal: boolean;
  copyError: boolean;
}

const statusMap: Record<string, StatusTarget> = {
  submitted: { status: 'created', terminal: false, copyError: false },
  working: { status: 'running', terminal: false, copyError: false },
  'input-required': { status: 'awaiting', terminal: false, copyError: false },
  completed: { status: 'completed', terminal: true, copyError: false },
  failed: { status: 'failed', terminal: true, copyError: true },
  canceled: { status: 'cancelled', terminal: true, copyError: true },
};

export function registerPushCallbackRoutes(
  app: FastifyInstance,
  db: Database.Database,
  sseManager: SseManager,
): void {
  app.post<{ Params: CallbackParams; Body: any }>(
    '/api/internal/push-callback/:cardId/:bot',
    async (request, reply) => {
      const { cardId, bot } = request.params;
      const auth = request.headers.authorization ?? '';
      const m = auth.match(/^Bearer\s+(.+)$/);
      if (!m) return reply.status(401).send({ error: 'Missing bearer token' });
      const token = m[1];

      if (!validateAgentTokenForCard(db, token, cardId, bot)) {
        return reply.status(401).send({ error: 'Invalid token' });
      }

      const card = getCard(db, cardId);
      if (!card) return reply.status(404).send({ error: 'Card not found' });

      const event = request.body;
      if (!event || typeof event !== 'object') {
        return reply.status(200).send({});
      }
      const kind = (event as { kind?: unknown }).kind;

      try {
        if (kind === 'task') {
          // No-op - initial frame; onReady on the kanban side already updated the run.
        } else if (kind === 'status-update') {
          handleStatusUpdate(db, sseManager, card.id, event);
        } else if (kind === 'artifact-update') {
          handleArtifactUpdate(db, sseManager, card.id, bot, event);
        }
      } catch (err) {
        request.log.error({ err, cardId, bot }, 'push-callback handler error');
      }

      return reply.status(200).send({});
    },
  );
}

function getTextError(event: unknown): string | null {
  const parts = (event as { status?: { message?: { parts?: unknown } } }).status?.message?.parts;
  if (!Array.isArray(parts)) return null;

  const textPart = parts.find((part) => {
    const p = part as { kind?: unknown; text?: unknown };
    return p.kind === 'text' && typeof p.text === 'string';
  }) as { text: string } | undefined;

  return textPart?.text ?? null;
}

function handleStatusUpdate(db: Database.Database, sseManager: SseManager, cardId: string, event: unknown): void {
  const taskId = (event as { taskId?: unknown }).taskId;
  if (typeof taskId !== 'string') return;

  const state = (event as { status?: { state?: unknown } }).status?.state;
  if (typeof state !== 'string') return;

  const target = statusMap[state];
  if (!target) return;

  const run = getRunByBridgeRunId(db, taskId);
  if (!run || run.card_id !== cardId) return;

  const patch: Partial<Run> = { status: target.status };
  if (target.terminal) {
    patch.finished_at = new Date().toISOString();
  }
  if (target.copyError) {
    patch.error = getTextError(event);
  }

  updateRun(db, run.id, patch);
  sseManager.emit(cardId, `run.${target.status === 'cancelled' ? 'failed' : target.status}`, {});
}

function handleArtifactUpdate(
  db: Database.Database,
  sseManager: SseManager,
  cardId: string,
  bot: string,
  event: unknown,
): void {
  const taskId = (event as { taskId?: unknown }).taskId;
  if (typeof taskId !== 'string') return;

  if ((event as { lastChunk?: unknown }).lastChunk !== true) return;

  const parts = (event as { artifact?: { parts?: unknown } }).artifact?.parts;
  if (!Array.isArray(parts)) return;

  const text = parts
    .map((part) => {
      const p = part as { kind?: unknown; text?: unknown };
      return p.kind === 'text' && typeof p.text === 'string' ? p.text : '';
    })
    .join('');
  if (text === '') return;

  const run = getRunByBridgeRunId(db, taskId);
  if (!run || run.card_id !== cardId) return;

  const dup = db.prepare(
    "SELECT 1 FROM card_comments WHERE run_id = ? AND author_kind = 'agent' AND content = ? LIMIT 1",
  ).get(run.id, text);
  if (dup) return;

  const comment = addComment(db, { card_id: cardId, author_kind: 'agent', author_id: bot, content: text, run_id: run.id });
  sseManager.emit(cardId, 'comment.created', comment);
}
