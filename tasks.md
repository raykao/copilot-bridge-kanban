# Kanban ACP Refactor Tasks

Relates to: raykao/copilot-bridge-kanban#1, #4
Bridge ref: ChrisRomp/copilot-bridge#216 (ACP /runs routes)

All tasks must be implemented against the existing code patterns shown in each spec.
Validation command must exit 0 before the task is considered done.

---

## t0 - Add bridge_run_id column and awaiting status

**Goal:** Extend the runs schema and types to hold the bridge-assigned run ID and the
new `awaiting` status (used when the agent is blocked on a permission prompt).

**Files to read:**
- `src/server/db.ts` - schema definition in `initializeSchema`
- `src/server/cards.ts` - `Run` interface, `updateRun`, `createRun`

**Files to modify:**
- `src/server/db.ts`
- `src/server/cards.ts`

**Changes:**

In `db.ts`, add `bridge_run_id TEXT` column to the runs CREATE TABLE (after `bridge_session_id`):
```sql
bridge_run_id TEXT,
bridge_session_id TEXT,
```

In `cards.ts`, update the `Run` interface:
```ts
export interface Run {
  id: string;
  card_id: string;
  agent_name: string;
  status: 'created' | 'running' | 'awaiting' | 'completed' | 'failed';
  bridge_run_id: string | null;    // ADD
  bridge_session_id: string | null;
  input_comment_id: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}
```

In `cards.ts`, add `'bridge_run_id'` to the `allowed` array in `updateRun`:
```ts
const allowed = ['status', 'bridge_run_id', 'bridge_session_id', 'error', 'finished_at'] as const;
```

**Done criteria:**
```bash
npx tsc --noEmit -p tsconfig.server.json   # exits 0
npx vitest run src/server/cards.test.ts    # exits 0
```

---

## t1 - Rewrite dispatch.ts to POST /v1/runs

**Goal:** Replace the old `POST /v1/agent/execute` + callback URL pattern with the ACP
`POST /v1/runs` endpoint. Remove all callback_url references.

**Files to read:**
- `src/server/dispatch.ts` - current implementation (replace entirely)
- `src/server/config.ts` - `AppConfig` type (use `bridgeApiUrl`, `bridgeApiKey`)
- `src/server/cards.ts` - `updateRun` signature

**Files to modify:**
- `src/server/dispatch.ts`

**New interface shape:**

```ts
export interface DispatchOptions {
  bot: string;
  prompt: string;
  cardId: string;   // used as ACP channel_id
  runId: string;    // kanban-side run ID (for updateRun calls)
}

export interface DispatchResult {
  ok: boolean;
  bridgeRunId?: string;   // ACP run_id returned by bridge (= CLI sessionId)
  error?: string;
}
```

**New request to bridge:**
```ts
// POST ${config.bridgeApiUrl}/v1/runs
// Authorization: Bearer ${config.bridgeApiKey}
// Body:
{
  bot: opts.bot,
  channel_id: opts.cardId,
  prompt: opts.prompt,
}
// Expected response: { run_id: string, status: string }
```

**On success:** call `updateRun(db, opts.runId, { status: 'running', bridge_run_id: result.run_id })`
**On HTTP error or thrown error:** call `updateRun(db, opts.runId, { status: 'failed', error: ... })`

**Remove:** all references to `callback_url`, `kanbanBaseUrl`, `session_id`.

**Done criteria:**
```bash
npx tsc --noEmit -p tsconfig.server.json   # exits 0
```

---

## t2a - New bridge-stream.ts: SSE consumer

**Goal:** Create a module that subscribes to `GET /v1/runs/:run_id/stream` on the bridge
using native fetch streaming (Node 24 has native fetch). Parse SSE frames and call a
callback for each event. Auto-stops when the stream ends or a terminal event is received.

**Files to read:**
- `src/server/sse.ts` - `SseManager.emit` signature (this is what we relay into)
- `src/server/cards.ts` - `Run` type, status values

**File to create:**
- `src/server/bridge-stream.ts`

**Interface to implement:**

```ts
export type BridgeEventType =
  | 'run.queued'
  | 'run.in_progress'
  | 'run.awaiting'
  | 'run.completed'
  | 'run.failed'
  | 'run.text_delta'
  | 'tool.start'
  | 'tool.end';

export interface BridgeEvent {
  type: BridgeEventType;
  data: Record<string, unknown>;
}

export interface BridgeStreamOptions {
  bridgeApiUrl: string;
  bridgeApiKey: string;
  runId: string;                         // ACP run_id (= bridge_run_id)
  onEvent: (event: BridgeEvent) => void;
  onClose: () => void;
}

/**
 * Subscribe to the bridge SSE stream for a run.
 * Returns a cancel function that terminates the stream.
 */
export function subscribeToBridgeRunStream(opts: BridgeStreamOptions): () => void;
```

