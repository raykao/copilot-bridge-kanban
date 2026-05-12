import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';

import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

interface LabelEditorProps {
  cardId: string;
  labels: string[];
}

export function LabelEditor({ cardId, labels }: LabelEditorProps) {
  const queryClient = useQueryClient();
  const [newLabel, setNewLabel] = useState('');

  const addLabelMutation = useMutation({
    mutationFn: (label: string) => api.labels.add(cardId, [label]),
    onSuccess: async () => {
      setNewLabel('');
      await queryClient.invalidateQueries({ queryKey: ['cards'] });
    },
  });

  const removeLabelMutation = useMutation({
    mutationFn: (label: string) => api.labels.remove(cardId, label),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cards'] });
    },
  });

  async function handleAddLabel() {
    const normalized = newLabel.trim();
    if (!normalized) {
      setNewLabel('');
      return;
    }

    if (labels.includes(normalized)) {
      setNewLabel('');
      return;
    }

    await addLabelMutation.mutateAsync(normalized);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {labels.map((label) => (
          <Badge className="gap-1 pr-1" key={label} variant="secondary">
            <span>{label}</span>
            <button
              aria-label={`Remove ${label} label`}
              className="rounded-full p-0.5 transition-colors hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={removeLabelMutation.isPending}
              onClick={() => removeLabelMutation.mutate(label)}
              type="button"
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <Input
          className="h-8 min-w-32 flex-1"
          disabled={addLabelMutation.isPending}
          onChange={(event) => setNewLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void handleAddLabel();
            }
          }}
          placeholder="Add label"
          value={newLabel}
        />
      </div>
    </div>
  );
}
