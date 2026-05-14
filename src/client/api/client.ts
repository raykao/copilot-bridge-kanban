import type {
  Agent,
  AgentCard,
  AuthUser,
  Card,
  CardComment,
  CardDetail,
  CardFilter,
  Checkpoint,
  NewCard,
  ResumeDecision,
  Run,
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

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

// Ensure card.labels is always an array (bridge may omit it).
function normalizeCard<T extends Partial<Card>>(card: T): T {
  return { ...card, labels: (card as any).labels ?? [] };
}

// Bridge API wraps array responses in a named key (e.g. { cards: [] }).
// This helper unwraps them, falling back to the raw response if it's already an array.
function unwrapArray<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object' && key in data) return (data as Record<string, unknown>)[key] as T[];
  return [];
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
  async list(): Promise<Agent[]> {
    const data = await apiFetch<unknown>('/api/agents');
    return unwrapArray<Agent>(data, 'agents');
  },

  cards(): Promise<{ cards: AgentCard[] }> {
    return apiFetch<{ cards: AgentCard[] }>('/api/agents/cards');
  },

  get(name: string): Promise<Agent> {
    return apiFetch<Agent>(`/api/agents/${encodeURIComponent(name)}`);
  },
};

const cards = {
  async create(card: NewCard): Promise<Card> {
    const result = await apiFetch<{ card: Card }>('/api/cards', {
      method: 'POST',
      body: JSON.stringify({
        ...card,
        agent: card.agent ?? card.agent_bot,
      }),
    });
    return normalizeCard(result.card);
  },

  async list(filter?: CardFilter): Promise<Card[]> {
    const data = await apiFetch<{ cards: Card[] }>(withQuery('/api/cards', filter));
    return unwrapArray<Card>(data, 'cards').map(normalizeCard);
  },

  async get(id: string): Promise<CardDetail> {
    const detail = await apiFetch<CardDetail>(`/api/cards/${encodeURIComponent(id)}`);
    return { ...detail, card: normalizeCard(detail.card) };
  },

  async update(id: string, patch: CardUpdate): Promise<Card> {
    const result = await apiFetch<{ card: Card }>(`/api/cards/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return normalizeCard(result.card);
  },

  async archive(id: string): Promise<Card> {
    const result = await apiFetch<{ card: Card }>(`/api/cards/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived' }),
    });
    return normalizeCard(result.card);
  },

  async abort(id: string): Promise<Card> {
    const result = await apiFetch<{ card: Card }>(`/api/cards/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done' }),
    });
    return normalizeCard(result.card);
  },

  async delete(id: string): Promise<void> {
    await apiFetch<void>(`/api/cards/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
};

const comments = {
  async list(cardId: string): Promise<CardComment[]> {
    const data = await apiFetch<{ comments: CardComment[] }>(`/api/cards/${encodeURIComponent(cardId)}/comments`);
    return unwrapArray<CardComment>(data, 'comments');
  },

  async add(cardId: string, content: string): Promise<CardComment> {
    const result = await apiFetch<{ comment: CardComment }>(`/api/cards/${encodeURIComponent(cardId)}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    return result.comment;
  },
};

const labels = {
  async add(cardId: string, labelValues: string[]): Promise<string[]> {
    const result = await apiFetch<{ labels: string[] }>(`/api/cards/${encodeURIComponent(cardId)}/labels`, {
      method: 'POST',
      body: JSON.stringify({ labels: labelValues }),
    });
    return result.labels;
  },

  async remove(cardId: string, label: string): Promise<void> {
    await apiFetch<void>(
      `/api/cards/${encodeURIComponent(cardId)}/labels/${encodeURIComponent(label)}`,
      {
        method: 'DELETE',
      },
    );
  },
};

const checkpoints = {
  async list(cardId: string): Promise<Checkpoint[]> {
    const data = await apiFetch<unknown>(`/api/cards/${encodeURIComponent(cardId)}/checkpoints`);
    return unwrapArray<Checkpoint>(data, 'checkpoints');
  },

  create(cardId: string, name?: string): Promise<Checkpoint> {
    return apiFetch<Checkpoint>(`/api/cards/${encodeURIComponent(cardId)}/checkpoints`, {
      method: 'POST',
      body: JSON.stringify(name ? { name } : {}),
    });
  },

  delete(cardId: string, checkpointId: string): Promise<OkResponse> {
    return apiFetch<OkResponse>(
      `/api/cards/${encodeURIComponent(cardId)}/checkpoints/${encodeURIComponent(checkpointId)}`,
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

const runs = {
  get(cardId: string, runId: string): Promise<{ run: Run }> {
    return apiFetch<{ run: Run }>(
      `/api/cards/${encodeURIComponent(cardId)}/runs/${encodeURIComponent(runId)}`,
    );
  },

  resume(
    cardId: string,
    runId: string,
    decision: ResumeDecision,
  ): Promise<{ run_id: string; decision: string }> {
    return apiFetch<{ run_id: string; decision: string }>(
      `/api/cards/${encodeURIComponent(cardId)}/runs/${encodeURIComponent(runId)}/resume`,
      {
        method: 'POST',
        body: JSON.stringify({ decision }),
      },
    );
  },
};

export const api = { auth, agents, cards, comments, labels, checkpoints, preferences, runs };
