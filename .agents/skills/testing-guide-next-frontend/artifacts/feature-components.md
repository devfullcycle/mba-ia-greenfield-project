> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Feature Components (`components/<feature>/*.tsx` — server, presentational, no logic)

Cross-route reusable composites that arrange primitives and content. When they have **no state, no handlers, no conditionals** (only prop passing + composition), they are presentational — framework rendering — and are covered via their consumers, not directly.

## What to test

- Nothing directly while the component is purely presentational.
- The moment a feature component gains `"use client"` + state/handlers/conditionals, it is no longer a feature component for testing purposes — treat it as a **client component** (`artifacts/client-components.md`).

## Layer assignment

| Component shape | Unit | Integration | E2E |
|---|---|---|---|
| Server, composes primitives, prop-only, no branching | ❌ skip | ❌ | ✅ via the consuming page's flow |
| Has a `cn()` conditional class on a `size`/`variant`-style prop only | ❌ skip (visual concern; class assertion is a mirror test) | ❌ | visual parity is a Playwright/screenshot concern |
| Gains state/handlers/conditional render | → see `artifacts/client-components.md` | | |

## Setup pattern

No dedicated test. Coverage is incidental through the page E2E that renders the component in context (`artifacts/pages.md`). If you find yourself wanting a unit test for a feature component, first check whether the thing you want to assert is *behavior* (→ it's really a client component) or *appearance* (→ Playwright visual, not Vitest).

## When to skip

- Always skip, unless it crosses into client-component territory (state/handlers/conditional rendering driven by user interaction).
- Skip `data-slot`/`size`-class assertions — those are mirror tests; the rendered look is verified visually in E2E, not by string-matching Tailwind.

## Examples from project

- `components/auth/auth-footer.tsx` (`<AuthFooter>`) — server, renders a `<p>` + `next/link` from props, no logic → **skip**; exercised when the login/signup E2E navigates via its link.
- `components/auth/brand-logo.tsx` (`<BrandLogo>`) — server, `size`-conditioned `cn()` classes + composes `<StreamTubeIcon>`, no behavior → **skip**; the conditional sizing is a visual concern (Playwright), not a Vitest class assertion.
