# Tasks: Consolidate Client/Server (Issue #1)

Relates to: raykao/copilot-bridge-kanban#1

## Phase 0: Scaffold New Structure

### t0 - Create unified package.json and tsconfig

**Goal:** Replace workspaces with a single root package.json that has all dependencies from both packages. Create tsconfig files for server and client.

**Steps:**
1. Create new root `package.json` (non-workspace) combining all deps from `packages/server/package.json` and `packages/client/package.json`
2. Keep `name: "@copilot-bridge/kanban"`, `version: "0.2.0"`
3. Scripts: `"dev"`, `"build"`, `"start"`, `"test"`, `"lint"`, `"cli"`
4. Create `tsconfig.server.json` extending `tsconfig.base.json` targeting `src/server/`
5. Create `tsconfig.client.json` (Vite handles this but needed for IDE)
6. Run `npm install` -- must succeed with no errors

**Validation:** `npm install` exits 0, `node -e "require('./package.json')"` succeeds

---

### t1 - Move server source to src/server/

**Goal:** Relocate `packages/server/src/*.ts` to `src/server/` preserving all file contents exactly.

**Steps:**
1. `mkdir -p src/server`
2. Copy all `.ts` files from `packages/server/src/` to `src/server/` (not test files yet)
3. Copy `packages/server/cli/` to `src/cli/`
4. Update any relative import paths that reference `../../client/dist` to point to `dist/client/`
5. Ensure `src/server/index.ts` is the entry point

**Validation:** `npx tsc --noEmit -p tsconfig.server.json` exits 0

---

### t2 - Move client source to src/client/

**Goal:** Relocate `packages/client/src/` to `src/client/` preserving all file contents exactly.

**Steps:**
1. `mkdir -p src/client`
2. Copy entire `packages/client/src/` tree to `src/client/`
3. Move `packages/client/index.html` to root `index.html`
4. Move `packages/client/vite.config.ts` to root `vite.config.ts`
5. Update vite.config.ts: `root` stays as `.`, resolve alias `@` points to `src/client`
6. Update `index.html` script src to reference `src/client/main.tsx`

**Validation:** `npx tsc --noEmit -p tsconfig.client.json` exits 0

---

### t3 - Move test files

**Goal:** Relocate all test files to new locations alongside their source.

**Steps:**
1. Move `packages/server/src/*.test.ts` to `src/server/`
2. Move `packages/client/src/**/*.test.ts` (if any) to `src/client/`
3. Create root `vitest.config.ts` with two projects: `{ test: { include: ['src/server/**/*.test.ts'] } }` and `{ test: { include: ['src/client/**/*.test.ts'] } }`
4. Update any import paths in test files

**Validation:** `npx vitest run` passes all existing tests

---

## Phase 1: Wire Unified Dev Server

### t4 - Implement Vite middleware mode in dev

**Goal:** In development, Fastify loads Vite as middleware so HMR and API share one port.

