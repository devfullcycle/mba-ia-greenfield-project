> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Layouts (`app/**/layout.tsx`)

A layout wraps a route segment with shared chrome (root layout, segment layouts). It typically loads fonts, sets `<html>`/`<body>` classes, and renders `children`.

## What to test

- **Auth gates** in a layout (e.g., a future authenticated route group) — verified via Playwright (unauthenticated → redirect; authenticated → renders).
- **Conditional rendering branches** (e.g., a future "show sidebar only when logged in" branch) — verified via Playwright in each state.
- Metadata correctness, when SEO-critical — Playwright via `page.title()` / `page.locator('meta[name=...]')`.

## Layer assignment

| Layout shape | Vitest unit | Playwright E2E |
|---|---|---|
| Static wrapper (fonts, body class, renders children) | ❌ skip — framework behavior | ❌ skip |
| Logic-bearing (auth gate, conditional rendering) | ❌ — async/server logic | ✅ verify each branch |

Layouts are server-rendered. They have the same async-RSC restriction as pages (see `pages.md`): Vitest cannot render them.

## Setup pattern — Playwright

```ts
import { test, expect } from "@playwright/test"

test.describe("authenticated layout", () => {
  test("unauthenticated visitor is redirected to /login", async ({ page }) => {
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/login$/)
  })

  test("authenticated visitor sees the dashboard chrome", async ({ page }) => {
    // see references/file-conventions.md for the auth.setup.ts storageState pattern
    await page.goto("/dashboard")
    await expect(page.getByRole("navigation")).toBeVisible()
  })
})
```

## When to skip

- The layout has no logic — it only sets fonts/classes and renders `children`. The root `app/layout.tsx` falls in this bucket today.

## Examples from this project

- `app/layout.tsx` — root layout: loads `Inter` and `Geist_Mono`, sets `<html>`/`<body>` classes via `cn(...)`, renders `children`. **Skip.** No logic to assert.
- Future segment layouts under `app/(authenticated)/layout.tsx` with redirect logic → **Playwright**, one test per branch (redirect vs render).
