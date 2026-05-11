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
docker compose exec kanban node dist/server/cli.js user add admin your-password
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

In development:

```bash
npm run cli -- add --username <name> --password <password>
npm run cli -- list
npm run cli -- delete --username <name>
```

In the Docker container:

```bash
node dist/server/cli.js user add <username> <password>
node dist/server/cli.js user list
node dist/server/cli.js user delete <username>
```

## Development setup

```bash
git clone https://github.com/raykao/copilot-bridge-kanban.git
cd copilot-bridge-kanban
npm install

export BRIDGE_API_URL=http://localhost:7878
export BRIDGE_API_KEY=your-key
export SESSION_SECRET=dev-secret

npm run dev
```

A single process serves both the Vite HMR client and the Fastify API on port 3000.

## Verification

```bash
npm run lint    # type-check server and client
npm test        # run vitest
npm run build   # build server (tsc) and client (vite)
```

## Architecture

Single-package layout:

- `src/server/`: Fastify 5 API server, auth, bridge proxy, preferences, SQLite
- `src/client/`: React 19 SPA built with Vite
- `src/cli/`: User management CLI

In development, Vite runs in middleware mode inside Fastify via `@fastify/middie`, so HMR and API share port 3000. In production, Fastify serves the pre-built SPA from `dist/client/` via `@fastify/static`.

## Links

- [Plan and spec](https://github.com/raykao/dark-factory/issues/52)
