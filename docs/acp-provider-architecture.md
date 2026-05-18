# ACP Provider Architecture

**Last updated:** 2026-05-17
**Status:** Approved design, pending implementation

---

## Overview

Kanban supports two provider types for connecting to agents:

| Type | Description | Discovery | Dispatch |
|------|-------------|-----------|----------|
| `acp` | Standard ACP-compliant agent (one agent per endpoint) | `GET /.well-known/agent-card.json` | WebSocket JSON-RPC |
| `copilot-bridge` | Multi-agent host (N agents behind one server) | `GET /v1/agents/cards` catalog | WebSocket JSON-RPC per bot path |

Both types use WebSocket JSON-RPC (ACP protocol) for dispatch. The difference is
discovery and how agent URLs are derived.

---

## Database Schema

### `providers` table (new)

One row per configured connection. The `label` field is required -- it is the
human-readable name the user assigns when adding a provider in Settings.

```sql
CREATE TABLE providers (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL CHECK(type IN ('acp', 'copilot-bridge')),
  label            TEXT NOT NULL,       -- user-assigned, e.g. "Local Dev Bridge"
  url              TEXT NOT NULL,       -- acp: ws://host:port  copilot-bridge: http://host:port
  ws_url           TEXT,                -- copilot-bridge only: auto-filled from discovery
  api_key          TEXT,
  status           TEXT NOT NULL DEFAULT 'disconnected',
                                        -- disconnected | connecting | connected | reconnecting
  last_discovered_at TEXT,
  created_at       TEXT NOT NULL
);
```

### `agents` table (updated)

Gains a `provider_id` FK. All agents -- whether manually configured or
auto-discovered -- live in this table.

```sql
ALTER TABLE agents ADD COLUMN provider_id TEXT REFERENCES providers(id) ON DELETE CASCADE;
```

`provider_id` is NULL for legacy rows only. All new agents are created with a
`provider_id` pointing to their parent provider.

---

## Provider Type: `acp`

### Purpose

Standard ACP-compliant external agents: Claude Code, GitHub Copilot CLI,
Codex CLI, or any agent implementing the ACP spec.

### User configuration (Settings)

| Field | Example | Notes |
|-------|---------|-------|
| Label | "Claude Code" | Required, user-chosen |
| Type | acp | |
| URL | ws://localhost:5000 | The agent's WebSocket ACP endpoint |
| API key | (optional) | Sent as Bearer token on WS upgrade |

### On save

Kanban creates one `providers` row and one `agents` row (1:1). The agent URL
is the same as the provider URL.

### Discovery

`GET <url-with-http-scheme>/.well-known/agent-card.json` is called once on
save and on reconnect to verify the agent is reachable and retrieve its card
metadata (name, capabilities, skills). The WS URL itself is configured
directly by the user -- the `.well-known` fetch is for metadata only.

### Dispatch

`AcpSessionManager` opens a WebSocket connection to `provider.url` and
dispatches via ACP JSON-RPC (`session/new`, `session/prompt`, etc.).

---

## Provider Type: `copilot-bridge`

### Purpose

copilot-bridge is a multi-agent host. One server exposes N agents. Kanban
connects to the bridge and auto-discovers all agents from a catalog endpoint.

### User configuration (Settings)

| Field | Example | Notes |
|-------|---------|-------|
| Label | "Local Dev Bridge" | Required, user-chosen |
| Type | copilot-bridge | |
| URL | http://localhost:7878 | Bridge HTTP adapter URL -- this is the ONLY URL the user enters |
| API key | (optional) | Sent as Bearer token on HTTP + WS |

The WebSocket URL is NOT configured by the user. It is auto-discovered
from the catalog response (see below).

### Discovery flow

```
1. GET http://localhost:7878/v1/agents/cards
   Response: {
     acpWsUrl: "ws://localhost:3030",   <- bridge advertises its ACP WS port
     cards: [ { name: "bob", ... }, { name: "homer", ... }, ... ]
   }

2. Kanban saves acpWsUrl to providers.ws_url

3. For each card:
   UPSERT agents SET url = acpWsUrl + "/" + card.name
                       WHERE provider_id = this.provider.id AND name = card.name

4. Agents in DB but absent from catalog -> mark inactive (soft-delete)

5. providers.status = "connected", providers.last_discovered_at = now()
```

### Dispatch

