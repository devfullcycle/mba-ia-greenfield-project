<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only the `next-frontend` container** — **never** start the Next.js dev server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting the container, always confirm it is up before proceeding:

```bash
docker compose ps   # next-frontend must show status "running"
```

The base image's command is `tail -f /dev/null`, so the container stays alive **without** booting Next. The dev server is only started on demand via `docker compose exec`.

If the dev server has been started, verify it actually serves before claiming success:

```bash
curl -I http://localhost:3001   # expect HTTP/1.1 200 OK
```

Only start `npm run dev` when the user **explicitly** asks to run the application — never as part of "start the environment".

## Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start container (from next-frontend/)
docker compose up -d

# Install dependencies (first time only)
docker compose exec next-frontend npm install

# Run the dev server (watch mode) — see "Long-running Processes" below
docker compose exec next-frontend npm run dev
```

Service:
- `next-frontend` — Next.js dev container, host port `3001` → container port `3000`. Browser accesses the app at **`http://localhost:3001`**.

Bind mount: the repo's `next-frontend/` directory is mounted at `/home/node/app` inside the container, so file edits on the host are reflected immediately.

Teardown and inspection commands run on the **host machine**:

```bash
# Verify the dev server is responding (after it has been started)
curl -I http://localhost:3001

# Check container logs
docker compose logs next-frontend

# Tear down
docker compose down
```

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and shadcn command runs **inside the container**, never on the host. Running on the host uses a different Node version, bypasses the container's working directory, and can leave artifacts owned by the wrong user on the bind mount.

### Container-only commands (always prefix with `docker compose exec next-frontend`)

```bash
npm run dev                              # Dev server with hot-reload (run in background)
npm run build                            # Production build (.next/)
npm run start                            # Serve the production build
npm run lint                             # ESLint (eslint-config-next)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npx shadcn@latest add <component>        # Add a shadcn primitive — respects components.json
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs next-frontend
curl -I http://localhost:3001
```

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run **in background** in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `npm run dev`, `npm run start`, and any other persistent process. After starting in background, validate with `curl -I http://localhost:3001`.

## Architecture

Next.js 16 App Router with React 19 Server Components by default. Routes, layouts, and pages live under `app/`.

- **Server Components** (default): can `fetch` from the NestJS API directly server-side. Prefer this for data loading — keeps payloads small and avoids client-side waterfalls.
- **Client Components** (`"use client"`): only when the component uses `useState`/`useEffect`/refs/browser APIs or interactive event handlers. Keep client boundaries as deep in the tree as possible.

### Talking to the NestJS API

Today the `next-frontend/` and `nestjs-project/` Docker Compose stacks are **separate** — they do not share a network. Implications:

- **From the browser (client components):** call the API at **`http://localhost:3000`** (the host-exposed port of `nestjs-api`).
- **From the server (RSC, route handlers, server actions) inside the container:** the container cannot reach `localhost:3000` of the host. A shared Compose network or `host.docker.internal` will be required — **to be defined** when the first server-side integration lands.
- **Env var convention (planned):** `NEXT_PUBLIC_API_URL` for client-side reads, `API_URL` for server-side reads. Treat these as the conventional names; concrete values are not prescribed yet.

Media streaming will eventually come from Object Storage (S3/MinIO) — TBD.

Refer to the C4 container diagram at `docs/diagrams/software-arch.mermaid` for the full system view.

## Testing

**TBD.** No test scripts are wired in `package.json` yet, and the tooling (Vitest/Jest, Testing Library, Playwright, …) has not been selected.

The global [`CLAUDE.md`](../CLAUDE.md) → "Definition of Done (Technical)" requires tests to pass before a task is complete. Until the test setup is chosen and added here, this section is a placeholder — replace it with concrete instructions (how to run unit/integration/e2e, conventions, file suffixes) as soon as the tooling decision is made.

## Stack Summary

