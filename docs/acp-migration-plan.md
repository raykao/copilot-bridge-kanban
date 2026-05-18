# ACP Migration Plan: Kanban + copilot-bridge

**Date:** 2026-05-14  
**Status:** Approved for implementation  
**Repos:** raykao/copilot-bridge-kanban, raykao/copilot-bridge  
**Reviewed by:** Claude Opus 4.7 (second opinion, findings incorporated)

---

## 1. Context and Current State

### What we built

```
Kanban (React + Fastify)
  -> POST /runs          -> copilot-bridge (HTTP platform adapter)
  <- POST /callback_url  <- copilot-bridge (CallbackDelivery)
```

- Kanban dispatches cards via POST /runs using BRIDGE_API_KEY
- copilot-bridge runs the Copilot CLI agent session via the copilot-sdk
- Bridge posts results back to kanban via a callback URL
- Kanban validates callbacks using a per-agent callback_token

### What works
- Card creation and state machine (pending -> running -> done/failed)
- SSE streaming from kanban to browser (real-time card updates)
- Admin UI for generating agent tokens (/settings page)
- channelLock fix (bridge ca1c054) - HTTP channel releases on session.idle/error

### What is broken / painful

| Problem | Root cause |
|---------|-----------|
| Agent blocks forever on tool approval | No bidirectional channel - no way to ask kanban for approval |
| Session timeout kills running cards | Timeout fires, no clean recovery |
| envLock serializes session creation | Per-workspace lock, cross-card blocking possible |
| Two-token auth complexity | Invented BRIDGE_API_KEY + callback_token to work around missing protocol |
| No path to support non-copilot-bridge agents | Dispatch hardcoded to custom HTTP protocol |

### Root diagnosis

Every problem traces back to the same root: the custom HTTP+callback adapter has no bidirectional channel. Tool approvals block because there is no way for the bridge to ask kanban for a response. The solution is a protocol that makes bidirectional RPC first-class. That protocol is ACP.

---

## 2. Protocol Decision: ACP

### What ACP is

The Agent Client Protocol standardizes communication between clients (editors, dashboards, orchestrators) and coding agents via JSON-RPC.

Spec: https://agentclientprotocol.com  
Copilot CLI ACP support: https://github.blog/changelog/2026-01-28-acp-support-in-copilot-cli-is-now-in-public-preview/

### Transport

| Transport | Status | Notes |
|-----------|--------|-------|
| stdio (subprocess) | STABLE | Canonical spec transport |
| Streamable HTTP + SSE | DRAFT | In progress, this is the target |
| Custom TCP (copilot --acp --port) | Ships today | GitHub-specific, not in spec |
| WebSocket | Custom | Not in spec, but practical today |

We implement WebSocket transport now (practical, bidirectional, well-understood).
When ACP streamable HTTP stabilizes, we migrate the transport layer only - the protocol above it is unchanged.

### How ACP fixes each current problem

**Tool approval blocking:** ACP has a first-class `session/request_permission` RPC. Agent sends it, client responds. Kanban receives it as an event, shows approve/deny in the card UI, or auto-approves per agent config. No more blocking.

**Streaming blocks:** `session/update` notifications stream from agent to client on the same connection. No callbacks, no second HTTP round-trip.

**Session lifecycle:** `session/new`, `session/load`, `session/resume`, `session/close` are all protocol primitives. Clean cancel via `session/cancel`.

**Multi-agent:** Multiple `session/new` calls on one connection = multiple concurrent sessions. Each session is isolated by `sessionId`. Different cards for the same bot use the same ACP connection with different session IDs.

### Why not A2A?

A2A adds agent discovery (Agent Cards) on top of a similar execution model. Useful for self-describing agents across organizations. For our use case (a known set of configured agents), ACP is sufficient and has native Copilot CLI support. A2A can be layered on later via `GET /bob/.well-known/agent.json` on the same HTTP server.

---

## 3. Architecture: Target State

### Connection model

```
Kanban (ACP client, Fastify + React)
  |
  |-- WS ws://localhost:3030/bob  -->  copilot-bridge (ACP server, :3030)
  |<-- session/update stream       --  |
  |<-- session/request_permission  --  |  <- tool approvals, shown in card UI
  |-- permission response          -->  |
                                        |-- copilot-sdk manages Copilot CLI sessions
                                        |   one per card, per bot's workingDirectory
```

Kanban is always the client. copilot-bridge is always the server. No callbacks. No second HTTP connection. No callback_token.

### Multi-bot model

Each bot is a separate ACP endpoint exposed by copilot-bridge on a shared port:

