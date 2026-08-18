> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Future Artifact Types (not yet present — proactive guidance)

App Router artifact types this project has not introduced yet. When the first instance of one is created, follow the recipe here and, if it warrants its own file, split it out.

## Server Actions (`"use server"` functions / `app/**/actions.ts`)

- **What to test:** the action's branching + its upstream call. A server action is a server function reachable from the client — its `fetch`/`upstream` call is the system boundary.
- **Layer:**
  - **Integration** `*.integration.test.ts` — import the action, call it as a function, MSW intercepts the upstream fetch, assert the returned value / thrown error / `redirect()`.
  - **E2E** for the form-submit flow it powers (Playwright, per `pages.md`).
  - **Unit** only for a *pure* helper the action extracts (branching mapper/validator).
- **Skip:** an action that is a one-line passthrough with no branching beyond the upstream call — the integration test covers it; no separate unit test.
- **Do NOT:** `vi.mock` the upstream client; use MSW (same boundary discipline as route handlers).

## Middleware (`middleware.ts` at project root)

- **What to test:** request gating — redirect/rewrite/`NextResponse.next()` decisions based on cookies/path/headers (auth gate, locale).
- **Layer:** **E2E** (Playwright) — drive a gated vs anonymous request and assert the redirect/rewrite. Edge middleware is not Vitest-renderable; its observable contract is the HTTP outcome.
  - *Exception:* a pure decision helper extracted from middleware (e.g., `shouldRedirect(req): boolean`) → **Unit** `*.test.ts`.
- **Skip:** middleware that only sets a benign header with no branching.

## `error.tsx` / `loading.tsx` / `not-found.tsx`

- **What to test:** `error.tsx` only if its reset/recovery has logic (it's a client component — `"use client"`); then unit-test per `client-components.md` (mock `reset`, assert the retry path). `loading.tsx` and `not-found.tsx` are presentational → **skip**; cover the not-found/error *route behavior* via E2E if it's on a critical flow.
- **Layer:** Unit for `error.tsx` recovery logic; E2E for the route-level boundary behavior; skip pure presentational ones.

## `metadata` / `generateMetadata`

- **What to test:** `generateMetadata` **only** if it branches or fetches to build dynamic SEO/OG values → **Integration** `*.integration.test.ts` (call it as a function, MSW for any upstream fetch, assert the returned `Metadata`).
- **Skip:** the static `export const metadata = {...}` object (as in `app/layout.tsx`) — framework behavior, no test.

## General rule for any new type

Classify it with §1 Testability Foundations: *Is it async-RSC (→ E2E only)? Does it branch (→ unit)? Does it cross the upstream boundary (→ integration with MSW)? Is it configured-library/presentational (→ skip, cover via consumer/E2E)?* Then add a dedicated `artifacts/<type>.md` and a §4 row in `../SKILL.md` if the project accumulates several instances.
