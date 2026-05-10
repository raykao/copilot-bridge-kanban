import { useDroppable } from '@dnd-kit/core';

import type { Card as CardType } from '@/api/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import { CardPreview } from './CardPreview';

interface BoardColumnProps {
  columnId: string;
  title: string;
  cards: CardType[];
  count?: number;
}

export function BoardColumn({ columnId, title, cards, count = cards.length }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });

  return (
    <div
      className={cn('flex h-full w-72 shrink-0 flex-col rounded-xl border bg-muted/30 transition-colors', isOver && 'bg-accent/50')}
      ref={setNodeRef}
    >
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <span className="inline-flex min-w-8 items-center justify-center rounded-full bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm">
            {count}
          </span>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {cards.length > 0 ? (
            cards.map((card) => <CardPreview card={card} key={card.id} />)
          ) : (
            <Card className="border border-dashed border-border/80 bg-background/60 shadow-none" size="sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-center text-sm text-muted-foreground">No cards</CardTitle>
              </CardHeader>
              <CardContent className="text-center text-xs text-muted-foreground">
                Nothing here yet.
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
