import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Link } from 'react-router-dom';

import { api, getErrorMessage } from '@/api/client';
import type { Card } from '@/api/types';
import { FilterBar } from '@/components/board/FilterBar';
import { ErrorState } from '@/components/ErrorState';
import { CardListPageSkeleton } from '@/components/PageSkeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { applyFilters, useFilterStore } from '@/stores/filters';

type SortColumn = 'title' | 'type' | 'agent' | 'status' | 'created_at' | 'updated_at';
type SortDirection = 'asc' | 'desc';

const statusVariantMap = {
  idea: 'outline',
  refining: 'secondary',
  ready: 'default',
  in_progress: 'default',
  paused: 'secondary',
  done: 'outline',
  archived: 'ghost',
} as const;

const statusClassMap = {
  idea: 'border-dashed',
  refining: 'bg-secondary text-secondary-foreground',
  ready: 'bg-emerald-600 text-white hover:bg-emerald-600',
  in_progress: 'bg-sky-600 text-white hover:bg-sky-600',
  paused: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  done: 'border-emerald-300 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300',
  archived: 'text-muted-foreground',
} as const;

const typeClassMap = {
  work: 'bg-slate-900 text-white hover:bg-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-100',
  chat: 'bg-violet-100 text-violet-800 hover:bg-violet-100 dark:bg-violet-500/20 dark:text-violet-200 dark:hover:bg-violet-500/20',
} as const;

function formatStatus(status: Card['status']): string {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatTimestamp(timestamp: string): string {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return '-';
  }

  return value.toLocaleString();
}

function getAgentName(card: Card): string {
  return card.agent_bot ?? 'Unassigned';
}

function getSortValue(card: Card, column: SortColumn): number | string {
  switch (column) {
    case 'title':
      return card.title.toLowerCase();
    case 'type':
      return card.type;
    case 'agent':
      return getAgentName(card).toLowerCase();
    case 'status':
      return card.status;
    case 'created_at':
      return new Date(card.created_at).getTime();
    case 'updated_at':
      return new Date(card.updated_at).getTime();
  }
}

function compareCards(left: Card, right: Card, column: SortColumn, direction: SortDirection): number {
  const leftValue = getSortValue(left, column);
  const rightValue = getSortValue(right, column);
  const order = direction === 'asc' ? 1 : -1;

  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    return (leftValue - rightValue) * order;
  }

  return String(leftValue).localeCompare(String(rightValue)) * order;
}

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) {
    return <ArrowUpDown className="size-4 text-muted-foreground" />;
  }

  return direction === 'asc' ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />;
}

function SortableHeader({
  label,
  column,
  sortColumn,
  sortDirection,
  onSort,
}: {
  label: string;
  column: SortColumn;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onSort: (column: SortColumn) => void;
}) {
  const active = sortColumn === column;

  return (
    <Button
      className="-ml-3 h-auto min-h-11 px-3 py-1.5 text-foreground hover:text-foreground"
      onClick={() => onSort(column)}
      type="button"
      variant="ghost"
    >
      <span>{label}</span>
      <SortIcon active={active} direction={sortDirection} />
    </Button>
  );
}

export function CardListPage() {
  const filters = useFilterStore();
  const [sortColumn, setSortColumn] = useState<SortColumn>('updated_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const cardsQuery = useQuery({
    queryKey: ['cards'],
    queryFn: () => api.cards.list(),
  });

  const cards = cardsQuery.data ?? [];
  const filteredCards = useMemo(() => applyFilters(cards, filters), [cards, filters]);
  const sortedCards = useMemo(
    () => [...filteredCards].sort((left, right) => compareCards(left, right, sortColumn, sortDirection)),
    [filteredCards, sortColumn, sortDirection],
  );

  function handleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDirection((currentDirection) => (currentDirection === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortColumn(column);
    setSortDirection(column === 'updated_at' ? 'desc' : 'asc');
  }

  if (cardsQuery.isPending) {
    return <CardListPageSkeleton />;
  }

  if (cardsQuery.isError) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <ErrorState
          message={getErrorMessage(cardsQuery.error, 'Failed to load cards.')}
          onRetry={() => {
            void cardsQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">All Cards</h1>
        <p className="text-sm text-muted-foreground">A sortable table view of every card in the workspace.</p>
      </div>

      <FilterBar cards={cards} />

      <div className="rounded-xl border bg-card shadow-sm">
        <Table className="min-w-[680px]">
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortableHeader
                  column="title"
                  label="Title"
                  onSort={handleSort}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                />
              </TableHead>
              <TableHead>
                <SortableHeader
                  column="type"
                  label="Type"
                  onSort={handleSort}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                />
              </TableHead>
              <TableHead>
                <SortableHeader
                  column="agent"
                  label="Agent"
                  onSort={handleSort}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                />
              </TableHead>
              <TableHead>
                <SortableHeader
                  column="status"
                  label="Status"
                  onSort={handleSort}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                />
              </TableHead>
              <TableHead className="hidden md:table-cell">Labels</TableHead>
              <TableHead className="hidden md:table-cell">
                <SortableHeader
                  column="created_at"
                  label="Created"
                  onSort={handleSort}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                />
              </TableHead>
              <TableHead>
                <SortableHeader
                  column="updated_at"
                  label="Updated"
                  onSort={handleSort}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedCards.length > 0 ? (
              sortedCards.map((card) => (
                <TableRow key={card.id}>
                  <TableCell className="max-w-80 whitespace-normal">
                    <Link
                      className="block truncate break-words font-medium text-foreground hover:text-primary hover:underline"
                      title={card.title}
                      to={`/cards/${card.id}`}
                    >
                      {card.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge className={cn('capitalize', typeClassMap[card.type])} variant="secondary">
                      {card.type}
                    </Badge>
                  </TableCell>
                  <TableCell>{getAgentName(card)}</TableCell>
                  <TableCell>
                    <Badge className={cn(statusClassMap[card.status])} variant={statusVariantMap[card.status]}>
                      {formatStatus(card.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden max-w-72 whitespace-normal md:table-cell">
                    {card.labels.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {card.labels.map((label) => (
                          <Badge className="max-w-full" key={label} variant="outline">
                            <span className="truncate">{label}</span>
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{formatTimestamp(card.created_at)}</TableCell>
                  <TableCell>{formatTimestamp(card.updated_at)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell className="py-10 text-center text-muted-foreground" colSpan={7}>
                  No cards found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
