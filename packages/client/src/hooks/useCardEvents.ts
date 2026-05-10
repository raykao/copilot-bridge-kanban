import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { subscribeToCardEvents } from "@/api/client";
import type { CardEvent, ToolCall } from "@/api/types";

export interface UseCardEventsOptions {
  cardId: string;
  enabled?: boolean;
}

export interface StreamingState {
  isStreaming: boolean;
  content: string;
  toolCalls: ToolCall[];
}

const initialStreamingState: StreamingState = {
  isStreaming: false,
  content: "",
  toolCalls: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getStringField(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = getString(record[key]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function getChunkContent(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }

  if (!isRecord(data)) {
    return "";
  }

  return (
    getStringField(data, ["content", "delta", "part", "text"]) ??
    getStringField(data, ["message"]) ??
    ""
  );
}

function getToolCallId(data: Record<string, unknown>): string {
  return (
    getStringField(data, ["toolCallId", "tool_call_id", "callId", "id"]) ??
    `tool-call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
}

function getToolCallName(data: Record<string, unknown>): string {
  return (
    getStringField(data, ["toolName", "tool_name", "name", "tool"]) ??
    "Tool call"
  );
}

function normalizeToolStatus(value: unknown): ToolCall["status"] {
  if (value === "completed" || value === "failed") {
    return value;
  }

  return "pending";
}

function upsertToolCall(
  toolCalls: ToolCall[],
  nextToolCall: ToolCall,
): ToolCall[] {
  const index = toolCalls.findIndex(
    (toolCall) => toolCall.id === nextToolCall.id,
  );

  if (index === -1) {
    return [...toolCalls, nextToolCall];
  }

  const current = toolCalls[index];
  const updated = {
    ...current,
    ...nextToolCall,
    input: nextToolCall.input ?? current.input,
    output: nextToolCall.output ?? current.output,
    error: nextToolCall.error ?? current.error,
  } satisfies ToolCall;

  return toolCalls.map((toolCall, toolCallIndex) =>
    toolCallIndex === index ? updated : toolCall,
  );
}

function toolCallFromEvent(data: unknown): ToolCall | null {
  if (!isRecord(data)) {
    return null;
  }

  return {
    id: getToolCallId(data),
    name: getToolCallName(data),
    status: normalizeToolStatus(data.status),
    input: data.input ?? data.arguments ?? data.args ?? null,
  };
}

function toolResultFromEvent(data: unknown): ToolCall | null {
  if (!isRecord(data)) {
    return null;
  }

  const status = data.error
    ? "failed"
    : normalizeToolStatus(data.status) === "pending"
      ? "completed"
      : normalizeToolStatus(data.status);

  return {
    id: getToolCallId(data),
    name: getToolCallName(data),
    status,
    input: data.input ?? data.arguments ?? data.args,
    output: data.output ?? data.result ?? null,
    error: data.error,
  };
}

export function useCardEvents({
  cardId,
  enabled = true,
}: UseCardEventsOptions): StreamingState {
  const queryClient = useQueryClient();
  const isMountedRef = useRef(false);
  const [streamingState, setStreamingState] = useState<StreamingState>(
    initialStreamingState,
  );

  const invalidateCardQueries = useMemo(
    () => async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cards", cardId] }),
        queryClient.invalidateQueries({ queryKey: ["cards"] }),
      ]);
    },
    [cardId, queryClient],
  );

  useEffect(() => {
    setStreamingState(initialStreamingState);
  }, [cardId]);

  useEffect(() => {
    isMountedRef.current = true;

    if (!enabled) {
      setStreamingState(initialStreamingState);
      return () => {
        isMountedRef.current = false;
      };
    }

    let eventSource: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempts = 0;

    const cleanupEventSource = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };

    const scheduleReconnect = () => {
      if (!isMountedRef.current || reconnectTimer !== null) {
        return;
      }

      const delay = Math.min(1000 * 2 ** reconnectAttempts, 30_000);
      reconnectAttempts += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const handleEvent = (event: CardEvent) => {
      if (!isMountedRef.current) {
        return;
      }

      switch (event.type) {
        case "message.part": {
          const chunk = getChunkContent(event.data);
          if (!chunk) {
            return;
          }

          setStreamingState((current) => ({
            ...current,
            isStreaming: true,
            content: `${current.content}${chunk}`,
          }));
          return;
        }
        case "tool.call": {
          const toolCall = toolCallFromEvent(event.data);
          if (!toolCall) {
            return;
          }

          setStreamingState((current) => ({
            ...current,
            isStreaming: true,
            toolCalls: upsertToolCall(current.toolCalls, toolCall),
          }));
          return;
        }
        case "tool.result": {
          const toolCall = toolResultFromEvent(event.data);
          if (!toolCall) {
            return;
          }

          setStreamingState((current) => ({
            ...current,
            isStreaming: true,
            toolCalls: upsertToolCall(current.toolCalls, toolCall),
          }));
          return;
        }
        case "message.completed": {
          void invalidateCardQueries();
          setStreamingState(initialStreamingState);
          return;
        }
        case "run.completed":
        case "run.failed":
        case "run.cancelled":
        case "card.status": {
          void invalidateCardQueries();
          setStreamingState(initialStreamingState);
          return;
        }
        default:
          return;
      }
    };

    const handleError = () => {
      cleanupEventSource();
      scheduleReconnect();
    };

    function connect() {
      if (!isMountedRef.current) {
        return;
      }

      cleanupEventSource();
      eventSource = subscribeToCardEvents(cardId, handleEvent, handleError);
      eventSource.onopen = () => {
        reconnectAttempts = 0;
      };
    }

    connect();

    return () => {
      isMountedRef.current = false;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      cleanupEventSource();
    };
  }, [cardId, enabled, invalidateCardQueries]);

  return streamingState;
}