```
copilot-bridge HTTP server on :3030
  WS /bob   -> routes to bob's session manager (workingDirectory: /workspaces/bob)
  WS /homer -> routes to homer's session manager (workingDirectory: /workspaces/homer)
  GET /bob/.well-known/agent.json   -> optional, for future A2A compatibility
```

- **One port, path per bot.** No per-bot port configuration. Adding a new bot requires zero networking changes.
- **Bot identity is the URL path.** Kanban's agents table stores `ws://localhost:3030/bob` - no separate bot ID field needed.
- **copilot-bridge resolves workingDirectory from config** and passes it to the copilot-sdk session.

### config.json shape for the ACP platform

Mirrors the mattermost config structure. Same bot properties (`agent`, `model`, `workingDirectory`, `mode`, `users`). No apiKey, url, or token fields - those are Mattermost-specific connection credentials that ACP does not require for same-host deployments.

```json
{
  "platforms": {
    "acp": {
      "port": 3030,
      "access": {
        "mode": "allowlist",
        "users": ["raykao"]
      },
      "bots": {
        "bob": {
          "agent": "bob",
          "model": "claude-sonnet-4.6",
          "workingDirectory": "/home/raykao/.copilot-bridge/workspaces/bob",
          "admin": true,
          "mode": "allowlist",
          "users": ["raykao"]
        },
        "homer": {
          "agent": "homer",
          "model": "gpt-4.1",
          "workingDirectory": "/home/raykao/.copilot-bridge/workspaces/homer"
        }
      }
    }
  }
}
```

The `agent`, `model`, `workingDirectory`, `admin`, `mode`, and `users` fields already exist in the copilot-bridge type system (`BotConfig`). The ACP adapter reuses them as-is.

### Protocol adapter pattern in kanban

```typescript
interface AgentAdapter {
  dispatch(cardId: string, agentCfg: AgentConfig, prompt: string, runId: string): void;
  reconnect(cardId: string, agentCfg: AgentConfig, sessionId: string): void;
  cancel(cardId: string): void;
}

class AcpAdapter implements AgentAdapter { ... }       // new - ACP over WebSocket
class LegacyBridgeAdapter implements AgentAdapter { ... } // existing code, kept intact
```

Kanban's agents table stores a `protocol` field (`acp` | `legacy`). Dispatch picks the adapter by protocol. The existing card state machine, SSE infrastructure, and run history are unchanged.

---

## 4. Client Capabilities: Kanban Does NOT Need fs/terminal

Verified from GitHub's own ACP reference implementation:

```typescript
await connection.initialize({
  protocolVersion: acp.PROTOCOL_VERSION,
  clientCapabilities: {},  // empty - no fs, no terminal
});
```

ACP spec states: if `readTextFile`/`writeTextFile` are absent from `clientCapabilities`, the agent MUST NOT call those methods. Copilot CLI uses `cwd` (from `session/new`) to operate on the filesystem directly. The ACP fs/terminal methods exist for editor integration (unsaved buffer access). Kanban declares no capabilities, Copilot CLI falls back to direct disk access. This is the intended design.

**Blocker 1 from Opus review: RESOLVED.**

---

## 5. Multi-Bot Identity

**Blocker 2 from Opus review: RESOLVED.** Not a protocol problem.

One bot = one URL path on the shared ACP server. Each bot has its own `session/new` lifecycle, its own `workingDirectory`, its own copilot-sdk session pool. Bot identity is encoded in the WebSocket URL path, not in the protocol. No `_meta` extensions needed.

For multiple concurrent cards on the same bot: multiple `session/new` calls on the same WebSocket connection, each returning a different `sessionId`. ACP is explicitly designed for this.

---

## 6. Auth Model

### Two separate auth concepts in ACP (do not conflate)

**`authMethods` in `initialize` response:** How the agent tells the client that the USER needs to authenticate to the agent (e.g., "provide GITHUB_TOKEN env var"). This is user-to-agent auth, declared by the agent during init. Covered by the ACP spec. Kanban should surface these to the user in the connection status UI.

**Transport-level auth:** Who is allowed to CONNECT to the ACP server at all. The ACP spec says nothing about this. It is our implementation concern.

### Transport auth by deployment type

| Deployment | Auth | How |
|-----------|------|-----|
| Same host (primary) | None | ACP server binds to 127.0.0.1 only. Localhost = trust. |
| Remote (future) | Bearer token | `Authorization: Bearer <token>` on WebSocket upgrade or HTTP POST |

For remote deployments: copilot-bridge generates a token per bot on startup. Admin copies it to kanban's agents table (one-time setup). Kanban sends it as `Authorization: Bearer <token>` on every connection.