**SSE parsing pattern:** Read `response.body` as a `ReadableStream<Uint8Array>`, decode
with `TextDecoder`, accumulate partial lines, split on `\n\n` to get frames, parse
`event:` and `data:` fields from each frame.

```ts
// Pattern for reading an SSE stream with native fetch:
const response = await fetch(url, { headers, signal: controller.signal });
const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const frames = buffer.split('\n\n');
  buffer = frames.pop() ?? '';
  for (const frame of frames) {
    // parse event: and data: lines
  }
}
```

**Terminal events** (`run.completed`, `run.failed`): call `opts.onClose()` after delivering
the event, then stop reading.

**Done criteria:**
```bash
npx tsc --noEmit -p tsconfig.server.json   # exits 0
npx vitest run src/server/bridge-stream.test.ts  # exits 0
# (write the test file alongside - mock fetch, verify events fire and cancel works)
```

---

## t2b - Wire bridge-stream into card-routes.ts

**Goal:** After a successful dispatch, subscribe to the bridge run stream. Relay each
bridge event to the kanban's `SseManager` for the card. Update the run status in SQLite
on terminal events.

**Files to read:**
- `src/server/card-routes.ts` - two dispatch call sites (POST /api/cards and POST /api/cards/:id/comments)
- `src/server/bridge-stream.ts` - `subscribeToBridgeRunStream`, `BridgeEvent` (just created in t2a)
- `src/server/sse.ts` - `SseManager.emit(cardId, event, data)`
- `src/server/cards.ts` - `updateRun`

**Files to modify:**
- `src/server/card-routes.ts`

**Relay mapping** (bridge event type -> kanban SSE event name and data):

```ts
// On each bridge event, call:
sseManager?.emit(cardId, bridgeEvent.type, bridgeEvent.data);

// On run.awaiting: also call updateRun(db, kanbanRunId, { status: 'awaiting' })
// On run.completed: also call updateRun(db, kanbanRunId, { status: 'completed', finished_at: new Date().toISOString() })
// On run.failed: also call updateRun(db, kanbanRunId, { status: 'failed', finished_at: new Date().toISOString(), error: bridgeEvent.data.error as string ?? null })
```

**Wire pattern** (both dispatch call sites follow the same pattern):
```ts
const dispatchResult = await dispatchToBridge(config, db, { ... });
if (dispatchResult.ok && dispatchResult.bridgeRunId && sseManager) {
  subscribeToBridgeRunStream({
    bridgeApiUrl: config.bridgeApiUrl,
    bridgeApiKey: config.bridgeApiKey,
    runId: dispatchResult.bridgeRunId,
    onEvent: (event) => { /* relay + updateRun on terminal */ },
    onClose: () => { /* no-op, terminal events handle cleanup */ },
  });
}
```

**Note:** `subscribeToBridgeRunStream` is fire-and-forget. Do NOT await it.
The cancel function is not needed here (stream self-terminates on run end).

**Done criteria:**
```bash
npx tsc --noEmit -p tsconfig.server.json   # exits 0
```

---

## t3 - Add resume route to card-routes.ts

**Goal:** Add `POST /api/cards/:id/runs/:run_id/resume` that proxies the permission
decision to the bridge's `POST /v1/runs/:run_id/resume`.

**Files to read:**
- `src/server/card-routes.ts` - existing route pattern (copy auth + error shape)
- `src/server/config.ts` - `AppConfig` (need `bridgeApiUrl`, `bridgeApiKey`)
- `src/server/cards.ts` - `listRuns` (to verify the run belongs to the card)

**Files to modify:**
- `src/server/card-routes.ts`

**Route spec:**
```
POST /api/cards/:id/runs/:run_id/resume
Auth: session cookie (existing app.addHook or preHandler - match pattern of other card routes)
Body: { decision: 'allow-once' | 'allow-session' | 'allow-all-session' | 'allow-all' | 'deny' }
```

**Implementation:**
1. Verify card exists (404 if not)
2. Verify `run_id` belongs to the card via `listRuns` (404 if not found)
3. POST to `${config.bridgeApiUrl}/v1/runs/${run_id}/resume` with body `{ decision }`
   and header `Authorization: Bearer ${config.bridgeApiKey}`
4. Return 200 `{ run_id, decision }` on success
5. Pass through 404 and 409 status codes from bridge unchanged
6. Return 502 if bridge fetch fails (network error)

**Done criteria:**
```bash
npx tsc --noEmit -p tsconfig.server.json   # exits 0
npx vitest run src/server/card-routes.test.ts  # exits 0
```

---

## t4 - Add GET /api/cards/:id/runs/:run_id route

**Goal:** Single-run fetch endpoint so the client can hydrate the run detail drawer
when opening mid-run or after completion.

**Files to read:**
- `src/server/card-routes.ts` - existing `GET /api/cards/:id/runs` pattern (lines ~195-205)
- `src/server/cards.ts` - `listRuns` (use this to find the run, filter by run_id)