**Steps:**
1. Create `src/server/dev.ts` that:
   - Imports `createServer` from `vite` (dynamic import so prod doesn't load it)
   - Creates vite dev server in middleware mode: `{ server: { middlewareMode: true }, appType: 'spa' }`
   - Returns a Fastify plugin that registers `vite.middlewares` via `app.use()` (requires `@fastify/middie`)
2. Add `@fastify/middie` as a dev dependency
3. In `src/server/index.ts`, detect `NODE_ENV !== 'production'`:
   - If dev: register middie plugin, then register vite middleware
   - If prod: use existing `@fastify/static` serving from `dist/client/`
4. Remove the old `packages/client/vite.config.ts` server.proxy block (no longer needed)

**Validation:** `npm run dev` starts, `curl http://localhost:3000` returns HTML with Vite HMR script, `curl http://localhost:3000/api/health` returns `{"status":"ok"}`

---

### t5 - Update vite.config.ts for unified build

**Goal:** Configure Vite build to output to `dist/client/`.

**Steps:**
1. Update root `vite.config.ts`:
   - `build.outDir` = `dist/client`
   - `build.emptyOutDir` = true
   - Remove any proxy config
   - Keep react plugin and `@` alias
2. Verify `index.html` at root references `src/client/main.tsx`

**Validation:** `npx vite build` succeeds, `dist/client/index.html` exists, `dist/client/assets/` has JS/CSS bundles

---

### t6 - Update server build

**Goal:** Server compiles to `dist/server/` via tsc.

**Steps:**
1. `tsconfig.server.json`: set `outDir: "dist/server"`, `rootDir: "src/server"`
2. Add build script: `"build:server": "tsc -p tsconfig.server.json"`
3. Add combined: `"build": "npm run build:server && vite build"`
4. Update `src/server/server.ts` static path resolution: in prod, client dist is at `../../dist/client` relative to `dist/server/server.js`

**Validation:** `npm run build` exits 0, `dist/server/index.js` exists, `dist/client/index.html` exists

---

### t7 - Wire npm scripts

**Goal:** All npm scripts work correctly.

**Steps:**
1. `"dev"`: `NODE_ENV=development tsx src/server/index.ts`
2. `"build"`: `tsc -p tsconfig.server.json && vite build`
3. `"start"`: `NODE_ENV=production node dist/server/index.js`
4. `"test"`: `vitest run`
5. `"lint"`: `tsc --noEmit -p tsconfig.server.json && tsc --noEmit -p tsconfig.client.json`
6. `"cli"`: `tsx src/cli/manage-users.ts`

**Validation:** Each script runs successfully

---

## Phase 2: Cleanup and Polish

### t8 - Remove old packages/ directory

**Goal:** Delete the old workspace structure.

**Steps:**
1. Remove `packages/` directory entirely
2. Remove `"workspaces"` field from package.json
3. Remove any `packages/*/tsconfig.json` references
4. Verify `npm install` still works (lock file may need regenerating)

**Validation:** `ls packages` fails (doesn't exist), `npm install` exits 0, `npm run build` exits 0, `npm test` passes

---

### t9 - Update Dockerfile

**Goal:** Dockerfile reflects new single-package structure.

**Steps:**
1. Remove workspace-specific COPY lines for `packages/server/package.json` and `packages/client/package.json`
2. COPY `package.json`, `package-lock.json`, `tsconfig.base.json`, `tsconfig.server.json`, `index.html`, `vite.config.ts`
3. `RUN npm ci`
4. COPY `src/` directory
5. `RUN npm run build`
6. Production stage: `npm ci --omit=dev`, copy `dist/` from build stage
7. CMD: `["node", "dist/server/index.js"]`
8. Keep existing HEALTHCHECK

**Validation:** `docker build -t kanban-test .` succeeds, `docker run --rm -e BRIDGE_API_URL=http://host.docker.internal:7878 -e BRIDGE_API_KEY=test -e SESSION_SECRET=test -p 3000:3000 kanban-test` serves both API and client

---

### t10 - Update docker-compose.yml

**Goal:** docker-compose reflects new structure.

**Steps:**
1. Update build context (still `.`)
2. Verify env vars are correct (same as before)
3. No changes to volumes or depends_on

**Validation:** `docker compose config` exits 0

---

### t11 - Update README

**Goal:** README reflects new dev workflow.

**Steps:**
1. Remove references to separate client/server dev commands
2. Document single `npm run dev` workflow
3. Document env vars needed: `BRIDGE_API_URL`, `BRIDGE_API_KEY`, `SESSION_SECRET`
4. Document `npm run cli -- user add <username> <password>`
5. Keep Docker section, update if needed

**Validation:** README is accurate and complete

---

### t12 - Final validation

**Goal:** Full integration test of the refactored app.

**Steps:**
1. `rm -rf node_modules dist && npm install`
2. `npm run lint` -- exits 0
3. `npm test` -- all tests pass
4. `npm run build` -- exits 0
5. `npm run dev` -- serves client + API on port 3000
6. `npm start` (after build) -- serves production bundle on port 3000
7. Docker build and run -- works

**Validation:** All above pass, commit and push

---

## Implementation Notes

- The server already has `@fastify/static` and SPA fallback in `server.ts` -- don't rewrite, just adjust paths
- Client `api/client.ts` uses relative paths (`/api/...`) -- no changes needed since same origin
- SSE proxy streaming in `proxy.ts` -- must verify it still works with middleware mode
- `@fastify/middie` enables express-style middleware (for Vite's connect middleware) on Fastify
- The CLI reads `DB_PATH` from env -- independent of server, no changes needed
