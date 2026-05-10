import { Bot, User } from 'lucide-react';

import { MarkdownContent } from '@/components/card/MarkdownContent';
import { cn } from '@/lib/utils';

interface ChatMessageProps {
  authorKind: 'human' | 'agent' | 'system';
  authorId: string;
  content: string;
  timestamp: string;
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const diffMs = date.getTime() - Date.now();

  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const absDiffMs = Math.abs(diffMs);

  if (absDiffMs < minute) {
    return 'just now';
  }

  if (absDiffMs < hour) {
    return relativeTimeFormatter.format(Math.round(diffMs / minute), 'minute');
  }

  if (absDiffMs < day) {
    return relativeTimeFormatter.format(Math.round(diffMs / hour), 'hour');
  }

  if (absDiffMs < week) {
    return relativeTimeFormatter.format(Math.round(diffMs / day), 'day');
  }

  return relativeTimeFormatter.format(Math.round(diffMs / week), 'week');
}

export function ChatMessage({
  authorKind,
  authorId,
  content,
  timestamp,
}: ChatMessageProps) {
  if (authorKind === 'system') {
    return (
      <div className="flex justify-center">
        <div className="max-w-xl rounded-full border bg-muted/50 px-4 py-2 text-center text-sm text-muted-foreground">
          <div className="font-medium text-foreground">{authorId}</div>
          <div className="mt-1 whitespace-pre-wrap">{content}</div>
          <div className="mt-2 text-xs">{formatRelativeTime(timestamp)}</div>
        </div>
      </div>
    );
  }

  const isHuman = authorKind === 'human';
  const Icon = isHuman ? User : Bot;

  return (
    <div className={cn('flex', isHuman ? 'justify-end' : 'justify-start')}>
      <article
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-3 shadow-sm sm:max-w-[75%]',
          isHuman ? 'bg-primary text-primary-foreground' : 'border bg-muted/40 text-foreground',
        )}
      >
        <div
          className={cn(
            'mb-2 flex items-center gap-2 text-xs',
            isHuman ? 'justify-end text-primary-foreground/80' : 'text-muted-foreground',
          )}
        >
          {!isHuman ? <Icon className="size-3.5" /> : null}
          <span className="font-medium">{authorId}</span>
          <span>{formatRelativeTime(timestamp)}</span>
          {isHuman ? <Icon className="size-3.5" /> : null}
        </div>

        {isHuman ? (
          <p className="whitespace-pre-wrap break-words text-sm">{content}</p>
        ) : (
          <MarkdownContent className="text-sm" content={content} />
        )}
      </article>
    </div>
  );
}
