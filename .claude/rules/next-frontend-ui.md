---
paths:
  - 'next-frontend/components/**/*.tsx'
  - 'next-frontend/app/**/*.tsx'
  - 'next-frontend/app/**/*.css'
description: 'UI rules: design tokens (no hardcoding), shadcn primitive pattern, custom icon components'
---

# next-frontend — UI Rules

These rules govern how UI is written in this project: how tokens are consumed, how shadcn primitives are shaped, and how icons are authored. They apply whenever you edit a `.tsx` under `app/` or `components/`, or a `.css` under `app/`.

**Token registry exception.** `app/globals.css` IS the token registry — the "do not hardcode" rules below describe how to **consume** tokens elsewhere. When you're editing `app/globals.css` itself, you're allowed (and expected) to define raw values inside `:root { … }` / `@theme inline { … }` / dark-mode overrides. The "never add a new token in a component file" rule remains in force everywhere else.

## § Design tokens — consume, never hardcode

All design tokens live in **`app/globals.css`**, organized in three regions:

- `:root { … }` — light-mode semantic + theme values.
- `@theme inline { … }` — Tailwind v4 token mapping that exposes them as utility classes.
- `@media (prefers-color-scheme: dark) :root { … }` — dark-mode overrides.

Rules when **consuming** tokens in components:

- **NEVER hardcode** colors, radii, spacing, font sizes, shadows, or font weights. Always use the tokens defined in `app/globals.css`.
- **NEVER add a new design token in a component file.** If a token is missing, add it to `app/globals.css` first (both raw `:root` and the `@theme inline` block, plus dark mode if needed) and only then consume it.
- When extending Tailwind utilities that aren't in the default scale (e.g. custom `text-*` sizes), they **MUST** also be registered in the `extendTailwindMerge` config in `lib/utils.ts` (see the `font-size` group) so `cn()` dedupes them correctly.

### Semantic colors (preferred — use these first)

Use role-based classes whenever the Figma layer maps to a role: `bg-background`, `text-foreground`, `bg-card`, `bg-popover`, `bg-primary`, `bg-secondary`, `bg-muted`, `bg-accent`, `bg-destructive`, `bg-success`, `bg-warning`, plus paired `-foreground` variants; `border-border`, `border-input`, `ring-ring`, `text-link`, `bg-overlay`, `bg-input-background`, and `*-text` status variants. Sidebar role tokens (`bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-primary`, `bg-sidebar-accent`, `border-sidebar-border`, `ring-sidebar-ring`) are also defined. Full inventory in `app/globals.css`.

### Palette scales (fallback when no semantic token fits)

Scales available: `red`, `blue`, `almost-black`, `neutral` (each with `-100…-1000` steps plus `-alpha-*` variants), status (`error`, `warning`, `success` with `-100`/`-200`/`-alpha-10`/`-dark` where applicable), and `chart-1…chart-5`. Prefer the semantic name (`bg-primary`) over the raw scale (`bg-almost-black-1000`) unless Figma references a specific palette value.

### Typography utilities

Custom text styles (registered in `@theme inline` AND in `lib/utils.ts` tailwind-merge groups): `text-display`, `text-h1`, `text-h2`, `text-h3`, `text-body-lg`, `text-body-md`, `text-caption`, `text-label-md`, `text-label-lg`, `text-label-xl`, `text-label-2xl`, `text-helper`, `text-overlay`. Each carries its own `font-size`, `line-height`, and `font-weight` — **do NOT combine** with `leading-*` or `font-medium` / `font-semibold` unless Figma explicitly overrides. Standalone weights: `font-weight-{400,500,600,700}`.

For body copy / headings / labels use these utilities **instead of** raw `text-sm`, `text-base`, etc.

### Radius, Spacing, Shadows

