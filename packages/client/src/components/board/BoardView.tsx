import { BoardColumn } from './BoardColumn';

interface Column {
  id: string;
  title: string;
  cards: import('@/api/types').Card[];
}

interface BoardViewProps {
  columns: Column[];
  isLoading?: boolean;
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

export function BoardView({ columns, isLoading = false }: BoardViewProps) {
  const skeletonColumns = columns.length > 0 ? columns : [
    { id: 'loading-1', title: 'Loading', cards: [] },
    { id: 'loading-2', title: 'Loading', cards: [] },
    { id: 'loading-3', title: 'Loading', cards: [] },
  ];

  return (
    <div className="h-full">
      <div className="flex h-full gap-4 overflow-x-auto pb-2">
        {isLoading
          ? skeletonColumns.map((column) => <BoardSkeletonColumn key={column.id} title={column.title} />)
          : columns.map((column) => (
              <BoardColumn cards={column.cards} count={column.cards.length} key={column.id} title={column.title} />
            ))}
      </div>
    </div>
  );
}
