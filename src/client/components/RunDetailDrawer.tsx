import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';

import { api } from '@/api/client';
import type { ResumeDecision, Run, ToolCall } from '@/api/types';
import { Button } from '@/components/ui/button';
import { useCardEvents } from '@/hooks/useCardEvents';
import { cn } from '@/lib/utils';

export interface RunDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  cardId: string;
  cardTitle: string;
  runId: string | null;
}

type RunStatus = Run['status'];

function formatRunStatus(status: RunStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function getRunStatusBadgeClassName(status: RunStatus): string {
  switch (status) {
    case 'running':
      return 'bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300';
    case 'awaiting':
      return 'bg-yellow-500/10 text-yellow-800 ring-yellow-500/20 dark:text-yellow-300';
    case 'completed':
      return 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300';
    case 'failed':
      return 'bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-300';
    case 'interrupted':
      return 'bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300';
    case 'created':
      return 'bg-muted text-muted-foreground ring-border';
  }
}

function getToolStatusLabel(status: ToolCall['status']): string {
  switch (status) {
    case 'pending':
      return 'running';
    case 'completed':
      return 'done';
    case 'failed':
      return 'error';
  }
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? '';
}

export function RunDetailDrawer({
  open,
  onClose,
  cardId,
  cardTitle,
  runId,
}: RunDetailDrawerProps) {
  const [isResuming, setIsResuming] = useState<boolean>(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const streaming = useCardEvents({ cardId, enabled: open });
  const { data } = useQuery({
    queryKey: ['run', cardId, runId],
    queryFn: () => api.runs.get(cardId, runId!),
    enabled: open && runId != null,
  });
  const run = data?.run ?? null;

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    if (isNearBottom) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [streaming]);

  const handleResume = async (decision: ResumeDecision) => {
    if (!runId) {
      return;
    }

    setIsResuming(true);
    try {
      await api.runs.resume(cardId, runId, decision);
    } finally {
      setIsResuming(false);
    }
  };

  return (
    <>
      {open ? (
        <button
          aria-label="Close run details"
          className="fixed inset-0 z-40 bg-black/40"
          onClick={onClose}
          type="button"
        />
      ) : null}

      <aside
        aria-hidden={!open}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-[45vw] min-w-[360px] flex-col border-l bg-background shadow-xl transition-transform duration-300 ease-in-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0 space-y-2">
            <h2 className="truncate text-lg font-semibold text-foreground">{cardTitle}</h2>
            {runId && run ? (
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
                  getRunStatusBadgeClassName(run.status),
                )}
              >
                {formatRunStatus(run.status)}
              </span>
            ) : null}
          </div>

          <Button aria-label="Close run details" onClick={onClose} size="icon-sm" type="button" variant="ghost">
            <X />
          </Button>
        </header>

        <div ref={scrollContainerRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {streaming.isStreaming || streaming.content ? (
            <>
              <div className="text-xs text-muted-foreground">Agent started</div>
              {streaming.content ? (
                <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs">{streaming.content}</pre>
              ) : null}
            </>
          ) : null}

          {streaming.toolCalls.map((toolCall) => (
            <details key={toolCall.id} className="rounded border p-2 text-sm" open>
              <summary>Tool: {toolCall.name}</summary>
              <div className="mt-2 space-y-2">
                <div className="text-xs text-muted-foreground">Status: {getToolStatusLabel(toolCall.status)}</div>
                <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs">{formatJson(toolCall.input)}</pre>
                {toolCall.status === 'completed' ? (
                  <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs">{formatJson(toolCall.output)}</pre>
                ) : null}
                {toolCall.status === 'failed' ? (
                  <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs text-red-600">
                    {formatJson(toolCall.error)}
                  </pre>
                ) : null}
              </div>
            </details>
          ))}

          {streaming.awaitingPermission ? (
            <div className="space-y-2 border-l-4 border-yellow-400 py-2 pl-3">
              <div className="text-sm font-medium">Permission required: {streaming.awaitingPermission.tool}</div>
              {streaming.awaitingPermission.detail ? (
                <div className="text-sm text-muted-foreground">{streaming.awaitingPermission.detail}</div>
              ) : null}
              <div className="flex gap-2">
                <Button
                  disabled={isResuming || !runId}
                  onClick={() => void handleResume('allow-once')}
                  type="button"
                >
                  Approve
                </Button>
                <Button
                  disabled={isResuming || !runId}
                  onClick={() => void handleResume('deny')}
                  type="button"
                  variant="outline"
                >
                  Deny
                </Button>
              </div>
            </div>
          ) : null}

          {run?.status === 'completed' ? (
            <div className="text-sm font-medium text-green-600">Run completed</div>
          ) : null}
          {run?.status === 'failed' ? (
            <div className="text-sm font-medium text-red-600">Run failed: {run.error}</div>
          ) : null}
          <div ref={logEndRef} />
        </div>
      </aside>
    </>
  );
}
