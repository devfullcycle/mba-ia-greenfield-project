---
scope_type: ad-hoc
related_phases: []
status: decided
date: 2026-05-13
scope_description: "Foundation for environment variable configuration and validation in the next-frontend subproject: validation library, server/client boundary enforcement strategy, and the initial canonical env-key contract for the FE↔BE bridge."
---

# Technical Decisions — next-frontend Config Base

_Subprojects in scope:_

- `next-frontend/` — primary subproject. Receives the env validation layer (`lib/env.ts` or equivalent), the canonical key contract, the `.env.example` document, and any wiring needed for non-Next contexts (Vitest setup, future codegen scripts) to read env using the same conventions.
- `nestjs-project/` — out of scope for env _decisions_; the backend already decided its own ConfigModule/Joi strategy in `phase-01-configuracao-base`. The backend appears here only as the consumer that the FE's `API_URL` key points to (TD-03 only). No open decision in this document for the backend.

> Cross-doc parity note: the backend chose **Joi** + **@nestjs/config** + namespaced `registerAs()` factories in `phase-01-configuracao-base/TD-01..TD-04`. The Joi recommendation there was driven by **first-class integration with `@nestjs/config`'s `validationSchema` option** — an argument that does not apply to Next.js, which has no analogous integration point. The FE foundation is therefore evaluated on its own ergonomics (TS-first inference, ecosystem alignment, bundle weight, server/client boundary) without binding the choice to backend parity.

---

## TD-01: Validation Library for Env Schema

**Scope:** Frontend

**Trigger:** Decide which schema library typechecks and parses `process.env` at startup in `next-frontend` — establishing the canonical validation paradigm for the FE subproject (likely to flow into future FE form/DTO work).

**Context:** `next-frontend/package.json` declares zero validation deps today. Env vars are read raw from `process.env.X` with no parsing or shape guarantees. The chosen library will:
- run at module-load time inside the Next.js runtime (server-side bundle), validating both server-only and `NEXT_PUBLIC_*` keys;
- have its `NEXT_PUBLIC_*` slice imported into client bundles (build-frozen) — so its bundle weight matters;
- export the inferred TS type used by every consumer (`lib/env.ts → env.API_URL`).

Stack constraint: Next.js 16.2.6 + React 19.2.4, TypeScript strict, App Router. CLAUDE.md mandates `npx tsc --noEmit` + lint as part of Definition of Done — any library chosen must produce inferred types, not require manual `as` casts.

**Options:**

### Option A: Zod 4

TypeScript-first schema library. Define schemas with `z.object({ API_URL: z.url(), PORT: z.coerce.number().default(3000) })`; types inferred via `z.infer<typeof schema>`. Zod 4 moved string format methods to top-level functions (`z.url()`, `z.email()` — not `z.string().url()`) and introduced `z.stringbool()` for env-style boolean parsing (`"true"|"1"|"yes"|"on" → true`).

- **Pros:** Single source of truth — schema IS the type. Native env ergonomics: `z.coerce.number()`, `z.coerce.boolean()`, `z.stringbool()`, default values, top-level format helpers (`z.url()`, `z.email()`). Dominant in the Next.js / React 19 ecosystem — integrates with `react-hook-form` (via `@hookform/resolvers/zod`), Next Server Actions validation, and `@t3-oss/env-nextjs` (TD-02 candidate). Mature (v4 stable, ~12KB gzip core). Used as canonical schema language in the App Router docs and React community examples.
- **Cons:** Adds a new validation paradigm to the monorepo (backend uses Joi for env, will use class-validator for DTOs). Zod 4 changes API surface vs Zod 3 (top-level `z.url()` instead of `z.string().url()`) — readers familiar only with older blog posts may copy outdated patterns.

### Option B: Valibot

Modular, tree-shakeable, dependency-free schema library with a functional API: `v.object({ API_URL: v.pipe(v.string(), v.url()) })`. Schemas built by composing small functions instead of methods on a single object — only the validators actually used ship in the bundle.

