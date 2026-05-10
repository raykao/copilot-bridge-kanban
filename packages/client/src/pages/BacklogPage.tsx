import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';

import type { Card } from '@/api/types';
import { api } from '@/api/client';
import { BoardView } from '@/components/board/BoardView';
import { CreateCardModal } from '@/components/board/CreateCardModal';
import { FilterBar } from '@/components/board/FilterBar';
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

  const {
    data: cards = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['cards', { agent: 'none' }],
    queryFn: () => api.cards.list({ agent: 'none' }),
  });

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

        {isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Unable to load the backlog right now.
          </div>
        ) : null}

        <div className="min-h-0 flex-1">
          <BoardView columns={columns} isLoading={isLoading} mode="status" />
        </div>
      </div>

      <CreateCardModal onOpenChange={setCreateOpen} open={createOpen} />
    </>
  );
}
