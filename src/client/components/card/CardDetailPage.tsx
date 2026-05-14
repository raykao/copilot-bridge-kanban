import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, CircleSlash, PencilLine, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import type { Agent, Card, CardComment, Run } from "@/api/types";
import { LiveUpdatesBanner } from "@/components/LiveUpdatesBanner";
import { RunDetailDrawer } from "@/components/RunDetailDrawer";
import { RunStatusBar } from "@/components/RunStatusBar";
import { CheckpointList } from "@/components/card/CheckpointList";
import { CommentThread } from "@/components/card/CommentThread";
import { LabelEditor } from "@/components/card/LabelEditor";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card as SurfaceCard,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useCardEvents } from "@/hooks/useCardEvents";

interface CardDetailPageProps {
  card: Card;
  agents: Agent[];
  comments: CardComment[];
  runs: Run[];
}

type CardUpdatePatch = Partial<Pick<Card, "title" | "status">> & {
  agent?: string | null;
};

const statusOptions: Card["status"][] = [
  "idea",
  "refining",
  "ready",
  "in_progress",
  "paused",
  "done",
  "archived",
];

const unassignedAgentValue = "__unassigned__";

function formatStatus(status: Card["status"]): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) {
    return "-";
  }

  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return "-";
  }

  return value.toLocaleString();
}

