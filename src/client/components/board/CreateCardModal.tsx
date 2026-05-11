import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface CreateCardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const noAgentValue = 'none';

export function CreateCardModal({ open, onOpenChange }: CreateCardModalProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [agent, setAgent] = useState(noAgentValue);
  const [labels, setLabels] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.agents.list(),
    staleTime: 60_000,
  });

  const createCardMutation = useMutation({
    mutationFn: (card: {
      title: string;
      description?: string;
      agent?: string;
      labels?: string[];
    }) => api.cards.create(card),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cards'] });
      onOpenChange(false);
    },
    onError: () => {
      setSubmitError('Unable to create the card right now.');
    },
  });

  const mutationRef = useRef(createCardMutation);
  mutationRef.current = createCardMutation;

  useEffect(() => {
    if (!open) {
      setTitle('');
      setDescription('');
      setAgent(noAgentValue);
      setLabels('');
      setTitleError(null);
      setSubmitError(null);
      mutationRef.current.reset();
    }
  }, [open]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextTitle = title.trim();
    if (!nextTitle) {
      setTitleError('Title is required.');
      return;
    }

    setTitleError(null);
    setSubmitError(null);

    const nextDescription = description.trim();
    const nextLabels = labels
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean);

    await createCardMutation.mutateAsync({
      title: nextTitle,
      description: nextDescription || undefined,
      agent: agent === noAgentValue ? undefined : agent,
      labels: nextLabels.length > 0 ? nextLabels : undefined,
    });
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-lg p-0">
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 px-4 pt-4">
            <DialogHeader>
              <DialogTitle>Create card</DialogTitle>
              <DialogDescription>Add a new work item to the board.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="create-card-title">
                Title
              </label>
              <Input
                aria-invalid={titleError ? 'true' : 'false'}
                autoFocus
                id="create-card-title"
                onChange={(event) => {
                  setTitle(event.target.value);
                  if (titleError) {
                    setTitleError(null);
                  }
                }}
                placeholder="Ship the next milestone"
                value={title}
              />
              {titleError ? <p className="text-sm text-destructive">{titleError}</p> : null}
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="create-card-description">
                Description
              </label>
              <Textarea
                id="create-card-description"
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional context for the agent"
                rows={4}
                value={description}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="create-card-agent">
                Agent
              </label>
              <Select onValueChange={(value) => setAgent(value ?? noAgentValue)} value={agent}>
                <SelectTrigger className="w-full" id="create-card-agent">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={noAgentValue}>None</SelectItem>
                  {agents.map((item) => (
                    <SelectItem key={item.name} value={item.name}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="create-card-labels">
                Labels
              </label>
              <Input
                id="create-card-labels"
                onChange={(event) => setLabels(event.target.value)}
                placeholder="frontend, urgent"
                value={labels}
              />
              <p className="text-xs text-muted-foreground">Separate labels with commas.</p>
            </div>

            {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
          </div>

          <DialogFooter>
            <Button
              disabled={createCardMutation.isPending}
              onClick={() => onOpenChange(false)}
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
  );
}
