> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Stack-Specific Gotchas

## Async Server Components are not Vitest-renderable (React 19 / Next 16)

`async function Page()` / async layouts cannot be rendered in jsdom by Vitest or React Testing Library — confirmed unsupported as of May 2026 (Next.js testing docs, vitest-dev/vitest#8526, testing-library/react-testing-library#1209). There is **no jsdom workaround**; do not invent one. Prove async RSC behavior with Playwright. Synchronous Server Components and Client Components **are** renderable (with the jsdom docblock).

## Missing `// @vitest-environment jsdom` docblock

Default env is `node` (`vitest.config.ts`). A `*.test.tsx` that renders without the top-of-file `// @vitest-environment jsdom` docblock has no `document`/`window` — `render()` throws or assertions no-op. Symptom: `ReferenceError: document is not defined` or queries finding nothing. Add the docblock as the **first line**. Pure-logic tests must **not** add it (keeps them on the faster `node` env).

## `next/navigation` throws outside the Next runtime

`useRouter`/`usePathname`/`useSearchParams` have no Node implementation. A unit-rendered client component/hook that calls them throws `invariant expected app router to be mounted`. Mock the module once per test file (`references/mock-health-rules.md`). This is the **only** Next primitive you mock — `next/image`, `next/link`, `next/font` are real in tests.

## MSW + route handler: import order / dynamic import

MSW must be **listening before** the route handler issues its fetch. `mocks/setup.ts` calls `server.listen()` in a global `beforeAll`, so a top-level `import { POST } from "@/app/api/.../route"` is generally safe. **But** if the handler module (or a module it imports, e.g. one that reads `env` or registers `upstream.use(...)` at module load) initializes at import time, a static import can evaluate before MSW is ready or capture stale env. In that case import the handler via **dynamic `import()` inside the test/`beforeEach`** (after `server.listen()`), optionally with `vi.resetModules()`. (Recorded project pattern: BFF route-handler integration tests should dynamic-`import()` the handler after MSW `listen`, or they bypass MSW.)

## `onUnhandledRequest` must differ by runtime

`"error"` in `mocks/setup.ts` (Vitest — an unhandled fetch must fail the test). `"bypass"` in `instrumentation.ts` (E2E — Next's own internal requests must pass through). Copying `"error"` into `instrumentation.ts` breaks the dev server under MSW; copying `"bypass"` into Vitest silently lets real network calls through and destroys the contract discipline.

## Playwright is containerized — no `webServer`, host-run

Per `next-frontend/CLAUDE.md` E2E architecture: Playwright runs on the **host** (`npx playwright test`, `baseURL` `http://localhost:3001`) against the **containerized `next dev` started with `MSW_ENABLED=true`**. Do **not** add a `webServer` block (it would try to spawn/own the server) and do **not** point Playwright at a production `build && start` — the dev server is managed out-of-band and the contract is real `/api/**` + server-side-faked upstream. E2E specs must not `page.route()`/browser-intercept `/api/**` and must not reach a real NestJS API.

## Vitest 4 specifics (this project on `^4.1.6`)

- Requires Node ≥ 20 and Vite ≥ 6 — the container satisfies this; don't run Vitest on the host (different Node).
- `environmentMatchGlobs`/`poolMatchGlobs` were **removed** in v4. Do not reach for them to "auto-jsdom" component tests — the per-file `// @vitest-environment jsdom` docblock is the project's chosen mechanism; keep it.
- Browser Mode is now stable but requires a separate provider package (`@vitest/browser-*`) and is **not** used here — browser-level testing is Playwright's job, not Vitest Browser Mode. Don't introduce it.
- `vi.mock` factories are hoisted; reference helpers via `vi.hoisted(...)` or assign-then-import.

## `passWithNoTests: true`

`vitest.config.ts` sets `passWithNoTests: true`, so an empty/zero-match run **exits 0**. A green `npm test` does **not** prove tests exist. When the Definition of Done says "the affected suite passes", verify the test files were actually created and matched — don't trust a no-op green.

## Tailwind class assertions are mirror tests

`toHaveClass("bg-primary")`, asserting `cva` variant maps, or matching the icon's `<path d>` copy the implementation and break on harmless edits while proving nothing. Assert role, accessible name, `aria-invalid`, `data-slot`/`data-variant`. Visual/variant correctness is a Playwright/visual concern.

## `repository.delete`-style empty-cleanup N/A; teardown is MSW + Next

There is no DB in `next-frontend`. The relevant teardown is MSW's `afterEach(resetHandlers)` / `afterAll(close)` — already wired in `mocks/setup.ts`; do not re-register it per test file (double registration leaks/cross-talks handlers). For Playwright, rely on the reserved-trigger fixtures, not stateful cleanup.
