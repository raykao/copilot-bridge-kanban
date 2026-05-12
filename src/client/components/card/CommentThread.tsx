import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, SendHorizontal, Settings, User } from 'lucide-react';

import { api } from '@/api/client';
import type { CardComment } from '@/api/types';
import { MarkdownContent } from '@/components/card/MarkdownContent';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface CommentThreadProps {
  cardId: string;
  comments: CardComment[];
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const authorStyles = {
  human: {
    icon: User,
    className: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200',
    label: 'Human',
  },
  agent: {
    icon: Bot,
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
    label: 'Agent',
  },
  system: {
    icon: Settings,
    className: 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200',
    label: 'System',
  },
} as const;

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

export function CommentThread({ cardId, comments }: CommentThreadProps) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const sortedComments = useMemo(
    () =>
      [...comments].sort(
        (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
      ),
    [comments],
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [sortedComments]);

  const addCommentMutation = useMutation({
    mutationFn: (nextContent: string) => api.comments.add(cardId, nextContent),
    onMutate: () => {
      setSubmitError(null);
    },
    onSuccess: async () => {
      setContent('');
      await queryClient.invalidateQueries({ queryKey: ['cards', cardId] });
    },
    onError: () => {
      setSubmitError('Unable to post the comment right now.');
    },
  });

  async function handleSubmit(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    const nextContent = content.trim();
    if (!nextContent || addCommentMutation.isPending) {
      return;
    }

    try {
      await addCommentMutation.mutateAsync(nextContent);
    } catch {
      return;
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Comments</h2>
        <p className="text-sm text-muted-foreground">Discuss the card with markdown support and inline updates.</p>
      </div>

      <div className="space-y-3 rounded-xl border bg-muted/10 p-4">
        {sortedComments.length ? (
          sortedComments.map((comment) => {
            const authorStyle = authorStyles[comment.author_kind];
            const AuthorIcon = authorStyle.icon;

            return (
              <article className="rounded-xl border bg-background p-4 shadow-sm" key={comment.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={cn('gap-1', authorStyle.className)} variant="secondary">
                    <AuthorIcon className="size-3" />
                    {authorStyle.label}
                  </Badge>
                  <span className="text-sm font-medium text-foreground">{comment.author_id}</span>
                  <span className="text-xs text-muted-foreground">{formatRelativeTime(comment.created_at)}</span>
                </div>
                <MarkdownContent className="mt-3" content={comment.content} />
              </article>
            );
          })
        ) : (
          <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
            No comments yet.
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form className="space-y-3 rounded-xl border bg-background p-4" onSubmit={(event) => void handleSubmit(event)}>
        <Textarea
          disabled={addCommentMutation.isPending}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder="Write a comment in markdown..."
          rows={4}
          value={content}
        />
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">Press Ctrl+Enter to send.</div>
          <Button disabled={addCommentMutation.isPending || !content.trim()} type="submit">
            <SendHorizontal />
            {addCommentMutation.isPending ? 'Sending...' : 'Send'}
          </Button>
        </div>
        {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
      </form>
    </div>
  );
}