export function CardDetailPage({
  card,
  agents,
  comments,
  runs,
}: CardDetailPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(card.title);
  const [actionError, setActionError] = useState<string | null>(null);
  const [abortOpen, setAbortOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [viewRunId, setViewRunId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const streamingState = useCardEvents({ cardId: card.id });

  const sortedAgents = useMemo(
    () =>
      [...agents].sort((left, right) => left.name.localeCompare(right.name)),
    [agents],
  );

  const latestRun = useMemo(() => {
    if (runs.length === 0) return null;
    const active = runs.filter(r => r.status !== 'completed' && r.status !== 'failed');
    const pool = active.length > 0 ? active : runs;
    return [...pool].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0] ?? null;
  }, [runs]);

  useEffect(() => {
    setTitleDraft(card.title);
  }, [card.title]);

  async function invalidateCards() {
    await queryClient.invalidateQueries({ queryKey: ["cards"] });
  }

  const updateMutation = useMutation({
    mutationFn: (patch: CardUpdatePatch) => api.cards.update(card.id, patch),
    onSuccess: async () => {
      setActionError(null);
      await invalidateCards();
    },
    onError: () => {
      setActionError("Unable to update the card right now.");
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => api.cards.archive(card.id),
    onSuccess: async () => {
      setActionError(null);
      await invalidateCards();
    },
    onError: () => {
      setActionError("Unable to archive the card right now.");
    },
  });

  const abortMutation = useMutation({
    mutationFn: () => api.cards.abort(card.id),
    onSuccess: async () => {
      setAbortOpen(false);
      setActionError(null);
      await invalidateCards();
    },
    onError: () => {
      setActionError("Unable to abort the card right now.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.cards.delete(card.id),
    onSuccess: async () => {
      setDeleteOpen(false);
      setActionError(null);
      await invalidateCards();
      navigate("/board");
    },
    onError: () => {
      setActionError("Unable to delete the card right now.");
    },
  });

  const isMutating =
    updateMutation.isPending ||
    archiveMutation.isPending ||
    abortMutation.isPending ||
    deleteMutation.isPending;

  async function commitTitle() {
    const nextTitle = titleDraft.trim();

    if (!nextTitle || nextTitle === card.title) {
      setTitleDraft(card.title);
      setIsEditingTitle(false);
      return;
    }

    try {
      await updateMutation.mutateAsync({ title: nextTitle });
      setIsEditingTitle(false);
    } catch {
      setTitleDraft(card.title);
    }
  }

  function handleAgentChange(value: string | null) {
    if (!value) {
      return;
    }

    const nextAgent = value === unassignedAgentValue ? null : value;
    if (nextAgent === card.agent_bot) {
      return;
    }

    updateMutation.mutate({ agent: nextAgent });
  }

  function handleStatusChange(value: string | null) {
    if (!value) {
      return;
    }

    const nextStatus = value as Card["status"];
    if (nextStatus === card.status) {
      return;
    }

    updateMutation.mutate({ status: nextStatus });
  }

  return (
    <>
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
        <SurfaceCard className="min-h-[calc(100vh-10rem)] min-w-0 flex-1">
          <CardHeader className="gap-4 border-b">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                {isEditingTitle ? (
                  <Input
                    autoFocus
                    className="h-auto px-0 py-0 text-2xl font-semibold tracking-tight sm:text-3xl"
                    onBlur={() => {
                      void commitTitle();
                    }}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitTitle();
                      }

                      if (event.key === "Escape") {
                        setTitleDraft(card.title);
                        setIsEditingTitle(false);
                      }
                    }}
                    value={titleDraft}
                  />
                ) : (
                  <button
                    className="inline-flex min-h-11 items-center gap-2 text-left"
                    onClick={() => setIsEditingTitle(true)}
                    type="button"
                  >
                    <CardTitle className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">
                      {card.title}
                    </CardTitle>
                    <PencilLine className="size-4 text-muted-foreground" />
                  </button>
                )}
                <p className="text-sm text-muted-foreground">
                  Card detail and editable metadata.
                </p>
              </div>
              <Badge variant="outline">{formatStatus(card.status)}</Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-6 py-4">
            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-medium">Description</h2>
                <p className="text-sm text-muted-foreground">
                  Plain text for now. Markdown rendering ships in f13.
                </p>
              </div>
              <div className="min-h-32 whitespace-pre-wrap break-words rounded-xl border bg-muted/20 p-4 text-sm text-foreground">
                {card.description?.trim()
                  ? card.description
                  : "No description yet."}
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <LiveUpdatesBanner
                onRetry={streamingState.retry}
                status={streamingState.connectionStatus}
              />
              <RunStatusBar
                cardId={card.id}
                latestRun={latestRun}
                streaming={streamingState}
                onViewLive={(runId) => {
                  setViewRunId(runId);
                  setDrawerOpen(true);
                }}
              />
              <CommentThread cardId={card.id} comments={comments} streamingState={streamingState} />
            </section>
          </CardContent>
        </SurfaceCard>

        <SurfaceCard className="w-full shrink-0 lg:sticky lg:top-4 lg:w-80">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 pb-4">
            <div className="space-y-2">
              <Label htmlFor="card-status">Status</Label>
              <Select onValueChange={handleStatusChange} value={card.status}>
                <SelectTrigger
                  className="min-h-11 w-full"
                  disabled={updateMutation.isPending}
                  id="card-status"
                >
                  <SelectValue placeholder="Select a status" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((status) => (
                    <SelectItem key={status} value={status}>
                      {formatStatus(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="card-agent">Agent</Label>
              <Select
                onValueChange={handleAgentChange}
                value={card.agent_bot ?? unassignedAgentValue}
              >
                <SelectTrigger
                  className="min-h-11 w-full"
                  disabled={updateMutation.isPending}
                  id="card-agent"
                >
                  <SelectValue placeholder="Assign an agent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={unassignedAgentValue}>
                    Unassigned
                  </SelectItem>
                  {sortedAgents.map((agent) => (
                    <SelectItem key={agent.name} value={agent.name}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Labels</Label>
              <LabelEditor cardId={card.id} labels={card.labels} />
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <div>
                <Badge variant="secondary">{card.type}</Badge>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Timestamps</Label>
              <dl className="grid gap-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Created</dt>
                      <dd className="break-words text-right">
                        {formatTimestamp(card.created_at)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">Updated</dt>
                      <dd className="break-words text-right">
                        {formatTimestamp(card.updated_at)}
                      </dd>
                    </div>
                    {card.archived_at ? (
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-muted-foreground">Archived</dt>
                        <dd className="break-words text-right">
                          {formatTimestamp(card.archived_at)}
                        </dd>
                      </div>
                ) : null}
              </dl>
            </div>

            {actionError ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {actionError}
              </div>
            ) : null}

            <Separator />

            <section className="space-y-3">
              <Label>Checkpoints</Label>
              <CheckpointList cardId={card.id} />
            </section>

            <Separator />

            <div className="space-y-2">
              <Label>Actions</Label>
              <div className="grid gap-2">
                {!card.archived_at ? (
                  <Button
                    className="min-h-11"
                    disabled={isMutating}
                    onClick={() => archiveMutation.mutate()}
                    variant="outline"
                  >
                    <Archive />
                    Archive
                  </Button>
                ) : null}
                {card.status === "in_progress" ? (
                  <Button
                    className="min-h-11"
                    disabled={isMutating}
                    onClick={() => setAbortOpen(true)}
                    variant="outline"
                  >
                    <CircleSlash />
                    Abort
                  </Button>
                ) : null}
                <Button
                  className="min-h-11"
                  disabled={isMutating}
                  onClick={() => setDeleteOpen(true)}
                  variant="destructive"
                >
                  <Trash2 />
                  Delete
                </Button>
              </div>
            </div>
          </CardContent>
        </SurfaceCard>
      </div>

      <AlertDialog onOpenChange={setAbortOpen} open={abortOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Abort run?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop the active run for this card.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={abortMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              disabled={abortMutation.isPending}
              onClick={() => abortMutation.mutate()}
              variant="destructive"
            >
              Abort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog onOpenChange={setDeleteOpen} open={deleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete card?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the card and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
              variant="destructive"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RunDetailDrawer
        cardId={card.id}
        cardTitle={card.title}
        onClose={() => setDrawerOpen(false)}
        open={drawerOpen}
        runId={viewRunId}
      />
    </>
  );
}
