> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# File Conventions

## Suffix is a contract (drives runner, location, allowed I/O)

| Suffix | Layer | Runner | External I/O | Location |
|---|---|---|---|---|
| `*.test.ts` / `*.test.tsx` | Unit — pure logic / single component, collaborators mocked | Vitest | **Forbidden** | `__tests__/` next to the artifact |
| `*.integration.test.ts` / `*.integration.test.tsx` | Integration — route handler called as a function, MSW intercepting upstream | Vitest | MSW only (no real network) | `__tests__/` next to the artifact |
| `*.e2e-spec.ts` | E2E — full browser flow, real `/api/**` server-side, upstream faked | Playwright | server-side MSW via `instrumentation.ts` | `tests/` at project root |

Routing decision (first match wins): renders a component / invokes a hook-util in isolation with mocked collaborators → `*.test.ts(x)`. Imports a route handler, builds a `Request`, asserts the `Response` with MSW intercepting fetch → `*.integration.test.ts`. Drives the full app in a browser → `*.e2e-spec.ts` under `tests/`.

## Directory placement

- `components/<feature>/__tests__/*.test.tsx` — component unit tests.
- `app/api/<route>/__tests__/*.integration.test.ts` — route handler integration tests.
- `lib/__tests__/` or `lib/<area>/__tests__/*.test.ts` — utility/boundary-module unit tests.
- `hooks/__tests__/*.test.tsx` — hook unit tests (directory created with the first hook).
- `next-frontend/tests/*.e2e-spec.ts` — Playwright specs (root-level, host-run).

## jsdom opt-in (mandatory for JSX)

Default Vitest env is `node` (`vitest.config.ts`). Any test that renders JSX/TSX (components, pages, hooks via `renderHook`) **MUST** start with the docblock:

```ts
// @vitest-environment jsdom
```

`jsdom` and `@testing-library/react` are installed. Without the docblock the render has no DOM and assertions silently fail. Pure-logic tests (utils, Zod schema, non-rendering hooks) run under default `node` — **no docblock**.

## Configuration files

- `vitest.config.ts` — `environment: "node"`, `setupFiles: ["./mocks/setup.ts"]`, `passWithNoTests: true`.
- `mocks/setup.ts` — global MSW lifecycle (`listen` `error` / `resetHandlers` / `close`).
- `mocks/server.ts` — `setupServer(...handlers)`. `mocks/handlers/index.ts` — barrel. `mocks/handlers/<domain>.ts` — per-domain. `mocks/factories/<domain>.ts` — factories.
- Path alias `@/*` → project root (`tsconfig.json`). Vitest resolves it via the Vite/tsconfig integration; if a future config needs it explicitly, add `test.alias` or `vite-tsconfig-paths` — do not invent new aliases per-file.
- `playwright.config.ts` — **does not exist yet**. When Playwright is installed: **no `webServer` block** (the dev server is the containerized `next dev` with `MSW_ENABLED=true`, started out-of-band); `use.baseURL = "http://localhost:3001"`; specs in `tests/`. Playwright runs on the **host**, not in any container.

## Commands (Vitest/tsc/lint inside the container; Playwright on the host)

```bash
# Vitest — inside the next-frontend container
docker compose exec next-frontend npm test                      # full suite (vitest run)
docker compose exec next-frontend npm test -- path/to/file.test.ts   # single file (dev)
docker compose exec next-frontend npm run test:watch            # watch (background)

# Type-check + lint — inside the container (build gates)
docker compose exec next-frontend npx tsc --noEmit              # must exit 0
docker compose exec next-frontend npm run lint                  # must exit 0

# Playwright — on the HOST (once installed); containerized `next dev` must run with MSW_ENABLED=true
npx playwright test
npx playwright test tests/auth-login.e2e-spec.ts
```

## Build gates (Definition of Done — global `CLAUDE.md`)

A change is done only when, **inside the container**: the affected Vitest tests pass, the **full** Vitest suite passes, `npx tsc --noEmit` exits 0, `npm run lint` exits 0 — and (once Playwright is installed) the affected E2E specs pass on the host. Compilation errors are never left as debt.

## Coverage philosophy — Pragmatic

No coverage thresholds are enforced. Test what matters: the BFF↔NestJS contract (route-handler integration), auth/session flows (E2E + integration), branching utilities and the `env`/`cn` configured contracts. **Skip** trivial/presentational code: shadcn primitives, icons, prop-only feature components, static pages/layouts, pass-through `contracts.ts` aliases. Each test must catch a bug no other test catches — duplicate coverage across layers is waste, not safety.
