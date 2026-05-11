import type Database from 'better-sqlite3';
import type { AppConfig } from './config.js';
import { updateRun } from './cards.js';

export interface DispatchOptions {
  bot: string;
  prompt: string;
  cardId: string;
  runId: string;
  sessionId?: string;
}

export interface DispatchResult {
  ok: boolean;
  session_id?: string;
  error?: string;
}

/**
 * Dispatch a prompt to the bridge's agent execution endpoint.
 * The bridge will POST the agent's response to our callback URL.
 */
export async function dispatchToBridge(
  config: AppConfig,
  db: Database.Database,
  opts: DispatchOptions,
): Promise<DispatchResult> {
  const callbackUrl = `${config.kanbanBaseUrl}/api/internal/cards/${opts.cardId}/agent-response`;

  const body = {
    bot: opts.bot,
    prompt: opts.prompt,
    channel_id: opts.cardId,
    callback_url: callbackUrl,
    ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
  };

  try {
    const res = await fetch(`${config.bridgeApiUrl}/v1/agent/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.bridgeApiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => 'unknown error');
      updateRun(db, opts.runId, { status: 'failed', error: `Bridge returned ${res.status}: ${errorBody}` });
      return { ok: false, error: `Bridge returned ${res.status}` };
    }

    const result = (await res.json()) as { run_id?: string; session_id?: string };

    updateRun(db, opts.runId, {
      status: 'running',
      bridge_session_id: result.session_id ?? null,
    });

    return { ok: true, session_id: result.session_id };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    updateRun(db, opts.runId, { status: 'failed', error: `Dispatch failed: ${message}` });
    return { ok: false, error: message };
  }
}