**Files to modify:**
- `src/server/card-routes.ts`

**Route spec:**
```
GET /api/cards/:id/runs/:run_id
Returns: { run: Run }
404 if card not found or run not found / does not belong to card
```

**Implementation:** call `listRuns(db, id)` and find the entry where `r.id === run_id`.

**Done criteria:**
```bash
npx tsc --noEmit -p tsconfig.server.json   # exits 0
```

---

## t5 - Delete callback route and remove kanbanBaseUrl

**Goal:** Remove all dead code from the old callback pattern.

**Files to read:**
- `src/server/server.ts` - find `registerAgentCallbackRoutes` call
- `src/server/config.ts` - `kanbanBaseUrl` field and its `loadConfig` logic
- `.env.example` - `KANBAN_BASE_URL` entry

**Files to modify / delete:**
- Delete: `src/server/agent-callback.ts`
- Delete: `src/server/agent-callback.test.ts`
- Modify: `src/server/server.ts` - remove `registerAgentCallbackRoutes` import and call
- Modify: `src/server/config.ts` - remove `kanbanBaseUrl` from `AppConfig` interface and `loadConfig`
- Modify: `.env.example` - remove `KANBAN_BASE_URL` line

**Done criteria:**
```bash
npx tsc --noEmit -p tsconfig.server.json   # exits 0
npx vitest run                              # exits 0 (no failing tests from deleted files)
grep -r "kanbanBaseUrl\|KANBAN_BASE_URL\|agent-callback\|registerAgentCallbackRoutes" src/ # returns nothing
```

---

## t6 - Add runs API to client.ts

**Goal:** Add `runs.resume` and `runs.get` to the client API object.

**Files to read:**
- `src/client/api/client.ts` - full file, follow `apiFetch` pattern
- `src/client/api/types.ts` - `Run` type (add if missing, mirror `src/server/cards.ts Run`)

**Files to modify:**
- `src/client/api/client.ts`
- `src/client/api/types.ts`

**Add to `types.ts`** (if `Run` is not already there):
```ts
export interface Run {
  id: string;
  card_id: string;
  agent_name: string;
  status: 'created' | 'running' | 'awaiting' | 'completed' | 'failed';
  bridge_run_id: string | null;
  bridge_session_id: string | null;
  input_comment_id: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export type ResumeDecision =
  | 'allow-once'
  | 'allow-session'
  | 'allow-all-session'
  | 'allow-all'
  | 'deny';
```

**Add to `client.ts`** as a new `runs` namespace following the `comments` pattern:
```ts
const runs = {
  get(cardId: string, runId: string): Promise<{ run: Run }> {
    return apiFetch(`/api/cards/${encodeURIComponent(cardId)}/runs/${encodeURIComponent(runId)}`);
  },
  resume(cardId: string, runId: string, decision: ResumeDecision): Promise<{ run_id: string; decision: string }> {
    return apiFetch(`/api/cards/${encodeURIComponent(cardId)}/runs/${encodeURIComponent(runId)}/resume`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
  },
};
// Add runs to the exported api object: export const api = { auth, agents, cards, comments, labels, checkpoints, preferences, runs };
```

**Done criteria:**
```bash
npx tsc --noEmit   # exits 0 (root tsconfig - covers client)
```

---

## t7 - Extend useCardEvents to handle new ACP event types

**Goal:** Handle the new bridge event types that are relayed through the kanban SSE
channel: `run.status`, `run.awaiting`, `tool.start`, `tool.end`, `run.text_delta`.
Expose `awaitingPermission` state for the RunStatusBar to render.

**Files to read:**
- `src/client/hooks/useCardEvents.ts` - FULL file - extend the `handleEvent` switch
- `src/client/api/types.ts` - `CardEvent`, `ToolCall`

**Files to modify:**
- `src/client/hooks/useCardEvents.ts`

**Add to `StreamingState`:**
```ts
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
  awaitingPermission: AwaitingPermission | null;  // ADD
  retry: () => void;
}
```

**Add to `handleEvent` switch** (add these cases before `default`):
```ts
case 'run.text_delta': {
  const chunk = getChunkContent(event.data);
  if (chunk) {
    setStreamingState((s) => ({ ...s, isStreaming: true, content: s.content + chunk }));
  }
  return;
}
case 'tool.start': {
  const toolCall = toolCallFromEvent(event.data);
  if (toolCall) {
    setStreamingState((s) => ({ ...s, isStreaming: true, toolCalls: upsertToolCall(s.toolCalls, toolCall) }));
  }
  return;
}
case 'tool.end': {
  const toolCall = toolResultFromEvent(event.data);
  if (toolCall) {
    setStreamingState((s) => ({ ...s, toolCalls: upsertToolCall(s.toolCalls, toolCall) }));
  }
  return;
}
case 'run.awaiting': {
  const d = event.data as Record<string, unknown>;
  setStreamingState((s) => ({
    ...s,
    awaitingPermission: {
      runId: d.run_id as string,
      tool: d.tool as string,
      detail: d.detail as string | undefined,
    },
  }));
  return;
}
case 'run.status':
case 'run.completed':
case 'run.failed': {
  void invalidateCardQueries();
  setStreamingState((s) => ({ ...initialStreamingState, retry: s.retry, awaitingPermission: null }));
  return;
}
```

