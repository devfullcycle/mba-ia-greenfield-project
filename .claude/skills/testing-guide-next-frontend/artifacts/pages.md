> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Pages (`app/**/page.tsx`)

A page is either:

- a **synchronous Server Component** that renders static markup or composes child components, or
- a **synchronous Server Component** that composes **client components** (which carry the interactivity), or
- an **asynchronous Server Component** that `await`s data (e.g., `await fetch(...)`).

## What to test

- The page renders **in production** for every supported state (loaded, empty, error) — verified via Playwright by navigating to the route.
- The page wires its **child client components** correctly: the right props are passed, the right initial data lands in the DOM (verified via Playwright with the running app or via the child component's own `*.test.ts`).
- **Critical user flows that start on this page** (login submit, signup, upload) — Playwright.
- For pages behind auth: redirect on unauthenticated → `/login`, 200 on authenticated → Playwright with a saved storage state.

## Layer assignment

| Page shape | Vitest unit | Playwright E2E |
|---|---|---|
| Synchronous, static (no data, no children with logic) | ❌ skip — framework behavior | ❌ skip unless part of a critical flow |
| Synchronous, composes interactive client children | ❌ — test the client child directly | ✅ flow-level coverage |
| Asynchronous (`async function Page`, `await fetch`) | ❌ — Vitest cannot render async RSCs | ✅ navigation + content assertions |
| Behind auth / with redirects | ❌ | ✅ redirect, 200, content |

> Why no unit tests for sync pages: rendering `<Home />` in jsdom only proves React renders elements — which the framework already guarantees. Anything worth testing on a page is either a flow (Playwright) or lives inside a client child (`artifacts/client-components.md`).

## Setup pattern — Playwright E2E

`tests/<feature>.e2e-spec.ts`:

```ts
import { test, expect } from "@playwright/test"

test("login page renders the form and submits", async ({ page }) => {
  await page.goto("/login")

  await expect(
    page.getByRole("heading", { level: 1, name: "Sign in" })
  ).toBeVisible()

  await page.getByLabel("Email address").fill("user@example.com")
  await page.getByLabel("Password").fill("hunter2")
  await page.getByRole("button", { name: "Sign in" }).click()

  await expect(page).toHaveURL("/")
})
```

`playwright.config.ts` must run against the production build — see `../references/file-conventions.md` for the `webServer` block.

## When to skip

- The page has no interactivity and is not part of a critical flow (e.g., a future "about" page).
- The page only composes client children — test the children, skip the wrapper.

## Examples from this project

- `app/page.tsx` — sync Server Component, presentational only, links to external URLs. **Skip.** It's not a critical flow.
- `app/login/page.tsx` — sync Server Component composing `<BrandLogo>`, `<Input>`, `<Button>`, `<AuthFooter>`. **Playwright** when the auth flow lands. The form's controlled state will eventually be a client child — when that exists, unit-test it (`artifacts/client-components.md`); the page itself stays Playwright-only.
- Future `app/<route>/page.tsx` with `async function Page()` → **Playwright only**, never Vitest (see `../references/gotchas.md`).
