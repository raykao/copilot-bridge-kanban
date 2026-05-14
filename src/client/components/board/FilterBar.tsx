import { useEffect, useMemo, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';

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
  const [mobileOpen, setMobileOpen] = useState(false);

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
  const activeFilterCount = (search ? 1 : 0) + labels.length + (status ? 1 : 0);

  useEffect(() => {
    if (hasActiveFilters) {
      setMobileOpen(true);
    }
  }, [hasActiveFilters]);

  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex items-center gap-3 md:hidden">
        <Button
          className="min-h-11 flex-1 justify-between"
          onClick={() => setMobileOpen((current) => !current)}
          type="button"
          variant="outline"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="size-4" />
            Filters
          </span>
          {hasActiveFilters ? <Badge variant="secondary">{activeFilterCount}</Badge> : null}
        </Button>
      </div>

      <div className={cn('mt-3 hidden flex-col gap-3 md:mt-0 md:flex', mobileOpen && 'flex')}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
            <div className="relative w-full md:max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search cards"
                className="min-h-11 pl-8"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search cards"
                value={search}
            />
          </div>

          <Select
            onValueChange={(value) => setStatus(value === allStatusesValue ? null : value)}
            value={status ?? allStatusesValue}
          >
            <SelectTrigger className="min-h-11 w-full md:w-44">
              <SelectValue>{status ? formatStatus(status) : 'All statuses'}</SelectValue>
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
            <Button
              className="min-h-11 self-stretch md:self-start"
              onClick={() => clearFilters()}
              type="button"
              variant="outline"
            >
              <X />
              Clear
            </Button>
          ) : null}
        </div>

        {availableLabels.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {availableLabels.map((label) => {
              const isActive = labels.includes(label);

              return (
                <button
                  aria-label={`Filter by label ${label}`}
                  aria-pressed={isActive}
                  className="inline-flex min-h-11 items-center rounded-4xl px-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
    </div>
  );
}
