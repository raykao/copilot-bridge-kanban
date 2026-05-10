# copilot-bridge-kanban

A production-ready Kanban web UI for managing copilot-bridge work cards, chat sessions, and agent interactions.

## Features

- Kanban board with drag-and-drop card management
- Card detail editing with labels, checkpoints, and threaded comments
- Chat UI with live agent response streaming
- Shiki-powered markdown code highlighting
- Dark, light, and system theme support
- Fastify API with SQLite persistence and bcrypt-backed auth

## Quick start with Docker

1. Export the required secrets:

```bash
export BRIDGE_API_KEY=your-bridge-api-key
export SESSION_SECRET=$(openssl rand -hex 32)
```

2. Start the stack:

```bash
docker compose up --build -d
```

3. Create the first login:

```bash
docker compose exec kanban node packages/server/dist/cli.js user add admin your-password
```

4. Open <http://localhost:3000>.

The bundled `bridge` service is a placeholder. Replace its image and configuration, or point `BRIDGE_API_URL` at an existing copilot-bridge deployment.

## Environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `BRIDGE_API_URL` | Base URL for the copilot-bridge HTTP API | Required |
| `BRIDGE_API_KEY` | Bearer token used by the server-side proxy | Required |
| `SESSION_SECRET` | Secret used to sign the session cookie | Required |
| `DB_PATH` | SQLite database path inside the container | `/data/kanban.db` |
| `PORT` | Fastify listen port | `3000` |

## Production image

Build and run the image without Compose:

```bash
docker build -t copilot-bridge-kanban .
docker run --rm -p 3000:3000 \
  -e BRIDGE_API_URL=http://host.docker.internal:8080 \
  -e BRIDGE_API_KEY="$BRIDGE_API_KEY" \
  -e SESSION_SECRET="$SESSION_SECRET" \
  -v kanban-data:/data \
  copilot-bridge-kanban
```

The container exposes `GET /api/health` for readiness checks and persists SQLite data under `/data`.

## CLI user management

The production image includes a small user-management CLI:

```bash
node packages/server/dist/cli.js user add <username> <password>
node packages/server/dist/cli.js user list
node packages/server/dist/cli.js user delete <username>
```

## Development setup

```bash
git clone https://github.com/raykao/copilot-bridge-kanban.git
cd copilot-bridge-kanban
npm install
npm run dev
```

## Verification

```bash
cd packages/server && npx tsc --noEmit && npx vitest run
cd ../client && npx tsc --noEmit && npx vite build
```

## Architecture

This monorepo uses npm workspaces:

- `packages/server`: Fastify 5 API server, auth, bridge proxy, preferences, SQLite, and static asset hosting
- `packages/client`: React 19 SPA built with Vite

In production, the server serves `packages/client/dist` directly and proxies `/api/v1/*` traffic to copilot-bridge while keeping the bridge API key on the server.

## Links

- [Plan and spec](https://github.com/raykao/dark-factory/issues/52)
