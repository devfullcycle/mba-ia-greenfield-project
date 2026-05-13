> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# shadcn UI Primitives (`components/ui/*.tsx`)

shadcn primitives are configured-library wrappers. They:

- Compose `cva` variants with a fixed base class set,
- Forward `...props` to a native element (`<button>`, `<input>`, `<div>`),
- Accept `asChild` and proxy to `radix-ui`'s `Slot.Root` when polymorphism is needed,
- Set `data-slot`, `data-variant`, `data-size` attributes.

They contain no business logic, no state, no side effects.

## What to test

Nothing at the primitive level. The behavior of `cva` and Radix is covered by their own test suites; testing it here would duplicate that coverage. Visual correctness of variants is a design concern, validated against Figma during implementation (`figma-implement-design` skill).

## Layer assignment

| Primitive shape | Vitest | E2E |
|---|---|---|
| Stock shadcn primitive (Button, Card, Input, Label, …) | ❌ skip | covered via consumers |
| Custom primitive that adds branching logic on top (rare) | ✅ unit-test only the new branching | covered via consumers |

## Setup pattern

None. If a primitive ever grows real branching (e.g., a future `<DataTable>` that owns sort/pagination state), promote it to a client component and follow `client-components.md` — but that artifact does not belong in `components/ui/` in the first place. Reserve `components/ui/` strictly for shadcn-style stateless primitives.

## When to skip

Always for stock shadcn primitives.

## Examples from this project

- `components/ui/button.tsx` — `cva` variants + `Slot` passthrough. **Skip.** Coverage comes from every page/component that renders a button.
- `components/ui/card.tsx`, `input.tsx`, `label.tsx` — same. **Skip.**

## Important rule

Do **not** unit-test shadcn primitives "for completeness". Such tests are mirror tests: they assert that `variant="destructive"` sets `bg-destructive`, which only restates the `cva` config. They never catch real bugs and they make refactors painful.
