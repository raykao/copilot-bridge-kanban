import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';

import { api } from '@/api/client';
import type { Card } from '@/api/types';

import { BoardColumn } from './BoardColumn';
import { CardPreview } from './CardPreview';

interface Column {
  id: string;
  title: string;
  cards: Card[];
}

interface BoardViewProps {
  columns: Column[];
  isLoading?: boolean;
  mode: 'agent' | 'status';
}

function buildPatchedCard(card: Card, patch: Record<string, unknown>): Card {
  return {
    ...card,
    ...(patch.status !== undefined ? { status: patch.status as Card['status'] } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'agent')
      ? { agent_bot: (patch.agent as string | null | undefined) ?? null }
      : {}),
    ...(patch.title !== undefined ? { title: patch.title as string } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'description')
      ? { description: (patch.description as string | null | undefined) ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'workspace_subdir')
      ? { workspace_subdir: (patch.workspace_subdir as string | null | undefined) ?? null }
      : {}),
    ...(patch.metadata !== undefined ? { metadata: patch.metadata as Card['metadata'] } : {}),
    ...(patch.labels !== undefined ? { labels: patch.labels as string[] } : {}),
  };
}

function matchesQueryFilter(card: Card, queryKey: QueryKey): boolean {
  const [, rawFilter] = queryKey;

  if (!rawFilter || typeof rawFilter !== 'object' || Array.isArray(rawFilter)) {
    return true;
  }

  const filter = rawFilter as Partial<Record<'agent' | 'status' | 'label' | 'type', string>>;

  if (filter.agent === 'none' && card.agent_bot !== null) {
    return false;
  }

  if (filter.agent && filter.agent !== 'none' && card.agent_bot !== filter.agent) {
    return false;
  }

  if (filter.status && card.status !== filter.status) {
    return false;
  }

  if (filter.label && !card.labels.includes(filter.label)) {
    return false;
  }

  if (filter.type && card.type !== filter.type) {
    return false;
  }

  return true;
}

function applyOptimisticPatch(
  cards: Card[],
  id: string,
  patch: Record<string, unknown>,
  queryKey: QueryKey,
): Card[] {
  let found = false;

  const nextCards = cards.map((card) => {
    if (card.id !== id) {
      return card;
    }

    found = true;
    return buildPatchedCard(card, patch);
  });

  if (!found) {
    return cards;
  }

  return nextCards.filter((card) => matchesQueryFilter(card, queryKey));
}

function BoardSkeletonColumn({ title }: { title: string }) {
  return (
    <div className="flex h-full w-72 shrink-0 flex-col rounded-xl border bg-muted/30">
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-6 w-8 animate-pulse rounded-full bg-muted" />
        </div>
      </div>
      <div className="space-y-3 p-3">
        <span className="sr-only">{title}</span>
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="space-y-3 rounded-xl border bg-card p-3 shadow-sm" key={index}>
            <div className="flex items-start justify-between gap-2">
              <div className="h-4 w-32 animate-pulse rounded bg-muted" />
              <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="flex gap-2">
              <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
              <div className="h-5 w-12 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function BoardView({ columns, isLoading = false, mode }: BoardViewProps) {
  const queryClient = useQueryClient();
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );
  const [activeCard, setActiveCard] = useState<Card | null>(null);

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => api.cards.update(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: ['cards'] });
      const previous = queryClient.getQueriesData<Card[]>({ queryKey: ['cards'] });

      for (const [queryKey, cards] of previous) {
        if (!cards) {
          continue;
        }

        queryClient.setQueryData<Card[]>(queryKey, applyOptimisticPatch(cards, id, patch, queryKey));
      }

      return { previous };
    },
    onError: (_error, _variables, context) => {
      for (const [queryKey, cards] of context?.previous ?? []) {
        queryClient.setQueryData(queryKey, cards);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cards'] });
    },
  });

  const skeletonColumns = columns.length > 0 ? columns : [
    { id: 'loading-1', title: 'Loading', cards: [] },
    { id: 'loading-2', title: 'Loading', cards: [] },
    { id: 'loading-3', title: 'Loading', cards: [] },
  ];

  function findCard(id: string): Card | undefined {
    return columns.flatMap((column) => column.cards).find((card) => card.id === id);
  }

  function handleDragStart(event: DragStartEvent) {
    const card = findCard(String(event.active.id));
    if (card) {
      setActiveCard(card);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);

    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const cardId = String(active.id);
    const targetColumnId = String(over.id);
    const card = findCard(cardId);

    if (!card) {
      return;
    }

    if (mode === 'agent') {
      if (card.agent_bot === targetColumnId) {
        return;
      }

      updateMutation.mutate({ id: cardId, patch: { agent: targetColumnId } });
      return;
    }

    if (card.status === targetColumnId) {
      return;
    }

    updateMutation.mutate({ id: cardId, patch: { status: targetColumnId } });
  }

  return (
    <div className="h-full">
      <DndContext
        collisionDetection={closestCenter}
        onDragCancel={() => setActiveCard(null)}
        onDragEnd={handleDragEnd}
        onDragStart={handleDragStart}
        sensors={sensors}
      >
        <div className="flex h-full gap-4 overflow-x-auto pb-2">
          {isLoading
            ? skeletonColumns.map((column) => <BoardSkeletonColumn key={column.id} title={column.title} />)
            : columns.map((column) => (
                <BoardColumn
                  cards={column.cards}
                  columnId={column.id}
                  count={column.cards.length}
                  key={column.id}
                  title={column.title}
                />
              ))}
        </div>

        <DragOverlay>{activeCard ? <CardPreview card={activeCard} isDragOverlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
