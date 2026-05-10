import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';

import type { Card } from '@/api/types';
import { api, getErrorMessage } from '@/api/client';
import { BoardView } from '@/components/board/BoardView';
import { CreateCardModal } from '@/components/board/CreateCardModal';
import { ErrorState } from '@/components/ErrorState';
import { FilterBar } from '@/components/board/FilterBar';
import { BoardPageSkeleton } from '@/components/PageSkeletons';
import { Button } from '@/components/ui/button';
import { applyFilters, useFilterStore } from '@/stores/filters';

const backlogStatuses = ['idea', 'refining', 'ready'] as const;

function formatStatus(status: (typeof backlogStatuses)[number]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function sortCards(cards: Card[]): Card[] {
  return [...cards].sort(
    (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
  );
}

export function BacklogPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const filters = useFilterStore();

  const cardsQuery = useQuery({
    queryKey: ['cards', { agent: 'none' }],
    queryFn: () => api.cards.list({ agent: 'none' }),
  });

  const cards = cardsQuery.data ?? [];
  const filteredCards = useMemo(() => applyFilters(cards, filters), [cards, filters]);

  const columns = useMemo(
    () =>
      backlogStatuses.map((status) => ({
        id: status,
        title: formatStatus(status),
        cards: sortCards(filteredCards.filter((card) => card.status === status)),
      })),
    [filteredCards],
  );

  if (cardsQuery.isPending) {
    return <BoardPageSkeleton columns={3} />;
  }

  if (cardsQuery.isError) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <ErrorState
          message={getErrorMessage(cardsQuery.error, 'Failed to load the backlog.')}
          onRetry={() => {
            void cardsQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Backlog</h1>
            <p className="text-sm text-muted-foreground">Unassigned cards grouped by readiness.</p>
          </div>

          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            New Card
          </Button>
        </div>

        <FilterBar cards={cards} />

        <div className="min-h-0 flex-1">
          <BoardView columns={columns} mode="status" />
        </div>
      </div>

      <CreateCardModal onOpenChange={setCreateOpen} open={createOpen} />
    </>
  );
}
