import { useMemo, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useNavigate } from 'react-router-dom';

import type { Card as CardType } from '@/api/types';
import { RunDetailDrawer } from '@/components/RunDetailDrawer';
import { RunStatusBar } from '@/components/RunStatusBar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { StreamingState } from '@/hooks/useCardEvents';
import { useCardEvents } from '@/hooks/useCardEvents';
import { cn } from '@/lib/utils';

interface CardPreviewProps {
  card: CardType;
  isDragOverlay?: boolean;
}

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

const labelClasses = [
  'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200',
  'bg-slate-200 text-slate-800 dark:bg-slate-500/20 dark:text-slate-200',
] as const;

function formatStatus(status: CardType['status']): string {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function hashLabel(label: string): number {
  return Array.from(label).reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function timeAgo(dateString: string): string {
  const diff = Date.now() - new Date(dateString).getTime();

  if (!Number.isFinite(diff) || diff < 0) {
    return 'just now';
  }

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  if (diff < minute) {
    return 'just now';
  }

  if (diff < hour) {
    return `${Math.floor(diff / minute)}m ago`;
  }

  if (diff < day) {
    return `${Math.floor(diff / hour)}h ago`;
  }

  if (diff < week) {
    return `${Math.floor(diff / day)}d ago`;
  }

  return `${Math.floor(diff / week)}w ago`;
}

interface CardPreviewBodyProps {
  card: CardType;
  className?: string;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onViewLive: (runId: string) => void;
  streaming: StreamingState;
  style?: CSSProperties;
  draggableProps?: Pick<ReturnType<typeof useDraggable>, 'attributes' | 'listeners' | 'setNodeRef'>;
}

function CardPreviewBody({
  card,
  className,
  onClick,
  onKeyDown,
  onViewLive,
  streaming,
  style,
  draggableProps,
}: CardPreviewBodyProps) {
  const relativeTime = useMemo(() => timeAgo(card.updated_at), [card.updated_at]);
  const latestRun = card.runs?.length ? card.runs[card.runs.length - 1] : null;

  const stopCardAction = (
    event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>,
  ) => {
    event.stopPropagation();
  };

  return (
    <Card
      {...draggableProps?.attributes}
      {...draggableProps?.listeners}
      className={cn(
        'min-h-30 gap-3 border border-border/70 shadow-sm transition-colors hover:bg-accent/40',
        draggableProps ? 'cursor-grab active:cursor-grabbing' : 'cursor-grabbing',
        className,
      )}
      ref={draggableProps?.setNodeRef}
      role="button"
      size="sm"
      style={style}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="line-clamp-2 text-sm leading-5">{card.title}</CardTitle>
          <Badge
            className={cn('shrink-0 capitalize', statusClassMap[card.status])}
            variant={statusVariantMap[card.status]}
          >
            {formatStatus(card.status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="mt-auto space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {(card.labels ?? []).length > 0 ? (
            (card.labels ?? []).slice(0, 3).map((label) => (
              <span
                className={cn(
                  'inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                  labelClasses[hashLabel(label) % labelClasses.length],
                )}
                key={label}
                title={label}
              >
                <span className="truncate">{label}</span>
              </span>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">No labels</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{relativeTime}</div>
        <div onClick={stopCardAction} onKeyDown={stopCardAction} onPointerDown={stopCardAction}>
          <RunStatusBar cardId={card.id} latestRun={latestRun} streaming={streaming} onViewLive={onViewLive} />
        </div>
      </CardContent>
    </Card>
  );
}

function StaticCardPreview({
  card,
  onViewLive,
  streaming,
}: {
  card: CardType;
  onViewLive: (runId: string) => void;
  streaming: StreamingState;
}) {
  const navigate = useNavigate();

  return (
    <CardPreviewBody
      card={card}
      className="cursor-grabbing shadow-lg"
      onClick={() => navigate(`/cards/${card.id}`)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          navigate(`/cards/${card.id}`);
        }
      }}
      onViewLive={onViewLive}
      streaming={streaming}
    />
  );
}

function DraggableCardPreview({
  card,
  onViewLive,
  streaming,
}: {
  card: CardType;
  onViewLive: (runId: string) => void;
  streaming: StreamingState;
}) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id });

  return (
    <CardPreviewBody
      card={card}
      className={cn(isDragging && 'opacity-50')}
      draggableProps={{ attributes, listeners, setNodeRef }}
      onClick={() => navigate(`/cards/${card.id}`)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          navigate(`/cards/${card.id}`);
        }
      }}
      onViewLive={onViewLive}
      streaming={streaming}
      style={{ transform: CSS.Translate.toString(transform) }}
    />
  );
}

export function CardPreview({ card, isDragOverlay = false }: CardPreviewProps) {
  const [drawerRunId, setDrawerRunId] = useState<string | null>(null);
  const streaming = useCardEvents({ cardId: card.id, enabled: !isDragOverlay });
  const handleViewLive = (runId: string) => setDrawerRunId(runId);

  if (isDragOverlay) {
    return <StaticCardPreview card={card} onViewLive={handleViewLive} streaming={streaming} />;
  }

  return (
    <>
      <DraggableCardPreview card={card} onViewLive={handleViewLive} streaming={streaming} />
      <RunDetailDrawer
        cardId={card.id}
        cardTitle={card.title}
        onClose={() => setDrawerRunId(null)}
        open={!!drawerRunId}
        runId={drawerRunId}
      />
    </>
  );
}
