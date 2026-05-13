> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Feature Components (`components/<feature>/*.tsx`, server, no logic)

Feature components are presentational composites that live under `components/<feature>/` (e.g., `components/auth/brand-logo.tsx`). They take props, compose primitives, and render. They have no state, no handlers, no `fetch`, no async.

## What to test

Almost nothing at the component level. They are covered transitively when:

- The page that uses them is exercised in Playwright (the rendered DOM proves the composition works), or
- A client component that depends on them is unit-tested (the feature component renders inside that test).

The only exception: a feature component that contains **branching presentational logic** (e.g., `size === "lg" ? "size-10" : "size-8"`) where the branches encode product rules that a designer cares about. Even then, prefer Playwright snapshots over Vitest class-name assertions.

## Layer assignment

| Feature-component shape | Vitest unit | E2E |
|---|---|---|
| Presentational, no branching | ❌ skip | covered via page E2E |
| Presentational, trivial branching (size prop, variant prop) | ❌ skip | covered via page E2E |
| Has handlers or state | Not this category — move it to `client-components.md` |

## Setup pattern

There is no setup pattern — these components do not get unit tests.

If you find yourself wanting to test a feature component, ask: *which branch of behavior would break user-visible output?* If the answer is "none" or "the className changes", do not write the test.

## When to skip

Always, with the rare exception above.

## Examples from this project

- `components/auth/brand-logo.tsx` — selects `size-10` vs `size-8` and `text-h1` vs `text-h2` from a `size` prop. Pure presentational. **Skip.** Exercise it via Playwright on the rendered `/login` page.
- `components/auth/auth-footer.tsx` — renders a question label and a `<Link>` from props. Pure passthrough. **Skip.** Exercise via Playwright (click the link, assert navigation).
