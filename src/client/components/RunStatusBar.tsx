import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';

import { api } from '@/api/client';
import type { ResumeDecision, Run } from '@/api/types';
import { Button } from '@/components/ui/button';
import type { StreamingState } from '@/hooks/useCardEvents';
import { cn } from '@/lib/utils';

interface RunStatusBarProps {
  cardId: string;
  latestRun: Run | null;
  streaming: StreamingState;
  onViewLive: (runId: string) => void;
}

function truncateError(error: string): string {
  return error.length > 60 ? `${error.slice(0, 57)}...` : error;
}

function ViewLiveButton({ runId, onViewLive }: { runId: string; onViewLive: (runId: string) => void }) {
  return (
    <Button
      className="h-auto px-0 text-xs"
      onClick={() => onViewLive(runId)}
      size="sm"
      type="button"
      variant="link"
    >
      View live
    </Button>
  );
}

export function RunStatusBar({ cardId, latestRun, streaming, onViewLive }: RunStatusBarProps) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [isCompletedFading, setIsCompletedFading] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);

  // Reset resuming state whenever the run changes or status transitions away from awaiting.
  // This keeps "Processing approval..." visible until the React Query refetch confirms the
  // status change, preventing the approval buttons from briefly re-appearing after submission.
  useEffect(() => {
    setIsResuming(false);
    setResumeError(null);
  }, [latestRun?.id, latestRun?.status]);

  useEffect(() => {
    if (latestRun?.status !== 'completed') {
      setShowCompleted(false);
      setIsCompletedFading(false);
      return;
    }

    setShowCompleted(true);
    setIsCompletedFading(false);
    const fadeTimeout = window.setTimeout(() => {
      setIsCompletedFading(true);
    }, 5000);

    return () => {
      window.clearTimeout(fadeTimeout);
    };
  }, [latestRun?.id, latestRun?.status]);

  if (!latestRun || latestRun.status === 'created') {
    return null;
  }

  const barClassName =
    'flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-background px-3 py-2 text-sm shadow-sm';
  const statusClassName = 'flex min-w-0 items-center gap-2';

  if (latestRun.status === 'running' && streaming.isStreaming) {
    return (
      <div className={barClassName}>
        <div className={cn(statusClassName, 'text-muted-foreground')}>
          <Loader2 className="size-4 animate-spin text-primary" />
          <span>Working...</span>
        </div>
        <ViewLiveButton onViewLive={onViewLive} runId={latestRun.id} />
      </div>
    );
  }

  if (latestRun.status === 'awaiting') {
    const awaitingPermission = streaming.awaitingPermission;
    const toolName = awaitingPermission?.tool || 'Permission requested';
    const awaitingRunId = awaitingPermission?.runId ?? latestRun.id;

    const resume = async (decision: ResumeDecision) => {
      setIsResuming(true);
      setResumeError(null);
      try {
        await api.runs.resume(cardId, awaitingRunId, decision);
        // Keep isResuming=true on success; the useEffect above clears it when
        // latestRun.status transitions away from 'awaiting'.
      } catch {
        setResumeError('Approval failed - please try again');
        setIsResuming(false);
      }
    };

    // While submitting, show a neutral processing bar so the user knows it worked
    if (isResuming) {
      return (
        <div className={barClassName}>
          <div className={cn(statusClassName, 'text-muted-foreground')}>
            <Loader2 className="size-4 animate-spin text-primary" />
            <span>Processing approval...</span>
          </div>
        </div>
      );
    }

    return (
      <div className={cn(barClassName, 'bg-amber-500/10 text-amber-900 dark:text-amber-200')}>
        <div className={statusClassName}>
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-300" />
          <span className="truncate">{resumeError ?? `Awaiting approval: ${toolName}`}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void resume('allow-once')} size="sm" type="button">
            Approve once
          </Button>
          <Button onClick={() => void resume('allow-session')} size="sm" type="button" variant="outline">
            Allow session
          </Button>
          <Button onClick={() => void resume('allow-all')} size="sm" type="button" variant="outline">
            Always allow
          </Button>
          <Button onClick={() => void resume('deny')} size="sm" type="button" variant="outline">
            Deny
          </Button>
          <Button onClick={() => void resume('deny-session')} size="sm" type="button" variant="outline">
            Deny session
          </Button>
          <Button onClick={() => void resume('deny-all')} size="sm" type="button" variant="outline">
            Always deny
          </Button>

          <ViewLiveButton onViewLive={onViewLive} runId={latestRun.id} />
        </div>
      </div>
    );
  }


  if (latestRun.status === 'interrupted') {
    const reconnect = async () => {
      setIsReconnecting(true);
      setReconnectError(null);
      try {
        await api.runs.reconnect(cardId, latestRun.id);
      } catch {
        setReconnectError('Reconnect failed - please try again');
      } finally {
        setIsReconnecting(false);
      }
    };

    if (isReconnecting) {
      return (
        <div className={barClassName}>
          <div className={cn(statusClassName, 'text-muted-foreground')}>
            <Loader2 className="size-4 animate-spin text-primary" />
            <span>Reconnecting...</span>
          </div>
        </div>
      );
    }

    return (
      <div className={cn(barClassName, 'bg-destructive/10 text-destructive')}>
        <div className={statusClassName}>
          <XCircle className="size-4" />
          <span>{reconnectError ?? 'Interrupted'}</span>
        </div>
        <Button onClick={() => void reconnect()} size="sm" type="button" variant="outline">
          Reconnect
        </Button>
      </div>
    );
  }

  if (latestRun.status === 'completed' && showCompleted) {
    return (
      <div
        className={cn(barClassName, 'bg-accent/40 transition-opacity duration-300', isCompletedFading && 'opacity-0')}
        onTransitionEnd={() => {
          if (isCompletedFading) {
            setShowCompleted(false);
          }
        }}
      >
        <div className={cn(statusClassName, 'text-emerald-700 dark:text-emerald-300')}>
          <CheckCircle2 className="size-4" />
          <span>Done</span>
        </div>
      </div>
    );
  }

  if (latestRun.status === 'failed') {
    const error = latestRun.error ? truncateError(latestRun.error) : null;

    return (
      <div className={cn(barClassName, 'bg-destructive/10 text-destructive')}>
        <div className={statusClassName}>
          <XCircle className="size-4" />
          <span>Failed{error ? `: ${error}` : ''}</span>
        </div>
      </div>
    );
  }

  return null;
}
