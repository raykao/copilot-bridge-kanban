import { useEffect, useMemo, useState } from "react";

import { MarkdownContent } from "@/components/card/MarkdownContent";
import { ToolCallTrajectory } from "@/components/card/ToolCallTrajectory";
import type { StreamingState } from "@/hooks/useCardEvents";
import { cn } from "@/lib/utils";

interface StreamingMessageProps {
  streamingState: StreamingState;
}

function hasStreamingPayload(streamingState: StreamingState): boolean {
  return (
    streamingState.isThinking ||
    streamingState.isStreaming ||
    streamingState.content.trim().length > 0 ||
    streamingState.toolCalls.length > 0
  );
}

export function StreamingMessage({ streamingState }: StreamingMessageProps) {
  const [renderedState, setRenderedState] = useState(streamingState);
  const [visible, setVisible] = useState(hasStreamingPayload(streamingState));

  const shouldRender = useMemo(
    () => hasStreamingPayload(streamingState),
    [streamingState],
  );

  useEffect(() => {
    if (shouldRender) {
      setRenderedState(streamingState);
      setVisible(true);
      return;
    }

    const timeout = window.setTimeout(() => {
      setVisible(false);
      setRenderedState(streamingState);
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [shouldRender, streamingState]);

  if (!visible) {
    return null;
  }

  const isStreaming = streamingState.isStreaming;

  return (
    <section
      className={cn(
        "space-y-4 rounded-xl border bg-muted/20 p-4 transition-opacity duration-300",
        shouldRender ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <span
          className={cn(
            "size-2 rounded-full bg-primary",
            isStreaming || streamingState.isThinking ? "animate-pulse" : "opacity-60",
          )}
        />
        <span>
          {streamingState.isThinking && !isStreaming
            ? "Agent is thinking..."
            : isStreaming
              ? "Agent is streaming"
              : "Agent response completed"}
        </span>
      </div>

      {renderedState.content.trim() ? (
        <MarkdownContent content={renderedState.content} />
      ) : null}
      <ToolCallTrajectory toolCalls={renderedState.toolCalls} />
    </section>
  );
}
