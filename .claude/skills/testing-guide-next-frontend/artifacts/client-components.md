> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Client Components (files with `"use client"` directive)

Client components are the only React components Vitest can render meaningfully — they own state, handlers, and the user-visible interaction surface.

## What to test

- **Branching** triggered by state or props: open/closed, loading/error/success, controlled/uncontrolled, validation visible / hidden.
- **Event handlers**: clicking a button calls the right side effect (with the right arguments), typing into an input updates the rendered value, submitting a form calls the right callback.
- **Accessibility-visible state**: `aria-invalid`, `aria-expanded`, `disabled`, `role`, accessible name. Use Testing Library's role/name queries to drive assertions — never assert class strings.
- **Side effects via mocked boundaries**: `fetch` (via MSW), `router.push` / `router.replace` (via `next/navigation` mock), analytics calls.

## Layer assignment

| Client component shape | Vitest `*.test.ts` | E2E |
|---|---|---|
| Holds state, has handlers, no `fetch` | ✅ unit, RTL, mock `next/navigation` if used | covered indirectly via the page's E2E |
| Calls `fetch` to a route handler / external URL | ✅ unit with MSW intercepting `fetch` | covered via page E2E |
| Pure presentational (no state, no handlers) | ❌ — same skip rule as feature-components.md | covered via page E2E |

## Setup pattern

`components/<feature>/__tests__/<name>.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// Mock next/navigation per file — required when the component reads useRouter,
// usePathname, or useSearchParams. See references/gotchas.md.
const pushMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
}))

import { LoginForm } from "@/components/auth/login-form"

describe("<LoginForm>", () => {
  beforeEach(() => pushMock.mockClear())

  it("shows aria-invalid when submitting an empty email", async () => {
    render(<LoginForm />)
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }))
    expect(screen.getByLabelText(/email address/i)).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    expect(pushMock).not.toHaveBeenCalled()
  })

  it("submits and navigates to / on success", async () => {
    // MSW is already configured in vitest setupFiles (see mocks/server.ts).
    // Override the default handler for this test if needed:
    //   server.use(http.post(`${API_URL}/auth/login`, () => HttpResponse.json({ token: "x" })))
    render(<LoginForm />)
    await userEvent.type(
      screen.getByLabelText(/email address/i),
      "user@example.com"
    )
    await userEvent.type(screen.getByLabelText(/password/i), "hunter2")
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }))
    expect(pushMock).toHaveBeenCalledWith("/")
  })
})
```

## Anti-pattern reminders

- Do **not** mock `<Button>`, `<Input>`, `<Card>` — those are configured-library primitives that compose into the component under test. Render them.
- Do **not** mock `cn()` from `@/lib/utils` or `next/image` / `next/link`. They have real Node implementations and the test should exercise them.
- Do **not** assert Tailwind class strings. Assert role + name + `aria-*` + visible text.

## When to skip

- The component is pure presentational with no state or handlers — treat it as a feature component (`feature-components.md`).
- The behavior is only meaningful when wired into a real page+server stack — escalate to Playwright instead.

## Examples from this project

- No client components exist yet. When `<LoginForm>` (or any controlled form) is extracted from `app/login/page.tsx`, it will be a client component and **must** have a `*.test.tsx` covering the validation branches and the submit path with MSW.
