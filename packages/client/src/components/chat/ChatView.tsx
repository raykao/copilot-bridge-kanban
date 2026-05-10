import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, MessageSquareDashed } from 'lucide-react';

import { api, getErrorMessage } from '@/api/client';
import type { Card, CardComment } from '@/api/types';
import { ErrorState } from '@/components/ErrorState';
import { LiveUpdatesBanner } from '@/components/LiveUpdatesBanner';
import { ChatPageSkeleton } from '@/components/PageSkeletons';
import { StreamingMessage } from '@/components/card/StreamingMessage';
import { ChatInput } from '@/components/chat/ChatInput';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { CreateCardFromChat } from '@/components/chat/CreateCardFromChat';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCardEvents } from '@/hooks/useCardEvents';

interface ChatViewProps {
  agentName: string;
}

function sortByUpdatedAt(cards: Card[]): Card[] {
  return [...cards].sort(
    (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
  );
}

function sortComments(comments: CardComment[]): CardComment[] {
  return [...comments].sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
  );
}

function hasStreamingPayload(streamingContent: ReturnType<typeof useCardEvents>): boolean {
  return (
    streamingContent.isStreaming ||
    streamingContent.content.trim().length > 0 ||
    streamingContent.toolCalls.length > 0
  );
}

export function ChatView({ agentName }: ChatViewProps) {
  const queryClient = useQueryClient();
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const hadStreamingPayloadRef = useRef(false);

  const activeChatQueryKey = useMemo(
    () => ['cards', { agent: agentName, type: 'chat', status: 'in_progress' }] as const,
    [agentName],
  );

  const activeCardQuery = useQuery({
    queryKey: activeChatQueryKey,
    queryFn: () => api.cards.list({ agent: agentName, type: 'chat', status: 'in_progress' }),
  });

  const activeChatCards = activeCardQuery.data ?? [];
  const activeCard = useMemo(() => sortByUpdatedAt(activeChatCards)[0] ?? null, [activeChatCards]);
  const activeCardId = activeCard?.id ?? null;

  const commentsQueryKey = useMemo(
    () => ['chat-comments', activeCardId] as const,
    [activeCardId],
  );

  const commentsQuery = useQuery({
    queryKey: commentsQueryKey,
    queryFn: () => api.comments.list(activeCardId!),
    enabled: !!activeCardId,
  });

  const chatHistory = commentsQuery.data ?? [];
  const sortedChatHistory = useMemo(() => sortComments(chatHistory), [chatHistory]);

  const streamingState = useCardEvents({
    cardId: activeCardId ?? '',
    enabled: !!activeCardId,
  });

  const createChatMutation = useMutation({
    mutationFn: () =>
      api.cards.create({
        title: `Chat with ${agentName}`,
        type: 'chat',
        agent_bot: agentName,
        status: 'in_progress',
      }),
    onSuccess: async (card) => {
      queryClient.setQueryData<Card[]>(activeChatQueryKey, (current) =>
        sortByUpdatedAt([card, ...(current ?? []).filter((item) => item.id !== card.id)]),
      );

      await queryClient.invalidateQueries({ queryKey: ['cards'] });
    },
    onError: () => {
      setSubmitError('Unable to start a chat right now.');
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: ({ cardId, content }: { cardId: string; content: string }) =>
      api.comments.add(cardId, content),
    onMutate: () => {
      setSubmitError(null);
    },
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: commentsQueryKey }),
        queryClient.invalidateQueries({ queryKey: ['cards', variables.cardId] }),
        queryClient.invalidateQueries({ queryKey: ['cards'] }),
      ]);
    },
    onError: () => {
      setSubmitError('Unable to send the message right now.');
    },
  });

  useEffect(() => {
    if (!queuedMessage || !activeCardId || sendMessageMutation.isPending) {
      return;
    }

    const nextMessage = queuedMessage;
    setQueuedMessage(null);
    void sendMessageMutation.mutateAsync({ cardId: activeCardId, content: nextMessage });
  }, [activeCardId, queuedMessage, sendMessageMutation]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [
    sortedChatHistory,
    streamingState.content,
    streamingState.isStreaming,
    streamingState.toolCalls.length,
  ]);

  useEffect(() => {
    const hasPayload = hasStreamingPayload(streamingState);

    if (hadStreamingPayloadRef.current && !hasPayload && activeCardId) {
      void queryClient.invalidateQueries({ queryKey: commentsQueryKey });
    }

    hadStreamingPayloadRef.current = hasPayload;
  }, [activeCardId, commentsQueryKey, queryClient, streamingState]);

  const handleSend = async (content: string) => {
    setSubmitError(null);

    if (activeCardId) {
      await sendMessageMutation.mutateAsync({ cardId: activeCardId, content });
      return;
    }

    try {
      await createChatMutation.mutateAsync();
      setQueuedMessage(content);
    } catch {
      return;
    }
  };

  const isBusy = createChatMutation.isPending || sendMessageMutation.isPending || streamingState.isStreaming;
  const isLoading = activeCardQuery.isPending || (!!activeCardId && commentsQuery.isPending);
  const showEmptyState =
    !isLoading && !activeCardId && sortedChatHistory.length === 0;

  if (isLoading) {
    return <ChatPageSkeleton />;
  }

  if (activeCardQuery.isError || commentsQuery.isError) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <ErrorState
          message={getErrorMessage(activeCardQuery.error ?? commentsQuery.error, 'Failed to load this chat.')}
          onRetry={() => {
            void Promise.all([activeCardQuery.refetch(), commentsQuery.refetch()]);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Chat with {agentName}</h1>
          <p className="text-sm text-muted-foreground">
            Start a conversation, then promote it into a work card when it becomes actionable.
          </p>
        </div>

        <CreateCardFromChat agentName={agentName} chatHistory={sortedChatHistory} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Bot className="size-4" />
          </div>
          <div>
            <div className="font-medium">{agentName}</div>
            <div className="text-sm text-muted-foreground">
              {activeCardId ? 'Connected to active chat card' : 'Ready for your first message'}
            </div>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 px-4 py-4">
            <LiveUpdatesBanner
              onRetry={streamingState.retry}
              status={streamingState.connectionStatus}
            />

            {showEmptyState ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center">
                <MessageSquareDashed className="mb-4 size-10 text-muted-foreground" />
                <h2 className="text-lg font-medium">No active chat yet</h2>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  Send the first message to create an in-progress chat card for {agentName}.
                </p>
              </div>
            ) : null}

            {sortedChatHistory.map((comment) => (
              <ChatMessage
                authorId={comment.author_id}
                authorKind={comment.author_kind}
                content={comment.content}
                key={comment.id}
                timestamp={comment.created_at}
              />
            ))}

            <StreamingMessage streamingState={streamingState} />
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        <div className="border-t px-4 py-4">
          <ChatInput
            disabled={isBusy}
            onSend={(content) => {
              void handleSend(content);
            }}
            placeholder={`Message ${agentName}...`}
          />
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>Press Enter to send. Shift+Enter adds a new line.</span>
            {submitError ? <span className="text-destructive">{submitError}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