**The agent_tokens table and /settings UI built for callback_token can be repurposed for this.** The direction flips: instead of "bridge authenticates to kanban", it becomes "kanban authenticates to bridge". Same infrastructure, correct direction.

### What we eliminate

| Was | Replaced by |
|-----|-------------|
| BRIDGE_API_KEY (kanban -> bridge) | Local trust (same host) or bearer token (remote) |
| callback_token (bridge -> kanban) | Eliminated - no callbacks in ACP |

---

## 7. Permission Handling

### Blocker 3 from Opus review: Bridge hooks vs kanban auto_approve

**Decision:** Bridge hooks handle permissions for Mattermost sessions (unchanged). For ACP sessions, permissions flow through to kanban. Bridge does NOT intercept `session/request_permission` for ACP sessions - it proxies them as-is to the kanban client.

Kanban handles them by:
1. Checking per-agent `auto_approve` setting in the agents table
2. If auto_approve=true: respond `allow_always` immediately
3. If auto_approve=false: emit a permission event via SSE to the browser, wait for user response, reply to ACP

This means the card UI needs a permission request component (approve/deny buttons, tool description). Scoped to Phase 3.

### Cancel and timeout semantics

- `session/cancel` is a one-way notification (no ack). After sending it, kanban waits for the in-flight `session/prompt` to return with `stopReason: "cancelled"`, with a hard 10s timeout. After that, the WebSocket connection for that session is dropped.
- `session/request_permission` timeout: if the user does not respond within 60s (configurable), kanban auto-denies. This prevents the same forever-block the current system has.

---

## 8. Graceful Degradation

Kanban is a standalone app. It must function without any connected agent.

### Per-agent connection state machine

```
disconnected -> connecting -> connected -> degraded -> disconnected
```

| State | UI | Card dispatch |
|-------|-----|---------------|
| connected | Green dot | Normal |
| connecting | Spinner | Queued |
| degraded | Yellow dot | Attempted, may fail |
| disconnected | Red dot | Blocked with message |

### Reliability requirements

- **Reconnect:** Exponential backoff, 2s base, 60s cap, unlimited retries
- **Keepalive:** WebSocket ping/pong every 30s. If pong not received in 10s, treat as disconnected.
- **Half-open detection:** The ping/pong covers this. No reliance on TCP timeout (2hr default on Linux).
- **Mid-turn disconnect:** `session/update` notifications are not replayable. If the connection drops mid-prompt, mark card as `interrupted`. If agent advertises `sessionCapabilities.resume`, attempt resume on reconnect. If not, show "interrupted" state with a re-dispatch button.
- **Interrupted runs on startup:** Any card in `running` state when kanban restarts is marked `interrupted` at startup.
- **Subprocess leak (stdio path):** Not applicable for our WebSocket model (copilot-bridge manages CLI lifecycle). Applicable if kanban ever spawns CLI directly.
- **Backpressure:** If session/update events arrive faster than SQLite writes, kanban buffers in memory and writes asynchronously. Do not block the WebSocket reader.
- **Concurrent session limit:** If copilot-bridge returns an error on `session/new` due to resource limits, kanban marks the card as `failed` with a retry-able error and queues it.

### Kanban-only mode

- Cards can be created, edited, deleted without any agent connected
- History and previous run output is always accessible
- Cards can be manually moved between states
- Dispatch button is disabled with tooltip when agent is disconnected

---

## 9. Implementation Phases

### Phase 0 - Issue cleanup (before starting)

