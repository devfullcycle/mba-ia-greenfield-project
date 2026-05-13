> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Mock Health Rules

The boundary principle from the universal fundamentals, translated to this project's stack.

## Mock across architecturally significant boundaries, not within

For `next-frontend`, the boundaries are:

| Boundary | How to fake it | Why |
|---|---|---|
| `fetch` to the NestJS API | **MSW** (`msw/node`) | The single sanctioned NestJS fake. Captures URL, method, headers, body. |
| `fetch` to any external HTTP API | **MSW** | Same reasoning. |
| `next/navigation` hooks (`useRouter`, `usePathname`, `useSearchParams`) | **`vi.mock("next/navigation", …)`** per test file | These hooks have no Node implementation and throw outside the Next runtime. There is no alternative. |
| `next/navigation`'s `redirect()` / `notFound()` functions | `vi.mock` with partial override (`{ ...orig, redirect: vi.fn() }`) | They throw special signals that break test assertions. Mock only the function being invoked. |
| `next/headers` (`cookies()`, `headers()`) in server actions / route handlers | Test-time helper that injects via `Request` headers; or `vi.mock` when called directly | Some code reads these helpers instead of the `Request`. Mock to control the value under test. |
| Analytics / tracking SDK calls (e.g., a future `track(...)`) | `vi.fn` for the module | Side-effect external systems — same rule as email in the universal table. |
| Browser APIs not in jsdom/happy-dom (e.g., `IntersectionObserver`, `ResizeObserver`) | Polyfill via `vitest.setup.ts` or `vi.stubGlobal` | Test environment limitation, not a real boundary. |

## What to use real

| Thing | Why real |
|---|---|
| `next/image`, `next/link` | Their rendered output is the contract — assertions should see the real `<img>`/`<a>`. |
| `next/font` | Generated `className` is part of the rendered tree. |
| `cn(...)` from `@/lib/utils` | Configured-library function. Mocking it hides class merging bugs. |
| `cva` / `class-variance-authority` | Same — configured library. |
| shadcn primitives (`<Button>`, `<Card>`, `<Input>`, `<Label>`) | Owned UI; rendering them inside a feature/page test proves the composition works. |
| Icons from `@/components/icons/*` | Pure SVG components; render them as-is. |
| `@/lib/utils`'s `extendTailwindMerge` config | Configured-library data; not behavior to mock. |

## The litmus test

Can you describe what observable behavior this test validates without referencing mock interactions?

- ✅ "Submitting a valid login navigates the user to `/`" — observable.
- ❌ "Submitting calls `pushMock` with `'/'`" — mock-interaction-only. Reword as observable behavior; the assertion stays the same but the test's *purpose* is the user-visible navigation, not the mock call.

When the answer is mock-interactions-only, you're either testing wiring (delete the test) or you're missing an integration test (escalate to MSW or Playwright).

## When you need too many mocks

If a single Vitest test sets up 4+ mocks (next/navigation, fetch handlers, cookies, analytics, …), one of two things is true:

1. The unit under test crosses too many boundaries — split it.
2. The test should be an integration or E2E test instead. Move it.

Don't keep stacking mocks. Each extra mock is one more place the test diverges from real behavior.

## Forbidden moves

- ❌ `vi.mock("@/components/ui/button")` — never mock owned UI primitives.
- ❌ `vi.mock("@/lib/utils")` — never mock `cn`.
- ❌ `vi.mock("next/link")` / `vi.mock("next/image")` — never mock framework primitives.
- ❌ `globalThis.fetch = vi.fn()` in a BFF test — MSW exists exactly to replace this. Raw `fetch` mocks hide URL/method mistakes.
- ❌ `vi.mock` on the route handler module itself when testing a component that calls it via `fetch` — let MSW intercept the request instead.

## Allowed but scoped

- `vi.stubGlobal("IntersectionObserver", ...)` — only for browser APIs missing from happy-dom, registered in `vitest.setup.ts`.
- `vi.useFakeTimers()` — only when the unit under test owns timer logic; restore in `afterEach`.