Also update `initialStreamingState` to include `awaitingPermission: null`.

**Done criteria:**
```bash
npx tsc --noEmit   # exits 0
```

---

## t8 - New RunStatusBar component

**Goal:** Compact run status indicator shown at the bottom of each card. Shows current
run phase as an icon + label. Shows approve/deny inline when `awaiting`. Has a
"View live" link that triggers the drawer.

**Files to read:**
- `src/client/hooks/useCardEvents.ts` - `StreamingState`, `AwaitingPermission`
- `src/client/api/client.ts` - `api.runs.resume`
- `src/client/api/types.ts` - `Run`, `ResumeDecision`
- Any existing shadcn component in `src/client/components/ui/` - follow the import pattern

**File to create:**
- `src/client/components/RunStatusBar.tsx`

**Props interface:**
```ts
interface RunStatusBarProps {
  cardId: string;
  latestRun: Run | null;          // from card data (hydrated)
  streaming: StreamingState;      // from useCardEvents
  onViewLive: (runId: string) => void;  // opens the drawer
}
```

**Status rendering:**
| Status / condition | Display |
|---|---|
| `null` or `created` | nothing (hidden) |
| `running` (isStreaming) | spinner + "Working..." + "View live" link |
| `awaiting` | warning icon + tool name + Approve / Deny buttons + "View live" link |
| `completed` | checkmark + "Done" (fades after 5s) |
| `failed` | x icon + "Failed" + error truncated |

**Approve/Deny buttons** call `api.runs.resume(cardId, runId, 'allow-once')` and
`api.runs.resume(cardId, runId, 'deny')` respectively. Show a loading spinner while
the request is in flight. On success, clear `awaitingPermission` optimistically.

**Done criteria:**
```bash
npx tsc --noEmit   # exits 0
npx vite build 2>&1 | tail -5   # exits 0, no type errors
```

---

## t9a - New RunDetailDrawer shell

**Goal:** Right-side drawer that slides in over the board. Contains a header (card title +
run status badge + close button) and a scrollable body (populated in t9b). No route
change - controlled by a boolean state in the parent.

**Files to read:**
- Any existing shadcn `Sheet` component in `src/client/components/ui/` - use it if present,
  otherwise implement with a fixed-position div + Tailwind transition classes
- `src/client/api/types.ts` - `Run`

**File to create:**
- `src/client/components/RunDetailDrawer.tsx`

**Props interface:**
```ts
interface RunDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  cardId: string;
  cardTitle: string;
  runId: string | null;
}
```

**Layout spec:**
- Fixed position, right-0, top-0, h-full, w-[45vw] min-w-[360px]
- Slides in with CSS transition: `translate-x-full` when closed, `translate-x-0` when open
- Header: `cardTitle` + run status badge (fetched via `api.runs.get`) + X button
- Body: scrollable div (event log goes here - passed as children or populated in t9b)
- Backdrop: semi-transparent overlay behind drawer, click closes

**Done criteria:**
```bash
npx tsc --noEmit   # exits 0
npx vite build 2>&1 | tail -5   # exits 0
```

---

## t9b - RunDetailDrawer event log

**Goal:** Wire the SSE event stream into the drawer body. Render each event type as a
distinct row. Auto-scroll to bottom on new events unless the user has scrolled up.

**Files to read:**
- `src/client/hooks/useCardEvents.ts` - reuse the hook with the same `cardId`
- `src/client/components/RunDetailDrawer.tsx` - add the log body here (t9a scaffold)
- `src/client/api/client.ts` - `api.runs.resume` for inline approve/deny

**Files to modify:**
- `src/client/components/RunDetailDrawer.tsx`

**Event row rendering:**

```tsx
// run.in_progress
<div className="text-xs text-muted-foreground">Agent started {timestamp}</div>

// tool.start
<details className="border rounded p-2 text-sm">
  <summary>Tool: {toolCall.name}</summary>
  <pre className="text-xs mt-1 overflow-auto">{JSON.stringify(toolCall.input, null, 2)}</pre>
</details>

// tool.end (update the matching tool.start entry)
// Add result/error to the existing <details> row for that toolCall.id

// run.text_delta
// Accumulate into a <pre> block, appending chunks as they arrive

// run.awaiting
<div className="border-l-4 border-yellow-400 pl-3 py-2">
  <p className="text-sm font-medium">Permission required: {tool}</p>
  <div className="flex gap-2 mt-2">
    <button onClick={() => resume('allow-once')}>Approve</button>
    <button onClick={() => resume('deny')}>Deny</button>
  </div>
</div>

// run.completed
<div className="text-green-600 text-sm font-medium">Run completed</div>

// run.failed
<div className="text-red-600 text-sm font-medium">Run failed: {error}</div>
```

