import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { api } from '@/api/client';
import type { CardComment } from '@/api/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface CreateCardFromChatProps {
  chatHistory: CardComment[];
  agentName: string;
}

function buildChatSummary(chatHistory: CardComment[]): string {
  const summaryLines = chatHistory
    .slice(0, 6)
    .map((comment) => {
      const label =
        comment.author_kind === 'human'
          ? 'Human'
          : comment.author_kind === 'agent'
            ? 'Agent'
            : 'System';

      return `- ${label} (${comment.author_id}): ${comment.content.trim()}`;
    })
    .filter((line) => line.trim().length > 0);

  return summaryLines.join('\n\n').slice(0, 1600);
}

export function CreateCardFromChat({
  chatHistory,
  agentName,
}: CreateCardFromChatProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const summary = useMemo(() => buildChatSummary(chatHistory), [chatHistory]);

  const createCardMutation = useMutation({
    mutationFn: (card: { title: string; description?: string }) =>
      api.cards.create({
        title: card.title,
        description: card.description,
        type: 'work',
        agent_bot: agentName,
      }),
    onSuccess: async (card) => {
      await queryClient.invalidateQueries({ queryKey: ['cards'] });
      setOpen(false);
      navigate(`/cards/${card.id}`);
    },
    onError: () => {
      setSubmitError('Unable to create the work card right now.');
    },
  });

  useEffect(() => {
    if (!open) {
      setTitle('');
      setDescription('');
      setTitleError(null);
      setSubmitError(null);
      return;
    }

    setTitle(`Follow up with ${agentName}`);
    setDescription(summary);
  }, [agentName, open, summary]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      createCardMutation.reset();
    }
    setOpen(nextOpen);
  }, [createCardMutation]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextTitle = title.trim();
    if (!nextTitle) {
      setTitleError('Title is required.');
      return;
    }

    setTitleError(null);
    setSubmitError(null);

    await createCardMutation.mutateAsync({
      title: nextTitle,
      description: description.trim() || undefined,
    });
  };

  return (
    <>
      <Button
        disabled={chatHistory.length === 0}
        onClick={() => handleOpenChange(true)}
        type="button"
        variant="outline"
      >
        <Plus />
        Create work card
      </Button>

      <Dialog onOpenChange={handleOpenChange} open={open}>
        <DialogContent className="max-w-xl p-0">
          <form className="grid gap-4" onSubmit={(event) => void handleSubmit(event)}>
            <div className="grid gap-4 px-4 pt-4">
              <DialogHeader>
                <DialogTitle>Create work card</DialogTitle>
                <DialogDescription>Promote this chat into a tracked work item.</DialogDescription>
              </DialogHeader>

              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="chat-work-card-title">
                  Title
                </label>
                <Input
                  aria-invalid={titleError ? 'true' : 'false'}
                  autoFocus
                  id="chat-work-card-title"
                  onChange={(event) => {
                    setTitle(event.target.value);
                    if (titleError) {
                      setTitleError(null);
                    }
                  }}
                  placeholder="Investigate the next step"
                  value={title}
                />
                {titleError ? <p className="text-sm text-destructive">{titleError}</p> : null}
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="chat-work-card-agent">
                  Agent
                </label>
                <Input disabled id="chat-work-card-agent" value={agentName} />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor="chat-work-card-description">
                  Description
                </label>
                <Textarea
                  id="chat-work-card-description"
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Conversation summary"
                  rows={8}
                  value={description}
                />
              </div>

              {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
            </div>

            <DialogFooter>
              <Button
                disabled={createCardMutation.isPending}
                onClick={() => handleOpenChange(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={createCardMutation.isPending} type="submit">
                {createCardMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
