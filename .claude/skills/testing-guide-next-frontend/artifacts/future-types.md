> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Future Artifact Types

This file covers Next.js artifact types **not yet present** in the project. Apply the same layered model as the existing types — fold the new type into the right artifact guide once it appears repeatedly.

## Server Actions (`"use server"` functions)

A server action is a function marked with `"use server"` that the client invokes (typically via a `<form action={...}>` or a programmatic call). It runs on the server, can read cookies/headers, and usually calls the NestJS API.

- **What to test**: validation branches, transformation of the NestJS response, error branches (NestJS 4xx/5xx → action throws / returns error state), redirects via `redirect()` from `next/navigation`.
- **Layer**: `*.integration.test.ts` with MSW for the NestJS contract; full Playwright E2E for the submit flow.
- **Setup**: import the action like a normal async function and call it with the expected payload. MSW intercepts the `fetch` it makes. Mock `next/navigation`'s `redirect` if the action calls it — `redirect` throws a special error in production that breaks the test assertion otherwise.

```ts
import { vi } from "vitest"
const redirectMock = vi.fn()
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  redirect: redirectMock,
}))
import { signUp } from "@/app/actions/sign-up"
```

## Middleware (`middleware.ts`)

Middleware runs in the Edge runtime, sees every matching request, and can rewrite/redirect/inject headers.

- **What to test**: each branch (authenticated → pass through, unauthenticated → redirect, locale negotiation, header injection).
- **Layer**: a Vitest `*.test.ts` that imports `middleware` and calls it with a `NextRequest` is sufficient for the branch logic. Playwright then validates the *user-visible* redirect on the running app.
- **Caveat**: middleware uses the Edge runtime — pure-JS branch logic runs fine in Vitest, but Edge-only globals (e.g., `EdgeRuntime`) must be mocked or guarded.

```ts
import { NextRequest } from "next/server"
import { middleware } from "@/middleware"

const req = new NextRequest("http://localhost/dashboard")
const res = await middleware(req)
expect(res.status).toBe(307)
expect(res.headers.get("location")).toBe("http://localhost/login")
```

## `error.tsx`, `loading.tsx`, `not-found.tsx`

Special segment files Next.js renders for error boundaries, loading states, and 404 pages.

- **What to test**: only when they contain real branching (e.g., `error.tsx` showing different messages by error type). Otherwise skip — they are presentational.
- **Layer**: when worth testing, unit-test as a client component (`error.tsx` is always a client component); otherwise verify visibility via Playwright by simulating the error condition.
- **`loading.tsx`**: skip — it's a Suspense fallback. The fact that it renders is framework behavior. Test the *transition* (skeleton → content) via Playwright only if it's flow-critical.

## `metadata` / `generateMetadata`

Exports from a page or layout that set `<title>`, `<meta>`, Open Graph, etc.

- **What to test**: only when SEO is contract-critical (e.g., a marketing page where the OG tags drive social previews).
- **Layer**: Playwright — `await page.title()`, `await page.locator('meta[property="og:image"]').getAttribute("content")`.
- **Skip**: when metadata is static or framework-trivial.

## Streaming / `Suspense` boundaries

Async data with `<Suspense>` fallbacks in Server Components.

- **What to test**: the user-perceived sequence (fallback first, then content). Vitest cannot render this — Playwright only.
- **Layer**: Playwright. Use `await expect(page.getByTestId("skeleton")).toBeVisible()` then `await expect(page.getByText(/loaded/)).toBeVisible()`.

## Parallel routes (`@slot/page.tsx`) and intercepting routes (`(.)folder`)

Layout-level routing features.

- **What to test**: the navigation contract — that the right slot renders for the right URL.
- **Layer**: Playwright only. The Vitest layer has no way to exercise the App Router segment tree faithfully.

## Image / font configuration (`next.config.ts`, `next/image`, `next/font`)

Configuration, not artifacts. Do **not** unit-test. Verify the rendered output via Playwright when a regression would hurt users (broken image, wrong font fallback).

## Cross-reference

When any of these types appears repeatedly in the codebase, promote it to its own `artifacts/<type>.md` file and add a row to `SKILL.md` §4.
