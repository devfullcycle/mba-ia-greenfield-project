> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# shadcn UI Primitives (`components/ui/*.tsx`)

The shadcn/ui layer (style `radix-nova`, baseColor `neutral`) — `cva`-variant wrappers over `radix-ui` primitives, added **only** via `npx shadcn@latest add <name>`. These are *configured-library* artifacts: their behavior is Radix's + `cva`'s, already covered by those libraries' own suites.

## What to test

- **Nothing at this layer.** A test here would re-assert `cva` variant→class mapping (a mirror of `buttonVariants`) or Radix `Slot`/focus behavior (the library's own coverage). Both are NOT-worth-testing per the fundamentals.
- The *configuration contract* (does `variant="destructive"` look destructive, does focus-visible ring render) is a **visual** concern — Playwright/visual parity, never a Vitest class assertion.

## Layer assignment

| Primitive | Unit | Integration | E2E |
|---|---|---|---|
| `components/ui/*` (Button, Input, Card, Label, …) | ❌ never | ❌ | only incidentally, via a page flow that uses it |

## Setup pattern

None. Coverage is incidental: when a page/client-component test or E2E flow renders `<Button>`/`<Input>`, the primitive is exercised in context. Assert the *consumer's* observable behavior (button submits the form, input is `aria-invalid` on error) — not the primitive's classes.

## When to skip

- Always skip a dedicated test for anything in `components/ui/`.
- Never write `expect(<Button>).toHaveClass("bg-primary")` or assert `data-variant` mapping — that is a mirror of `cva` config.
- If you believe a primitive is broken, the bug is either in the shadcn CLI output (regenerate it) or in *how a consumer uses it* (test the consumer).

## Examples from project

- `components/ui/button.tsx` — `cva` `buttonVariants` (6 variants × 4 sizes) + Radix `Slot` for `asChild`. **Skip.** Variant correctness is visual (Playwright); the `asChild` polymorphism is Radix's contract.
- `components/ui/input.tsx`, `card.tsx`, `label.tsx` — thin styled wrappers. **Skip.** Exercised through the `/login` page form and its E2E.
