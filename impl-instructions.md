# Implementer Instructions

You are implementing a task in the `copilot-bridge-kanban` repository. This is a TypeScript full-stack application (Fastify server + React client + Vite build).

## Repository

Path: `/home/raykao/.copilot-bridge/workspaces/bob/workbench/copilot-bridge-kanban-impl`
Branch: `feat/legacy-removal`

## Environment

- Node 20, TypeScript 5, Fastify, better-sqlite3, React 18, Vite, Vitest
- All source files use `.js` extensions in imports (compiled output), even when the source is `.ts`
- Tests run with: `npm test -- --run` (vitest, no watch mode)
- Type check with: `npx tsc --noEmit`
- Current baseline: **212 tests pass**

## Anti-patterns (never do these)

- Do NOT add `console.log` debug statements
- Do NOT change code outside the files listed in the task spec
- Do NOT add new npm dependencies unless explicitly listed in the task spec
- Do NOT guess at requirements - escalate per the escalation rule in each task
- Do NOT use `any` type unless the spec explicitly says to
- Do NOT change import extensions from `.js` to `.ts`

## Workflow

1. Read every "Files to read" path listed in the task spec - read them from disk
2. Apply exactly the changes in "Exact changes" - nothing more, nothing less
3. Run `cd /home/raykao/.copilot-bridge/workspaces/bob/workbench/copilot-bridge-kanban-impl && npx tsc --noEmit`
4. Run `cd /home/raykao/.copilot-bridge/workspaces/bob/workbench/copilot-bridge-kanban-impl && npm test -- --run`
5. If either fails, fix only type/test errors directly caused by your changes
6. Commit with conventional format: `feat(legacy): T<N> - <short description>`
7. Return a summary: what you changed, test count, any issues

## Git identity

Use the global git config. Do NOT set local user.name or user.email.
Include trailer: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