For each agent under a `copilot-bridge` provider, dispatch uses
`AcpSessionManager` with `url = ws://localhost:3030/bob`. This is the same
`AcpSessionManager` used by `acp` type providers -- the dispatch path is
identical once the agent URL is resolved.

### Per-agent well-known cards

The bridge also exposes `GET /agents/:name/.well-known/agent-card.json` for
individual agent cards. Kanban does not use this for discovery (the catalog
is sufficient), but it is available for future A2A compatibility.

---

## State Machine

Each provider has a `status` field that drives the UI indicator and dispatch
behavior.

```
disconnected
     |
     | (startup / user adds provider)
     v
  connecting
     |
     | HTTP discovery succeeds, WS handshake OK
     v
  connected  <--------+
     |                |
     | HTTP or WS     | reconnect succeeds
     | connection     |
     | drops          |
     v                |
 reconnecting --------+
     |
     | max retries exceeded (not implemented - retry is unlimited)
     v
 disconnected
```

| Status | UI indicator | Card dispatch |
|--------|-------------|---------------|
| connected | Green dot | Normal |
| connecting | Spinner | Queued |
| reconnecting | Yellow dot + "Reconnecting..." | Blocked with message |
| disconnected | Red dot | Blocked with message |

---

## Retry / Reconnect

### HTTP discovery retry (copilot-bridge)

Exponential backoff on the discovery poll loop:

- Base delay: 2s
- Multiplier: 2x
- Cap: 60s
- Retries: unlimited

On each successful discovery: reset backoff, update `ws_url` if it changed,
upsert agents, set status `connected`.

If `ws_url` changes between discovery cycles (bridge restarted on a different
ACP port): existing `AcpSessionManager` WS connections are closed and
re-opened to the new WS URL. In-flight card runs are marked `interrupted`.

### WS reconnect (both types)

`AcpSessionManager` maintains a persistent WS connection per agent. If the
connection drops mid-session:

- Exponential backoff reconnect (same curve as above)
- If the agent advertises `sessionCapabilities.resume`: attempt `session/resume`
  on reconnect
- If not: mark card as `interrupted`, show re-dispatch button in UI

---

## Settings UI Layout

```
Providers
+----------------------------------------------------------------------+
| Label              Type             URL                   Status     |
| Local Dev Bridge   copilot-bridge   http://localhost:7878  connected  |
| Claude Code        acp              ws://localhost:5000    connected  |
+----------------------------------------------------------------------+
[+ Add Provider]

Agents
+----------------------------------------------------------------------+
| Name         URL                       Provider           Status     |
| bob          ws://localhost:3030/bob    Local Dev Bridge   connected  |
| homer        ws://localhost:3030/homer  Local Dev Bridge   connected  |
| claude-code  ws://localhost:5000        Claude Code        connected  |
+----------------------------------------------------------------------+
```

Agents are read-only in the UI -- they are managed by their parent provider.
The only agent-level setting editable by the user is `auto_approve`.

---

## Implementation Phases

### Phase P1 - DB migrations + providers API

- Migration: `providers` table
- Migration: `agents.provider_id` FK
- Migration: `agents.ws_url` removed (moved to providers), `agents.url` updated
- REST routes: `POST /api/providers`, `GET /api/providers`, `PATCH /api/providers/:id`,
  `DELETE /api/providers/:id`
- On create: trigger initial discovery

### Phase P2 - copilot-bridge provider logic

- `CopilotBridgeProvider.discover()`: fetch catalog, extract `acpWsUrl`, upsert agents
- Bridge HTTP adapter: add `acpWsUrl` field to `GET /v1/agents/cards` response
- Retry/backoff loop
- State machine + SSE events for status changes

### Phase P3 - AcpSessionManager persistent connection

- One persistent WS connection per agent (not per dispatch)
- Reconnect on drop with exponential backoff
- `session/resume` support

### Phase P4 - Settings UI

- Providers section: add/edit/delete, status badge
- Agents section: auto-populated, `auto_approve` toggle
- Connection status badge (live via SSE)

### Phase P5 - Generic ACP provider logic

- `GenericAcpProvider`: fetch `.well-known/agent-card.json` for metadata
- Use `AcpSessionManager` for dispatch (replacing `subscribeToBridgeRunStream`)
- Remove `generic-acp` protocol type (replace with `acp`)
