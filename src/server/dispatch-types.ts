export interface DispatchCallbacks {
  onRunCreated: (kanbanRunId: string, bridgeRunId: string) => void;
  onEvent: (cardId: string, eventType: string, data: Record<string, unknown>) => void;
  onComplete: (cardId: string, kanbanRunId: string, status: 'completed' | 'failed', error?: string) => void;
  onAgentMessage: (cardId: string, kanbanRunId: string, bot: string, content: string) => void;
  onPermissionRequest: (cardId: string, kanbanRunId: string, wsReqId: number, tool: string | undefined) => void;
  onInterrupted: (cardId: string, kanbanRunId: string) => void;
}
