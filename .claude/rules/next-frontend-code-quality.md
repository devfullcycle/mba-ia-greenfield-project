---
paths:
  - 'next-frontend/**/*.ts'
  - 'next-frontend/**/*.tsx'
description: 'TypeScript strict, imports, RSC/client boundary, file naming, cn(), Next.js primitives, env access'
---

# next-frontend — Code Quality Rules

These rules apply to every TypeScript/TSX file in `next-frontend/`. Stack-specific rules (UI tokens, BFF wiring, tests, MSW) live in sibling rule files and layer on top of these.

## TypeScript

- Strict mode is on (`tsconfig.json` carries `strict: true`). **No `any`.** When you need to type a DOM-element-extending prop, use `React.ComponentProps<"tag">` rather than re-deriving the prop list.
- `npx tsc --noEmit` must exit 0 before any task is considered done. Never leave compilation errors as debt for a later cleanup task.

## `import type` for type-only imports

When an import is consumed **only** as a type (annotations, generics, `extends`, `implements`), use `import type`:

```typescript
import type { paths } from "@/lib/api/types.gen";
import type { ComponentProps } from "react";
```

This avoids runtime imports of type-only modules (which can break with `verbatimModuleSyntax` / `isolatedModules`) and keeps the compiled output minimal.

If the same module exports both values and types, use the inline form:

```typescript
import { cn, type ClassValue } from "@/lib/utils";
```

## Import order

Group imports in this order, separated by **a single blank line** between groups:

1. Node built-ins (`node:fs`, …).
2. Third-party packages (`react`, `next`, `msw`, …).
3. Project `@/...` aliases.
4. Relative imports (`./foo`, `../bar`).

## Path aliases

- **Always** import via `@/...` aliases (`@/components`, `@/components/ui`, `@/components/icons`, `@/lib`, `@/lib/utils`, `@/hooks`).
- **Never** use deep relative paths (`../../...`). One level of relative (`./sibling`) inside the same feature folder is fine.

Aliases are declared in `tsconfig.json` and `components.json`; do not invent new aliases per-file.

## File placement

- **Feature / page components** live under `app/<route>/` next to the route they serve.
- **Cross-route reusable composites** live under `components/<feature>/` (one subfolder per feature; create as needed).
- **Never mix custom composites into `components/ui/`** — that directory is reserved for shadcn primitives and is owned by the shadcn CLI workflow.

## File naming

- File names: **kebab-case** (`button.tsx`, `video-card.tsx`, `auth-provider.tsx`).
- Exported component / hook / util: **PascalCase** (`Button`, `VideoCard`) or **camelCase** for non-component utilities (`useAuth`, `cn`).
- One default-or-primary export per file. Co-locate small helpers in the same file only when they're not used elsewhere.

## React Server Components are the default

- Components are **Server Components by default**. They can `fetch` from the BFF Route Handlers server-side (or from the upstream API via the typed `upstream` client — see the BFF rule).
- Add `"use client"` **only** when the component uses `useState` / `useEffect` / refs / browser APIs / interactive event handlers. Keep the `"use client"` boundary as deep in the tree as possible — an entire page should not become a client component just because one button needs `onClick`.

## `cn(...)` for every className

Use `cn(...)` from `@/lib/utils` for every conditional / merged className. **Never string-concatenate Tailwind classes manually** — `cn()` is a `clsx` + extended `tailwind-merge` combination that dedupes conflicting utilities.

```tsx
<button className={cn("rounded-md px-3", isActive && "bg-primary", className)}>
```

## Next.js primitives

Use Next.js primitives instead of native HTML for cross-cutting concerns:

- `next/image` for raster images (any `.png`, `.jpg`, `.webp`, etc.). **Never use a plain `<img>` tag.** SVG-as-component is fine (see icons rule).

  ```tsx
  import Image from "next/image";
  <Image src="/hero.jpg" alt="..." width={1200} height={600} />
  ```

- `next/link` for client-side navigation between routes (never plain `<a>` for internal navigation).
- `next/font` for typography. Fonts are wired in `app/layout.tsx`; do not import them ad-hoc from component files.

## Environment access — `env` from `@/lib/env` only

`lib/env.ts` is the source of truth for environment variable reads in `next-frontend/`. Feature code **MUST** import `env` from `@/lib/env`:

```typescript
import { env } from "@/lib/env";
const url = `${env.API_URL}/videos`;
```

**Do NOT** read `process.env.X` directly anywhere in feature code. The only exceptions:

- `lib/env.ts` itself (it defines the schema).
- Non-Next contexts that explicitly bootstrap env via `loadEnvConfig(process.cwd())` from `@next/env` (rare — e.g., standalone scripts).

Accessing `env.API_URL` from a Client Component throws at runtime by design (the key is server-only).
