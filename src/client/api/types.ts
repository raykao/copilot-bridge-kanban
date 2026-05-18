// Mirror of bridge src/channels/http/agent-card-types.ts. Keep in sync.
export interface AgentCardCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
}

export interface AgentInterface {
  url: string;
  protocolBinding: string;       // "HTTP+JSON" for our REST routes
  protocolVersion: string;       // "0.3" while we are pre-1.0 internally
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export type SecuritySchemeMap = Record<string, {
  // Discriminated union from A2A spec - we only publish the http-bearer variant today.
  httpAuthSecurityScheme: {
    scheme: 'Bearer';
    description?: string;
  };
}>;

export interface AgentCard {
  name: string;
  description: string;
  version: string;
  supportedInterfaces: AgentInterface[];
  capabilities: AgentCardCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
  securitySchemes?: SecuritySchemeMap;
  securityRequirements?: Array<Record<string, string[]>>;
}

export interface Agent {
  name: string;
  description?: string;
  input_content_types?: string[];
  output_content_types?: string[];
  metadata?: Record<string, unknown>;
}

export interface AgentTokenSummary {
  id: string;
  agent_name: string;
  created_at: string;
}

export interface AgentTokenCreateResult {
  id: string;
  agent_name: string;
  token: string;
  created_at: string;
}

export interface AdminAgent {
  id: string;
  name: string | null;
  protocol: string;
  url: string;
  api_key?: string | null;
  auto_approve: boolean;
  created_at: string;
}

export type AdminProviderType = 'acp' | 'copilot-bridge';

export type AdminProviderDbStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export type AdminProviderRegistryStatus =
  | 'discovering'
  | 'connected'
  | 'disconnected'
  | 'unknown';

export interface AdminProvider {
  id: string;
  type: AdminProviderType;
  label: string;
  url: string;
  ws_url: string | null;
  api_key: string | null;
  status: AdminProviderDbStatus;
  last_discovered_at: string | null;
  created_at: string;
  registry_status: AdminProviderRegistryStatus;
  agent_count: number;
  last_error: string | null;
}

export interface AdminProviderDiscoveredAgent {
  id: string;
  name: string;
  description?: string | null;
}

export interface AdminProviderDetail {
  provider: AdminProvider;
  agents: AdminProviderDiscoveredAgent[];
  registry_status: AdminProviderRegistryStatus;
  last_error: string | null;
}

export interface ProviderStatusAgent {
  name: string;
  description: string;
  version: string;
}

export type ProviderConnectionStatus = 'discovering' | 'connected' | 'disconnected';

export interface ProviderStatusEntry {
  id: string;
  label: string | null;
  protocol: string;
  url: string;
  status: ProviderConnectionStatus;
  agents: ProviderStatusAgent[];
  lastError: string | null;
  lastDiscoveredAt: string | null;
}

export interface Card {
  id: string;
  type: "work" | "chat";
  agent_bot: string | null;
  title: string;
  description: string | null;
  status:
    | "idea"
    | "refining"
    | "ready"
    | "in_progress"
    | "paused"
    | "done"
    | "archived";
  created_by: string;
  workspace_subdir: string | null;
  metadata: Record<string, unknown>;
  labels: string[];
  runs?: Run[];
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface CardDetail {
  card: Card;
  runs: Run[];
  comments: CardComment[];
}

export interface NewCard {
  title: string;
  description?: string;
  agent?: string;
  agent_bot?: string;
  type?: Card['type'];
  status?: Card['status'];
  labels?: string[];
  metadata?: Record<string, unknown>;
}

export interface CardFilter {
  agent?: string;
  status?: string;
  label?: string;
  type?: string;
}

export interface Run {
  id: string;
  card_id: string;
  agent_name: string;
  status: "created" | "running" | "awaiting" | "completed" | "failed" | "interrupted";
  bridge_run_id: string | null;
  input_comment_id: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export type ResumeDecision =
  | "allow-once"
  | "allow-session"
  | "allow-all-session"
  | "allow-all"
  | "deny"
  | "deny-session"
  | "deny-all";

export interface CardComment {
  id: string;
  card_id: string;
  author_kind: "human" | "agent" | "system";
  author_id: string;
  content: string;
  created_at: string;
}

export interface Checkpoint {
  id: string;
  card_id: string;
  name: string | null;
  turn_index: number;
  git_ref: string | null;
  created_by: string;
  created_at: string;
}

export interface AuthUser {
  id: string;
  username: string;
}

export interface UserPreferences {
  theme?: "light" | "dark" | "system";
  boardView?: string;
  filters?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  status: "pending" | "completed" | "failed";
  input: unknown;
  output?: unknown;
  error?: unknown;
}

export type CardEventType =
  | "message.part"
  | "message.completed"
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "run.interrupted"
  | "card.status"
  | "card.updated"
  | "tool.call"
  | "tool.result"
  | "heartbeat";

export interface CardEvent {
  type: CardEventType;
  data: unknown;
  id?: string;
}
