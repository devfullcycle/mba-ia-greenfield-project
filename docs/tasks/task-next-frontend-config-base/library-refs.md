---
libs:
  "zod":
    version: "^4.0.0"
    context7_id: "/colinhacks/zod/v4.0.1"
    fetched_at: "2026-05-13T14:51:00-03:00"
  "@t3-oss/env-nextjs":
    version: "^0.13.0"
    context7_id: "/t3-oss/t3-env"
    fetched_at: "2026-05-13T14:51:00-03:00"
sources_mtime:
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-05-13T14:50:56-03:00"
---

# Library References — task-next-frontend-config-base

Context7-sourced excerpts for libraries decided in this task's TDs. Used by `/plan-build` (Phase B) and `/implement` for accurate API references at code-generation time.

---

### zod

**Used by:** `next-frontend-config-base/TD-01` (validation library for env schema).

**Install:** `npm install zod` (range `^4.0.0`).

**Key Zod 4 API surface for env validation:**

```ts
import * as z from "zod";

// Object schema with type inference — schema IS the type.
const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  API_URL: z.url(),                          // top-level (NOT z.string().url() — deprecated in v4)
  PORT: z.coerce.number().default(3000),     // string-to-number coercion + default
  DEBUG: z.stringbool(),                     // env-style boolean: "true"/"1"/"yes"/"on" → true
});

type EnvShape = z.infer<typeof schema>;       // type derived from schema
```

**v4 breaking changes relevant here:**
- String format methods are now **top-level functions**, not methods on `z.string()`:
  - `z.url()` instead of `z.string().url()` (deprecated)
  - `z.email()`, `z.uuid()`, `z.cuid()`, `z.iso.datetime()`, etc.
- New `z.stringbool()` for env-style boolean parsing (accepts `"true"|"1"|"yes"|"on"|"y"|"enabled"` → `true`; `"false"|"0"|"no"|"off"|"n"|"disabled"` → `false`); customizable via `z.stringbool({ truthy: [...], falsy: [...] })`.
- `z.coerce.number()`, `z.coerce.boolean()`, `z.coerce.bigint()`, `z.coerce.string()` still available — use `Boolean(input)` / `Number(input)` semantics. For env booleans prefer `z.stringbool()` over `z.coerce.boolean()` because `Boolean("false")` returns `true`.

**Defaults:** `z.coerce.number().default(3000)` applies the default only when input is `undefined`. With t3-env's `emptyStringAsUndefined: true`, empty strings (`PORT=` in `.env`) are normalized to `undefined`, allowing the default to apply.

**TS inference idiom:** `z.infer<typeof schema>` produces a fully typed shape — never declare a parallel `interface Env { ... }`; the schema is the single source of truth.

---

### @t3-oss/env-nextjs

**Used by:** `next-frontend-config-base/TD-02` (Server/Client boundary enforcement).

**Install:** `npm install @t3-oss/env-nextjs` (range `^0.13.0`; also requires `zod` peer — already installed via TD-01).

**Canonical pattern for Next.js 16.2 (we are on >= 13.4.4 → `experimental__runtimeEnv` available, server vars auto-pulled from `process.env`):**

```ts
// next-frontend/lib/env.ts
import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";

export const env = createEnv({
  /**
   * Server-only — never sent to the browser.
   * Runtime Proxy throws on client access; type-level the keys are NOT
   * available on the returned `env` object when imported from Client Components.
   */
  server: {
    API_URL: z.url(),
  },

  /**
   * Client-exposed — MUST be prefixed with NEXT_PUBLIC_ (type-level + runtime
   * enforcement). Build-frozen at `next build` time (Next.js inlines them
   * into the client bundle as literal string replacements).
   *
   * Empty in the foundation phase (TD-03 chose strict BFF — no public API URL).
   */
  client: {},

  /**
   * Shared — available on both server and client (no NEXT_PUBLIC_ prefix required).
   * Auto-inlined on client when referenced from a Client Component.
   */
  shared: {
    NODE_ENV: z.enum(["development", "production", "test"]),
  },

  /**
   * Next.js >= 13.4.4 path: list ONLY client + shared variables here.
   * Server variables are auto-pulled from `process.env` by t3-env.
   * (Pre-13.4.4 used `runtimeEnv` and required every key listed manually.)
   */
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
  },

  /**
   * Recommended for all new projects. Treats empty .env entries
   * (`PORT=`, `DOMAIN=`) as `undefined`, allowing Zod's `.default()` to fire.
   * Without this, `z.coerce.number()` flags empty strings as type mismatches.
   */
  emptyStringAsUndefined: true,
});
```

**Consumption — single import path across all contexts:**

```ts
// app/api/.../route.ts (Route Handler — server) — full access
import { env } from "@/lib/env";
fetch(`${env.API_URL}/users`);

// app/page.tsx (RSC — server) — full access
import { env } from "@/lib/env";
const upstream = env.API_URL;

// components/some-client.tsx ("use client") — only client + shared
"use client";
import { env } from "@/lib/env";
console.log(env.NODE_ENV);          // ✓ shared
// console.log(env.API_URL);         // ✗ runtime throw: "Attempted to access a server-side environment variable on the client"
```

**Boundary guarantees:**
- **Type-level prefix enforcement:** keys in the `client` block that don't start with `NEXT_PUBLIC_` produce a TS compile error.
- **Runtime Proxy:** any access to a `server` key from a Client Component bundle throws `"Attempted to access a server-side environment variable on the client"` — even if the consumer accidentally imported the file.
- **Build-time inlining:** Next.js still inlines `process.env.NEXT_PUBLIC_*` references at build; t3-env's role is the schema + boundary layer on top.

**Skip flag:** set `SKIP_ENV_VALIDATION=1` in CI contexts (Docker image builds, lint-only CI jobs) to skip the validation step when env vars are intentionally absent — t3-env documents this as the canonical opt-out.

**For non-Next contexts** (Vitest setup, codegen scripts running outside `next dev` / `next build`), pair with `@next/env`'s `loadEnvConfig(process.cwd())` at the entry point so `.env*` files are loaded before importing `env`. Document this in the test setup file when test infra lands.

---
