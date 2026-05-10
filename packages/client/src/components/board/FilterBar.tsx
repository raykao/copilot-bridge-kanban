import { useMemo } from 'react';
import { Search, X } from 'lucide-react';

import type { Card } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useFilterStore } from '@/stores/filters';

interface FilterBarProps {
  cards: Card[];
}

const allStatusesValue = '__all_statuses__';

function formatStatus(status: string): string {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function FilterBar({ cards }: FilterBarProps) {
  const { search, labels, status, setSearch, toggleLabel, setStatus, clearFilters } = useFilterStore();

  const availableLabels = useMemo(
    () =>
      Array.from(new Set([...cards.flatMap((card) => card.labels), ...labels]))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
    [cards, labels],
  );

  const availableStatuses = useMemo(
    () =>
      Array.from(new Set([...cards.map((card) => card.status), ...(status ? [status] : [])])).sort(
        (left, right) => left.localeCompare(right),
      ),
    [cards, status],
  );

  const hasActiveFilters = search.length > 0 || labels.length > 0 || status !== null;

  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
          <div className="relative w-full md:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search cards"
              className="pl-8"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search cards"
              value={search}
            />
          </div>

          <Select
            onValueChange={(value) => setStatus(value === allStatusesValue ? null : value)}
            value={status ?? allStatusesValue}
          >
            <SelectTrigger className="w-full md:w-44">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={allStatusesValue}>All statuses</SelectItem>
              {availableStatuses.map((item) => (
                <SelectItem key={item} value={item}>
                  {formatStatus(item)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {hasActiveFilters ? (
          <Button className="self-start" onClick={() => clearFilters()} size="sm" type="button" variant="outline">
            <X />
            Clear
          </Button>
        ) : null}
      </div>

      {availableLabels.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {availableLabels.map((label) => {
            const isActive = labels.includes(label);

            return (
              <button
                aria-label={`Filter by label ${label}`}
                aria-pressed={isActive}
                className="rounded-4xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                key={label}
                onClick={() => toggleLabel(label)}
                type="button"
              >
                <Badge
                  className={cn(
                    'cursor-pointer transition-colors',
                    isActive ? 'hover:bg-primary/90' : 'hover:border-primary/40 hover:text-primary',
                  )}
                  variant={isActive ? 'default' : 'outline'}
                >
                  {label}
                </Badge>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
