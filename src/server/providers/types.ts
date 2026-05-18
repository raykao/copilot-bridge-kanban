import type { DispatchCallbacks } from '../dispatch-types.js';

export type ProviderType = 'generic-acp' | 'copilot-bridge' | 'acp';

export interface ProviderAgentCard {
  name: string;
  description: string;
  version: string;
  supportedInterfaces: Array<{
    url: string;
    protocolBinding: string;
    protocolVersion: string;
  }>;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
  }>;
  // Kanban-added fields (not in A2A spec)
  providerType: ProviderType;
  providerBaseUrl: string;
}

export interface AgentProvider {
  readonly id: string;        // DB agents row id
  readonly type: ProviderType;
  readonly baseUrl: string;

  /**
   * Return all agents this provider exposes.
   * Standard: GET <baseUrl>/.well-known/agent-card.json -> single card.
   * Providers MAY override for multi-agent discovery.
   */
  discover(): Promise<ProviderAgentCard[]>;

  /**
   * Start a new run for the named agent.
   * Results are delivered via callbacks (same contract as provider dispatch).
   */
  dispatch(
    agentName: string,
    input: string,
    cardId: string,
    kanbanRunId: string,
    callbacks: DispatchCallbacks,
  ): void;

  /**
   * Resume a paused run (e.g. after permission approval).
   */
  resumeRun(
    runId: string,
    acpDecision: string,
    callbacks: DispatchCallbacks,
  ): void;
}
