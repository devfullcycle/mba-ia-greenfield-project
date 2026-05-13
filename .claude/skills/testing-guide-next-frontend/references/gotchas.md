> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Stack-Specific Gotchas

Specific failure modes you will hit with Vitest + React 19 + Next.js 16 + MSW + Playwright. Each entry tells you the symptom and the fix.

## React 19 / RSC

### Async Server Components are not unit-renderable

**Symptom**: `render(<AsyncPage />)` produces `Objects are not valid as a React child (found: Promise)`, or jsdom hangs, or you get a cryptic error about `await` in a component.

**Cause**: Vitest, React Testing Library, and React 19 itself do not render `async function Component()` outside a Next.js runtime. This is an open limitation as of React 19 / Next.js 16.

**Fix**: do not unit-test async RSCs. Move the assertion to a `*.e2e-spec.ts` and verify the rendered DOM via Playwright. If the data transformation inside the async component is complex, extract a pure helper and unit-test the helper.

### `"use client"` and module-level `vi.mock`

**Symptom**: `useRouter()` throws `Cannot read properties of null` when a client component is rendered in a test.

**Cause**: `next/navigation` hooks have no Node implementation. Outside the Next runtime, they throw or return null.

**Fix**: at the top of each test file that renders a client component using these hooks:

```ts
const pushMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}))
```

Define `pushMock` (and any other captured mocks) *before* the `vi.mock` call uses them — `vi.mock` is hoisted, so the factory closure must reference variables declared with `var` or use the `vi.hoisted` helper for `const`/`let`:

```ts
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, /* … */ }) }))
```

## MSW

### `Request handler missing` errors

**Symptom**: a BFF test fails with `[MSW] Error: Request handler for "POST http://api.test/auth/login" is not defined`.

**Cause**: `onUnhandledRequest: "error"` (see `external-systems.md`) is doing its job — your test issued a `fetch` to a URL not covered by `handlers.ts` or `server.use(...)`.

**Fix**: add the handler inside the test or to the default set. The error is the safety rail; don't suppress it.

### Forgot the server lifecycle

**Symptom**: tests leak handlers — one test's `server.use(...)` affects later tests.

**Cause**: missing `server.resetHandlers()` in `afterEach`.

**Fix**: ensure `vitest.setup.ts` includes:

```ts
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

### Reading a request body twice

**Symptom**: a route handler's MSW test gets an empty body in the handler.

**Cause**: a `Request` body is a one-shot stream. If you `await req.json()` in the handler under test, the BFF can't read it again — but in a test, you usually want to read it in the MSW handler *as well* to assert what the BFF sent.

**Fix**: read the body inside the MSW handler (`http.post(url, async ({ request }) => { const body = await request.json(); /* assert */; return HttpResponse.json(...) })`), not in the test outside. The MSW handler sees the request the BFF dispatched, which is exactly what you want to assert.

### `set-cookie` headers in MSW responses

**Symptom**: the BFF reads cookies from the NestJS response and forwards them, but assertions on the forwarded cookie are empty.

**Fix**: build the cookie via `HttpResponse`'s `headers` option:

```ts
return new HttpResponse(JSON.stringify({ ok: true }), {
  status: 200,
  headers: {
    "content-type": "application/json",
    "set-cookie": "access_token=jwt-xyz; Path=/; HttpOnly",
  },
})
```

## Vitest

### `happy-dom` vs `jsdom`

For Next.js 16, prefer `happy-dom` (the official Next.js Vitest guide and the 2026 ecosystem consensus). If you hit a missing-API error (rare — usually `IntersectionObserver` / `ResizeObserver`), polyfill via `vi.stubGlobal` in `vitest.setup.ts` rather than switching to `jsdom`.

### Path alias resolution

**Symptom**: `Cannot find module '@/lib/utils'` in a test file.

**Fix**: add the alias to `vitest.config.ts`:

```ts
resolve: { alias: { "@": path.resolve(__dirname, ".") } }
```

This must mirror `tsconfig.json`'s `paths`.

### Tailwind v4 CSS in tests

Vitest does not need to process `globals.css` — set `test.css: false` in `vitest.config.ts`. The DOM tests assert on roles / accessible names / `data-*` attributes, not on computed styles, so CSS evaluation is unnecessary and slows tests down.

## Playwright

### Tested the dev server, not the production build

**Symptom**: tests pass locally with `next dev`, fail in CI or behave differently in production (different error overlays, different transitions, different middleware behavior).

**Fix**: `playwright.config.ts` must run `npm run build && npm run start`. See `file-conventions.md` for the template.

### Auth in every test

**Symptom**: every test calls `login()` in `beforeEach`, suite is slow.

**Fix**: use the `auth.setup.ts` storageState fixture from `file-conventions.md`. Authenticated specs reuse the saved cookie.

### `page.goto` before content is interactive

**Symptom**: `page.click(...)` fires before hydration; the click is lost.

**Fix**: prefer Playwright's auto-waiting locators (`page.getByRole(...)`). They wait for the element to be visible and stable before acting. Avoid raw `page.click(selector)` for App Router pages with client components — hydration is async.

### Flaky waits on async RSCs

**Symptom**: data from an async Server Component appears late, assertions race.

**Fix**: assert on the rendered text/role with Playwright's built-in retry semantics (`await expect(page.getByText(/loaded/)).toBeVisible()`). Do not insert `page.waitForTimeout(...)` — it makes tests slow and still flaky.

## Test organization

### `__tests__/` next to the artifact — not at the root

If you put tests under a top-level `tests/` folder by habit, the Vitest config will pick them up only by accident, and developers will lose them when refactoring. Co-locate Vitest tests under `__tests__/` next to the source file. `tests/` is reserved for Playwright.

### Don't mix Vitest and Playwright in one file

A file with `*.test.ts` runs in Vitest; a file with `*.e2e-spec.ts` runs in Playwright. The two have different `expect` and `test` globals — mixing them produces confusing failures. Keep them in separate files with the right suffix.

## TypeScript

### Missing types after install

After bootstrap installs Vitest + Testing Library + Playwright, types may not be picked up immediately. Add to `tsconfig.json` (or a `tsconfig.test.json` referenced from the main one):

```json
{ "compilerOptions": { "types": ["vitest/globals", "@testing-library/jest-dom"] } }
```

Note: this project sets `globals: false` in the Vitest config — use explicit imports (`import { describe, it, expect, vi } from "vitest"`) instead of relying on globals. The `types` entry is only needed for `@testing-library/jest-dom`'s matcher extensions.
