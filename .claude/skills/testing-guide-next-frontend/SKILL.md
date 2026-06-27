---
name: testing-guide-next-frontend
description: >
  Testing guide for next-frontend. Reference this skill when planning features,
  implementing code, creating tests, or reviewing changes in next-frontend.
  Covers what to test, at which layer, and how to set up each test — organized
  by artifact type. Triggers on: planning next-frontend features, implementing
  next-frontend features, writing tests for next-frontend, reviewing
  next-frontend code, reviewing next-frontend tests, what should I test in
  next-frontend, how to test next-frontend, next-frontend test guide.
---

## 0. Purpose

This guide helps you decide **what to test**, at **which layer**, and **how to set up tests** for each type of artifact in `next-frontend`. When working on a specific artifact type (page, client component, route handler, hook, utility, …), read the corresponding file in `artifacts/` for the complete recipe. Supporting references (MSW boundary, mock health, file conventions, gotchas) are in `references/`.

The contract is fixed by `next-frontend/CLAUDE.md` § "Testing" and the four `.claude/rules/next-frontend-*.md` rule files:

- **Vitest 4** runs unit + integration tests (`*.test.ts(x)`, `*.integration.test.ts(x)`). Default `environment: "node"`; tests that render JSX opt into jsdom **per-file** with the `// @vitest-environment jsdom` docblock.
- **Playwright** runs end-to-end tests (`*.e2e-spec.ts` under `tests/`) — see §6 and `references/gotchas.md` for the containerized architecture.
- **MSW (`msw/node`)** is the **only** fake for the NestJS upstream API. **No** Vitest test may open a real network connection to the upstream host (`.claude/rules/next-frontend-testing.md`).

> **Tooling status (2026-05):** Vitest + MSW are fully wired — `vitest.config.ts`, `mocks/setup.ts`, `mocks/server.ts`, the per-domain handler barrel, and the `npm test` script all exist and run. **Playwright is not yet installed** (no `@playwright/test`, no `playwright.config.ts`, no `test:e2e` script). E2E recipes below are the binding contract for browser flows; the first phase that needs a browser test triggers the Playwright install — no rule below changes when it lands.

## 1. Testability Foundations

These principles connect the universal layered-testing model to the Next.js 16 / React 19 / RSC reality of this project. They justify every decision in the artifact guides.

- **The server boundary is the real boundary in App Router.** A page or layout is a Server Component that may `fetch()`. A route handler is a server module the browser calls over HTTP. The one interesting "external system" for nearly every artifact is the **NestJS upstream API**, reached through the typed `upstream` client (`lib/api/upstream.ts`). The only two sanctioned ways to stand in for it are `msw/node` (Vitest) and the server-side MSW that `instrumentation.ts` boots for Playwright. **Never `vi.mock` global `fetch`; never point a Vitest test at the live API** — `mocks/setup.ts` runs MSW with `onUnhandledRequest: "error"`, so an unintercepted fetch fails the test loudly with `"request unhandled"`. That error *is* the contract-coverage discipline.
- **Async Server Components are not Vitest-renderable.** React 19 + Next.js 16 still cannot render `async function Page()` in jsdom — Vitest and React Testing Library both document this as unsupported (confirmed May 2026; no change since the prior generation). Behavior of async RSCs is proven via Playwright only. Synchronous Server Components and Client Components **are** unit-renderable under the `jsdom` docblock.
- **Mock owned collaborators across module boundaries, not within.** If `<LoginPage>` composes `<BrandLogo>` and `<AuthFooter>`, do **not** mock those — render them together. The mock boundary is the `fetch` to upstream (intercepted by MSW), `next/navigation` hooks (no Node implementation — must be mocked when a client component under unit test calls `useRouter`/`usePathname`/`useSearchParams`), and irreversible side effects (`router.push`, analytics). Everything else in the tree stays real.
- **Configured framework features are real in tests.** `next/image`, `next/link`, `next/font`, `cn()` from `lib/utils`, `cva` variants, design tokens, the Zod 4 `env` schema, the `openapi-fetch` `upstream` client — never mock these. Mocking them hides whether you wired them correctly (a wrong `href`, a missing `alt`, a token typo, a bad `API_URL` schema). They are the project's *configured dependency contracts* — verify them with real instances and test config, never a stub.
- **A Vitest+MSW test does not test the NestJS contract — it tests the BFF logic.** It proves the route handler asks the right URL/method/body and reshapes the response correctly *against a fixture*. Whether the real backend honors that shape is the upstream project's own integration suite plus Playwright against a running stack. Chain: Vitest+MSW proves BFF logic ↔ upstream's tests prove the API ↔ Playwright proves the rendered app. None substitutes another.
- **Tailwind classNames are not behavior.** `expect(el).toHaveClass("bg-primary")` is a mirror test — it copies the implementation. Assert what the user perceives: role, accessible name, `aria-*`, `data-slot`/`data-variant` attributes. Variant *visual correctness* is a Playwright/visual concern, not a Vitest assertion.
- **Module/config artifacts fail only at runtime.** `lib/env.ts` (Zod schema), `lib/api/upstream.ts` (server-only client), `lib/api/contracts.ts` (the sole `paths` importer), and the MSW handler barrel are wiring that TypeScript cannot fully prove. A wrong `API_URL` schema, a missing `server-only` guard, or a stale fixture only bites at runtime — these get boundary/integration coverage, not skipped as "just config".

