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
  if (!hasStreamingPayload(streamingState)) {
    return null;
  }

  const isStreaming = streamingState.isStreaming;

  return (
    <section className="space-y-4 rounded-xl border bg-muted/20 p-4">
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
      {streamingState.content.trim() ? (
        <MarkdownContent content={streamingState.content} />
      ) : null}
      <ToolCallTrajectory toolCalls={streamingState.toolCalls} />
    </section>
  );
}
