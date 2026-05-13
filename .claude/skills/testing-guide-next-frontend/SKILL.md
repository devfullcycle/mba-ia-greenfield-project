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

This guide helps you decide **what to test**, at **which layer**, and **how to set up tests** for each type of artifact in `next-frontend`. When working on a specific artifact type (page, client component, route handler, hook, …), read the corresponding file in `artifacts/` for the complete recipe. Supporting references (MSW strategy, mock health, file conventions, gotchas) are in `references/`.

The contract is fixed by `next-frontend/CLAUDE.md` § "Testing":

- **Vitest** runs unit + integration tests (`*.test.ts`, `*.integration.test.ts`).
- **Playwright** runs end-to-end tests (`*.e2e-spec.ts` under `tests/`).
- **MSW (`msw/node`)** is the only fake for the NestJS API in BFF/route-handler integration tests. **No** Vitest test may open a real network connection to `nestjs-api`.

> **Status note:** as of this writing, Vitest/Playwright/MSW tooling is not yet wired (`vitest.config.ts`, `playwright.config.ts`, `mocks/server.ts` do not exist; `test` / `test:e2e` scripts are not in `package.json`). The rules below are the contract for *new* tests. Once bootstrap lands, no rule below changes — only the commands become runnable.

## 1. Testability Foundations

These principles connect the universal layered-testing model to the Next.js 16 / React 19 / RSC reality of this project. They justify every decision in the artifact guides.

- **The server boundary is the real boundary in App Router.** A page or layout is a Server Component that may `fetch()` directly. A route handler is a server module the client calls over HTTP. The interesting "external system" for almost every artifact is the **NestJS API**, reached through `fetch`. Mocking that boundary with `msw/node` (in Vitest) or letting Playwright drive the real running app are the only two sanctioned strategies — never `jest.mock` the global `fetch`, never point a Vitest test at the live API.
- **Async Server Components are not Vitest-renderable.** React 19 + Next.js 16 still cannot render `async function Page()` in jsdom/happy-dom — Vitest and React Testing Library both document this as unsupported. Behavior of async RSCs must be proven via Playwright; do not invent jsdom workarounds. Synchronous Server Components and Client Components **are** unit-renderable.
- **Mock owned collaborators across module boundaries, not within.** If `<LoginPage>` composes `<BrandLogo>` and `<AuthFooter>`, do **not** mock those — render them together. The mock boundary is `fetch` (intercepted by MSW), `next/navigation` hooks (mocked because they have no implementation outside the Next runtime), and side-effect calls (`router.push`, analytics). Everything else in the component tree stays real.
- **Configured framework features are real in tests.** `next/image`, `next/link`, `next/font`, `cn()` from `lib/utils`, `cva` variants, design tokens — never mock. Mocking them hides whether you wired them correctly (a wrong `href`, a missing `alt`, a token typo). The exception is `next/navigation` hooks (`useRouter`, `usePathname`, `useSearchParams`) — they have no Node implementation, so you mock them in Vitest unit tests that render client components.
- **A unit test that mocks `fetch`/MSW does not test the NestJS contract.** It proves the BFF logic transforms responses correctly. Whether the BFF asks the right URL with the right body is verified by the MSW fixtures *and* by Playwright running against a real (or staged) backend. The chain: Vitest+MSW proves BFF logic ↔ Playwright proves the rendered app works against a running stack. Neither substitutes the other.
- **Tailwind classNames are not behavior.** Asserting `expect(btn).toHaveClass("bg-primary")` is a mirror test — it copies the implementation. Test what the user perceives (role, accessible name, state attributes like `aria-invalid`, `data-*` slots), not the class string. Variant *correctness* (does `variant="destructive"` produce the destructive look) is a visual concern — defer to Playwright screenshots if it ever matters.

## 2. Testing Criteria

### Worth testing in `next-frontend`

- **Route handlers under `app/api/**/route.ts`** with branching, auth checks, body validation, or non-trivial response shaping → unit (mock collaborators) and/or `*.integration.test.ts` with MSW for the NestJS contract.
- **Client components (`"use client"`)** that hold state, handle events, or change rendering based on `useState`/`useReducer` (forms, modals, controlled inputs) → `*.test.ts`.
- **Custom hooks under `hooks/`** with branching logic, effects, or derived state → `*.test.ts`.
- **`lib/` utilities with branches** (e.g., a future `formatDuration`, error classifiers) → `*.test.ts`. The current `cn()` helper has no branching of its own — see `references/file-conventions.md` for the skip rule.
- **Server actions** (`"use server"` functions) that validate input or call the NestJS API → unit-test the logic with MSW intercepting `fetch`; cover the full submit flow in Playwright.
- **Critical user flows** end-to-end: sign-in, sign-up, video upload, video playback, comment posting → `*.e2e-spec.ts`.
- **Access control on route handlers and protected pages** → `*.e2e-spec.ts` (covers redirects, 401/403 response codes).
- **`middleware.ts`** when added — auth gates, locale negotiation, header rewrites → integration-style test of the `NextRequest`/`NextResponse` contract, plus Playwright proof of the user-visible redirect.

