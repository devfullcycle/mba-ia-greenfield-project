> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Icons (`components/icons/*.tsx`)

Custom SVG components (no external icon library, per project rules). Each is a single function returning a static `<svg>` with a hardcoded `<path>` and a `cn()`-merged `className`. Pure static output — no logic, no branching.

## What to test

- **Nothing.** Asserting the rendered `<path d="...">` or `viewBox` is a textbook mirror test — it copies the implementation and breaks on any harmless path edit while proving nothing.

## Layer assignment

| Artifact | Unit | Integration | E2E |
|---|---|---|---|
| `components/icons/*` | ❌ never | ❌ | only incidentally, via a page that renders it |

## Setup pattern

None. The icon is exercised wherever a tested component or E2E flow renders it (e.g., `<BrandLogo>` → `<StreamTubeIcon>` on the `/login` page). If accessibility matters, assert it on the *consumer* (e.g., the logo's accessible name), not the icon's `aria-hidden` attribute.

## When to skip

- Always. There is no scenario where a Vitest test of an icon component catches a real bug.

## Examples from project

- `components/icons/streamtube-icon.tsx` (`<StreamTubeIcon>`) — static `<svg>` with `aria-hidden`, `currentColor` fill, `cn(className)` passthrough. **Skip.** Rendered via `<BrandLogo>`; any visual regression is a Playwright/visual concern.
