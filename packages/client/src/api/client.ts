import type {
  Agent,
  AuthUser,
  Card,
  CardComment,
  CardDetail,
  CardEvent,
  CardFilter,
  Checkpoint,
  NewCard,
  UserPreferences,
} from './types';

type AuthResponse = { user: AuthUser };
type OkResponse = { ok: true };
type CardUpdate = Partial<
  Pick<Card, 'title' | 'description' | 'status' | 'workspace_subdir' | 'metadata'>
> & {
  agent?: string | null;
  labels?: string[];
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body?: unknown,
  ) {
    super(`API error ${status}: ${statusText}`);
    this.name = 'ApiError';
  }
}

function getErrorBodyMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const record = body as Record<string, unknown>;
  for (const key of ['error', 'message', 'detail']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

export function getErrorMessage(error: unknown, fallback = 'An error occurred'): string {
  if (error instanceof ApiError) {
    if (error.status === 502) {
      return 'Bridge is unavailable. The copilot-bridge server may be down.';
    }

    return getErrorBodyMessage(error.body) ?? (error.statusText || fallback);
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

export function getToastErrorMessage(error: unknown, fallback = 'An error occurred'): string | null {
  if (error instanceof ApiError && error.status === 401) {
    return null;
  }

  return getErrorMessage(error, fallback);
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const method = options.method?.toUpperCase();

  if (method && ['POST', 'PUT', 'PATCH'].includes(method) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new ApiError(res.status, res.statusText, body);
  }

  return (await res.json()) as T;
}

function withQuery(path: string, filter?: CardFilter): string {
  if (!filter) {
    return path;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

const auth = {
  login(username: string, password: string): Promise<AuthResponse> {
    return apiFetch<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  logout(): Promise<OkResponse> {
    return apiFetch<OkResponse>('/api/auth/logout', {
      method: 'POST',
    });
  },

  me(): Promise<AuthResponse> {
    return apiFetch<AuthResponse>('/api/auth/me');
  },
};

const agents = {
  list(): Promise<Agent[]> {
    return apiFetch<Agent[]>('/api/v1/agents');
  },

  get(name: string): Promise<Agent> {
    return apiFetch<Agent>(`/api/v1/agents/${encodeURIComponent(name)}`);
  },
};

const cards = {
  create(card: NewCard): Promise<Card> {
    const normalizedCard = {
      ...card,
      agent: card.agent ?? card.agent_bot,
      agent_bot: card.agent_bot ?? card.agent,
    };

    return apiFetch<Card>('/api/v1/cards', {
      method: 'POST',
      body: JSON.stringify(normalizedCard),
    });
  },

  list(filter?: CardFilter): Promise<Card[]> {
    return apiFetch<Card[]>(withQuery('/api/v1/cards', filter));
  },

  get(id: string): Promise<CardDetail> {
    return apiFetch<CardDetail>(`/api/v1/cards/${encodeURIComponent(id)}`);
  },

  update(id: string, patch: CardUpdate): Promise<Card> {
    return apiFetch<Card>(`/api/v1/cards/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  archive(id: string): Promise<Card> {
    return apiFetch<Card>(`/api/v1/cards/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
    });
  },

  abort(id: string): Promise<Card> {
    return apiFetch<Card>(`/api/v1/cards/${encodeURIComponent(id)}/abort`, {
      method: 'POST',
    });
  },

  delete(id: string): Promise<OkResponse> {
    return apiFetch<OkResponse>(`/api/v1/cards/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
};

const comments = {
  list(cardId: string): Promise<CardComment[]> {
    return apiFetch<CardComment[]>(`/api/v1/cards/${encodeURIComponent(cardId)}/comments`);
  },

  add(cardId: string, content: string): Promise<CardComment> {
    return apiFetch<CardComment>(`/api/v1/cards/${encodeURIComponent(cardId)}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },
};

const labels = {
  add(cardId: string, labelValues: string[]): Promise<Card> {
    return apiFetch<Card>(`/api/v1/cards/${encodeURIComponent(cardId)}/labels`, {
      method: 'POST',
      body: JSON.stringify({ labels: labelValues }),
    });
  },

  remove(cardId: string, label: string): Promise<Card> {
    return apiFetch<Card>(
      `/api/v1/cards/${encodeURIComponent(cardId)}/labels/${encodeURIComponent(label)}`,
      {
        method: 'DELETE',
      },
    );
  },
};

const checkpoints = {
  list(cardId: string): Promise<Checkpoint[]> {
    return apiFetch<Checkpoint[]>(`/api/v1/cards/${encodeURIComponent(cardId)}/checkpoints`);
  },

  create(cardId: string, name?: string): Promise<Checkpoint> {
    return apiFetch<Checkpoint>(`/api/v1/cards/${encodeURIComponent(cardId)}/checkpoints`, {
      method: 'POST',
      body: JSON.stringify(name ? { name } : {}),
    });
  },

  delete(cardId: string, checkpointId: string): Promise<OkResponse> {
    return apiFetch<OkResponse>(
      `/api/v1/cards/${encodeURIComponent(cardId)}/checkpoints/${encodeURIComponent(checkpointId)}`,
      {
        method: 'DELETE',
      },
    );
  },
};

const preferences = {
  get(): Promise<UserPreferences> {
    return apiFetch<UserPreferences>('/api/prefs');
  },

  update(prefs: UserPreferences): Promise<UserPreferences> {
    return apiFetch<UserPreferences>('/api/prefs', {
      method: 'PUT',
      body: JSON.stringify(prefs),
    });
  },
};

export const api = { auth, agents, cards, comments, labels, checkpoints, preferences };

export function subscribeToCardEvents(
  cardId: string,
  onEvent: (event: CardEvent) => void,
  onError?: (error: Event) => void,
): EventSource {
  const es = new EventSource(`/api/v1/cards/${cardId}/events`, { withCredentials: true });

  es.onmessage = (e) => {
    try {
      const event: CardEvent = JSON.parse(e.data);
      onEvent(event);
    } catch {}
  };

  if (onError) {
    es.onerror = onError;
  }

  return es;
}
