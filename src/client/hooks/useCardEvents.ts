import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { subscribeToCardEvents } from '@/api/client';
import type { CardEvent, ToolCall } from '@/api/types';

export interface UseCardEventsOptions {
  cardId: string;
  enabled?: boolean;
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'idle' | 'reconnecting';

export interface AwaitingPermission {
  runId: string;
  tool: string;
  detail?: string;
}

export interface StreamingState {
  isStreaming: boolean;
  content: string;
  toolCalls: ToolCall[];
  connectionStatus: ConnectionStatus;
  awaitingPermission: AwaitingPermission | null;
  retry: () => void;
}

const initialStreamingState: StreamingState = {
  isStreaming: false,
  content: '',
  toolCalls: [],
  connectionStatus: 'idle',
  awaitingPermission: null,
  retry: () => undefined,
};

const MAX_RECONNECT_ATTEMPTS = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
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
    return '';
  }

  return (
    getStringField(data, ['content', 'delta', 'part', 'text']) ??
    getStringField(data, ['message']) ??
    ''
  );
}

function getToolCallId(data: Record<string, unknown>): string {
  return (
    getStringField(data, ['toolCallId', 'tool_call_id', 'callId', 'id']) ??
    `tool-call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
}

function getToolCallName(data: Record<string, unknown>): string {
  return (
    getStringField(data, ['toolName', 'tool_name', 'name', 'tool']) ??
    'Tool call'
  );
}

function normalizeToolStatus(value: unknown): ToolCall["status"] {
  if (value === 'completed' || value === 'failed') {
    return value;
  }

  return 'pending';
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
    ? 'failed'
    : normalizeToolStatus(data.status) === 'pending'
      ? 'completed'
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
  const [streamingState, setStreamingState] = useState(initialStreamingState);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => {
    setConnectionStatus('reconnecting');
    setRetryToken((current) => current + 1);
  }, []);

  const invalidateCardQueries = useMemo(
    () => async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cards', cardId] }),
        queryClient.invalidateQueries({ queryKey: ['cards'] }),
      ]);
    },
    [cardId, queryClient],
  );

  useEffect(() => {
    setStreamingState((current) => ({
      ...initialStreamingState,
      retry: current.retry,
    }));
    setConnectionStatus('idle');
  }, [cardId]);

  useEffect(() => {
    isMountedRef.current = true;

    if (!enabled) {
      setStreamingState((current) => ({
        ...initialStreamingState,
        retry: current.retry,
      }));
      setConnectionStatus('idle');
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

      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        setConnectionStatus('disconnected');
        return;
      }

      const delay = Math.min(1000 * 2 ** reconnectAttempts, 30_000);
      reconnectAttempts += 1;
      setConnectionStatus('reconnecting');
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const handleEvent = (event: CardEvent) => {
      if (!isMountedRef.current) {
        return;
      }

      switch (event.type as string) {
        case 'message.part': {
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
        case 'run.text_delta': {
          const chunk = getChunkContent(event.data);
          if (chunk) {
            setStreamingState((current) => ({
              ...current,
              isStreaming: true,
              content: `${current.content}${chunk}`,
            }));
          }
          return;
        }
        case 'tool.call': {
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
        case 'tool.start': {
          const toolCall = toolCallFromEvent(event.data);
          if (toolCall) {
            setStreamingState((current) => ({
              ...current,
              isStreaming: true,
              toolCalls: upsertToolCall(current.toolCalls, toolCall),
            }));
          }
          return;
        }
        case 'tool.result': {
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
        case 'tool.end': {
          const toolCall = toolResultFromEvent(event.data);
          if (toolCall) {
            setStreamingState((current) => ({
              ...current,
              toolCalls: upsertToolCall(current.toolCalls, toolCall),
            }));
          }
          return;
        }
        case 'run.awaiting': {
          if (!isRecord(event.data)) {
            return;
          }

          const data = event.data;
          setStreamingState((current) => ({
            ...current,
            isStreaming: false,
            awaitingPermission: {
              runId: getString(data.run_id) ?? '',
              tool: getString(data.tool) ?? '',
              detail: getString(data.detail),
            },
          }));
          return;
        }
        case 'run.queued':
        case 'run.in_progress': {
          setStreamingState((current) => ({
            ...current,
            awaitingPermission: null,
          }));
          return;
        }
        case 'message.completed': {
          void invalidateCardQueries();
          setStreamingState((current) => ({
            ...initialStreamingState,
            retry: current.retry,
          }));
          return;
        }
        case 'run.status':
        case 'run.completed':
        case 'run.failed':
        case 'run.cancelled':
        case 'card.status': {
          void invalidateCardQueries();
          setStreamingState((current) => ({
            ...initialStreamingState,
            retry: current.retry,
            awaitingPermission: null,
          }));
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
        setConnectionStatus('connected');
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
  }, [cardId, enabled, invalidateCardQueries, retryToken]);

  return useMemo(() => ({
    ...streamingState,
    connectionStatus,
    retry,
  }), [streamingState, connectionStatus, retry]);
}