Next.js App Router with React Server Components, TypeScript strict, React 19, Tailwind CSS v4 (CSS-first config via `@theme inline` in `app/globals.css` — there is NO `tailwind.config.js`), shadcn/ui (style `radix-nova`, baseColor `neutral`, `cssVariables: true`) on top of `radix-ui` primitives, `class-variance-authority` (`cva`) with extended `tailwind-merge`, custom SVG icon components in `components/icons/` (no external icon library), `Inter` + `Geist_Mono` fonts loaded via `next/font/google` in `app/layout.tsx`. Exact versions in `package.json`.

## Project Structure & Path Aliases

```
next-frontend/
├── app/                      # Next.js App Router (routes, layouts, pages)
│   ├── globals.css           # Tokens + @theme inline + base layer
│   ├── layout.tsx            # Root layout (fonts wired here)
│   └── <route>/page.tsx
├── components/
│   ├── ui/                   # shadcn primitives — ONLY add via shadcn CLI
│   └── icons/                # Custom SVG icon components
├── lib/
│   └── utils.ts              # `cn(...)` helper (clsx + extended tailwind-merge)
└── components.json           # shadcn config (do not edit by hand)
```

Path aliases live in `tsconfig.json` and `components.json` — `@/components`, `@/components/ui`, `@/components/icons`, `@/lib`, `@/lib/utils`, `@/hooks` (create when first hook is added).

- IMPORTANT: Always import with `@/...` aliases. Do NOT use deep relative paths (`../../...`).
- IMPORTANT: Feature/page components live under `app/<route>/` next to the route. Cross-route reusable composites live under `components/` (create subfolders by feature; do NOT mix them into `components/ui/`, which is reserved for shadcn primitives).

## Design Tokens — Source of Truth

All design tokens live in **`app/globals.css`**, organized in three regions: `:root { … }` (light mode semantic + theme values), `@theme inline { … }` (Tailwind v4 token mapping exposing them as utility classes), and `@media (prefers-color-scheme: dark) :root { … }` (dark mode overrides).

- IMPORTANT: NEVER hardcode colors, radii, spacing, font sizes, shadows, or font weights. Always use the tokens defined in `app/globals.css`.
- IMPORTANT: NEVER add a new design token to a component file. If a token is missing, add it to `app/globals.css` (both raw `:root` and the `@theme inline` block, and dark mode if needed) and only then consume it.
- When extending Tailwind utilities that aren't in the default scale (e.g. custom `text-*` sizes), they MUST also be registered in the `extendTailwindMerge` config in `lib/utils.ts` (see the `font-size` group) so `cn()` dedupes them correctly.

### Semantic colors (preferred — use these first)

Use role-based classes whenever the Figma layer maps to a role: `bg-background`, `text-foreground`, `bg-card`, `bg-popover`, `bg-primary`, `bg-secondary`, `bg-muted`, `bg-accent`, `bg-destructive`, `bg-success`, `bg-warning`, plus paired `-foreground` variants; `border-border`, `border-input`, `ring-ring`, `text-link`, `bg-overlay`, `bg-input-background`, and `*-text` status variants. Sidebar role tokens (`bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-primary`, `bg-sidebar-accent`, `border-sidebar-border`, `ring-sidebar-ring`) are also defined. Full inventory in `app/globals.css`.

### Palette scales (when a semantic token doesn't fit)

Scales available: `red`, `blue`, `almost-black`, `neutral` (each with `-100…-1000` steps plus `-alpha-*` variants), status (`error`, `warning`, `success` with `-100`/`-200`/`-alpha-10`/`-dark` where applicable), and `chart-1…chart-5`. Prefer the semantic name (`bg-primary`) over the raw scale (`bg-almost-black-1000`) unless Figma references a specific palette value.

### Typography utilities

Custom text styles (registered in `@theme inline` AND in `lib/utils.ts` tailwind-merge groups): `text-display`, `text-h1`, `text-h2`, `text-h3`, `text-body-lg`, `text-body-md`, `text-caption`, `text-label-md`, `text-label-lg`, `text-label-xl`, `text-label-2xl`, `text-helper`, `text-overlay`. Each carries its own `font-size`, `line-height`, and `font-weight` — do NOT combine with `leading-*` or `font-medium`/`font-semibold` unless Figma explicitly overrides. Standalone weights: `font-weight-{400,500,600,700}`.

