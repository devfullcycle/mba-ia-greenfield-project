---
kind: task
name: task-next-frontend-openapi-typing
sources_mtime:
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-05-13T15:43:57-03:00"
  docs/tasks/task-next-frontend-openapi-typing/library-refs.md: "2026-05-13T15:46:29-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-05-12T16:17:52-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-05-13T15:23:15-03:00"
  docs/phases/phase-02-auth/context.md: "2026-05-12T14:01:10-03:00"
  .claude/skills/testing-guide-next-frontend/SKILL.md: "2026-05-13T10:59:26-03:00"
---

# task-next-frontend-openapi-typing — Context

## Scope

> How next-frontend consumes the openapi.json artifact produced by nestjs-project (openapi-docs-nestjs/TD-02, Option C): how the spec is brought into next-frontend's filesystem boundary under Docker bind-mount isolation, codegen tooling, when codegen runs and whether output is committed, how types are shared between the BFF Route Handlers (upstream → Nest) and the Components layer (browser → same-origin BFF), and how MSW handlers in the BFF integration tests reuse the same schema.

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| next-frontend-openapi-typing/TD-01 | ad-hoc | Frontend | OpenAPI Codegen Tooling | decided | A | openapi-typescript, openapi-fetch |
| next-frontend-openapi-typing/TD-02 | ad-hoc | Frontend | Spec Sourcing Under Docker Bind-Mount Isolation | decided | B | — |
| next-frontend-openapi-typing/TD-03 | ad-hoc | Frontend | Codegen Execution Timing & Output Commit Policy | decided | C | — |
| next-frontend-openapi-typing/TD-04 | ad-hoc | Frontend | Type Sharing Between BFF Layer and Components Layer | decided | A | — |
| next-frontend-openapi-typing/TD-05 | ad-hoc | Frontend | MSW Handler Typing Against the Generated Schema | decided | A | — |

_Source files:_

- next-frontend-openapi-typing — `docs/decisions/technical-decisions-next-frontend-openapi-typing.md` (scope_type: ad-hoc, related_phases: [])

## Decisions Detail

### next-frontend-openapi-typing/TD-01

