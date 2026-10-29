---
kind: task
name: task-next-frontend-msw-foundation
sources_mtime:
  docs/decisions/technical-decisions-next-frontend-msw-foundation.md: "2026-05-13T20:06:42-03:00"
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-05-13T19:51:13-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-05-13T15:23:15-03:00"
  docs/phases/phase-02-auth/context.md: "2026-05-12T14:01:10-03:00"
  .claude/skills/testing-guide-next-frontend/SKILL.md: "2026-05-13T10:59:26-03:00"
---

# task-next-frontend-msw-foundation — Context

## Scope

> MSW (Mock Service Worker) foundation for next-frontend: handler module organization across domains/phases, separation between Node test handlers (msw/node) and browser dev handlers (msw/browser Service Worker), response builder/factory strategy (with or without faker-js), and how each phase exposes its handler set to that phase's tests.

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| next-frontend-msw-foundation/TD-01 | ad-hoc | Frontend | Handler Module Organization & Phase Expansion Model | decided | B | — |
| next-frontend-msw-foundation/TD-02 | ad-hoc | Frontend | Node Test Handlers vs. Browser Dev Handlers (setupServer / setupWorker) | decided | A | — |
| next-frontend-msw-foundation/TD-03 | ad-hoc | Frontend | Response Builders / Factory Pattern (with or without faker-js) | decided | D | — |
| next-frontend-msw-foundation/TD-04 | ad-hoc | Frontend | How Each Phase's Tests Consume the Handler Set | decided | A | — |

_Source files:_

- next-frontend-msw-foundation — `docs/decisions/technical-decisions-next-frontend-msw-foundation.md` (scope_type: ad-hoc, related_phases: [])

## Decisions Detail

### next-frontend-msw-foundation/TD-01

**Recommendation:** Three reasons. (1) MSW's own best-practice recommends it — the project should not invent its own scheme when the official one is documented and matches the codebase's domain orientation. (2) Domain ownership tracks the codebase, not the project plan — `components/`, `app/api/`, and any future feature folders will be organized by domain (auth, videos, channels), so handler files mirror that vocabulary and remain stable as phases come and go. (3) Append-only growth with minimal merge conflicts — each phase touches a new file plus one line in the barrel, which is the smallest practical concurrent-PR footprint. Option A is acceptable through Phase 02 alone (~5–7 endpoints) but accumulates costs that B avoids from day one; bootstrapping directly into B costs one extra file and one barrel and pays off by Phase 03. Option C's phase coupling is rejected outright — domain-by-phase is a category error.
**Libraries:** —

### next-frontend-msw-foundation/TD-02

**Recommendation:** The browser worker is a future capability with no documented current consumer; wiring it now (Option B) is speculative investment, and wiring it incoherently (Option C) actively misleads developers into thinking interception works when it doesn't under strict BFF. Option A keeps the foundation minimal, aligns 1:1 with everything CLAUDE.md and the existing rules currently document, and is non-breaking to extend.
**Libraries:** —

### next-frontend-msw-foundation/TD-03

**Recommendation:** Reasons: (1) Option B's determinism + readability is the right baseline — every fixture in Phase 02 (5–7 endpoints, single-record-mostly) is naturally hand-written, and the diff-revealing override pattern is the highest-value benefit. (2) Bulk-collection cases will arrive (Phase 07 home page grid, Phase 06 comment threads) and inline hand-written lists of 20+ items are genuinely tedious — keeping faker available as a scoped tool is pragmatic. (3) Per-fixture local seeding eliminates the global-cursor pitfall that makes Option C structurally fragile — using `faker.seed(N)` immediately before a collection-builder run scopes the determinism to that fixture and isolates it from upstream changes to other factories.
**Libraries:** —

### next-frontend-msw-foundation/TD-04

**Recommendation:** The user's "import only what it needs" requirement is satisfied at the *authoring* layer by TD-01 (per-domain files; each phase adds one file). At the *runtime* layer, loading all handlers is the canonical MSW v2 model and imposes no cost on tests that don't fetch the extra URLs. `onUnhandledRequest: "error"` enforces that a phase's test cannot accidentally invoke a route outside its scope (the fetch fails loudly with "no handler matched"), which is the strongest version of "stays inside its phase" available. Option B's per-suite composition pays real boilerplate cost for an explicitness gain that TD-01 already provides at a different layer. Option C invents a Vitest-projects-shaped problem for a phase-shaped concern.
**Libraries:** —

## Inherited Decisions Detail

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.
**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** @nestjs/passport — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.
**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Refresh Token Rotation — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.
**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Random Opaque Tokens in DB — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.
**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** @nestjs-modules/mailer — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.
**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** class-validator + class-transformer — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.
**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Custom Domain Exception Filter — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.
**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** @nestjs/throttler — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.
**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Opaque — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.
**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Strict `[a-z0-9_]` allowlist — The platform is a video sharing service with URL-based channel handles. A strict allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.
**Libraries:** —

### next-frontend-openapi-typing/TD-01

