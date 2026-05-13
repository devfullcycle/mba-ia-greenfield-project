> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Custom Hooks (`hooks/*.ts`)

Custom hooks encapsulate stateful logic shared across client components. The `hooks/` directory does not exist yet — it will be created the first time a hook is added (see `next-frontend/CLAUDE.md` → Path Aliases).

## What to test

- **Branching** in the hook's return value (loading/error/success, throttled/idle, validating/valid/invalid).
- **State transitions** in response to actions (counter increments, debounced updates, optimistic updates that roll back on error).
- **Effects** that schedule timers, attach listeners, or subscribe — assert that they clean up.
- **Hooks that call `fetch`** — set up MSW so the hook exercises the real `fetch` against intercepted responses; verify each response shape produces the right hook state.

## What NOT to test

- A hook that simply returns `useState`'s tuple — that's framework behavior.
- A hook that is a single-line wrapper around another hook — mirror test.

## Layer assignment

| Hook shape | Vitest `*.test.ts` | E2E |
|---|---|---|
| Pure state machine (no `fetch`) | ✅ unit with `renderHook` + `act` | covered via the consuming component's E2E |
| Calls `fetch` (or a route handler) | ✅ unit with MSW intercepting `fetch` | covered via E2E |
| Wraps another hook with no logic | ❌ skip | — |

## Setup pattern

`hooks/__tests__/use-video-upload.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { server } from "@/mocks/server"
import { useVideoUpload } from "@/hooks/use-video-upload"

const API_URL = process.env.API_URL ?? "http://api.test"

describe("useVideoUpload", () => {
  beforeEach(() => {
    server.use(
      http.post(`${API_URL}/videos`, async () =>
        HttpResponse.json({ id: "v1", status: "queued" })
      )
    )
  })

  it("transitions idle → uploading → success", async () => {
    const { result } = renderHook(() => useVideoUpload())
    expect(result.current.status).toBe("idle")

    await act(async () => {
      await result.current.upload(new File(["..."], "clip.mp4"))
    })

    await waitFor(() => expect(result.current.status).toBe("success"))
    expect(result.current.video).toEqual({ id: "v1", status: "queued" })
  })

  it("transitions to error when the API returns 500", async () => {
    server.use(
      http.post(`${API_URL}/videos`, () =>
        HttpResponse.json({ message: "boom" }, { status: 500 })
      )
    )
    const { result } = renderHook(() => useVideoUpload())
    await act(async () => {
      await result.current.upload(new File(["..."], "clip.mp4"))
    })
    await waitFor(() => expect(result.current.status).toBe("error"))
  })
})
```

## When to skip

- The hook is a single-line passthrough.
- The hook returns the same shape as the inner library hook with no transformations.

## Examples from this project

- No custom hooks exist yet. When the first hook lands (likely `useVideoUpload`, `useDebounce`, or similar), it must have a `*.test.ts` under `hooks/__tests__/` covering each state branch.
