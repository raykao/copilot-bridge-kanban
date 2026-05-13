import type Database from 'better-sqlite3';
import type { AppConfig } from './config.js';
import { updateRun } from './cards.js';

export interface DispatchOptions {
  bot: string;
  prompt: string;
  cardId: string;
  runId: string;
  messageId?: string;
}

export interface DispatchResult {
  ok: boolean;
  bridgeRunId?: string;
  error?: string;
}

interface A2ATaskResponse {
  id?: unknown;
  contextId?: unknown;
  kind?: unknown;
}

/**
 * Dispatch a prompt to the bridge A2A message endpoint.
 */
export async function dispatchToBridge(
  config: AppConfig,
  db: Database.Database,
  opts: DispatchOptions,
): Promise<DispatchResult> {
  const body = {
    message: {
      role: 'user' as const,
      parts: [{ kind: 'text' as const, text: opts.prompt }],
      messageId: opts.messageId ?? opts.runId,
      contextId: opts.cardId,
    },
  };

  try {
    const res = await fetch(`${config.bridgeApiUrl}/agents/${encodeURIComponent(opts.bot)}/message:send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.bridgeApiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => 'unknown error');
      const message = `Bridge returned ${res.status}: ${errorBody}`;
      updateRun(db, opts.runId, { status: 'failed', error: message });
      return { ok: false, error: message };
    }

    const task = (await res.json()) as A2ATaskResponse;
    if (task.kind !== 'task' || typeof task.id !== 'string') {
      const message = 'Bridge returned malformed task response';
      updateRun(db, opts.runId, { status: 'failed', error: message });
      return { ok: false, error: message };
    }

    updateRun(db, opts.runId, {
      status: 'running',
      bridge_run_id: task.id,
    });

    return { ok: true, bridgeRunId: task.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    updateRun(db, opts.runId, { status: 'failed', error: message });
    return { ok: false, error: message };
  }
}
