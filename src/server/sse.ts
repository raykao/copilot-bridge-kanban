import type { ServerResponse } from 'node:http';

/**
 * In-memory pub/sub for card-level SSE connections.
 * Tracks ServerResponse objects per card ID and writes SSE frames to them.
 */
export class SseManager {
  private clients = new Map<string, Set<ServerResponse>>();
  private globalClients = new Set<ServerResponse>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  subscribe(cardId: string, raw: ServerResponse): void {
    let set = this.clients.get(cardId);
    if (!set) {
      set = new Set();
      this.clients.set(cardId, set);
    }
    set.add(raw);

    raw.on('close', () => {
      this.unsubscribe(cardId, raw);
    });
  }

  unsubscribe(cardId: string, raw: ServerResponse): void {
    const set = this.clients.get(cardId);
    if (!set) return;
    set.delete(raw);
    if (set.size === 0) {
      this.clients.delete(cardId);
    }
  }

  subscribeGlobal(raw: ServerResponse): void {
    this.globalClients.add(raw);

    raw.on('close', () => {
      this.unsubscribeGlobal(raw);
    });
  }

  unsubscribeGlobal(raw: ServerResponse): void {
    this.globalClients.delete(raw);
  }

  emit(cardId: string, event: string, data: object): void {
    const set = this.clients.get(cardId);
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

    if (set && set.size > 0) {
      for (const raw of set) {
        if (!raw.writableEnded) {
          raw.write(frame);
        }
      }
    }

    const envelope = JSON.stringify({ card_id: cardId, data });
    const globalFrame = `event: ${event}\ndata: ${envelope}\n\n`;

    for (const raw of this.globalClients) {
      if (!raw.writableEnded) {
        raw.write(globalFrame);
      }
    }
  }

  emitGlobal(event: string, data: object): void {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const raw of this.globalClients) {
      if (!raw.writableEnded) raw.write(frame);
    }
  }

  startHeartbeat(intervalMs = 30_000): void {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(() => {
      for (const set of this.clients.values()) {
        for (const raw of set) {
          if (!raw.writableEnded) {
            raw.write(':heartbeat\n\n');
          }
        }
      }

      for (const raw of this.globalClients) {
        if (!raw.writableEnded) {
          raw.write(':heartbeat\n\n');
        }
      }
    }, intervalMs);

    // Don't keep the process alive just for heartbeats
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  shutdown(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const [cardId, set] of this.clients) {
      for (const raw of set) {
        if (!raw.writableEnded) {
          raw.end();
        }
      }
      set.clear();
    }
    this.clients.clear();

    for (const raw of this.globalClients) {
      if (!raw.writableEnded) {
        raw.end();
      }
    }
    this.globalClients.clear();
  }

  /** Number of cards with active subscribers (for testing). */
  get cardCount(): number {
    return this.clients.size;
  }

  /** Number of subscribers for a specific card (for testing). */
  subscriberCount(cardId: string): number {
    return this.clients.get(cardId)?.size ?? 0;
  }
}