- IMPORTANT: For body copy / headings / labels use these utilities instead of raw `text-sm`, `text-base`, etc.

### Radius, Spacing, Shadows

- **Radius:** `rounded-[var(--radius-{0-5|1|1-5|2|3|4|5|6|full})]` — values in `app/globals.css`.
- **Spacing:** Tailwind v4 `--spacing-*` tokens registered in `app/globals.css`. Use standard utilities (`p-4`, `gap-6`, `mt-12`) which resolve through these tokens. Do NOT use arbitrary values like `p-[17px]`.
- **Shadows:** named tokens only — `shadow-card`, `shadow-drawer-left`, `shadow-button-focus`, `shadow-showcase-card`, `shadow-focus-ring`. Do NOT compose shadow strings inline.

### Dark mode

Driven by `prefers-color-scheme: dark` overriding `:root` semantic vars. Components using semantic tokens react automatically — do NOT write `dark:` variants against raw hex values. Use `dark:` only for asset swaps (e.g. inverting an SVG logo) or palette-scale tokens with no semantic equivalent.

## Component Patterns

The reference primitive is `components/ui/button.tsx`. Every shadcn-style primitive MUST follow it:

1. Define styles with `cva([...base], { variants, defaultVariants })`, base classes as an array joined with `.join(" ")`.
2. Plain function component (no `forwardRef`, no `displayName`) typed as `React.ComponentProps<"…">` & `VariantProps<typeof xVariants>`; accept `asChild` and use `radix-ui`'s `Slot.Root` (`import { Slot } from "radix-ui"`) when polymorphism is needed.
3. Set `data-slot="<component-name>"`, `data-variant={variant}`, `data-size={size}` on the root element. Compose classes with `cn(xVariants({ variant, size, className }))`. Export both component and variants object (e.g. `export { Button, buttonVariants }`).
4. State styling uses ARIA / data attributes, not boolean props: `disabled:…`, `aria-invalid:…`, `data-[loading=true]:…`, `[&_svg]:…` for descendant SVGs.