## 2. Testing Criteria

### Worth testing in `next-frontend`

- **Route handlers under `app/api/**/route.ts`** that branch, check auth/session, validate the request body, or reshape the upstream response → `*.integration.test.ts` with MSW for the NestJS contract (plus a `*.test.ts` for any pure branching helper they extract).
- **`lib/` utilities and boundary modules with branching or system-shape assumptions** — `cn()` (`tailwind-merge` conflict resolution), `lib/env.ts` (Zod schema accept/reject), `lib/api/contracts.ts` aliases that *reshape* (`Pick`/composed) the wire shape.
- **Client components (`"use client"`) with state, handlers, or conditional rendering** — form submit/validation states, error display, disabled/loading transitions.
- **Auth/session flows** (login, signup, logout, forgot-password) — the critical user paths; covered end-to-end via Playwright and at the BFF seam via `*.integration.test.ts`.
- **The BFF↔NestJS wire contract** — every endpoint added to `paths` needs a hand-written MSW handler; a missing/stale fixture is a real bug that `"request unhandled"` or `tsc --noEmit` must catch.

### NOT worth testing in `next-frontend`

- **shadcn UI primitives (`components/ui/*`)** — configured-library wrappers; testing them duplicates `cva`/Radix coverage. Cover via consumers.
- **Icon components (`components/icons/*`)** — static SVG output; a render assertion is a mirror test.
- **Presentational feature components with no logic** (`components/<feature>/*` that only compose primitives) — covered via the page's E2E.
- **Static synchronous pages/layouts with no logic** — framework rendering; cover only if part of a critical flow (then E2E).
- **Tailwind class strings / static prop shape** — mirror tests.
- **Pass-through `contracts.ts` aliases** that merely index `paths` with no reshaping — `tsc` already proves them.

## 3. Feature Implementation Checklist

When implementing a feature, walk this checklist. For each artifact created or modified, read the linked guide and verify the required tests exist.