- Close kanban#4 with a summary: backend callback auth implemented and merged. The callback model is superseded by ACP. The /settings UI and agent_tokens table are preserved and will be repurposed for ACP transport tokens in remote deployments.
- File new tracking issues for phases 1-4.
- Update dashboard (dark-factory#5).

### Phase 1 - Kanban: agents table + ACP client adapter

**Start here, not with the bridge.** Build kanban's AcpAdapter against raw Copilot CLI first (`copilot --acp --port N`). This validates the client against the reference implementation and surfaces any capability/integration issues before the bridge ACP server commits to a shape.

Tasks:
- Migration 004: `agents` table (id, name, protocol, url, auto_approve, created_at)
- Migration 004: `agent_id` FK on `cards` table
- Implement `AcpAdapter` in `card-session-manager.ts`:
  - WebSocket connect to ACP server URL
  - `initialize` handshake (`clientCapabilities: {}`)
  - `session/new` on first dispatch, `session/resume` on reconnect (if advertised)
  - `session/prompt`, receive `session/update` stream
  - `session/request_permission` handler: check auto_approve, else emit to SSE for UI
  - `session/cancel` + hard timeout
  - Emit card updates via existing SSE infrastructure
- Keep `LegacyBridgeAdapter` as-is for backward compat
- Conformance test harness: JSON-RPC fixture replay against AcpAdapter (validates protocol handling without a live agent)
- RPC-level request/response logging at the transport layer (replaces HTTP access logs)

**Validate against:** `copilot --acp --port 3031` with a test workspace before touching the bridge.

### Phase 2 - copilot-bridge: ACP channel adapter

With the kanban client validated, build the bridge-side ACP server.

Tasks:
- New channel adapter: `src/channels/acp/adapter.ts`
- HTTP server (Fastify) on `platforms.acp.port` (default 3030)
- WebSocket route per bot: `WS /<botName>`
- On WebSocket connect: parse bot name from path, look up bot config
- JSON-RPC message router:
  - `initialize` -> return agentCapabilities, authMethods (from copilot-sdk if available)
  - `session/new` -> `bridge.createSession({ workingDirectory, agent, model })`
  - `session/prompt` -> forward to active copilot-sdk session
  - `session/cancel` -> cancel session
  - `session/close` -> close and clean up session
- Forward `session/update` notifications from copilot-sdk -> WebSocket client
- Forward `session/request_permission` from copilot-sdk -> WebSocket client, await response
- Optional bearer token validation on WebSocket upgrade (if `platforms.acp.bots.<name>.token` is set)
- Config shape mirrors mattermost platform (port at platform level, bots with agent/model/workingDirectory/admin/mode/users)

### Phase 3 - Kanban: agent settings UI + permission UI + connection health

Tasks:
- Settings > Agents tab (extends /settings):
  - Add agent form: name, protocol, URL, auto_approve toggle
  - Connection status badge per agent (from health monitor SSE events)
  - Test connection button
- Card creation: agent selector (defaults to first connected agent)
- Permission request UI in card detail:
  - Tool description, approve/deny buttons
  - 60s countdown timer before auto-deny
  - Shows when card is in `awaiting_permission` sub-state
- Connection health monitor service (ping/pong loop, updates connection state, emits SSE)

### Phase 4 - Graceful degradation

Tasks:
- Connection state machine per agent (disconnected/connecting/connected/degraded)
- Exponential backoff reconnect loop
- SSE events for connection state changes (browser updates badge in real time)
- `interrupted` card state: cards that were running when agent disconnected or kanban restarted
- Manual re-dispatch button on interrupted cards
- Startup recovery: scan for `running` cards on boot, mark as `interrupted`
- Kanban-only mode validation: confirm all CRUD operations work without any agent

### Phase 5 - Cleanup

Tasks:
- Remove callback_token validation from callback route (or repurpose for remote auth)
- Deprecation notice on LegacyBridgeAdapter (keep code, mark deprecated)
- Update kanban docs: ACP configuration guide

---

## 10. What We Keep From Current Work

| Component | Status | Notes |
|-----------|--------|-------|
| Card state machine | Keep as-is | Add `interrupted` state |
| SSE infrastructure | Keep as-is | Add agent connection state events |
| Admin /settings page | Keep, extend | Add Agents tab |
| agent_tokens table | Keep, repurpose | ACP transport tokens for remote deployments |
| LegacyBridgeAdapter | Keep | Wraps existing dispatch code |
| card-session-manager tests | Keep, extend | Add AcpAdapter test suite |
| channelLock fix (ca1c054) | Keep | Still needed for legacy/Mattermost path |

---

## 11. Known Risks and Open Items

| Risk | Mitigation |
|------|-----------|
| ACP streamable HTTP draft changes shape | Build transport behind an interface; swap without protocol changes |
| Copilot CLI does not advertise session/resume | Fall back to interrupted state + re-dispatch button |
| envLock still serializes session creation in bridge | Separate workstream; not fixed by ACP. Track as bridge bug. |
| copilot-sdk does not expose session/request_permission natively | May need to intercept at SDK event level; verify during Phase 2 |
| Homer hang (copilot-4ta) | Unrelated to protocol. Keep on backlog, do not use homer for testing. |

---

## 12. Future: A2A Compatibility

The single-port HTTP server built in Phase 2 is the foundation. Adding A2A later is:
- `GET /<botName>/.well-known/agent.json` -> serve agent card (capabilities, auth methods, endpoint URL)
- A2A JSON-RPC task submission -> translate to ACP session/prompt internally

No architectural changes needed. A2A becomes a route on the same server.


---

## 13. ACP Platform Port Configuration

The `port` field under `platforms.acp` is user-configurable with a default of `3030` if omitted:

```json
{
  "platforms": {
    "acp": {
      "port": 3030
    }
  }
}
```

copilot-bridge resolves the port at startup:
- If `platforms.acp.port` is set: use that value
- If omitted: default to `3030`
- If the port is already in use: fail fast with a clear error message at startup

This follows the same pattern as copilot-bridge's existing Fastify HTTP server port handling.

---

## 14. Branch and PR Hygiene

### Current state (as of 2026-05-14)

| Branch | Status | Action |
|--------|--------|--------|
| `main` | Current, all fixes merged | Keep |
| `feat/acp-channel-adapter` | **New branch for this work** | Active |
| `feat/http-channel-adapter` | Superseded by ACP | Delete after new branch validated |
| `feat/http-channel-idle-fix` | Merged to main | Delete |
| `feat/approval-auto-deny` | Merged to main | Delete |
| `feat/a2a-migration` | Partially relevant but approach changed | Delete after cherry-picking any useful commits |
| `impl/active` | Orchestration worktree | Delete |
| `impl-gpt/t1` | Old implementation branch | Delete |

### Upstream PRs (ChrisRomp/copilot-bridge)

| PR | Status | Action |
|----|--------|--------|
| #216 HTTP channel adapter | CLOSED 2026-05-13 | Already done |
| #159 Beads docs | OPEN | Keep - unrelated, still valid |
| #158 Session hooks | OPEN | Keep - unrelated, still valid |

### New feature issue

File in `raykao/copilot-bridge` explaining the HTTP adapter approach is superseded by a proper ACP channel adapter. Link back to kanban#4 and this plan for context.

### Branch cleanup order

1. Start work on `feat/acp-channel-adapter` (current)
2. Validate Phase 1 (kanban AcpAdapter against raw CLI)
3. Once Phase 2 begins and `feat/acp-channel-adapter` has meaningful commits, delete stale branches:
   - `feat/http-channel-adapter`
   - `feat/http-channel-idle-fix`
   - `feat/approval-auto-deny`
   - `feat/a2a-migration`
   - `impl/active`
   - `impl-gpt/t1`

Do NOT delete stale branches before the new branch is validated - they are the fallback if something needs to be recovered.



---

## 14. Design Revision (2026-05-17)

The following decisions were made after the original plan and supersede any
conflicting guidance above.

### Providers table (new)

A separate `providers` table replaces the implicit provider-in-agents model.
All provider connection configs live here. `label` is required -- users must
name each connection explicitly.

```
providers: id, type, label (required), url, ws_url, api_key, status, last_discovered_at
agents:    id, name, protocol, url, auto_approve, api_key, provider_id -> providers.id
```

Rationale: cleaner separation between "connection config" (providers) and
"dispatch target" (agents). Extensible without schema churn. The `agents`
table stays uniform regardless of how the agent was discovered.

### Single-URL model for copilot-bridge

The user configures ONE URL for a `copilot-bridge` provider: the HTTP adapter
URL (e.g. `http://localhost:7878`). The ACP WebSocket URL is NOT manually
configured -- it is auto-discovered from the catalog response.

Bridge change required: `GET /v1/agents/cards` response adds `acpWsUrl` field,
sourced from `platforms.acp.port` in `config.json`.

If the bridge restarts on a different ACP port, the next discovery cycle
updates `providers.ws_url` and reconnects `AcpSessionManager` instances.

### Dispatch is always AcpSessionManager

Both `acp` and `copilot-bridge` provider types dispatch via `AcpSessionManager`
(WebSocket JSON-RPC). `CopilotBridgeProvider` and `GenericAcpProvider` are
transitional classes that will be removed once the new provider model is
implemented. `CardSessionManager` (HTTP SSE) and `subscribeToBridgeRunStream`
are legacy paths, not the target architecture.

### Settings UI

Two sections on the Settings > Agents tab:

1. Providers: one row per configured connection, status badge, add/edit/delete
2. Agents: auto-populated from providers, `auto_approve` toggle, provider label shown

### Retry and connection state

Status values: `disconnected | connecting | connected | reconnecting`

- copilot-bridge: HTTP discovery loop drives status. Exponential backoff
  (2s base, 2x multiplier, 60s cap, unlimited retries).
- Both types: `AcpSessionManager` WS reconnect uses same backoff curve.
- Status changes emitted via `provider.status_changed` SSE event to browser.

### Protocol type cleanup

`generic-acp` protocol is deprecated. It used `subscribeToBridgeRunStream`
(HTTP SSE) which is not standard ACP. It is replaced by `acp` type with
`AcpSessionManager` dispatch. Migration: existing `generic-acp` rows are
updated to `acp` protocol; `GenericAcpProvider` class is removed.