**Auto-scroll:** use a `useEffect` with a `ref` on the bottom of the log div. Only
scroll if `isNearBottom` (within 100px of bottom) to avoid interrupting manual scrolling.

**Done criteria:**
```bash
npx tsc --noEmit   # exits 0
npx vite build 2>&1 | tail -5   # exits 0
```

---

## t10 - Wire RunStatusBar and RunDetailDrawer into card view

**Goal:** Add RunStatusBar to the card component and wire up drawer open/close state.

**Files to read:**
- Any component in `src/client/components/` that renders individual cards
  (likely `CardPreview.tsx` or `CardView.tsx` - read both to find the right one)
- `src/client/hooks/useCardEvents.ts` - already used in the card component
- `src/client/api/types.ts` - `Run`

**Files to modify:**
- The card component that renders runs/comments (check both files above)

**Changes:**
1. Add `useState<string | null>(null)` for `drawerRunId`
2. Pass `onViewLive={(runId) => setDrawerRunId(runId)}` to `RunStatusBar`
3. Render `<RunDetailDrawer open={!!drawerRunId} onClose={() => setDrawerRunId(null)} runId={drawerRunId} ... />`
4. Render `<RunStatusBar cardId={card.id} latestRun={latestRun} streaming={streaming} onViewLive={...} />`
   where `latestRun` is the last entry from `card.runs` (or null)

**Done criteria:**
```bash
npx tsc --noEmit   # exits 0
npx vite build 2>&1 | tail -5   # exits 0
npx vitest run                  # exits 0
```

---

## t11 - Final validation

**Goal:** Full clean build and test pass. Close issues #1 and #4.

**Steps:**
1. `rm -rf dist`
2. `npx tsc --noEmit -p tsconfig.server.json && npx tsc --noEmit` -- both exit 0
3. `npx vitest run` -- all tests pass
4. `npm run build` -- exits 0
5. Search for dead references:
   ```bash
   grep -r "kanbanBaseUrl\|KANBAN_BASE_URL\|agent-callback\|v1/agent/execute\|callback_url" src/
   # must return nothing
   ```
6. Commit and push

**Done criteria:** all commands above exit 0, grep returns empty.

---

# copilot-a8g - Generic ACP Provider Abstraction

Feature: allow kanban to discover and dispatch to any A2A-compatible HTTP+JSON agent,
not just copilot-bridge. Implements the AgentProvider interface described in
`docs/acp-provider-architecture.md`.

All tasks must pass `npm run build` (tsc) before being considered done.
Validation commands are listed per task.

---

## p0 - Add api_key column to agents table (migration 005)

**Goal:** Agents registered in the DB need a per-agent API key for auth when
kanban calls their endpoints. Add `api_key TEXT` (nullable) to the `agents` table.

**Files to read:**
- `src/server/migrations/004-add-acp-session-id.ts` - copy this file's structure exactly
- `src/server/migrations/index.ts` - register the new migration here
- `src/server/agents-db.ts` - update `Agent` interface, `rowToAgent`, `createAgent`, `updateAgent`
- `src/server/agent-admin-routes.ts` - update POST and PATCH body handling for `api_key`

**Files to create:**
- `src/server/migrations/005-agents-api-key.ts`

**Files to modify:**
- `src/server/migrations/index.ts`
- `src/server/agents-db.ts`
- `src/server/agent-admin-routes.ts`

**Migration spec:**
```ts
// 005-agents-api-key.ts
const migration: Migration = {
  version: 5,
  name: 'agents-api-key',
  up: (db: Database.Database) => {
    const cols = (db.prepare('PRAGMA table_info(agents)').all() as Array<{ name: string }>).map(r => r.name);
    if (!cols.includes('api_key')) {
      db.exec('ALTER TABLE agents ADD COLUMN api_key TEXT');
    }
  },
};
```

**agents-db.ts changes:**
- Add `api_key: string | null` to `Agent` interface
- Add `api_key?: string | null` to `NewAgent` interface
- In `rowToAgent`: add `api_key: (row.api_key as string | null) ?? null`
- In `createAgent`: add `api_key` to INSERT (column list and `.run()` params), use `input.api_key ?? null`
- In `updateAgent`: add `if ('api_key' in patch) { sets.push('api_key = ?'); params.push(patch.api_key ?? null); }`

**agent-admin-routes.ts changes:**
- POST: extract `api_key: typeof body.api_key === 'string' ? body.api_key : undefined` and pass to `NewAgent`
- PATCH: add `if ('api_key' in body) patch.api_key = typeof body.api_key === 'string' ? body.api_key : null`

**Done criteria:**
- `npx tsc --noEmit` exits 0
- `npm test -- --testPathPattern=migrations` passes