| Artifact created | Required tests | Guide |
|---|---|---|
| **Page** — sync RSC, static, no logic | None at component level; cover only if part of a critical flow → `*.e2e-spec.ts` | `artifacts/pages.md` |
| **Page** — sync RSC composing client children | Test client children directly; cover rendered page via `*.e2e-spec.ts` | `artifacts/pages.md` |
| **Page** — async RSC (`async function Page()` with `await`) | `*.e2e-spec.ts` only — Vitest cannot render it | `artifacts/pages.md` |
| **Layout** (`layout.tsx`) | None unless it adds logic (auth gate, conditional render); else via E2E | `artifacts/layouts.md` |
| **Client component** (`"use client"`) with state/handlers | `*.test.tsx` — RTL + `jsdom` docblock, mock `next/navigation`, MSW for fetch | `artifacts/client-components.md` |
| **Feature component** (server, composes primitives) | Skip unit; cover via the page's E2E | `artifacts/feature-components.md` |
| **shadcn UI primitive** (`components/ui/*`) | None — trust the library; cover via consumers | `artifacts/ui-primitives.md` |
| **Icon** (`components/icons/*`) | None | `artifacts/icons.md` |
| **`lib/` utility / boundary module** with branching or shape assumptions | `*.test.ts` | `artifacts/utilities.md` |
| **Custom hook** (`hooks/*`) | `*.test.ts(x)` with `renderHook`, `jsdom` docblock | `artifacts/hooks.md` |
| **Route handler** (`app/api/**/route.ts`) — proxy or with branching | `*.integration.test.ts` with MSW (+ `*.test.ts` for extracted pure logic) | `artifacts/route-handlers.md` |
| **Server action / middleware / error-loading-not-found / metadata** | See guide — depends on type | `artifacts/future-types.md` |

**How to use:** after implementing, walk every row. If a row doesn't apply (you didn't create that artifact type), skip it. Before declaring done, run the gates in `references/file-conventions.md` (Vitest suite, Playwright suite once installed, `tsc --noEmit`, `lint`) — see global `CLAUDE.md` → "Definition of Done (Technical)".

## 4. Artifact Type Testing Guide

When creating or modifying an artifact, read the corresponding guide for the complete recipe (what to test, layer, setup template, when to skip, project examples).

| Artifact Type | Pattern | Test Layer(s) | Guide |
|---|---|---|---|
| Pages | `app/**/page.tsx` | E2E for async; client-child unit; skip static | `artifacts/pages.md` |
| Layouts | `app/**/layout.tsx` | E2E only (when it has logic) | `artifacts/layouts.md` |
| Route handlers | `app/api/**/route.ts` (exports `GET`/`POST`/…) | Integration (Vitest+MSW) + Unit for extracted logic | `artifacts/route-handlers.md` |
| Client components | files with `"use client"` directive | Vitest unit (`*.test.tsx`) | `artifacts/client-components.md` |
| Feature components | `components/<feature>/*.tsx` (server, no logic) | Skip — covered via consumers | `artifacts/feature-components.md` |
| shadcn UI primitives | `components/ui/*.tsx` | None | `artifacts/ui-primitives.md` |
| Icons | `components/icons/*.tsx` | None | `artifacts/icons.md` |
| Utilities & boundary modules | `lib/**/*.ts` | Vitest unit (when branching / shape) | `artifacts/utilities.md` |
| Custom hooks | `hooks/*.ts` | Vitest unit | `artifacts/hooks.md` |
| Future types | Server actions, middleware, error/loading/not-found, metadata | See guide | `artifacts/future-types.md` |

## 5. Anti-patterns — Do NOT Do This

