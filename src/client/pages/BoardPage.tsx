import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';

import type { Card } from '@/api/types';
import { api, getErrorMessage } from '@/api/client';
import { BoardView } from '@/components/board/BoardView';
import { CreateCardModal } from '@/components/board/CreateCardModal';
import { ErrorState } from '@/components/ErrorState';
import { BoardPageSkeleton } from '@/components/PageSkeletons';
import { FilterBar } from '@/components/board/FilterBar';
import { Button } from '@/components/ui/button';
import { applyFilters, useFilterStore } from '@/stores/filters';

function sortCards(cards: Card[]): Card[] {
  return [...cards].sort(
    (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
  );
}

export function BoardPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const filters = useFilterStore();

  const agentsQuery = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.agents.cards(),
    staleTime: 60_000,
  });

  const cardsQuery = useQuery({
    queryKey: ['cards'],
    queryFn: () => api.cards.list(),
  });

  const agents = agentsQuery.data?.cards ?? [];
  const cards = cardsQuery.data ?? [];
  const filteredCards = useMemo(() => applyFilters(cards, filters), [cards, filters]);

  const columns = useMemo(
    () =>
      [...agents]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((agentCard) => ({
          id: agentCard.name,
          title: agentCard.name,
          cards: sortCards(
            filteredCards.filter(
              (card) => card.agent_bot === agentCard.name && card.status !== 'archived',
            ),
          ),
        })),
    [agents, filteredCards],
  );

  if (agentsQuery.isPending || cardsQuery.isPending) {
    return <BoardPageSkeleton columns={4} />;
  }

  if (agentsQuery.isError || cardsQuery.isError) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <ErrorState
          message={getErrorMessage(agentsQuery.error ?? cardsQuery.error, 'Failed to load the board.')}
          onRetry={() => {
            void Promise.all([agentsQuery.refetch(), cardsQuery.refetch()]);
          }}
        />
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Agent board</h1>
            <p className="text-sm text-muted-foreground">Active cards grouped by agent.</p>
          </div>

          <Button className="min-h-11 w-full sm:w-auto" onClick={() => setCreateOpen(true)}>
            <Plus />
            New Card
          </Button>
        </div>

        <FilterBar cards={cards} />

        <div className="min-h-0 flex-1">
          <BoardView columns={columns} mode="agent" />
        </div>
      </div>

      <CreateCardModal onOpenChange={setCreateOpen} open={createOpen} />
    </>
  );
}