- IMPORTANT: Do NOT install or scaffold shadcn primitives manually. Run `npx shadcn@latest add <component>` so the install respects `components.json`. After install, replace any external icon imports the generator adds with the corresponding custom icon component from `@/components/icons/` (creating it if it doesn't exist) and remove the icon package from dependencies if it gets added.
- IMPORTANT: After `shadcn add`, if the primitive has a Figma counterpart, reconcile it before use. Fetch the Figma component (`get_design_context`) and rewrite the base classes in `components/ui/<name>.tsx` to use this project's tokens (`text-body-md`/`text-label-lg`, `rounded-[var(--radius-N)]`, `bg-input-background`, `border-border`, …). Drop `dark:` overrides that the semantic tokens already cover. Keep the API (props, `data-slot`, `asChild`) — only classes change. Do this once at install time, not via overrides at every call site.
- IMPORTANT: Do NOT add primitives that already exist in `@/components/ui`. Reuse and compose.
- All interactive components MUST handle `:hover`, `:focus-visible` (with `ring-ring` / `border-ring`), `:disabled`, and `aria-invalid` where applicable — see `components/ui/button.tsx` lines 13–16.

## Icons

- IMPORTANT: This project does NOT use any external icon library. Do NOT install one.
- All icons are custom React components rendering inline `<svg>` and live under `@/components/icons/`. File naming: kebab-case (`play-icon.tsx`); export PascalCase (`PlayIcon`).
- Each icon component MUST: be typed as `React.ComponentProps<"svg">`; spread `...props` onto the root `<svg>` and merge `className` via `cn(...)`; use `currentColor` for `stroke`/`fill` so it inherits `text-*` color; set `viewBox` from the source SVG and omit hardcoded `width`/`height` (consumers size via `size-*` classes); include `aria-hidden="true"` by default.
- Inside a `cva` primitive, size icons via the descendant selector pattern (`[&_svg:not([class*='size-'])]:size-5`), not by hand on each usage — works the same with these SVG components since they render a plain `<svg>`.
- When Figma returns an inline SVG or `localhost` asset URL, convert it to a new component under `@/components/icons/` following the rules above. Do NOT inline raw SVG markup inside feature components.

## Static Assets & Images

- Static assets that ship with the app go in `public/` and are referenced as `/file.svg` (or via `<Image src="/file.svg" … />` from `next/image` when raster).
- Use `next/image` (`import Image from "next/image"`) for all raster images so Next can optimize them — never plain `<img>`.

## Code Quality Conventions

- TypeScript strict; no `any`. Use `React.ComponentProps<"tag">` to extend native element props.
- Imports: built-in / third-party / `@/…` aliases / relative — separated by blank lines.
- File naming: kebab-case for files (`button.tsx`, `video-card.tsx`), PascalCase for the exported component (`Button`, `VideoCard`).
- Server Components by default. Add `"use client"` deliberately.
- Use `cn(...)` from `@/lib/utils` for every conditional / merged className. Never string-concatenate Tailwind classes manually.
- Use Next.js primitives (`next/image`, `next/link`, `next/font`) — do NOT replace them with native elements for navigation/images.
- Lint must pass: `npm run lint`. TypeScript must compile: `npx tsc --noEmit`.

## When in Doubt

- Compare against `components/ui/button.tsx` (canonical primitive) and `app/globals.css` (canonical token registry).
- If a Figma value has no matching token, ADD the token to `app/globals.css` first, then consume it — do not inline a hex/px value.
- If the design implies a missing shadcn primitive, install it via `npx shadcn@latest add <name>` rather than hand-rolling it.

# Figma MCP Integration Rules — next-frontend

These rules tell AI coding agents how to translate Figma designs into code for this project. They MUST be followed for every Figma-driven change.

## Figma Assets

- The Figma MCP server serves images and SVGs from a localhost endpoint embedded in the design payload.
- IMPORTANT: If the Figma MCP server returns a `localhost` source for an image or SVG, use that source directly.
- IMPORTANT: DO NOT install new icon packages — icons are custom SVG components under `@/components/icons/` (see the Icons section). Convert Figma SVG payloads into components there.
- IMPORTANT: DO NOT invent or insert placeholder images when a `localhost` source is provided.

## Required Figma-to-Code Flow

Follow this order for EVERY Figma-driven change. Do not skip steps.

1. **`get_design_context`** for the exact node(s). Primary input — returns React + Tailwind code, screenshots, and context hints.
2. If the response is too large or truncated, call **`get_metadata`** for a high-level node map, then re-fetch only the required node(s) with `get_design_context`.
3. **`get_screenshot`** for the node variant you are implementing. You MUST have both `get_design_context` and `get_screenshot` before writing code.
4. Download / inline any assets referenced in the payload (use the localhost sources).
5. **Translate**, do not transcribe. The MCP output is a REFERENCE — convert it to this project's conventions:
   - Replace raw hex colors with semantic tokens (`bg-primary`, `text-foreground`, …) or palette tokens.
   - Replace arbitrary spacing (`p-[17px]`) with the project's spacing scale.
   - Replace ad-hoc text classes (`text-base font-medium`) with the project's typography utilities (`text-label-md`, etc.).
   - Replace inline radii with `rounded-[var(--radius-*)]` tokens.
   - Swap absolute-positioned layouts for flex/grid where the design intent is a flow layout.
   - Reuse `@/components/ui/*` primitives (Button, etc.) instead of re-implementing them.
   - Server Components by default; add `"use client"` ONLY when the component uses state, effects, refs, or browser APIs.
6. **Validate** the rendered output against the Figma screenshot — pixel-level visual parity AND interactive states (hover, focus-visible, disabled, dark mode).
