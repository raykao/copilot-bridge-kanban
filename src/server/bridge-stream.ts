export type BridgeEventType =
  | 'run.queued'
  | 'run.created'
  | 'run.in_progress'
  | 'run.awaiting'
  | 'run.completed'
  | 'run.failed'
  | 'message.part'
  | 'message.completed'
  | 'tool.start'
  | 'tool.end';

export interface BridgeEvent {
  type: BridgeEventType;
  data: Record<string, unknown>;
}

export interface BridgeStreamOptions {
  bridgeApiUrl: string;
  bridgeApiKey: string;
  /** Logical request id; sent as A2A messageId on the wire. */
  runId: string;
  bot: string;
  prompt: string;
  cardId: string;
  messageId?: string;
  onEvent: (event: BridgeEvent) => void;
  onClose: () => void;
  /** Called with the bridge task id when the first `task` SSE frame is received. */
  onReady?: (bridgeRunId: string) => void;
  /** Called when the stream fails (non-ok response or thrown exception). status=0 means exception. */
  onError?: (status: number, body: string) => void;
}

const bridgeEventTypes = new Set<string>([
  'run.queued',
  'run.created',
  'run.in_progress',
  'run.awaiting',
  'run.completed',
  'run.failed',
  'message.part',
  'message.completed',
  'tool.start',
  'tool.end',
]);

function isBridgeEventType(value: string): value is BridgeEventType {
  return bridgeEventTypes.has(value);
}

function parseData(dataLines: string[]): Record<string, unknown> {
  const raw = dataLines.join('\n');
  if (raw === '') return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed JSON and use the default empty payload.
  }

  return {};
}

function textFromParts(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .filter((part): part is { kind: string; text: string } => {
      return Boolean(part)
        && typeof part === 'object'
        && 'kind' in part
        && 'text' in part
        && (part as { kind?: unknown }).kind === 'text'
        && typeof (part as { text?: unknown }).text === 'string';
    })
    .map((part) => part.text)
    .join('');
}

function mapA2AEvent(eventType: string, data: Record<string, unknown>): BridgeEvent | null {
  if (eventType === 'task') {
    if (data.kind !== 'task' || typeof data.id !== 'string') return null;
    return { type: 'run.created', data: { run_id: data.id } };
  }

  if (eventType === 'status-update') {
    if (typeof data.taskId !== 'string') return null;
    const status = data.status;
    if (!status || typeof status !== 'object' || Array.isArray(status)) return null;

    const state = (status as { state?: unknown }).state;
    if (typeof state !== 'string') return null;

    if (state === 'working') {
      return { type: 'run.in_progress', data: { run_id: data.taskId } };
    }
    if (state === 'input-required') {
      return { type: 'run.awaiting', data: { run_id: data.taskId } };
    }
    if (state === 'completed') {
      return { type: 'run.completed', data: { run_id: data.taskId } };
    }
    if (state === 'failed') {
      const message = (status as { message?: unknown }).message;
      const parts = message && typeof message === 'object' && !Array.isArray(message)
        ? (message as { parts?: unknown }).parts
        : undefined;
      return { type: 'run.failed', data: { run_id: data.taskId, error: textFromParts(parts) } };
    }
    if (state === 'canceled') {
      return { type: 'run.failed', data: { run_id: data.taskId, error: 'cancelled' } };
    }

    return null;
  }

  if (eventType === 'artifact-update') {
    const artifact = data.artifact;
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return null;
    const content = textFromParts((artifact as { parts?: unknown }).parts);
    const type = data.lastChunk === true ? 'message.completed' : 'message.part';
    return { type, data: { role: 'agent', content } };
  }

  if (!isBridgeEventType(eventType)) return null;
  return { type: eventType, data };
}

function parseFrame(frame: string): BridgeEvent | null {
  if (frame.trim() === '') return null;

  const lines = frame.split(/\r?\n/);
  let eventType: string | null = null;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventType = line.slice('event:'.length).trimStart();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  if (!eventType) return null;

  return mapA2AEvent(eventType, parseData(dataLines));
}

/** Subscribe to the bridge SSE stream for a run. Returns a cancel function that terminates the stream. */
export function subscribeToBridgeRunStream(opts: BridgeStreamOptions): () => void {
  const controller = new AbortController();
  let closed = false;

  const closeOnce = () => {
    if (closed) return;
    closed = true;
    opts.onClose();
  };

  void (async () => {
    try {
      const base = opts.bridgeApiUrl.endsWith('/') ? opts.bridgeApiUrl : `${opts.bridgeApiUrl}/`;
      const url = new URL(`agents/${encodeURIComponent(opts.bot)}/message:stream`, base);
      const body = {
        message: {
          role: 'user' as const,
          parts: [{ kind: 'text' as const, text: opts.prompt }],
          messageId: opts.messageId ?? opts.runId,
          contextId: opts.cardId,
        },
      };
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.bridgeApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'unknown error');
        opts.onError?.(response.status, errorBody);
        closeOnce();
        return;
      }

      if (!response.body) {
        closeOnce();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const event = parseFrame(frame);
          if (!event) continue;

          if (event.type === 'run.created' && opts.onReady) {
            opts.onReady(event.data.run_id as string);
          }

          opts.onEvent(event);
          if (event.type === 'run.completed' || event.type === 'run.failed') {
            closeOnce();
            return;
          }
        }
      }

      closeOnce();
    } catch (err) {
      opts.onError?.(0, err instanceof Error ? err.message : 'unknown error');
      closeOnce();
    }
  })();

  return () => {
    controller.abort();
  };
}
