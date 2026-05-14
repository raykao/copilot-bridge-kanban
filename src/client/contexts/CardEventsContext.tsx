import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export interface CardEventEnvelope<T = unknown> {
  card_id: string;
  data: T;
}

export type EnvelopeHandler = (eventName: string, envelope: CardEventEnvelope) => void;

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface CardEventsContextValue {
  status: ConnectionStatus;
  subscribe(cardId: string, handler: EnvelopeHandler): () => void;
}

const MAX_RECONNECT_ATTEMPTS = 8;

export const CARD_EVENT_NAMES = [
  'message.part',
  'message.completed',
  'run.text_delta',
  'run.queued',
  'run.in_progress',
  'run.status',
  'run.started',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.awaiting',
  'card.status',
  'card.updated',
  'tool.call',
  'tool.start',
  'tool.result',
  'tool.end',
  'heartbeat',
  'connected',
] as const;

type StatusListener = (status: ConnectionStatus) => void;
type EventSourceFactory = (url: string, eventSourceInitDict?: EventSourceInit) => EventSource;

function isEnvelope(value: unknown): value is CardEventEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { card_id?: unknown }).card_id === 'string' &&
    'data' in value
  );
}

export class CardEventStream {
  private readonly handlers = new Map<string, Set<EnvelopeHandler>>();
  private eventSource: EventSource | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private stopped = true;

  constructor(
    private readonly onStatusChange: StatusListener,
    private readonly eventSourceFactory: EventSourceFactory = (url, init) => new EventSource(url, init),
  ) {}

  start(): void {
    if (!this.stopped) {
      return;
    }

    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearReconnectTimer();
    this.cleanupEventSource();
  }

  subscribe(cardId: string, handler: EnvelopeHandler): () => void {
    let handlersForCard = this.handlers.get(cardId);
    if (!handlersForCard) {
      handlersForCard = new Set();
      this.handlers.set(cardId, handlersForCard);
    }

    handlersForCard.add(handler);

    return () => {
      const currentHandlers = this.handlers.get(cardId);
      if (!currentHandlers) {
        return;
      }

      currentHandlers.delete(handler);
      if (currentHandlers.size === 0) {
        this.handlers.delete(cardId);
      }
    };
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }

    this.cleanupEventSource();
    this.onStatusChange(this.reconnectAttempts === 0 ? 'connecting' : 'reconnecting');

    const eventSource = this.eventSourceFactory('/api/events', { withCredentials: true });
    this.eventSource = eventSource;

    for (const eventName of CARD_EVENT_NAMES) {
      eventSource.addEventListener(eventName, (event) => {
        this.dispatch(eventName, event);
      });
    }

    eventSource.onopen = () => {
      this.reconnectAttempts = 0;
      this.onStatusChange('connected');
    };

    eventSource.onerror = () => {
      this.cleanupEventSource();
      this.scheduleReconnect();
    };
  }

  private dispatch(eventName: string, event: MessageEvent): void {
    let envelope: unknown;
    try {
      envelope = JSON.parse(event.data as string);
    } catch (error) {
      console.warn('Ignoring malformed card event envelope', error);
      return;
    }

    if (!isEnvelope(envelope)) {
      return;
    }

    const handlersForCard = this.handlers.get(envelope.card_id);
    if (!handlersForCard) {
      return;
    }

    for (const handler of handlersForCard) {
      handler(eventName, envelope);
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) {
      return;
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.onStatusChange('disconnected');
      return;
    }

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts += 1;
    this.onStatusChange('reconnecting');
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private cleanupEventSource(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

const CardEventsContext = createContext<CardEventsContextValue | null>(null);

export function CardEventsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const stream = useMemo(() => new CardEventStream(setStatus), []);

  useEffect(() => {
    stream.start();

    return () => {
      stream.stop();
    };
  }, [stream]);

  const subscribe = useCallback(
    (cardId: string, handler: EnvelopeHandler) => stream.subscribe(cardId, handler),
    [stream],
  );

  const value = useMemo(() => ({ status, subscribe }), [status, subscribe]);

  return <CardEventsContext.Provider value={value}>{children}</CardEventsContext.Provider>;
}

export function useCardEventsContext(): CardEventsContextValue {
  const ctx = useContext(CardEventsContext);
  if (!ctx) {
    throw new Error('useCardEventsContext must be used inside CardEventsProvider');
  }

  return ctx;
}