- **Pros:** Smallest bundle in this class — minimum ~700 bytes; typical real-world schema lands well under Zod's footprint. Type inference parity with Zod (`v.InferOutput<typeof schema>`). Supported by `@t3-oss/env-nextjs` (alongside Zod) — no lock-in to a specific lib via t3-env. Dependency-free.
- **Cons:** Smaller ecosystem — no `@hookform/resolvers/valibot` parity with Zod's ubiquity (resolver exists but the community examples & Next.js docs default to Zod). Functional API is unfamiliar to developers coming from Joi/Yup/Zod; higher onboarding cost in a project with no prior Valibot usage. For an env schema with ~5-10 keys, the bundle savings are real but bounded — only the `NEXT_PUBLIC_*` slice is shipped to the client, and it's tiny either way.

### Option C: Joi (mirror backend)

Same library used by the backend in `phase-01-configuracao-base/TD-02`. Schema-based validation with fluent API: `Joi.object({ API_URL: Joi.string().uri().required() })`.

- **Pros:** Single validation paradigm across monorepo — one syntax for env validation regardless of subproject. Mature, battle-tested, ~9M weekly downloads.
- **Cons:** ~150-250KB unminified; bundle weight is meaningful if the schema (or any code that imports it) leaks into client bundles. Schema is defined separately from TypeScript types — no inference; types must be hand-written or generated via a separate codegen step (`joi-to-typescript`). The original argument for Joi in `phase-01-configuracao-base/TD-02` was **first-class integration with `@nestjs/config`'s `validationSchema` option** — Next.js has no equivalent integration point, so the unique advantage that swung the backend decision does not transfer. Fluent OO API is a poor fit for the otherwise TS-first FE codebase (already using `cva` variants, typed `React.ComponentProps<>`, strict mode).

### Option D: class-validator + class-transformer (mirror future-backend-DTO paradigm)

Decorator-based validation: define a class with `@IsString()`, `@IsUrl()`, `@Transform()`, then `plainToInstance() + validateSync()`.

- **Pros:** Same library that the backend will use for request DTOs (Phase 02+). Decorators feel idiomatic to developers coming from NestJS.
- **Cons:** Requires `experimentalDecorators` + `emitDecoratorMetadata` in `tsconfig.json`, **and** `reflect-metadata` polyfill imported once at process entry — neither is currently configured in `next-frontend/tsconfig.json`. Decorators add runtime metadata to the client bundle wherever the validated class is imported. The validated class lives in the runtime context that loads it — extra ceremony for a one-shot startup validation. Same backend-rejection reasoning as `phase-01-configuracao-base/TD-02` (which explicitly chose Joi over class-validator for env): startup validation is a one-time concern, not a DTO-per-request concern.

**Recommendation:** **Option A (Zod 4)**. Three converging reasons: (1) **Type-inference matches the FE's strict-TS culture** — `lib/env.ts` exports a typed `env` object with no `as` casts, satisfying the project's "Type Safety" working principle. (2) **Ecosystem gravity in Next.js / React 19** — Zod is the de-facto schema language for App Router (Server Actions inputs, form resolvers, future contract validation), so introducing it once at the env layer compounds value for forms in Phase 02+. (3) **Direct enablement of TD-02 Option A (`@t3-oss/env-nextjs`)** — t3-env's first-citizen validator. Backend parity with Joi is not load-bearing: env schemas are not shared FE↔BE (different runtimes, different key sets); two validators across two subprojects is a bounded cost.

**Decision:** **A (Zod 4)**
**Libraries:** zod

---

## TD-02: Server/Client Boundary Enforcement Strategy

**Scope:** Frontend

**Trigger:** Decide how `next-frontend` structurally prevents server-only env vars from leaking into the client bundle, and how a single consumer call site (`import { env } from "..."`) can serve both Server Components / Route Handlers / Server Actions AND Client Components without code duplication or runtime accidents.

**Context:** Per Next.js 16's bundled docs (`node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`):

- `NEXT_PUBLIC_*` vars are **inlined at build time** into the client JS bundle as literal string replacements of `process.env.NEXT_PUBLIC_X`.
- Non-`NEXT_PUBLIC_*` vars stay in the Node.js `process.env` and are **never** sent to the browser by Next.
- However, the **boundary is enforced by Next only at the `process.env.X` literal-reference level**. If a developer accidentally imports a server-side helper that exposes `process.env.DB_PASSWORD` via a returned value into a Client Component module, Next does NOT strip it — the boundary depends on the module graph not bridging server↔client. Adding `import "server-only"` at the top of a server-only module makes the build fail loudly when a Client Component imports it (Next.js primitive).

This decision determines: (1) where the env schema lives (one file or two), (2) how `NEXT_PUBLIC_*` prefix correctness is enforced (manual review vs structural), (3) whether server-var-on-client access fails at build, at runtime, or silently.