**Recommendation:** Three reinforcing reasons. (1) **Strict BFF makes the SDK surface valueless on the client.** Only Route Handlers ever call the upstream Nest; they already use `fetch` (Next 16's caching extensions sit on top of native `fetch`); a generated SDK adds a third client style to learn for zero functional gain. (2) **Types-first matches the rest of the FE foundation.** Env validation is Zod-derived types; component variants are `cva` types; both are TS-first with zero generated runtime. `paths` is the natural extension — one `.d.ts` file imported wherever the contract is touched. (3) **MSW typing is solved by the same `paths` symbol.** Hand-written handlers in `mocks/handlers.ts` type their resolver returns off `paths["/videos"]["get"]["responses"][200]`, giving the contract guarantee without orval/kubb's verbose generated handlers (which would be overridden per-test anyway). The marginal cost of adding `openapi-fetch` (~6KB, server-side only) is small enough that we recommend the **types + thin-client** pair, not types alone — `openapi-fetch` removes the `fetch(API_URL + path, { method, headers, body })` boilerplate in each Route Handler while staying within the BFF model. Options B/C/D may be revisited if (a) client-side data-fetching enters the stack with TanStack Query and per-endpoint hooks are wanted, or (b) the API grows beyond ~20 operations and per-call boilerplate becomes painful.

**Libraries:** openapi-typescript, openapi-fetch

### next-frontend-openapi-typing/TD-02

**Recommendation:** Three reasons. (1) **Preserves the compose-stack independence** that `next-frontend-config-base/TD-03` Context calls out as the current architecture — neither subproject's compose file references the other. (2) **Drift is eliminated structurally when paired with TD-03's CI freshness check** — the check runs the sync script and asserts no diff on either `openapi.json` or `types.gen.ts`, so a backend PR that forgets to re-sync fails CI with a clear message. (3) **The committed local file is a real artifact in PR review** — reviewers see the contract change in `next-frontend/openapi.json`'s diff at the same time as the backend change, doubling the visibility (an `openapi.json`-only diff in a feature PR is a red flag for accidental drift). Option A is acceptable as a pre-CI fallback; Option C is rejected because the cross-stack file dependency in `docker-compose.yaml` introduces coupling that the current architecture explicitly avoids, and the "no drift" gain over B is small once TD-03 lands.

**Libraries:** —

### next-frontend-openapi-typing/TD-03

**Recommendation:** It is the only option that makes contract drift _both_ visible (in PR diffs) _and_ impossible to merge accidentally (CI fail). The complexity premium over Option A is one CI step. Option B's "no committed artifacts" purity is poorly paid for in a monorepo where the cross-subproject build coupling becomes a real ergonomic cost, and it wastes the PR visibility that TD-02 Option B's committed `openapi.json` is specifically designed to deliver. Option A is acceptable as a temporary state until the CI pipeline lands; downgrading from C to A is reversible (just remove the CI step) but upgrading to C later requires explaining `types.gen.ts` history in a separate commit. Start at C. Apply the same script-and-check pattern to any future generated artifact (e.g., if `openapi-fetch` is wrapped, the wrapper file is hand-written; the only generated artifact remains `types.gen.ts`).

**Libraries:** —

### next-frontend-openapi-typing/TD-04

**Recommendation:** It is the only option that (i) handles pass-through and reshape with the same mechanism, (ii) gives a single grep target for "what shape does the BFF expose", and (iii) decouples Component imports from App Router file paths (Components import `from "@/lib/api/contracts"`, not `from "@/app/api/videos/route"`). Option B is theoretically minimal but fragile against Next's actual RSC/Client/Route-Handler typing; Option C scatters the contract surface and creates drift opportunities. The "long file" concern is bounded — for the scope of StreamTube, the BFF will likely have <30 contract aliases at peak; sectioning by feature header comments is sufficient. Make `lib/api/contracts.ts` the only file that imports `paths` from `types.gen.ts` (lintable later); every other consumer imports from `contracts.ts`.

**Libraries:** —

### next-frontend-openapi-typing/TD-05

**Recommendation:** Reasons: (1) **Determinism over auto-generation** — BFF integration tests assert on specific values; randomized fixtures are anti-helpful. (2) **Coherence with TD-01 recommendation** — `openapi-typescript`'s `paths` type is the single contract anchor; reusing it in MSW handlers means "spec ↔ handler ↔ assertion" is one type chain. (3) **Scale fit** — Phase 02 introduces few endpoints; the manual cost is negligible at this stage. If the API grows to dozens of endpoints and authoring overhead becomes real, this TD can be superseded with a Kubb-or-hey-api MSW plugin without touching TD-01's `paths` import sites (the generator just produces additional handler files; the existing manual handlers stay valid). Option B locks the project into a heavier TD-01 choice for marginal mock-authoring savings; Option C is Option A with an unnecessary detour.

**Libraries:** —

## Inherited Decisions Detail

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.

**Libraries:** argon2@^0.41.x

### phase-02-auth/TD-02

**Recommendation:** @nestjs/passport — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.

**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.

**Libraries:** @nestjs/jwt@^11.0.0

### phase-02-auth/TD-03

**Recommendation:** Refresh Token Rotation — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.

**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Random Opaque Tokens in DB — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.

**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** @nestjs-modules/mailer — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.

**Libraries:** @nestjs-modules/mailer@^2.x, handlebars@^4.x

### phase-02-auth/TD-06

**Recommendation:** class-validator + class-transformer — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.

**Libraries:** class-validator@^0.14.x, class-transformer@^0.5.x

### phase-02-auth/TD-07

**Recommendation:** Custom Domain Exception Filter — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.

**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** @nestjs/throttler — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.

**Libraries:** @nestjs/throttler@^6.x

### phase-02-auth/TD-09

**Recommendation:** Opaque — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.

**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.

**Libraries:** @nestjs/jwt@^11.0.0

### phase-02-auth/TD-10

**Recommendation:** The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.

**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** @nestjs/swagger — the only option that preserves the prior decisions (class-validator in phase-02-auth/TD-06) without re-platform; the CLI plugin with `classValidatorShim: true` reuses existing `class-validator` decorators to infer schemas, keeping boilerplate low. Nestia has real technical merit but the cost of migrating the validation stack makes it unviable without an upstream supersede of TD-06. Manual authoring discarded.

**Libraries:** @nestjs/swagger

**Revisions:**
- 2026-05-12 — Clarifies that the CLI plugin (`classValidatorShim: true`) covers only DTO schema inference from `class-validator`; documentation of operations, typed responses per status code, error contracts (aligned with the envelope in phase-02-auth/TD-07), and examples require explicit decorators (`@ApiOperation`, `@ApiResponse`, `@ApiBody`, `@ApiParam`, `@ApiQuery`, `@ApiExtraModels`). Rationale: the bootstrap-generated `openapi.json` was too generic — no parameter details, no per-status response schemas, no error contracts — because the installed baseline relied only on auto-introspection. This revision fixes that explicit-decorator enrichment is part of the chosen Option A, not out-of-scope work.

### openapi-docs-nestjs/TD-02

**Recommendation:** Both — the marginal cost over Option A is just one ~15-line npm script and the benefit is a correct foundation for future FE integration (offline codegen) without losing the interactive UI used by dev/QA. Option B alone punishes the development experience in dev/local; Option A alone compromises the future codegen pipeline. Combining is dominant.

### openapi-docs-nestjs/TD-03

**Recommendation:** Only in dev/staging — aligns with the defensive posture already established in phase 02 and does not compromise legitimate consumers (the committed `openapi.json` in TD-02 fulfills the "spec consultable outside the UI" role). Re-opening as Option A or C is trivial in the future if a public-API use case arises.

### next-frontend-config-base/TD-01

**Recommendation:** Zod 4. Three converging reasons: (1) Type-inference matches the FE's strict-TS culture — `lib/env.ts` exports a typed `env` object with no `as` casts, satisfying the project's "Type Safety" working principle. (2) Ecosystem gravity in Next.js / React 19 — Zod is the de-facto schema language for App Router (Server Actions inputs, form resolvers, future contract validation), so introducing it once at the env layer compounds value for forms in Phase 02+. (3) Direct enablement of TD-02 Option A (`@t3-oss/env-nextjs`) — t3-env's first-citizen validator. Backend parity with Joi is not load-bearing: env schemas are not shared FE↔BE (different runtimes, different key sets); two validators across two subprojects is a bounded cost.

**Libraries:** zod

### next-frontend-config-base/TD-02

**Recommendation:** @t3-oss/env-nextjs. The only option that combines (i) type-level NEXT_PUBLIC_ prefix enforcement, (ii) runtime Proxy-based leak detection, and (iii) single-file, single-import-path consumer ergonomics. Option B reaches roughly the same structural outcome at higher implementation and maintenance cost, with a weaker guarantee (no prefix enforcement, no proxy). Option C is unsafe at any non-trivial team size. The marginal cost over B is one ~3KB dep — well-spent for the strongest boundary among the three.

**Libraries:** @t3-oss/env-nextjs

### next-frontend-config-base/TD-03

**Recommendation:** Strict BFF — single server-only `API_URL`. Aligned with the BFF testing strategy and architectural commitment already documented in `next-frontend/CLAUDE.md` (Route Handlers as the only NestJS caller; BFF tests stub `fetch` via MSW). Eliminates CORS, eliminates public exposure of the backend URL, and produces the smallest correct foundation. Option B's `NEXT_PUBLIC_API_URL` is a future-proofing concession with no current consumer — and adding a public key later is a non-breaking change, while removing one is breaking. Option C ties a foundational decision to infra work explicitly deferred elsewhere. The Docker networking gap (how server-in-container resolves the backend) is a separate orthogonal decision, surfaced below.

**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 02)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: { allowUnknown: true, abortEarly: false } })`. _(from phase 02)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for non-DI contexts (e.g., TypeORM CLI). _(from phase 02)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 02)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and `data-source.ts`. _(from phase 02)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options including `autoLoadEntities: true`, `synchronize: false`. _(from phase 02)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |

## UI Inventory

_Frontend-runtime only — no screen inventory needed for this phase.
Run /screen-inventory <arg> if a UI surface is added in a future revision._

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### next-frontend

| Artifact created | Required tests |
|---|---|
| **Page** — sync RSC, no interaction (e.g., static marketing page) | None at component level; cover only if part of a critical flow → `*.e2e-spec.ts` |
| **Page** — sync RSC composing client children | Test the client children directly; cover the rendered page via `*.e2e-spec.ts` |
| **Page** — async RSC (`async function Page()` with `await fetch`) | `*.e2e-spec.ts` only — Vitest cannot render it |
| **Layout** (`layout.tsx`) | None unless it adds logic (auth gate, conditional rendering); else covered via E2E |
| **Client component** (`"use client"`) with state/handlers | `*.test.ts` — render with RTL, mock `next/navigation` and `fetch` |
| **Feature component** (server, composes primitives, presentational) | Skip unit; cover via the page's E2E |
| **shadcn UI primitive** (`components/ui/*`) | None — trust the library; cover via consumers |
| **Icon** (`components/icons/*`) | None |
| **`lib/` utility** with branching | `*.test.ts` |
| **Custom hook** (`hooks/*`) | `*.test.ts` with `renderHook` from `@testing-library/react` |
| **Route handler** (`app/api/**/route.ts`) with branching | `*.test.ts` (pure logic) and/or `*.integration.test.ts` with MSW |
| **Route handler** (simple proxy to NestJS) | `*.integration.test.ts` with MSW only |
| **Server action** | `*.integration.test.ts` with MSW; E2E for the submit flow |
| **Middleware / error / loading / not-found / metadata** | See guide — depends on type |

_Source: `.claude/skills/testing-guide-next-frontend/SKILL.md` §3 Feature Implementation Checklist._

_Task-specific note: the artifacts produced by this task (`openapi.json` copy, `lib/api/types.gen.ts`, `lib/api/contracts.ts`, repo-root sync script, npm script) are configuration / generated / pure-type artifacts with no runtime branching — none of the checklist rows applies directly. The freshness check (TD-03 Option C) is a CI step verifiable by running the pipeline locally and asserting clean `git diff`. Future BFF route handlers that consume the generated types will fall under "Route handler" rows above._
