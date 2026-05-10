import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitFork, Plus, Trash2 } from "lucide-react";

import { api } from "@/api/client";
import type { Checkpoint } from "@/api/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface CheckpointListProps {
  cardId: string;
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const diffMs = date.getTime() - Date.now();

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const absDiffMs = Math.abs(diffMs);

  if (absDiffMs < minute) {
    return "just now";
  }

  if (absDiffMs < hour) {
    return relativeTimeFormatter.format(Math.round(diffMs / minute), "minute");
  }

  if (absDiffMs < day) {
    return relativeTimeFormatter.format(Math.round(diffMs / hour), "hour");
  }

  if (absDiffMs < week) {
    return relativeTimeFormatter.format(Math.round(diffMs / day), "day");
  }

  return relativeTimeFormatter.format(Math.round(diffMs / week), "week");
}

function getCheckpointName(checkpoint: Checkpoint): string {
  const name = checkpoint.name?.trim();
  return name?.length ? name : "Checkpoint";
}

export function CheckpointList({ cardId }: CheckpointListProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Checkpoint | null>(null);

  const { data: checkpoints = [], isLoading, isError } = useQuery({
    queryKey: ["checkpoints", cardId],
    queryFn: () => api.checkpoints.list(cardId),
  });

  const sortedCheckpoints = useMemo(
    () =>
      [...checkpoints].sort(
        (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
      ),
    [checkpoints],
  );

  async function invalidateCheckpoints() {
    await queryClient.invalidateQueries({ queryKey: ["checkpoints", cardId] });
  }

  const createMutation = useMutation({
    mutationFn: (checkpointName?: string) => api.checkpoints.create(cardId, checkpointName),
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      setName("");
      await invalidateCheckpoints();
    },
    onError: () => {
      setActionError("Unable to create the checkpoint right now.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (checkpointId: string) => api.checkpoints.delete(cardId, checkpointId),
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      setDeleteTarget(null);
      await invalidateCheckpoints();
    },
    onError: () => {
      setActionError("Unable to delete the checkpoint right now.");
    },
  });

  async function handleCreate(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (createMutation.isPending) {
      return;
    }

    const trimmedName = name.trim();

    try {
      await createMutation.mutateAsync(trimmedName || undefined);
    } catch {
      return;
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleteMutation.isPending) {
      return;
    }

    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
    } catch {
      return;
    }
  }

  return (
    <>
      <div className="space-y-3">
        <form className="space-y-2" onSubmit={(event) => void handleCreate(event)}>
          <Input
            disabled={createMutation.isPending}
            onChange={(event) => setName(event.target.value)}
            placeholder="Checkpoint name (optional)"
            value={name}
          />
          <Button className="w-full" disabled={createMutation.isPending} size="sm" type="submit">
            <Plus />
            {createMutation.isPending ? "Creating..." : "Create"}
          </Button>
        </form>

        {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

        <div className="space-y-2">
          {isLoading ? (
            <div className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
              Loading checkpoints...
            </div>
          ) : isError ? (
            <div className="rounded-xl border border-dashed px-3 py-4 text-sm text-destructive">
              Unable to load checkpoints.
            </div>
          ) : sortedCheckpoints.length ? (
            sortedCheckpoints.map((checkpoint) => (
              <div
                className="rounded-xl border bg-muted/10 px-3 py-3"
                key={checkpoint.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="truncate text-sm font-medium">
                      {getCheckpointName(checkpoint)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Turn {checkpoint.turn_index}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatRelativeTime(checkpoint.created_at)}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger render={<span className="inline-flex" />}>
                        <Button
                          aria-label="Fork checkpoint"
                          disabled
                          size="icon-xs"
                          type="button"
                          variant="ghost"
                        >
                          <GitFork />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Coming in v1.5</TooltipContent>
                    </Tooltip>

                    <Button
                      aria-label={`Delete ${getCheckpointName(checkpoint)}`}
                      disabled={deleteMutation.isPending}
                      onClick={() => setDeleteTarget(checkpoint)}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
              No checkpoints yet
            </div>
          )}
        </div>
      </div>

      <AlertDialog onOpenChange={(open) => !open && setDeleteTarget(null)} open={!!deleteTarget}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete checkpoint &apos;{deleteTarget ? getCheckpointName(deleteTarget) : "Checkpoint"}&apos;?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => void handleDelete()}
              variant="destructive"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