### NOT worth testing

- **Pure shadcn UI primitives** (`components/ui/button.tsx`, `card.tsx`, `input.tsx`, `label.tsx`) — they are thin wrappers that compose `cva` variants and forward props. Tested transitively via the feature components and pages that use them. Exception: if a primitive grows real branching (e.g., a future `<DataTable>` with sort/pagination state), test the branching only.
- **Icon components in `components/icons/`** — they render static `<svg>` markup with `currentColor`. Mirror test, no behavior. Skip.
- **`lib/utils.ts` `cn()` passthrough** — it forwards to `clsx`+`tailwind-merge`. Trust the libraries. Re-test only if the `extendTailwindMerge` config grows non-trivial groups.
- **Static / synchronous pages** with no interaction (e.g., the current `app/page.tsx`) — render is framework behavior. If the page is async (server fetch) or has interactive children, the test belongs in Playwright or in the child client component, not the page.
- **`metadata` exports** — Next.js's responsibility. Validate via Playwright only when SEO is contract-critical.
- **Class-name assertions on Tailwind output** — see §1 (mirror test).
- **Validation passthrough** — one `*.e2e-spec.ts` per endpoint proves wiring; do not unit-test every Zod/HTML5 message.

## 3. Feature Implementation Checklist

When implementing a feature, walk this checklist. For each artifact created or modified, read the linked guide and verify the required tests exist.

| Artifact created | Required tests | Guide |
|---|---|---|
| **Page** — sync RSC, no interaction (e.g., static marketing page) | None at component level; cover only if part of a critical flow → `*.e2e-spec.ts` | `artifacts/pages.md` |
| **Page** — sync RSC composing client children | Test the client children directly; cover the rendered page via `*.e2e-spec.ts` | `artifacts/pages.md` |
| **Page** — async RSC (`async function Page()` with `await fetch`) | `*.e2e-spec.ts` only — Vitest cannot render it | `artifacts/pages.md` |
| **Layout** (`layout.tsx`) | None unless it adds logic (auth gate, conditional rendering); else covered via E2E | `artifacts/layouts.md` |
| **Client component** (`"use client"`) with state/handlers | `*.test.ts` — render with RTL, mock `next/navigation` and `fetch` | `artifacts/client-components.md` |
| **Feature component** (server, composes primitives, presentational) | Skip unit; cover via the page's E2E | `artifacts/feature-components.md` |
| **shadcn UI primitive** (`components/ui/*`) | None — trust the library; cover via consumers | `artifacts/ui-primitives.md` |
| **Icon** (`components/icons/*`) | None | `artifacts/icons.md` |
| **`lib/` utility** with branching | `*.test.ts` | `artifacts/utilities.md` |
| **Custom hook** (`hooks/*`) | `*.test.ts` with `renderHook` from `@testing-library/react` | `artifacts/hooks.md` |
| **Route handler** (`app/api/**/route.ts`) with branching | `*.test.ts` (pure logic) and/or `*.integration.test.ts` with MSW | `artifacts/route-handlers.md` |
| **Route handler** (simple proxy to NestJS) | `*.integration.test.ts` with MSW only | `artifacts/route-handlers.md` |
| **Server action** | `*.integration.test.ts` with MSW; E2E for the submit flow | `artifacts/future-types.md` |
| **Middleware / error / loading / not-found / metadata** | See guide — depends on type | `artifacts/future-types.md` |

**How to use:** after implementing, walk every row. If a row doesn't apply (you didn't create that artifact type), skip it. Before declaring the task done, run `npm test`, `npm run test:e2e`, `npx tsc --noEmit`, and `npm run lint` — see global `CLAUDE.md` → "Definition of Done (Technical)".

## 4. Artifact Type Testing Guide

When creating or modifying an artifact, read the corresponding guide for the complete recipe (what to test, layer, setup template, when to skip, project examples).

