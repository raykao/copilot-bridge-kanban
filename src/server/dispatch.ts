import type Database from 'better-sqlite3';
import type { AppConfig } from './config.js';
import { updateRun } from './cards.js';

export interface DispatchOptions {
  bot: string;
  prompt: string;
  cardId: string;
  runId: string;
}

export interface DispatchResult {
  ok: boolean;
  bridgeRunId?: string;
  error?: string;
}

/**
 * Dispatch a prompt to the bridge ACP runs endpoint.
 */
export async function dispatchToBridge(
  config: AppConfig,
  db: Database.Database,
  opts: DispatchOptions,
): Promise<DispatchResult> {
  const body = {
    bot: opts.bot,
    channel_id: opts.cardId,
    prompt: opts.prompt,
  };

  try {
    const res = await fetch(`${config.bridgeApiUrl}/v1/runs`, {
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

    const result = (await res.json()) as { run_id: string; status: string };

    updateRun(db, opts.runId, {
      status: 'running',
      bridge_run_id: result.run_id,
    });

    return { ok: true, bridgeRunId: result.run_id };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    updateRun(db, opts.runId, { status: 'failed', error: message });
    return { ok: false, error: message };
  }
}