**ESCALATION RULE:** If any requirement is ambiguous or covers a situation not
described here, STOP. Ask the orchestrator a specific question before writing code.

---

## p1 - Define AgentProvider interface and shared types

**Goal:** Create the TypeScript interface that all providers implement. This is the
contract that `GenericAcpProvider` and `CopilotBridgeProvider` fulfil.

**Files to read:**
- `src/server/card-session-manager.ts` - import `DispatchCallbacks` from here
- `src/client/api/types.ts` - reference for `AgentCard` shape (do NOT import from client)
- `docs/acp-provider-architecture.md` - the authoritative design spec

**Files to create:**
- `src/server/providers/types.ts`

**Exact content of `src/server/providers/types.ts`:**
```ts
import type { DispatchCallbacks } from '../card-session-manager.js';

export type ProviderType = 'generic-acp' | 'copilot-bridge';

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
   * Results are delivered via callbacks (same contract as CardSessionManager.dispatch).
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
```

**Done criteria:**
- `npx tsc --noEmit` exits 0
- File exists at `src/server/providers/types.ts`

**ESCALATION RULE:** If any requirement is ambiguous or covers a situation not
described here, STOP. Ask the orchestrator a specific question before writing code.

---

## p2 - Implement GenericAcpProvider

**Goal:** Standard A2A HTTP+JSON provider. Discovers a single agent via
`.well-known/agent-card.json` and dispatches via `POST /agents/:name/message:stream`.

**Files to read:**
- `src/server/providers/types.ts` (created in p1) - interface to implement
- `src/server/bridge-stream.ts` - reuse `subscribeToBridgeRunStream` for dispatch;
  read its `BridgeStreamOptions` interface carefully (lines 1-35)
- `src/server/agents-db.ts` - `Agent` type for constructor input

**Files to create:**
- `src/server/providers/generic-acp.ts`

**Exact class signature:**
```ts
export class GenericAcpProvider implements AgentProvider {
  readonly type: ProviderType = 'generic-acp';

  constructor(
    readonly id: string,
    readonly baseUrl: string,
    private readonly apiKey: string | null,
  ) {}
}
```

**`discover()` implementation:**
- Build URL: `${this.baseUrl.replace(/\/+$/, '')}/.well-known/agent-card.json`
- Headers: `Authorization: Bearer ${this.apiKey}` if `this.apiKey` is non-null
- Fetch with 10_000ms timeout using `AbortController`
- If response not ok: throw `new Error('GenericAcpProvider discover failed: ' + res.status)`
- Parse JSON as `unknown`, cast to `ProviderAgentCard`
- Return `[{ ...card, providerType: 'generic-acp', providerBaseUrl: this.baseUrl }]`

**`dispatch()` implementation:**
- Call `subscribeToBridgeRunStream` from `../bridge-stream.js`
- Map parameters: `bridgeApiUrl = this.baseUrl`, `bridgeApiKey = this.apiKey ?? ''`,
  `bot = agentName`, `prompt = input`, `cardId = cardId`, `runId = kanbanRunId`
- `onReady`: call `callbacks.onRunCreated(kanbanRunId, bridgeRunId)`
- `onEvent`: call `callbacks.onEvent(cardId, event.type, event.data)`
- `onClose`: no-op (completion handled by onEvent run.completed/run.failed)
- `onError`: call `callbacks.onComplete(cardId, kanbanRunId, 'failed', ...)` with status+body
- Map `event.type` to callbacks exactly as `CardSessionManager.handleEvent` does
  (copy the if-chain from lines 138-178 of `card-session-manager.ts`)
- Store the cancel function returned by `subscribeToBridgeRunStream` in a private
  `Map<string, () => void>` keyed by `kanbanRunId` for future cancellation

**`resumeRun()` implementation:**
- Log a warning: `'GenericAcpProvider.resumeRun not yet implemented'`
- Call `callbacks.onComplete(runId, runId, 'failed', 'resumeRun not supported')`
- (Resume is deferred - note clearly in a TODO comment)

**Done criteria:**
- `npx tsc --noEmit` exits 0
- File exists at `src/server/providers/generic-acp.ts`

**ESCALATION RULE:** If any requirement is ambiguous or covers a situation not
described here, STOP. Ask the orchestrator a specific question before writing code.

---

## p3 - Implement CopilotBridgeProvider

**Goal:** Wraps the existing `CardSessionManager` so the bridge participates in the
`AgentProvider` interface. Overrides `discover()` to use the bridge catalog endpoint.

**Files to read:**
- `src/server/providers/types.ts` - interface to implement
- `src/server/card-session-manager.ts` - delegate dispatch and resumeRun to an instance
- `src/server/config.ts` - `AppConfig` shape for constructor input

**Files to create:**
- `src/server/providers/copilot-bridge.ts`

