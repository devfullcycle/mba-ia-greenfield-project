> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Mock Health Rules

## The boundary principle (project-specific)

Mock **across architecturally significant boundaries, not within**. In `next-frontend` there are exactly three things you mock — everything else stays real:

1. **The upstream NestJS fetch** — via `msw/node` (Vitest) or server-side MSW (E2E). Never `vi.mock`/`vi.fn` on global `fetch` or on `@/lib/api/upstream`. MSW catches URL/method/header/body mistakes that a stub would silently pass.
2. **`next/navigation` hooks** (`useRouter`, `usePathname`, `useSearchParams`) — they have **no Node implementation** and throw outside the Next runtime, so they must be mocked when a *unit-rendered client component/hook* uses them. This is the one "no real implementation exists" mock.
3. **Irreversible side effects** with no test double (analytics, external SDK `track()`) — mock to assert the observable call. `router.push` falls under #2's mock.

Everything else is **real**: owned components (`<BrandLogo>`, `<AuthFooter>`), `cn()`, `cva` variants, `next/image`, `next/link`, `next/font`, the Zod `env` schema, the `openapi-fetch` `upstream` client, design tokens. These are *configured dependency contracts* — mocking them hides whether you wired them correctly.

## Litmus test

Can you state the **observable behavior** this test validates without referencing a mock interaction? If the only assertion is "`fn` was called with X" and nothing the user perceives changed, it's a wiring test — delete it or rewrite it around a consequence (a rendered error, a redirected URL, a returned status).

## Too-many-mocks smell

If a test needs to mock owned components or stub `upstream` to set up, the design is wrong:
- Wanting to mock `<BrandLogo>` to test `<LoginPage>` → render them together; the mock boundary is the fetch, not the child.
- Wanting to stub `upstream` in a route-handler test → use MSW; that's exactly the boundary the integration test exists to exercise.
- A client-component test drowning in mocks → the component is doing too much; split the logic into a hook/util and unit-test that.

## Framework-specific mocking patterns (Vitest 4)

- `vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/x", useSearchParams: () => new URLSearchParams() }))` — hoisted; declare the `push = vi.fn()` with `vi.hoisted(...)` if you reference it in the factory, or assign inside and import after.
- Prefer **MSW over `vi.mock`** for anything network. `vi.spyOn` only for asserting an owned side-effect call that has no observable rendering.
- `vi.resetModules()` + dynamic `import()` for modules that memoize at import (e.g., `@/lib/env`, or a route handler that reads env at module load — see the gotchas note on MSW + dynamic import).
- Do **not** stub global `fetch` — MSW owns the network boundary.

## Mirror-test prohibition

`expect(el).toHaveClass("bg-primary")`, `expect(svg).toContainHTML("<path d=...")`, asserting a `cva` variant→class map, or copying a route handler's return literal into the expectation — all mirror tests. Assert role, accessible name, `aria-*`, `data-slot`/`data-variant`, returned status/body shape instead.