**Recommendation:** `openapi-typescript` + `openapi-fetch`. Three reinforcing reasons. (1) Strict BFF makes the SDK surface valueless on the client. Only Route Handlers ever call the upstream Nest; they already use `fetch` (Next 16's caching extensions sit on top of native `fetch`); a generated SDK adds a third client style to learn for zero functional gain. (2) Types-first matches the rest of the FE foundation. Env validation is Zod-derived types; component variants are `cva` types; both are TS-first with zero generated runtime. `paths` is the natural extension — one `.d.ts` file imported wherever the contract is touched. (3) MSW typing is solved by the same `paths` symbol. Hand-written handlers in `mocks/handlers.ts` type their resolver returns off `paths["/videos"]["get"]["responses"][200]`, giving the contract guarantee without orval/kubb's verbose generated handlers (which would be overridden per-test anyway). The marginal cost of adding `openapi-fetch` (~6KB, server-side only) is small enough that the recommendation is the types + thin-client pair, not types alone — `openapi-fetch` removes the `fetch(API_URL + path, { method, headers, body })` boilerplate in each Route Handler while staying within the BFF model.
**Libraries:** openapi-typescript, openapi-fetch

### next-frontend-openapi-typing/TD-02

**Recommendation:** Committed local copy at `next-frontend/openapi.json` + repo-root sync script. Three reasons. (1) Preserves the compose-stack independence that `next-frontend-config-base/TD-03` Context calls out as the current architecture — neither subproject's compose file references the other. (2) Drift is eliminated structurally when paired with TD-03's CI freshness check — the check runs the sync script and asserts no diff on either `openapi.json` or `types.gen.ts`, so a backend PR that forgets to re-sync fails CI with a clear message. (3) The committed local file is a real artifact in PR review — reviewers see the contract change in `next-frontend/openapi.json`'s diff at the same time as the backend change, doubling the visibility (an `openapi.json`-only diff in a feature PR is a red flag for accidental drift). Option A is acceptable as a pre-CI fallback; Option C is rejected because the cross-stack file dependency in `docker-compose.yaml` introduces coupling that the current architecture explicitly avoids.
**Libraries:** —

### next-frontend-openapi-typing/TD-03

**Recommendation:** Committed + CI freshness check. It is the only option that makes contract drift both visible (in PR diffs) and impossible to merge accidentally (CI fail). The complexity premium over Option A is one CI step. Option B's "no committed artifacts" purity is poorly paid for in a monorepo where the cross-subproject build coupling becomes a real ergonomic cost, and it wastes the PR visibility that TD-02 Option B's committed `openapi.json` is specifically designed to deliver. Start at C. Apply the same script-and-check pattern to any future generated artifact (e.g., if `openapi-fetch` is wrapped, the wrapper file is hand-written; the only generated artifact remains `types.gen.ts`).
**Libraries:** —

### next-frontend-openapi-typing/TD-04

**Recommendation:** Single `lib/api/contracts.ts` with explicit aliases. It is the only option that (i) handles pass-through and reshape with the same mechanism, (ii) gives a single grep target for "what shape does the BFF expose", and (iii) decouples Component imports from App Router file paths (Components import from `@/lib/api/contracts`, not from `@/app/api/videos/route`). Option B is theoretically minimal but fragile against Next's actual RSC/Client/Route-Handler typing; Option C scatters the contract surface and creates drift opportunities. The "long file" concern is bounded — for the scope of StreamTube, the BFF will likely have <30 contract aliases at peak; sectioning by feature header comments is sufficient. Make `lib/api/contracts.ts` the only file that imports `paths` from `types.gen.ts`; every other consumer imports from `contracts.ts`.
**Libraries:** —

### next-frontend-openapi-typing/TD-05

**Recommendation:** Hand-written MSW handlers, typed via `paths`. Reasons: (1) Determinism over auto-generation — BFF integration tests assert on specific values; randomized fixtures are anti-helpful. (2) Coherence with TD-01 recommendation — `openapi-typescript`'s `paths` type is the single contract anchor; reusing it in MSW handlers means "spec ↔ handler ↔ assertion" is one type chain. (3) Scale fit — Phase 02 introduces few endpoints; the manual cost is negligible at this stage. If the API grows to dozens of endpoints and authoring overhead becomes real, this TD can be superseded with a Kubb-or-hey-api MSW plugin without touching TD-01's `paths` import sites. Option B locks the project into a heavier TD-01 choice for marginal mock-authoring savings; Option C is Option A with an unnecessary detour.
**Libraries:** —

### next-frontend-config-base/TD-01

**Recommendation:** Zod 4. Three converging reasons: (1) Type-inference matches the FE's strict-TS culture — `lib/env.ts` exports a typed `env` object with no `as` casts, satisfying the project's "Type Safety" working principle. (2) Ecosystem gravity in Next.js / React 19 — Zod is the de-facto schema language for App Router (Server Actions inputs, form resolvers, future contract validation), so introducing it once at the env layer compounds value for forms in Phase 02+. (3) Direct enablement of TD-02 Option A (`@t3-oss/env-nextjs`) — t3-env's first-citizen validator. Backend parity with Joi is not load-bearing: env schemas are not shared FE↔BE (different runtimes, different key sets); two validators across two subprojects is a bounded cost.
**Libraries:** zod

### next-frontend-config-base/TD-02

**Recommendation:** `@t3-oss/env-nextjs`. The only option that combines (i) type-level NEXT_PUBLIC_ prefix enforcement, (ii) runtime Proxy-based leak detection, and (iii) single-file, single-import-path consumer ergonomics. Option B reaches roughly the same structural outcome at higher implementation and maintenance cost, with a weaker guarantee (no prefix enforcement, no proxy). Option C is unsafe at any non-trivial team size. The marginal cost over B is one ~3KB dep — well-spent for the strongest boundary among the three.
**Libraries:** @t3-oss/env-nextjs

### next-frontend-config-base/TD-03

**Recommendation:** Strict BFF — single server-only `API_URL`. Aligned with the BFF testing strategy and architectural commitment already documented in `next-frontend/CLAUDE.md` (Route Handlers as the only NestJS caller; BFF tests stub `fetch` via MSW). Eliminates CORS, eliminates public exposure of the backend URL, and produces the smallest correct foundation. Option B's `NEXT_PUBLIC_API_URL` is a future-proofing concession with no current consumer — and adding a public key later is a non-breaking change, while removing one is breaking. Option C ties a foundational decision to infra work explicitly deferred elsewhere.
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: { allowUnknown: true, abortEarly: false } })`. _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for non-DI contexts (e.g., TypeORM CLI). _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options including `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_

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

