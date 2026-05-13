# task-next-frontend-msw-foundation — Progress

**Status:** completed
**SIs:** 5/5 completed

### SI-1 — Instalar MSW + Vitest e dependências de teste
- **Status:** completed
- **Tests:** no tests
- **Observations:**
  - Installed msw@2.14.6, vitest@4.1.6, @testing-library/react@16.3.2, @testing-library/jest-dom@6.9.1, jsdom@29.1.1, @vitest/coverage-v8@4.1.6 as devDependencies.
  - Added `test` and `test:watch` scripts to `next-frontend/package.json`.
  - `npx vitest --version` → `vitest/4.1.6 linux-x64 node-v25.6.0`.

### SI-2 — Criar a árvore mocks/handlers/ + barrel + seed + diretório mocks/factories/
- **Status:** completed
- **Tests:** no tests
- **Observations:**
  - Created `mocks/handlers/_seed.ts` (typed empty `RequestHandler[]`), `mocks/handlers/index.ts` (barrel spreading seedHandlers), `mocks/factories/.gitkeep`.
  - `tsc --noEmit` exit 0.

### SI-3 — Wire MSW na lifecycle do Vitest
- **Status:** completed
- **Tests:** no tests (smoke-gated by AC)
- **Observations:**
  - Created `mocks/server.ts` (`setupServer(...handlers)` from `msw/node`), `mocks/setup.ts` (`listen({ onUnhandledRequest: "error" })` + `resetHandlers` + `close`), `vitest.config.ts` (`environment: "node"`, `setupFiles: ["./mocks/setup.ts"]`).
  - Added `passWithNoTests: true` to `vitest.config.ts` so the foundation smoke run exits 0 with no test files (Vitest 4 default is exit 1). Tech Spec did not specify the option but Acceptance Criteria requires exit 0 — the flag preserves the criterion verbatim without altering MSW lifecycle behavior. Future SIs (Phase 02+) will author real tests; the flag becomes a no-op once test files exist.
  - `npm test` exit 0 with "No test files found, exiting with code 0" (no `onUnhandledRequest` warnings).
  - `tsc --noEmit` exit 0.

### SI-4 — Atualizar .claude/rules/next-frontend-msw-mocks.md
- **Status:** completed
- **Tests:** no tests (rule doc only)
- **Observations:**
  - Rewrote `## Where MSW lives` section to enumerate `mocks/handlers/<domain>.ts`, `mocks/handlers/index.ts`, `mocks/factories/<domain>.ts`, `mocks/server.ts`, `mocks/setup.ts` with one-liner per role.
  - Added `## Lifecycle (Vitest setupFiles)` section citing `next-frontend-msw-foundation/TD-04`.
  - Added `## Factories convention` section citing `next-frontend-msw-foundation/TD-03` (hand-written defaults + opt-in seeded faker for bulk).
  - Updated handler example from `mocks/handlers.ts` to `mocks/handlers/auth.ts`; preserved `paths[...]` typing and `${env.API_URL}/...` URL composition verbatim.
  - `### Exception to the contracts-barrel rule` block preserved unchanged.

### SI-5 — Atualizar next-frontend/CLAUDE.md § Testing → Status
- **Status:** completed
- **Tests:** no tests (doc only)
- **Observations:**
  - Replaced `### Status — bootstrap pending` block with `### Status — bootstrap complete` listing the materialized artifacts and citing `docs/tasks/task-next-frontend-msw-foundation/`.
  - Updated "Already decided" block to mark `next-frontend-openapi-typing/TD-05` as executed convention (not pending).
  - Noted Playwright `test:e2e` is still absent — separate bootstrap task remains.