This decision **depends on TD-01**: Option A (`@t3-oss/env-nextjs`) supports Zod and Valibot; if TD-01 chose Joi or class-validator, Option A here is off the table.

**Options:**

### Option A: `@t3-oss/env-nextjs` (purpose-built wrapper)

A thin wrapper around the chosen schema lib (Zod or Valibot) that exposes `createEnv({ server, client, runtimeEnv, emptyStringAsUndefined })`. Single file (`lib/env.ts`) exports one typed `env` object. The library:
- enforces at the **type level** that every key in `client` starts with `NEXT_PUBLIC_` (TS error otherwise);
- enforces at the **runtime level** via a Proxy: any access to a server-only key from a client bundle throws `"Attempted to access a server-side environment variable on the client"` — even if the consumer imported the file by mistake;
- supports `emptyStringAsUndefined: true` so `.env` lines like `PORT=` correctly fall through to schema defaults instead of failing as empty-string mismatches;
- on Next.js ≥ 13.4.4 (we are on 16.2.6), only the client keys must be listed in `runtimeEnv` — server keys are auto-pulled from `process.env`.

- **Pros:** Solves three concerns in one config (validation + structural boundary + build-frozen NEXT_PUBLIC_ mapping). Single import path (`@/lib/env`) regardless of context — no duplication, no two-file mental overhead. Type-level enforcement of `NEXT_PUBLIC_` prefix means a misnamed client key is a TS error, not a runtime mystery. Runtime proxy is the only option here that catches accidental server-var access from a client component when the module graph crosses the line (e.g., a poorly-placed import). Active maintenance, ~3KB gzip wrapper on top of the chosen schema lib.
- **Cons:** Adds one small dep on top of the validator. Opinionated structure — `createEnv()` is the only way to declare schemas, no escape hatch for unusual splits. Lock-in to t3-env's argument shape (mitigated by its small surface).

### Option B: DIY two-module split (`env.server.ts` + `env.client.ts`)

