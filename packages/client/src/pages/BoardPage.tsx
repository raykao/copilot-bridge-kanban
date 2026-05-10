import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { Card } from '@/api/types';
import { api } from '@/api/client';
import { BoardView } from '@/components/board/BoardView';

function sortCards(cards: Card[]): Card[] {
  return [...cards].sort(
    (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
  );
}

export function BoardPage() {
  const {
    data: agents = [],
    isLoading: agentsLoading,
    isError: agentsError,
  } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.agents.list(),
    staleTime: 60_000,
  });

  const {
    data: cards = [],
    isLoading: cardsLoading,
    isError: cardsError,
  } = useQuery({
    queryKey: ['cards'],
    queryFn: () => api.cards.list(),
  });

  const columns = useMemo(
    () =>
      [...agents]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((agent) => ({
          id: agent.name,
          title: agent.name,
          cards: sortCards(
            cards.filter((card) => card.agent_bot === agent.name && card.status !== 'archived'),
          ),
        })),
    [agents, cards],
  );

  const isLoading = agentsLoading || cardsLoading;
  const hasError = agentsError || cardsError;

  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agent board</h1>
        <p className="text-sm text-muted-foreground">Active cards grouped by agent.</p>
      </div>

      {hasError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Unable to load the board right now.
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <BoardView columns={columns} isLoading={isLoading} />
      </div>
    </div>
  );
}
