export interface Agent {
  name: string;
  description?: string;
  input_content_types?: string[];
  output_content_types?: string[];
  metadata?: Record<string, unknown>;
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
  status: "created" | "running" | "awaiting" | "completed" | "failed";
  bridge_run_id: string | null;
  bridge_session_id: string | null;
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
  | "deny";

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