This task creates test infrastructure (the MSW foundation itself) rather than a directly-testable artifact. The checklist below identifies the artifact types that **consume** this foundation in subsequent SIs / phases — every row whose `Required tests` mention MSW depends on the structure decided in this task.

| Artifact type | Required layers |
|---------------|-----------------|
| Page — async RSC (`async function Page()` with `await fetch`) | `*.e2e-spec.ts` only — Vitest cannot render it (consumer of MSW indirectly via the running BFF) |
| Page — sync RSC composing client children | Test the client children directly; cover the rendered page via `*.e2e-spec.ts` |
| Client component (`"use client"`) with state/handlers | `*.test.ts` — render with RTL, mock `next/navigation` and `fetch` |
| `lib/` utility with branching | `*.test.ts` |
| Custom hook (`hooks/*`) | `*.test.ts` with `renderHook` from `@testing-library/react` |
| Route handler (`app/api/**/route.ts`) with branching | `*.test.ts` (pure logic) **and/or** `*.integration.test.ts` with MSW — primary consumer of this foundation |
| Route handler (simple proxy to NestJS) | `*.integration.test.ts` with MSW only — primary consumer of this foundation |
| Server action | `*.integration.test.ts` with MSW; E2E for the submit flow |
| Middleware / error / loading / not-found / metadata | See guide — depends on type |
| Pure shadcn UI primitive (`components/ui/*`) | None — trust the library; cover via consumers |
| Icon (`components/icons/*`) | None |
| Feature component (server, presentational) | Skip unit; cover via the page's E2E |

**Foundation-specific build gates** (apply to this task's own SIs, not to its consumers):

- `npx tsc --noEmit` must pass after `mocks/server.ts`, `mocks/setup.ts`, and any seed `mocks/handlers/` files are added — the `paths`-anchored fixture typing chain (`next-frontend-openapi-typing/TD-05`) must remain green.
- `npm run lint` must pass on the new `mocks/` tree.
- `npm test` (Vitest, once `test` script is added per CLAUDE.md § "Status — bootstrap pending") must run **zero** suites and exit clean — bootstrap is correct when the runner starts up, loads `setupFiles`, registers MSW, and finds no tests to run.
- A smoke `*.integration.test.ts` is **out of scope** of this foundation task: real handler/test pairs arrive with Phase 02 (auth endpoints — first concrete consumer per the correlator's medium-ranked phase-02-auth doc).

**Anti-patterns enforced by this foundation** (verbatim from `testing-guide-next-frontend` § 5):

- ❌ Open a real network connection to `nestjs-api` from Vitest — every fetch from a route handler under test must be intercepted by `msw/node`.
- ❌ Mock `fetch` with `vi.mock`/`vi.fn` in BFF tests — use MSW. A raw `fetch` mock hides URL/method/header mistakes that MSW would catch via "request unhandled" errors.
- ❌ Forget `server.listen()` / `server.resetHandlers()` / `server.close()` in Vitest `setupFiles` — leaks handlers between tests and causes flakiness. (Resolved structurally by the canonical `mocks/setup.ts` shape implied by `next-frontend-msw-foundation/TD-04` Option A's recommendation.)
- ❌ Hardcode the NestJS base URL inside tests — read it from the same env var the BFF uses (`API_URL`) so MSW handlers and code stay in sync.