- **Radius:** `rounded-[var(--radius-{0-5|1|1-5|2|3|4|5|6|full})]` — values in `app/globals.css`.
- **Spacing:** Tailwind v4 `--spacing-*` tokens registered in `app/globals.css`. Use standard utilities (`p-4`, `gap-6`, `mt-12`) which resolve through these tokens. **Do NOT use arbitrary values** like `p-[17px]`.
- **Shadows:** named tokens only — `shadow-card`, `shadow-drawer-left`, `shadow-button-focus`, `shadow-showcase-card`, `shadow-focus-ring`. **Do NOT compose shadow strings inline.**

### Dark mode

Driven by `prefers-color-scheme: dark` overriding `:root` semantic vars. Components using semantic tokens react automatically — **do NOT write `dark:` variants against raw hex values.** Use `dark:` only for asset swaps (e.g. inverting an SVG logo) or palette-scale tokens with no semantic equivalent.

---

## § Shadcn primitives — pattern (applies to `components/ui/**/*.tsx`)

The reference primitive is `components/ui/button.tsx`. Every shadcn-style primitive **MUST** follow it:

1. Define styles with `cva([...base], { variants, defaultVariants })`, base classes as an array joined with `.join(" ")`.
2. Plain function component (**no `forwardRef`, no `displayName`**) typed as `React.ComponentProps<"…">` & `VariantProps<typeof xVariants>`; accept `asChild` and use `radix-ui`'s `Slot.Root` (`import { Slot } from "radix-ui"`) when polymorphism is needed.
3. Set `data-slot="<component-name>"`, `data-variant={variant}`, `data-size={size}` on the root element. Compose classes with `cn(xVariants({ variant, size, className }))`. Export both component and variants object (e.g. `export { Button, buttonVariants }`).
4. State styling uses **ARIA / data attributes**, not boolean props: `disabled:…`, `aria-invalid:…`, `data-[loading=true]:…`, `[&_svg]:…` for descendant SVGs.

Workflow rules:

- **Do NOT install or scaffold shadcn primitives manually.** Run `npx shadcn@latest add <component>` so the install respects `components.json`. After install, replace any external icon imports the generator adds with the corresponding custom icon component from `@/components/icons/` (creating it if it doesn't exist) and remove the icon package from dependencies if it gets added.
- **After `shadcn add`, if the primitive has a Figma counterpart, reconcile it before use.** Fetch the Figma component (`get_design_context`) and rewrite the base classes in `components/ui/<name>.tsx` to use this project's tokens (`text-body-md`/`text-label-lg`, `rounded-[var(--radius-N)]`, `bg-input-background`, `border-border`, …). Drop `dark:` overrides that the semantic tokens already cover. Keep the API (props, `data-slot`, `asChild`) — only classes change. Do this once at install time, not via overrides at every call site.
- **Do NOT add primitives that already exist** in `@/components/ui`. Reuse and compose.
- All interactive components **MUST** handle `:hover`, `:focus-visible` (with `ring-ring` / `border-ring`), `:disabled`, and `aria-invalid` where applicable — see `components/ui/button.tsx` lines 13–16 for the reference shape.

---

## § Icons — pattern (applies to `components/icons/**/*.tsx`)

- **This project does NOT use any external icon library. Do NOT install one.**
- All icons are custom React components rendering inline `<svg>` and live under `@/components/icons/`. File naming: kebab-case (`play-icon.tsx`); export PascalCase (`PlayIcon`).
- Each icon component **MUST**:
  - be typed as `React.ComponentProps<"svg">`;
  - spread `...props` onto the root `<svg>` and merge `className` via `cn(...)`;
  - use `currentColor` for `stroke` / `fill` so it inherits `text-*` color;
  - set `viewBox` from the source SVG and **omit hardcoded `width`/`height`** (consumers size via `size-*` classes);
  - include `aria-hidden="true"` by default.
- Inside a `cva` primitive, size icons via the descendant selector pattern (`[&_svg:not([class*='size-'])]:size-5`), not by hand on each usage — works the same with these SVG components since they render a plain `<svg>`.
- When Figma returns an inline SVG or `localhost` asset URL, convert it to a new component under `@/components/icons/` following the rules above. **Do NOT inline raw SVG markup** inside feature components.
