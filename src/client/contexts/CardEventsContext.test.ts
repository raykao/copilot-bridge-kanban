import { describe, expect, it, vi } from 'vitest';

import { CardEventStream } from './CardEventsContext';
import type { ConnectionStatus } from './CardEventsContext';

class MockEventSource {
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {}

  addEventListener(eventName: string, listener: (event: MessageEvent) => void): void {
    let listenersForEvent = this.listeners.get(eventName);
    if (!listenersForEvent) {
      listenersForEvent = new Set();
      this.listeners.set(eventName, listenersForEvent);
    }

    listenersForEvent.add(listener);
  }

  close(): void {
    this.closed = true;
  }

  emit(eventName: string, data: unknown): void {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener(event);
    }
  }
}

function createStream() {
  const sources: MockEventSource[] = [];
  const statuses: ConnectionStatus[] = [];
  const stream = new CardEventStream(
    (status) => statuses.push(status),
    (url, init) => {
      const source = new MockEventSource(url, init);
      sources.push(source);
      return source as unknown as EventSource;
    },
  );

  return { sources, statuses, stream };
}

describe('CardEventStream', () => {
  it('opens an EventSource on start and closes it on stop', () => {
    const { sources, statuses, stream } = createStream();

    stream.start();

    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe('/api/events');
    expect(sources[0].init).toEqual({ withCredentials: true });
    expect(statuses).toEqual(['connecting']);

    sources[0].onopen?.(new Event('open'));
    expect(statuses).toEqual(['connecting', 'connected']);

    stream.stop();

    expect(sources[0].closed).toBe(true);
  });

  it('delivers events for a subscribed card and unsubscribes cleanly', () => {
    const { sources, stream } = createStream();
    const handler = vi.fn();

    stream.start();
    const unsubscribe = stream.subscribe('card-1', handler);
    sources[0].emit('message.part', { card_id: 'card-1', data: { content: 'hello' } });

    expect(handler).toHaveBeenCalledWith('message.part', {
      card_id: 'card-1',
      data: { content: 'hello' },
    });

    unsubscribe();
    sources[0].emit('message.part', { card_id: 'card-1', data: { content: 'again' } });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not deliver events for other cards', () => {
    const { sources, stream } = createStream();
    const handler = vi.fn();

    stream.start();
    stream.subscribe('card-1', handler);
    sources[0].emit('message.part', { card_id: 'card-2', data: { content: 'hello' } });

    expect(handler).not.toHaveBeenCalled();
  });

  it('delivers events to multiple subscribers for the same card', () => {
    const { sources, stream } = createStream();
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();

    stream.start();
    stream.subscribe('card-1', firstHandler);
    stream.subscribe('card-1', secondHandler);
    sources[0].emit('tool.call', { card_id: 'card-1', data: { id: 'tool-1' } });

    expect(firstHandler).toHaveBeenCalledWith('tool.call', {
      card_id: 'card-1',
      data: { id: 'tool-1' },
    });
    expect(secondHandler).toHaveBeenCalledWith('tool.call', {
      card_id: 'card-1',
      data: { id: 'tool-1' },
    });
  });
});