Two files. `lib/env.server.ts` starts with `import "server-only"` (Next.js' build-time guard), defines a Zod schema for all server-side keys (including server-only and the `NEXT_PUBLIC_*` keys it can also read), parses `process.env`, exports a typed `serverEnv` object. `lib/env.client.ts` defines a Zod schema for `NEXT_PUBLIC_*` only, parses, exports a typed `clientEnv` (safe to import from Client Components).

- **Pros:** No additional dep beyond the validator. Module-graph boundary is enforced by Next's `server-only` package: if a Client Component imports `env.server.ts`, build fails with a clear error. Mirrors the namespacing impulse of `phase-01-configuracao-base/TD-03` (separate files per concern).
- **Cons:** Re-implements what `@t3-oss/env-nextjs` already provides — and provides imperfectly. No type-level enforcement that client keys start with `NEXT_PUBLIC_` (developer can type `LEAK_THIS: z.string()` in `env.client.ts` and Next will silently make it `undefined` in the browser because there is no `NEXT_PUBLIC_LEAK_THIS` to inline). No runtime proxy — if a server-side caller mistakenly reads `clientEnv` for a value that exists in both schemas, drift between the two schemas (e.g., `API_URL` defined slightly differently in each) becomes a silent inconsistency. Consumers must remember **which** of two imports to use per file. Worse ergonomics for the same outcome t3-env delivers in one file.

### Option C: DIY single-module with conventions only

One `lib/env.ts`. Single Zod schema, single typed `env` export. No `server-only` guard, no boundary. Documentation tells developers not to access `env.SERVER_SECRET` from Client Components.

- **Pros:** Simplest possible structure — one file, one import path. Zero ceremony beyond the schema.
- **Cons:** **No structural protection at all.** A Client Component importing `env.SERVER_SECRET` will see `undefined` at runtime in the browser (Next strips non-`NEXT_PUBLIC_*` reads when transpiling client bundles — but the import succeeds at build, and downstream code that depends on the value silently breaks). No prefix enforcement. No leak detection. The "documentation guards the boundary" model fails as soon as the project has more than one contributor or the codebase has more than a dozen files — the foundation phase is exactly when to lock in structural protection.

**Recommendation:** **Option A (`@t3-oss/env-nextjs`)**. The only option that combines (i) **type-level NEXT_PUBLIC_ prefix enforcement**, (ii) **runtime Proxy-based leak detection**, and (iii) **single-file, single-import-path consumer ergonomics**. Option B reaches roughly the same _structural_ outcome at higher implementation and maintenance cost, with a weaker guarantee (no prefix enforcement, no proxy). Option C is unsafe at any non-trivial team size. The marginal cost over B is one ~3KB dep — well-spent for the strongest boundary among the three.

**Decision:** **A (@t3-oss/env-nextjs)**
**Libraries:** @t3-oss/env-nextjs

---

## TD-03: API URL Key Strategy for the FE↔BE Bridge

**Scope:** Cross-layer

**Trigger:** Define the canonical env-key contract that `next-frontend` uses to reach `nestjs-project`. This is the FIRST cross-component value defined by the env layer and must be settled at the foundation phase because it shapes the schema, the `.env.example`, and the eventual Docker network configuration.

**Context:** Per `next-frontend/CLAUDE.md` ("Talking to the NestJS API" section), the two subprojects today run on **separate Docker Compose stacks** with no shared network:

- Browser ⇒ NestJS API: `http://localhost:3000` (host-exposed port of `nestjs-api`).
- Server-side code (RSC / Route Handlers / Server Actions, **inside the `next-frontend` container**) ⇒ NestJS API: **does not yet work** — `localhost:3000` from inside the container resolves to the container itself, not the host. CLAUDE.md notes "a shared Compose network or `host.docker.internal` will be required — to be defined".

The testing strategy in CLAUDE.md mandates a **BFF model**: every NestJS call originates from a Next.js Route Handler (`app/api/.../route.ts`), and Client Components call only same-origin Next.js routes. BFF tests stub `fetch` to NestJS via MSW. This testing architecture has implications for which keys are actually necessary.

This is `Scope: Cross-layer` because: (a) the chosen key set must align with backend CORS configuration (server-side knows which origin to allow); (b) the key set will be consumed by both subprojects' compose files and by every future FE feature that talks to the backend; and (c) the question "browser direct-calls backend or only via BFF?" is the contract between the two layers.

**Options:**

### Option A: Strict BFF — single server-only `API_URL`

One key, server-only: `API_URL`. Only Route Handlers / RSC / Server Actions read it. Client Components call **only** same-origin Next.js routes (`/api/...`). No browser-to-backend traffic; no CORS configuration required on the backend; the backend URL never leaves the server.

- **Pros:** Smallest possible surface — one key, no leak risk, no CORS, no public exposure of the backend URL. Perfectly aligned with the BFF testing strategy already locked in CLAUDE.md (Route Handlers are imported as functions; MSW intercepts the `fetch` they make to NestJS). Single source of truth for backend address. Adding `NEXT_PUBLIC_API_URL` later is non-breaking if a direct-client case appears.
- **Cons:** Every backend call goes through a Next.js Route Handler — extra hop for cases that could theoretically have gone direct (e.g., trivial read-only data). For large payloads (videos, Phase 03+), object storage URLs will need a separate mechanism anyway (presigned URLs from object storage, NOT the backend URL) — so the "videos go direct" case does not argue for `NEXT_PUBLIC_API_URL`.

### Option B: Dual key — `API_URL` (server) + `NEXT_PUBLIC_API_URL` (client)

Two keys. Server reads `API_URL`; browser reads `NEXT_PUBLIC_API_URL`. Mirrors the convention CLAUDE.md currently calls out as "planned" (without prescribed values).

- **Pros:** Matches the convention currently documented in CLAUDE.md. Permits direct browser → backend calls in addition to BFF, useful if a future feature wants to skip the BFF for latency or simplicity reasons. Explicit dual context — the dev/Docker URL ≠ the production URL is encoded in the key naming.
- **Cons:** Adds two keys to keep in sync (Docker dev: client uses `localhost:3000`, server uses `host.docker.internal:3000` or shared-network name; production: both may converge or diverge). Browser knows backend URL → backend MUST configure CORS. Direct browser-to-backend bypasses the BFF model: tests that mock the BFF do not cover those calls; observability fragments. Violates the architectural commitment in CLAUDE.md that the BFF is the single source of truth for backend traffic.

### Option C: Single shared `NEXT_PUBLIC_API_URL` (production-unified hostname)

One key, public, used both server and client. Works only when a reverse proxy / CDN fronts both subprojects on a routable hostname (e.g., production: both behind `api.streamtube.com`). In dev with separate Compose stacks, requires either a uniform hostname routable from both browser and `next-frontend` container (`host.docker.internal`) or a shared compose network.

- **Pros:** One key, one mental model. Trivially compatible with production-behind-reverse-proxy topology.
- **Cons:** Does not work in the current dev setup (separate Compose stacks). Would require infrastructure decisions (shared Compose network OR `host.docker.internal` discipline) that are explicitly marked "to be defined" in CLAUDE.md — taking this option forces those infra decisions now. Same CORS / BFF-bypass concerns as Option B if direct browser calls are made.

**Recommendation:** **Option A (Strict BFF — single server-only `API_URL`)**. Aligned with the BFF testing strategy and architectural commitment already documented in `next-frontend/CLAUDE.md` (Route Handlers as the only NestJS caller; BFF tests stub `fetch` via MSW). Eliminates CORS, eliminates public exposure of the backend URL, and produces the smallest correct foundation. Option B's `NEXT_PUBLIC_API_URL` is a future-proofing concession with no current consumer — and adding a public key later is a non-breaking change, while removing one is breaking. Option C ties a foundational decision to infra work explicitly deferred elsewhere. The Docker networking gap (how server-in-container resolves the backend) is a separate orthogonal decision, surfaced below.

> **Out-of-scope ancillary note (NOT a TD here):** Once Option A is chosen, the concrete _value_ of `API_URL` in dev (`http://host.docker.internal:3000` vs joining the two Compose stacks into a shared network with `http://nestjs-api:3000`) is a Docker-Compose-topology decision that this research does not resolve. It belongs in either Phase 02's pre-work or a dedicated infra ad-hoc TD. The env-key contract (this TD) is intentionally independent of how the value is resolved at runtime.

**Decision:** **A (Strict BFF — single server-only `API_URL`)**

---

## Initial canonical env-key set (informative — consequence of TD-01..TD-03)

The TDs above decide _how_ env is loaded and validated; they do not enumerate every key. The set below is the minimum scaffold that this foundation produces. Phases 02+ extend it via the same schema file.

| Key | Side | Type | Required at | Source of value |
|-----|------|------|-------------|-----------------|
| `NODE_ENV` | server (shared) | enum `development \| production \| test` | always | runtime (test runner / `next dev` / `next start`) |
| `API_URL` | server only | URL | runtime | Docker compose env / deployment config |

`NEXT_PUBLIC_*` is intentionally **empty** at the foundation phase: under TD-03 Option A there is no client-side env-driven value. The first `NEXT_PUBLIC_*` key will appear when a phase introduces a value the browser genuinely needs (e.g., analytics ID, public object-storage CDN host).

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|----------------|--------|
| TD-01 | Frontend | Validation library for env schema | **Zod 4** (TS-first inference, ecosystem alignment, t3-env compatibility) | **A (Zod 4)** |
| TD-02 | Frontend | Server/Client boundary enforcement | **`@t3-oss/env-nextjs`** (type-level prefix + runtime proxy + single-file ergonomics) | **A (@t3-oss/env-nextjs)** |
| TD-03 | Cross-layer | API URL key strategy | **Strict BFF — single server-only `API_URL`** (matches CLAUDE.md BFF model) | **A (Strict BFF — single server-only `API_URL`)** |

---

## Notes for downstream pipeline

- TD-02 **depends on TD-01**: `@t3-oss/env-nextjs` supports Zod and Valibot only. Picking Joi or class-validator in TD-01 forecloses TD-02 Option A and forces Option B or C.
- TD-03's Recommendation explicitly contradicts the planned-conventional naming in `next-frontend/CLAUDE.md` (which mentions `NEXT_PUBLIC_API_URL`). If TD-03 is decided in favor of Option A, `next-frontend/CLAUDE.md` should be updated to remove the planned `NEXT_PUBLIC_API_URL` mention as part of `/plan-build`'s SI scope; if Option B is chosen, CLAUDE.md already aligns.
- This document does NOT decide: (a) the Docker networking topology (how `API_URL`'s value reaches the FE container); (b) the OpenAPI codegen approach (next research: `next-frontend-openapi-typing`); (c) the MSW base (next research: `next-frontend-msw-foundation`). All three are sibling ad-hoc researches identified during `/decide` triage on 2026-05-13.
