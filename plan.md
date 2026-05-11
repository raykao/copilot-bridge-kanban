# Plan: Consolidate Client/Server

**Issue:** raykao/copilot-bridge-kanban#1
**Branch:** refactor/unified-server

## Approach

Merge the two-workspace monorepo into a single package. Use Vite middleware mode in dev so one process serves both HMR and API on port 3000. In production, Fastify serves the pre-built SPA via @fastify/static (already coded).

## Key Insight

The production path already works -- `server.ts` has `@fastify/static` + SPA fallback. The refactor is about:
1. Flattening the directory structure (packages/* -> src/client, src/server)
2. Wiring Vite middleware mode for dev HMR
3. Cleaning up the workspace overhead

## Phases

| Phase | Tasks | Goal |
|-------|-------|------|
| 0 | t0-t3 | Scaffold new structure, move files, verify types + tests |
| 1 | t4-t7 | Wire unified dev server with Vite middleware, build scripts |
| 2 | t8-t12 | Remove old structure, Docker, docs, final validation |

## Risk Areas

- Vite middleware mode + Fastify needs @fastify/middie (express compat layer)
- SSE streaming proxy must still work with middleware in the chain
- tsconfig paths must resolve correctly for both IDE and build

## Dev Loop

Same pattern as http-adapter and kanban v1:
1. Implement task
2. Run validation command from task spec
3. If fail: fix and re-validate
4. If pass: commit with conventional commit message, move to next task
