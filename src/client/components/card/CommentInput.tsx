import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SendHorizontal } from 'lucide-react';

import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface CommentInputProps {
  cardId: string;
}

export function CommentInput({ cardId }: CommentInputProps) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const addCommentMutation = useMutation({
    mutationFn: (nextContent: string) => api.comments.add(cardId, nextContent),
    onMutate: () => { setSubmitError(null); },
    onSuccess: async () => {
      setContent('');
      await queryClient.invalidateQueries({ queryKey: ['cards', cardId] });
    },
    onError: () => { setSubmitError('Unable to post the comment right now.'); },
  });

  async function handleSubmit(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const nextContent = content.trim();
    if (!nextContent || addCommentMutation.isPending) return;
    try {
      await addCommentMutation.mutateAsync(nextContent);
    } catch {
      return;
    }
  }

  return (
    <form className="space-y-3" onSubmit={(e) => void handleSubmit(e)}>
      <Textarea
        disabled={addCommentMutation.isPending}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void handleSubmit();
          }
        }}
        placeholder="Write a comment in markdown..."
        rows={3}
        value={content}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          Press Enter to send, Shift+Enter for new line.
        </div>
        <Button
          disabled={addCommentMutation.isPending || !content.trim()}
          type="submit"
          size="sm"
        >
          <SendHorizontal />
          {addCommentMutation.isPending ? 'Sending...' : 'Send'}
        </Button>
      </div>
      {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
    </form>
  );
}
