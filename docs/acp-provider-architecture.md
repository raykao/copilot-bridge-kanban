# ACP Provider Architecture

## Overview

Kanban is designed to work with any ACP-compatible agent, not just copilot-bridge.
This document describes the provider abstraction that makes this possible, explains
the standard contract every provider must follow, and documents how to add a new
provider when an agent deviates from or extends the base ACP spec.

---

## The Problem

The A2A/ACP spec defines how agents advertise themselves and accept work, but it
does not define how a client discovers *which agents exist* on a server. Different
implementations make different choices:

| Agent | Discovery | Dispatch |
|-------|-----------|----------|
| Standard ACP | `GET <baseUrl>/.well-known/agent-card.json` (one agent per URL) | Run URL taken from `card.supportedInterfaces[0].url` |
| copilot-bridge | `GET <baseUrl>/v1/agents/cards` catalog (N agents, one URL) | `POST <baseUrl>/runs` with `agent_name` in body |

Without an abstraction layer, kanban is coupled to a single provider's conventions.

---

## Architecture

```
AgentProvider (interface)
  |
  +-- GenericAcpProvider        (standard ACP - one agent per URL)
        |
        +-- CopilotBridgeProvider  (overrides discovery + dispatch)
```

### AgentProvider interface

Every provider implements:

```ts
interface AgentProvider {
  id: string;        // DB row id
  type: string;      // 'generic-acp' | 'copilot-bridge' | ...
  label: string;     // display name shown in UI
  baseUrl: string;

  // Return all agents this provider exposes.
  discover(): Promise<AgentCard[]>;

  // Start a new run. Returns a run ID for streaming/resuming.
  createRun(
    agentCard: AgentCard,
    input: string,
    sessionId?: string,
  ): Promise<{ runId: string }>;

  // Stream events for an in-progress run.
  streamEvents(runId: string): AsyncIterable<AcpEvent>;

  // Resume a run that is waiting for user input (e.g. permission approval).
  resumeRun(runId: string, response: ResumePayload): Promise<void>;
}
```

`AgentCard` carries a `provider` reference so kanban always knows which provider
to route dispatch calls to for a given card.

---

## GenericAcpProvider (standard contract)

Implements the A2A spec as written. Use this for any agent that fully follows
the spec without customisation.

### Discovery

```
GET <baseUrl>/.well-known/agent-card.json
```

Returns a single `AgentCard`. One URL = one agent.

### Dispatch

The run URL is read from the card itself:

```
card.supportedInterfaces[0].url
```

The provider never assumes a specific path - it uses whatever the card advertises.

### Auth

Bearer token supplied in provider config, sent as `Authorization: Bearer <token>`.

---

## CopilotBridgeProvider

Extends `GenericAcpProvider` and overrides two methods. Both deviations exist
because copilot-bridge hosts multiple agents behind a single base URL.

### Deviation 1 - Discovery

**Standard:** `GET <baseUrl>/.well-known/agent-card.json` -> one card

**Bridge override:** `GET <baseUrl>/v1/agents/cards` -> `{ cards: AgentCard[] }`

Rationale: bridge is a multi-agent host. A single `.well-known/` path cannot
represent N agents. The catalog endpoint returns all agents the API key can access.

Individual cards are still available at:
```
GET <baseUrl>/agents/<name>/.well-known/agent-card.json
```

### Deviation 2 - Dispatch

**Standard:** POST to `card.supportedInterfaces[0].url` (per-agent URL from card)

**Bridge override:** `POST <baseUrl>/runs` with `agent_name` in request body

```json
{
  "agent_name": "bob",
  "input": "...",
  "session_id": "..."
}
```

Rationale: bridge multiplexes all agents on a single `/runs` endpoint and uses
`agent_name` to route internally, rather than exposing per-agent run URLs.

---

## Provider registry

Providers are stored in the `providers` DB table:

```sql
CREATE TABLE providers (
  id       TEXT PRIMARY KEY,
  type     TEXT NOT NULL,       -- 'generic-acp' | 'copilot-bridge'
  label    TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key  TEXT,
  enabled  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
```

On startup, the existing bridge URL from env is seeded as a `copilot-bridge` row.
Additional providers are added via the Settings UI.

On board load, kanban calls `discover()` on all enabled providers in parallel and
merges the resulting agent cards into the column list.

---

## Adding a new provider

1. Create `src/server/providers/<name>.ts` that implements `AgentProvider`.
2. Start with `GenericAcpProvider` as the base class.
3. Override only the methods that differ from the standard. For each override,
   add a comment block with this structure:

```ts
/**
 * DEVIATION from GenericAcpProvider.discover()
 *
 * Standard: GET <baseUrl>/.well-known/agent-card.json -> single card
 * This override: <describe what this provider does instead>
 * Reason: <why the provider works this way>
 */
```

4. Add the new type string to the `ProviderType` union in `src/server/providers/types.ts`.
5. Register the factory in `src/server/providers/registry.ts`.
6. Add a row to the deviation table in this document.

### Known provider deviations

| Provider | Method | Deviation | Reason |
|----------|--------|-----------|--------|
| `copilot-bridge` | `discover()` | Catalog endpoint, returns N cards | Multi-agent host |
| `copilot-bridge` | `createRun()` | Single `/runs` endpoint, `agent_name` in body | Agent multiplexing |

Update this table whenever a new provider introduces a deviation.