**Exact class signature:**
```ts
import { CardSessionManager } from '../card-session-manager.js';
import type { AppConfig } from '../config.js';
import type { DispatchCallbacks } from '../card-session-manager.js';
import type { AgentProvider, ProviderAgentCard, ProviderType } from './types.js';

export class CopilotBridgeProvider implements AgentProvider {
  readonly type: ProviderType = 'copilot-bridge';
  readonly id: string;
  readonly baseUrl: string;
  private readonly manager: CardSessionManager;

  constructor(id: string, config: AppConfig, callbacks: DispatchCallbacks) {
    this.id = id;
    this.baseUrl = config.bridgeApiUrl;
    this.manager = new CardSessionManager(config, callbacks);
  }
}
```

**`discover()` implementation:**
- DEVIATION from standard - see `docs/acp-provider-architecture.md`
- URL: `${this.baseUrl}/v1/agents/cards`
- Headers: `Authorization: Bearer ${config.bridgeApiKey}` (store apiKey in constructor)
- If response not ok: throw `new Error('CopilotBridgeProvider discover failed: ' + res.status)`
- Parse body as `{ cards: ProviderAgentCard[] }`
- Return cards with `providerType: 'copilot-bridge'` and `providerBaseUrl: this.baseUrl` added
  to each card

**`dispatch()` implementation:**
- DEVIATION from standard - see `docs/acp-provider-architecture.md`
- Delegate directly: `this.manager.dispatch(cardId, agentName, input, kanbanRunId)`
- Note: `DispatchCallbacks` passed to constructor is used by `CardSessionManager` internally

**`resumeRun()` implementation:**
- No direct equivalent in `CardSessionManager` for ACP decision-based resume
- Log warning and no-op for now: `console.warn('CopilotBridgeProvider.resumeRun: use card-routes resume endpoint instead')`

**Done criteria:**
- `npx tsc --noEmit` exits 0
- File exists at `src/server/providers/copilot-bridge.ts`

**ESCALATION RULE:** If any requirement is ambiguous or covers a situation not
described here, STOP. Ask the orchestrator a specific question before writing code.

---

## p4 - Create ProviderRegistry and wire into server startup

**Goal:** A registry that maps DB agent rows to `AgentProvider` instances and
exposes a `fanoutDiscover()` method returning all agent cards from all providers.
Replace the hardcoded `cardSessionManager` + `acpManagers` with registry-based lookup.

**Files to read:**
- `src/server/providers/types.ts` - AgentProvider, ProviderAgentCard
- `src/server/providers/generic-acp.ts` (p2)
- `src/server/providers/copilot-bridge.ts` (p3)
- `src/server/agents-db.ts` - `Agent`, `listAgents`
- `src/server/config.ts` - `AppConfig`
- `src/server/index.ts` - where to wire the registry at startup
- `src/server/card-routes.ts` (lines 1-60) - how cardSessionManager and acpManagers are
  currently used in `registerCardRoutes` signature

**Files to create:**
- `src/server/providers/registry.ts`

**Files to modify:**
- `src/server/index.ts`

**Exact class in `src/server/providers/registry.ts`:**
```ts
export class ProviderRegistry {
  private providers = new Map<string, AgentProvider>();

  register(provider: AgentProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): AgentProvider | undefined {
    return this.providers.get(id);
  }

  getByName(agentName: string): AgentProvider | undefined {
    // Returns the first provider that advertised an agent with this name
    // after the last fanoutDiscover() call. Uses a secondary name->id index.
  }

  async fanoutDiscover(): Promise<ProviderAgentCard[]> {
    // Call discover() on all registered providers in parallel.
    // Catch per-provider errors, log them, skip that provider's cards.
    // Update internal name->providerId index from results.
    // Return flat merged array.
  }
}
```

**`index.ts` changes:**
- Import `ProviderRegistry`, `GenericAcpProvider`, `CopilotBridgeProvider`
- After `initializeSchema(db)`:
  1. Create `const registry = new ProviderRegistry()`
  2. Create a `'bootstrap'` bridge provider ID (use `crypto.randomUUID()` or a fixed
     constant `'copilot-bridge-default'`)
  3. Instantiate `CopilotBridgeProvider('copilot-bridge-default', config, callbacks)`
     and `registry.register(...)` it
  4. For each `agent` in `listAgents(db)` where `agent.protocol === 'generic-acp'`:
     instantiate `GenericAcpProvider(agent.id, agent.url, agent.api_key)` and register
  5. Remove the old `acpManagers` Map construction (AcpSessionManager WS agents are
     separate and remain unchanged - do NOT remove them)
- Pass `registry` into `registerCardRoutes` as an additional argument

**Done criteria:**
- `npx tsc --noEmit` exits 0
- `npm test -- --testPathPattern=server` passes

**ESCALATION RULE:** If any requirement is ambiguous or covers a situation not
described here, STOP. Ask the orchestrator a specific question before writing code.

---

## p5 - Replace /api/agents/cards proxy with registry fanout

