> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Pages (`app/**/page.tsx`)

Pages are Server Components by default. How (and whether) you test one depends entirely on whether it is **async**, **sync composing client children**, or **static**.

## What to test

- **Async RSC** (`async function Page()` doing `await upstream...` / `await fetch`): the data-loaded rendering, loading/error states, and any redirect/auth-gate behavior — **via Playwright only**.
- **Sync RSC composing client children**: the interactive behavior lives in the client children — test those directly (`artifacts/client-components.md`); cover the assembled page via E2E for the critical flow.
- **Static sync RSC** (marketing/placeholder, no data, no interaction): nothing at component level. Cover via E2E only if it sits on a critical path.

## Layer assignment

| Page shape | Unit | Integration | E2E |
|---|---|---|---|
| Async RSC (`await` in the component) | ❌ unsupported in Vitest/RTL (React 19/Next 16) | ❌ | ✅ Playwright — the only option |
| Sync RSC composing client children | ❌ (test the client children) | ❌ | ✅ for the critical flow |
| Static sync RSC, no logic | ❌ | ❌ | ✅ only if on a critical path |

There is no integration layer for pages — the BFF seam is tested separately (`artifacts/route-handlers.md`).

## Setup pattern

E2E spec under `tests/` (Playwright, host-run). Drives the containerized real app; upstream NestJS is faked server-side by the `mocks/` MSW (`instrumentation.ts`, `MSW_ENABLED=true`). Per-scenario outcomes come from **reserved trigger fixtures** in the shared handlers — never `page.route()`, never per-test `server.use()`.

```ts
// tests/auth-login.e2e-spec.ts
import { test, expect } from "@playwright/test";

test("user signs in and lands on the home feed", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("alice@example.com");
  await page.getByLabel("Password").fill("correct-horse");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL("/");
});

test("invalid credentials surface an inline error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("badrequest@example.com");
  await page.getByLabel("Password").fill("whatever");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("alert")).toBeVisible();
});
```

Hard rules: no `page.route("**/api/**")`; no reaching a real NestJS API; trigger values must not collide with Vitest fixture values (`references/external-systems.md`).

## When to skip

- Static pages with no logic and not on a critical flow — no test at all.
- Do not attempt a jsdom render of an async page "just to get a unit test" — it cannot work; the test would assert nothing meaningful.
- Do not E2E-test a page solely to cover a client child's logic — unit-test the child instead (faster, more precise).

## Examples from project

- `app/page.tsx` — static placeholder (Next starter content), no data/interaction → **no test** (not a critical flow).
- `app/layout.tsx` — see `artifacts/layouts.md`.
- `app/login/page.tsx` — sync RSC composing `<BrandLogo>`, `<AuthFooter>`, `<Input>`, `<Button>` with a `type="submit"`. As of 2026-05 the form has no client submit handler. Once the submit flow is wired (likely a client component), unit-test that client component (`artifacts/client-components.md`) **and** add `tests/auth-login.e2e-spec.ts` for the full sign-in flow (critical path).
- `app/(auth)/signup/page.tsx` — directory scaffolded, empty. When built, same treatment as `/login`.
