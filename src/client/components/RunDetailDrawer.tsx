import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';

import { api } from '@/api/client';
import type { Run } from '@/api/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface RunDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  cardId: string;
  cardTitle: string;
  runId: string | null;
}

type RunStatus = Run['status'];

function formatRunStatus(status: RunStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function getRunStatusBadgeClassName(status: RunStatus): string {
  switch (status) {
    case 'running':
      return 'bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300';
    case 'awaiting':
      return 'bg-yellow-500/10 text-yellow-800 ring-yellow-500/20 dark:text-yellow-300';
    case 'completed':
      return 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300';
    case 'failed':
      return 'bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-300';
    case 'created':
      return 'bg-muted text-muted-foreground ring-border';
  }
}

export function RunDetailDrawer({
  open,
  onClose,
  cardId,
  cardTitle,
  runId,
}: RunDetailDrawerProps) {
  const { data } = useQuery({
    queryKey: ['run', cardId, runId],
    queryFn: () => api.runs.get(cardId, runId!),
    enabled: open && runId != null,
  });
  const run = data?.run ?? null;

  return (
    <>
      {open ? (
        <button
          aria-label="Close run details"
          className="fixed inset-0 z-40 bg-black/40"
          onClick={onClose}
          type="button"
        />
      ) : null}

      <aside
        aria-hidden={!open}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-[45vw] min-w-[360px] flex-col border-l bg-background shadow-xl transition-transform duration-300 ease-in-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0 space-y-2">
            <h2 className="truncate text-lg font-semibold text-foreground">{cardTitle}</h2>
            {runId && run ? (
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
                  getRunStatusBadgeClassName(run.status),
                )}
              >
                {formatRunStatus(run.status)}
              </span>
            ) : null}
          </div>

          <Button aria-label="Close run details" onClick={onClose} size="icon-sm" type="button" variant="ghost">
            <X />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <p className="text-sm text-muted-foreground p-4">Loading run details...</p>
        </div>
      </aside>
    </>
  );
}