- ❌ **Open a real network connection to the upstream NestJS API from Vitest** — every fetch a route handler makes must be intercepted by `msw/node`. The rule is absolute (`references/external-systems.md`, `.claude/rules/next-frontend-testing.md`).
- ❌ **Mock `fetch` with `vi.mock`/`vi.fn` in BFF tests** — use MSW. A raw `fetch` stub hides URL/method/header mistakes that `"request unhandled"` would catch (`references/mock-health-rules.md`).
- ❌ **Try to render an async Server Component in Vitest** — unsupported in React 19/Next 16. Use Playwright (§1, `artifacts/pages.md`, `references/gotchas.md`).
- ❌ **Mock owned components inside a unit test** — render `<LoginPage>` with the real `<BrandLogo>`/`<AuthFooter>`. The mock boundary is `fetch`, `next/navigation`, side-effect APIs (`references/mock-health-rules.md`).
- ❌ **Assert Tailwind class strings** — `toHaveClass("bg-primary")` is a mirror test. Assert role, accessible name, `aria-*`, `data-slot`/`data-variant` (§1).
- ❌ **Unit-test shadcn primitives in `components/ui/`** — configured-library wrappers; test consumers (`artifacts/ui-primitives.md`).
- ❌ **Unit-test icon components** — static SVG is a mirror test (`artifacts/icons.md`).
- ❌ **Render a JSX/TSX test without the `// @vitest-environment jsdom` docblock** — default env is `node`; the render silently has no DOM (`references/gotchas.md`).
- ❌ **Skip the `next/navigation` mock when unit-testing a client component that uses `useRouter`/`usePathname`/`useSearchParams`** — the hook throws outside the Next runtime (`references/gotchas.md`).
- ❌ **Add `webServer` to `playwright.config.ts` or run Playwright against a production build** — the e2e contract is host Playwright → the **containerized `next dev`** with `MSW_ENABLED=true`; the dev server is not Playwright-managed (`references/file-conventions.md`, `references/gotchas.md`).
- ❌ **`page.route()` / browser-level interception of `/api/**` in an e2e spec** — it short-circuits the real Route Handlers; upstream is faked server-side via `instrumentation.ts` only (`artifacts/pages.md`, `references/external-systems.md`).
- ❌ **Copy `onUnhandledRequest: "error"` into `instrumentation.ts`** — it must be `"bypass"` there, `"error"` only in Vitest's `mocks/setup.ts` (`references/external-systems.md`).
- ❌ **Hand-write a DTO or hardcode the upstream base URL in a test/handler** — derive shapes from `paths`, compose URLs as `${env.API_URL}/...` (`references/external-systems.md`).
- ❌ **Hand-write an MSW handler that does not type its body via `paths`** — a stale fixture must fail `tsc --noEmit` after `types.gen.ts` regenerates (`artifacts/route-handlers.md`).

## 6. E2E Terminology Note

This guide uses **E2E** to mean *full browser flow via Playwright* — a real browser driving the running Next.js app (navigation, forms, assertions on rendered DOM). Architecture (per `next-frontend/CLAUDE.md`): real browser → containerized real Next.js (RSC, layouts, real `/api/**` Route Handlers server-side) → **upstream NestJS faked at the server** by the `mocks/` MSW that `instrumentation.ts` boots when `MSW_ENABLED=true`. This is stricter than the "HTTP integration" sense in the universal fundamentals: this project has **no supertest-style HTTP layer** for the Next app — route handlers are tested *as functions* in the `*.integration.test.ts` lane, not over HTTP. When external sources say "Next.js E2E", expect this Playwright meaning.

## 7. References

| Topic | File |
|---|---|
| NestJS upstream + Object Storage strategy; MSW boundary; Vitest vs instrumentation config | `references/external-systems.md` |
| Mock health rules; what to mock vs keep real | `references/mock-health-rules.md` |
| File naming, directory layout, scripts, build gates, coverage philosophy | `references/file-conventions.md` |
| Stack-specific gotchas (async RSC, jsdom docblock, `next/navigation`, containerized Playwright, Vitest 4) | `references/gotchas.md` |

## 8. How to Use This Guide

This guide is a multi-file skill:

- **`SKILL.md`** (this file) — always loaded. Core rules, quick reference, anti-patterns.
- **`artifacts/`** — one file per artifact type. Read the relevant file when creating or modifying that type.
- **`references/`** — supporting content. Read for MSW boundary details, mock-boundary rules, naming conventions, or pitfall reminders.

When working on a feature:

1. Use §3 (Feature Implementation Checklist) to identify which artifacts need tests.
2. Read the corresponding `artifacts/*.md` for each — that file carries the setup template to copy.
3. Consult `references/` for cross-cutting topics (MSW, mocking, naming, gotchas).
4. Before declaring done: run the full Vitest suite, the Playwright suite (once installed), `npx tsc --noEmit`, and `npm run lint` inside the container (`references/file-conventions.md`).