| Artifact Type | Pattern | Test Layer(s) | Guide |
|---|---|---|---|
| Pages | `app/**/page.tsx` | E2E for async; skip for static; client-child unit | `artifacts/pages.md` |
| Layouts | `app/**/layout.tsx` | E2E only (when it has logic) | `artifacts/layouts.md` |
| Client components | files with `"use client"` directive | Vitest unit (`*.test.ts`) | `artifacts/client-components.md` |
| Feature components | `components/<feature>/*.tsx` (server, no logic) | Skip — covered via consumers | `artifacts/feature-components.md` |
| shadcn UI primitives | `components/ui/*.tsx` | None | `artifacts/ui-primitives.md` |
| Icons | `components/icons/*.tsx` | None | `artifacts/icons.md` |
| Utilities | `lib/*.ts` | Vitest unit (when branching) | `artifacts/utilities.md` |
| Custom hooks | `hooks/*.ts` | Vitest unit | `artifacts/hooks.md` |
| Route handlers | `app/api/**/route.ts` (exports `GET`/`POST`/…) | Vitest unit + integration with MSW | `artifacts/route-handlers.md` |
| Future types | Server actions, middleware, error/loading/not-found, metadata | See guide | `artifacts/future-types.md` |

## 5. Anti-patterns — Do NOT Do This

- ❌ **Open a real network connection to `nestjs-api` from Vitest** — every fetch from a route handler under test must be intercepted by `msw/node`. The CLAUDE.md rule is absolute (see `references/external-systems.md`).
- ❌ **Mock `fetch` with `vi.mock`/`vi.fn` in BFF tests** — use MSW. A raw `fetch` mock hides URL/method/header mistakes that MSW would catch via "request unhandled" errors.
- ❌ **Try to render an async Server Component in Vitest** — Vitest and RTL document this as unsupported in React 19. Use Playwright for async RSCs (§1, `references/gotchas.md`).
- ❌ **Mock owned components inside a unit test** — render `<LoginPage>` with the real `<BrandLogo>` and `<AuthFooter>`. The mock boundary is `fetch`, `next/navigation`, and side-effect APIs (see `references/mock-health-rules.md`).
- ❌ **Assert Tailwind class strings** — `expect(el).toHaveClass("bg-primary")` is a mirror test. Assert role, accessible name, `aria-*` and `data-slot` attributes instead (§1).
- ❌ **Unit-test shadcn primitives in `components/ui/`** — they are configured-library wrappers; tests would duplicate `cva` and Radix coverage. Test consumers instead (`artifacts/ui-primitives.md`).
- ❌ **Unit-test icon components** — pure static SVG output is a mirror test (`artifacts/icons.md`).
- ❌ **Skip the `next/navigation` mock when rendering a client component that uses `useRouter`/`usePathname`/`useSearchParams`** — the hook throws outside the Next runtime. Mock once via `vi.mock("next/navigation", …)` per test file (`references/gotchas.md`).
- ❌ **Run Playwright against `npm run dev`** — Playwright must drive `npm run build && npm run start` so behavior matches production (no React DevServer overlays, no debug logs). Configure `webServer` accordingly (`references/file-conventions.md`).
- ❌ **Forget `server.listen()` / `server.resetHandlers()` / `server.close()`** in Vitest `setupFiles` — leaks handlers between tests and causes flakiness (`references/gotchas.md`).
- ❌ **Hardcode the NestJS base URL inside tests** — read it from the same env var the BFF uses (`API_URL`) so MSW handlers and code stay in sync (`references/external-systems.md`).

## 6. E2E Terminology Note

This guide uses **E2E** to mean *full browser flow via Playwright* — a real Chromium/Firefox/WebKit driving the running Next.js app, navigating, filling forms, asserting on rendered DOM. That is stricter than the "HTTP integration" sense used in the universal testing fundamentals: this project has no supertest-style HTTP-integration layer for the Next.js app itself, because route handlers are tested *as functions* (the `*.integration.test.ts` lane), not over HTTP. When external sources refer to "Next.js E2E", expect the same Playwright meaning.

## 7. References

| Topic | File |
|---|---|
| NestJS API + Object Storage strategy; MSW boundary | `references/external-systems.md` |
| Mock health rules; what to mock vs keep real | `references/mock-health-rules.md` |
| File naming, directory layout, scripts, coverage philosophy | `references/file-conventions.md` |
| Stack-specific gotchas (async RSC, `next/navigation`, Playwright prod build, …) | `references/gotchas.md` |

## 8. How to Use This Guide

This guide is a multi-file skill:

- **`SKILL.md`** (this file) — always loaded. Core rules, quick reference, anti-patterns.
- **`artifacts/`** — one file per artifact type. Read the relevant file when creating or modifying that type.
- **`references/`** — supporting content. Read when you need MSW strategy details, mock-boundary rules, naming conventions, or pitfall reminders.

When working on a feature:

1. Use §3 (Feature Implementation Checklist) to identify which artifacts need tests.
2. Read the corresponding `artifacts/*.md` for each — that file contains the setup template you should copy.
3. Consult `references/` for cross-cutting topics (MSW, mocking, naming, gotchas).
4. Before declaring done: run the full Vitest suite, full Playwright suite, `npx tsc --noEmit`, and `npm run lint` inside the container.
