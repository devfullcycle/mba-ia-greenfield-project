> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Custom Hooks (`hooks/*.ts`)

Not yet present (2026-05) — the `@/hooks` alias is reserved; the directory is created when the first hook is added. This guide is proactive.

## What to test

- **State transitions and branching** — a hook that manages form state, derived state, or a state machine: assert the returned values across the transitions a consumer relies on.
- **Data-fetching hooks** — a hook that fetches from a same-origin `/api/...` Route Handler: assert loading → success / loading → error, with MSW intercepting the fetch. Do **not** assert intermediate internals; assert the observable returned shape.
- **Effect side effects with consequence** — e.g., a hook that calls `router.push` under a condition: assert the call as observed behavior, mocking `next/navigation`.

## Layer assignment

| Hook shape | Layer |
|---|---|
| Pure state/derivation with branching | **Unit** `*.test.ts(x)` via `renderHook` |
| Fetches a `/api/...` Route Handler | **Unit** `*.test.tsx` + MSW intercepts the fetch |
| Trivial wrapper with no branching (e.g., `useContext` passthrough) | ❌ skip — no logic to prove |

No integration/E2E layer for a hook itself — its fetch boundary is covered by the route handler's integration test; the critical flow it powers is covered by the page's E2E.

## Setup pattern

`*.test.tsx` (rendering/`renderHook` needs DOM) with the **mandatory** jsdom docblock, colocated in `hooks/__tests__/`.

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useCurrentUser } from "@/hooks/use-current-user";

describe("useCurrentUser", () => {
  it("resolves to the user on a successful /api/auth/me", async () => {
    // MSW (mocks/handlers/auth.ts) fakes the upstream GET /auth/me.
    const { result } = renderHook(() => useCurrentUser());

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.user).toMatchObject({ email: expect.any(String) });
  });
});
```

Mock `next/navigation` per-file if the hook uses router/path hooks (`references/gotchas.md`). MSW is global; per-case error fixtures via `server.use(...)`.

## When to skip

- A hook that only forwards a context value or composes other tested hooks with no added branching.
- Do not re-test the BFF status mapping from inside a hook test — that's the route handler's integration test.

## Examples from project

- None yet. When the auth feature adds something like `useCurrentUser`/`useLogin`, apply this recipe; the underlying `/api/auth/*` route handlers still need their own `*.integration.test.ts` (`artifacts/route-handlers.md`).
