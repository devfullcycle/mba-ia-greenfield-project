> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Layouts (`app/**/layout.tsx`)

Server Components that wrap a route subtree. Most layouts are pure structural shells (fonts, providers, `<html>`/`<body>`) — framework behavior, not test-worthy. A layout becomes test-worthy only when it adds **logic**.

## What to test

- **Auth/redirect gates** — a layout that reads a session and redirects unauthenticated users: the redirect behavior → **E2E**.
- **Conditional rendering** — a layout that renders different chrome based on a condition.
- Nothing if the layout only wires fonts, metadata, and structural markup.

## Layer assignment

| Layout shape | Unit | Integration | E2E |
|---|---|---|---|
| Structural shell (fonts, `<html>`/`<body>`, providers) | ❌ | ❌ | ❌ — framework behavior |
| Auth gate / redirect / conditional chrome | ❌ (async RSC — not Vitest-renderable) | ❌ | ✅ Playwright |

## Setup pattern

When a layout has a gate, cover it through the protected route's E2E spec (it asserts the redirect), per `artifacts/pages.md`'s Playwright template — there is no separate layout-only test.

```ts
// tests/protected-route.e2e-spec.ts
test("anonymous user is redirected away from a gated route", async ({ page }) => {
  await page.goto("/dashboard");          // layout gate runs server-side
  await expect(page).toHaveURL("/login");
});
```

## When to skip

- The root layout that only loads `Inter`/`Geist_Mono`, sets `metadata`, and renders `<html><body>{children}</body></html>` — **skip entirely**. Asserting the font variable className is a mirror test; metadata is framework behavior.
- Do not unit-render a layout to check it "renders children" — that is framework behavior.

## Examples from project

- `app/layout.tsx` — root layout: fonts via `next/font/google`, `metadata`, `cn()`-composed `<html>` classes, `<body>` structure. **No logic → no test.** If an auth-provider or session gate is ever added here, cover the gate via the gated route's E2E spec.
