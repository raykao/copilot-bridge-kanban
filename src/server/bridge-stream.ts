export type BridgeEventType =
  | 'run.queued'
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
  runId: string;
  onEvent: (event: BridgeEvent) => void;
  onClose: () => void;
}

const bridgeEventTypes = new Set<string>([
  'run.queued',
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

  if (!eventType || !isBridgeEventType(eventType)) return null;

  return {
    type: eventType,
    data: parseData(dataLines),
  };
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
      const url = new URL(`v1/runs/${encodeURIComponent(opts.runId)}/stream`, base);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${opts.bridgeApiKey}` },
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
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

          opts.onEvent(event);
          if (event.type === 'run.completed' || event.type === 'run.failed') {
            closeOnce();
            return;
          }
        }
      }

      closeOnce();
    } catch {
      closeOnce();
    }
  })();

  return () => {
    controller.abort();
  };
}
