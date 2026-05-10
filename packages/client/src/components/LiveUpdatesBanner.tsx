import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';

import type { ConnectionStatus } from '@/hooks/useCardEvents';
import { Button } from '@/components/ui/button';

interface LiveUpdatesBannerProps {
  status: ConnectionStatus;
  onRetry: () => void;
}

export function LiveUpdatesBanner({ status, onRetry }: LiveUpdatesBannerProps) {
  if (status === 'connected' || status === 'idle') {
    return null;
  }

  if (status === 'reconnecting') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
        <RefreshCw className="size-4 animate-spin" />
        <span>Reconnecting to live updates...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
      <div className="flex items-center gap-2">
        <WifiOff className="size-4" />
        <span>Live updates unavailable.</span>
      </div>
      <Button className="h-8" onClick={onRetry} size="sm" type="button" variant="outline">
        <AlertTriangle className="size-4" />
        Retry
      </Button>
    </div>
  );
}
