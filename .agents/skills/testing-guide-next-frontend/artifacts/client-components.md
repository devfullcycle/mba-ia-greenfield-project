> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Client Components (files with the `"use client"` directive)

The only React component type that is fully unit-renderable in Vitest. State, event handlers, conditional rendering, and form behavior live here.

## What to test

- **Interactive behavior** — what the user perceives after an action: submit disables the button, an error message appears, a field is marked `aria-invalid`, a value is cleared.
- **Conditional rendering** — branches on props/state (loading vs loaded vs error).
- **Form submission** — calls the same-origin `/api/...` Route Handler with the right body; renders the success/error outcome. The fetch is intercepted by MSW.
- **Navigation side effects** — that `router.push(...)` was called with the right path *as observed behavior* (a redirect after login), mocking `next/navigation`.

Do **not** assert internal state, class strings, or that a handler "was called" without an observable consequence (`references/mock-health-rules.md`).

## Layer assignment

| Situation | Layer | Notes |
|---|---|---|
| State / handlers / conditional render, no network | **Unit** `*.test.tsx` (jsdom docblock) | render with RTL, drive with `@testing-library/user-event` |
| Submits to a `/api/...` Route Handler | **Unit** `*.test.tsx` + MSW intercepts the fetch | the handler-as-function contract is covered separately in `artifacts/route-handlers.md` |
| Part of a critical user flow (login/signup) | also covered by **E2E** | unit proves the component logic; E2E proves the wired flow end-to-end |

No standalone integration layer for components — the BFF contract lives in route-handler integration tests; the component test only proves the component reacts correctly to MSW-faked responses.

## Setup pattern

`*.test.tsx`, colocated in the feature's `__tests__/`. **The `jsdom` docblock is mandatory** — without it the render has no DOM (default env is `node`).

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
}));

import { LoginForm } from "@/components/auth/login-form";

describe("<LoginForm />", () => {
  it("disables submit and redirects on success", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email address"), "alice@example.com");
    await user.type(screen.getByLabelText("Password"), "correct-horse");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    // MSW (mocks/handlers/auth.ts) fakes POST /auth/login → 200.
    expect(push).toHaveBeenCalledWith("/");
  });

  it("shows an inline error on invalid credentials", async () => {
    // Override the success fixture for this case only.
    // server.use(http.post(`${env.API_URL}/auth/login`, () =>
    //   HttpResponse.json({ message: "invalid" }, { status: 401 })));
    // ...assert the alert is visible
  });
});
```

MSW is global (`mocks/setup.ts`); per-case error fixtures via `server.use(...)`. `next/navigation` has no Node implementation — mock it once per file (`references/gotchas.md`).

## When to skip

- A `"use client"` component with no state/handlers/conditionals (rare — it shouldn't be a client component) → treat as a feature component, skip unit.
- Do not unit-test the redirect *target* page — that's the page's E2E concern.
- Do not duplicate the BFF status-mapping assertions here — that belongs to `artifacts/route-handlers.md`.

## Examples from project

- None yet (2026-05) — no `"use client"` files exist. The auth feature will introduce a client form component (the `/login` and `/signup` pages currently render a static `type="submit"` with no handler). When it lands, it gets a `*.test.tsx` per this recipe **and** is exercised by the auth E2E spec.