**Goal:** `GET /api/agents/cards` currently proxies to the bridge catalog. Replace it
with a call to `registry.fanoutDiscover()` so all registered providers contribute agents.

**Files to read:**
- `src/server/agents.ts` - current implementation to replace
- `src/server/providers/registry.ts` (p4) - `fanoutDiscover()` return type
- `src/server/index.ts` - how `registry` is passed to routes

**Files to modify:**
- `src/server/agents.ts`
- `src/server/index.ts` - update `registerAgentRoutes` call signature

**`registerAgentRoutes` new signature:**
```ts
export function registerAgentRoutes(
  app: FastifyInstance,
  config: AppConfig,
  registry: ProviderRegistry,
): void
```

**`GET /api/agents/cards` new implementation:**
```ts
app.get('/api/agents/cards', async (_request, reply) => {
  try {
    const cards = await registry.fanoutDiscover();
    return reply.send({ cards });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Discovery error';
    return reply.status(502).send({ error: 'Agent discovery failed', detail: message });
  }
});
```

**Keep unchanged:** `GET /api/agents` and `GET /api/agents/:name` routes (still proxy
to bridge - they serve the admin UI use case and are not part of this task).

**Done criteria:**
- `npx tsc --noEmit` exits 0
- `npm test -- --testPathPattern=agents` passes

**ESCALATION RULE:** If any requirement is ambiguous or covers a situation not
described here, STOP. Ask the orchestrator a specific question before writing code.

---

## p6 - Settings UI: agent provider management page

**Goal:** Add a Settings page in the client where users can view, add, edit, and
delete agent providers. Uses the existing `/api/admin/agents` CRUD routes.

**Files to read:**
- `src/server/agent-admin-routes.ts` - available endpoints and response shapes
- `src/client/api/client.ts` - how to add new API methods (copy `cards` or `agents` section pattern)
- `src/client/api/types.ts` - add `AdminAgent` type here
- `src/client/pages/BoardPage.tsx` - copy page shell pattern (useQuery, error state, skeleton)
- `src/client/components/ui/` - available: `button.tsx`, `input.tsx` (check these exist)
- `src/client/App.tsx` or router file - where to register the new route

**Files to create:**
- `src/client/pages/SettingsPage.tsx`

**Files to modify:**
- `src/client/api/types.ts` - add `AdminAgent` interface
- `src/client/api/client.ts` - add `api.admin.agents` methods
- Router/App file - add `/settings` route

**`AdminAgent` type to add to `src/client/api/types.ts`:**
```ts
export interface AdminAgent {
  id: string;
  name: string;
  protocol: string;   // 'generic-acp' | 'copilot-bridge' | 'acp'
  url: string;
  api_key?: string | null;
  auto_approve: boolean;
  created_at: string;
}
```

**`api.admin.agents` methods to add to `src/client/api/client.ts`:**
```ts
admin: {
  agents: {
    list: (): Promise<{ agents: AdminAgent[] }> =>
      request('/api/admin/agents'),
    create: (body: { name: string; protocol: string; url: string; api_key?: string; auto_approve?: boolean }): Promise<{ agent: AdminAgent }> =>
      request('/api/admin/agents', { method: 'POST', body }),
    update: (id: string, patch: Partial<Pick<AdminAgent, 'name' | 'protocol' | 'url' | 'api_key' | 'auto_approve'>>): Promise<{ agent: AdminAgent }> =>
      request(`/api/admin/agents/${id}`, { method: 'PATCH', body: patch }),
    delete: (id: string): Promise<void> =>
      request(`/api/admin/agents/${id}`, { method: 'DELETE' }),
  },
},
```

**`SettingsPage.tsx` required elements:**
- Page title: "Settings" with subtitle "Manage agent providers."
- Section header: "Agent Providers"
- Table with columns: Name, Type, URL, Auto-approve, Actions
- "Add Provider" button that opens an inline form (not a modal) below the table
- Add form fields: Name (text input), Type (select: `generic-acp` | `copilot-bridge`),
  URL (text input), API Key (text input, type="password"), Auto-approve (checkbox)
- Delete button per row with `window.confirm('Delete agent <name>?')` guard
- Use `useQuery` for list, `useMutation` for create/update/delete (same pattern as `BoardPage.tsx`)
- Error and loading states following the pattern in `BoardPage.tsx`

**Router registration:**
- Find the existing router file (likely `App.tsx` or a `routes.tsx`)
- Add `<Route path="/settings" element={<SettingsPage />} />`
- Add a "Settings" link in the sidebar/nav (find the nav component and add it alongside existing links)

**Done criteria:**
- `npx tsc --noEmit` exits 0
- Page renders at `/settings` without console errors
- Can add and delete an agent via the UI (manual verification)

**ESCALATION RULE:** If any requirement is ambiguous or covers a situation not
described here, STOP. Ask the orchestrator a specific question before writing code.

