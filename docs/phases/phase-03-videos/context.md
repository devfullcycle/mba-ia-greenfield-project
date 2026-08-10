---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-07-12T18:21:39Z"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-12T19:54:34Z"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-07-12T18:21:39Z"
  docs/phases/phase-01-configuracao-base/context.md: "2026-07-12T18:21:39Z"
  docs/phases/phase-02-auth/context.md: "2026-07-12T18:21:39Z"
  docs/phases/phase-02-auth-frontend/context.md: "2026-07-12T18:21:39Z"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-07-12T18:21:38Z"
---

# phase-03-videos — Context

## Scope

**Phase name:** Upload e Processamento de Vídeos

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** _Not specified._

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:**

- `nestjs-project/` — upload, processamento em background (filas), armazenamento de vídeos e thumbnails, URL única por vídeo
- `next-frontend/` — deferred; streaming/download imply frontend work in Phase 05

**Deferred subprojects:** `next-frontend/` — upload and streaming UI deferred to Phase 05.

**Sequencing notes:** Depende de: Fase 01, Fase 02.

**Neighbors (for boundary detection only):**

- **Phase 02:** Fase 02 — Cadastro, Login e Gerenciamento de Conta
- **Phase 04:** Fase 04 — Gerenciamento de Vídeos e Canal (depends on Fase 02, Fase 03)

---

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Message Queue Technology | decided | A (BullMQ + Redis) | — |
| phase-03-videos/TD-02 | phase | Cross-layer | Upload Strategy for 10GB Files | decided | B (S3 Multipart pre-signed part URLs) | — |
| phase-03-videos/TD-03 | phase | Backend | Worker Architecture | decided | A (NestJS ApplicationContext) | — |
| phase-03-videos/TD-04 | phase | Cross-layer | Streaming and Download URL Strategy | decided | A (Pre-signed GET URL) | — |
| phase-03-videos/TD-05 | phase | Backend | Unique Video Slug | decided | C (crypto.randomBytes base64url) | — |
| phase-03-videos/TD-06 | phase | Backend | FFmpeg Integration in Worker | decided | A (fluent-ffmpeg) | — |
| phase-03-videos/TD-07 | phase | Backend | Object Storage SDK | decided | A (@aws-sdk/client-s3 + @aws-sdk/s3-request-presigner) | — |

_Source files:_

- upload-processing — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3])

---

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-07 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-03 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-02 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-03, phase-03-videos/TD-06 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-06 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-05 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-04 |
| Download do vídeo pelo usuário | phase-03-videos/TD-04 |

---

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** `@nestjs/bullmq` is the official, first-class NestJS queue solution. Redis is a minimal addition (single alpine container). The built-in retry/backoff is essential for video processing jobs that can fail due to transient FFmpeg or storage errors. Redis is also a natural fit for future needs (rate limiting, caching). RabbitMQ and SQS introduce disproportionate complexity for a single-consumer job queue.
**Libraries:** —

### phase-03-videos/TD-02

**Recommendation:** The only option that satisfies both "no API performance impact" and "resumable in case of failure." MinIO supports the S3 multipart protocol natively. The added API complexity (uploadId + part ETags) is justified by the explicit project requirement for resumability.
**Libraries:** —

### phase-03-videos/TD-03

**Recommendation:** Code reuse (TypeORM entities/repos, storage service, config namespaces) decisively outweighs the NestJS bootstrap cost. The worker runs continuously as a long-lived process, so cold start time is irrelevant. Code duplication would grow with each schema or config change. The team already knows NestJS patterns.
**Libraries:** —

### phase-03-videos/TD-04

**Recommendation:** The C4 architecture diagram explicitly shows `frontend → storage` for streaming. MinIO implements HTTP 206 range requests natively. The API generates short-lived pre-signed URLs, keeping video traffic entirely out of the API server. This is the only scalable architecture for a video streaming platform.
**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** Zero external dependencies, no ESM/CJS compatibility issues (a real concern given nanoid v4), and 64 bits of entropy is more than sufficient. The UUID option conflates primary key with public slug and produces unnecessarily long URLs. nanoid v3 is outdated; v4's ESM-only nature requires CJS workarounds in this project.
**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** The URL-input support for `ffprobe` is the decisive factor: metadata can be extracted from a MinIO pre-signed URL without downloading the full 10GB video. The maintenance-mode status is not a concern for this scope (metadata extraction + thumbnail generation are stable, fully-exercised code paths). Pair with `@types/fluent-ffmpeg` for TypeScript types and `ffmpeg-static` for the binary in the worker container.
**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** The project explicitly targets both MinIO (dev) and S3 (prod). The AWS SDK means zero code changes when deploying to production — only env vars change (`endpoint` is omitted; `forcePathStyle` is set to false). Adopting the MinIO SDK now would require an SDK migration at production deployment, which adds risk.
**Libraries:** —

---

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.
**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.
**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`.
**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.
**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.
**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.

**Note:** Decision deliberately diverged from the Recommendation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed.
**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs. Keeps email tokens decoupled from the JWT auth system.
**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.
**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.
**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity.
**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient.
**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.

**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes.
**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) Architectural fit. The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority. (2) Smaller blast radius. A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern. (3) Compatibility with Next.js 16 / React 19.
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Defense in depth on the cookie content — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection; the marginal cost is one ~3KB dep. Single cookie to manage simplifies logout and avoids the orphan-cookie failure mode. Room to carry minimal user metadata lets `app/layout.tsx` RSC render the authenticated chrome without a per-render `/auth/me` round-trip.
**Libraries:** `iron-session`

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** (1) Decoupled from TD-05 — works with Route Handlers OR Server Actions. (2) Aligned with shadcn's canonical form primitive — `npx shadcn@latest add form` produces react-hook-form wrappers. (3) Zod-first developer ergonomics match the rest of the FE foundation.
**Libraries:** `react-hook-form`, `@hookform/resolvers`

### phase-02-auth-frontend/TD-05

**Recommendation:** (1) Strict-BFF alignment — Route Handlers as the BFF surface. (2) Test scaffold already exists — `next-frontend-msw-foundation` was authored for Route-Handlers-as-functions. (3) Single mutation surface — Phase 02 sets the precedent for Phases 03–07.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** No first-render flicker, no round-trip — the session is delivered in the same response as the page HTML; the Client Provider hydrates with the correct initial state. No new BFF endpoint — the cookie is the source of truth, RSC reads it, the Provider broadcasts it.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** (1) First-paint-correct — the user sees the right outcome on the first paint, no skeleton, no flicker. (2) Single integration pattern across both flows — confirmation is RSC-only; reset is RSC + Client form. (3) Email-prefetch behavior is solved at the backend's idempotent-confirmation level.
**Libraries:** —

### next-frontend-config-base/TD-01

**Recommendation:** Option A (Zod 4). Type-inference matches the FE's strict-TS culture. Ecosystem gravity in Next.js / React 19 — Zod is the de-facto schema language for App Router. Direct enablement of TD-02 Option A (`@t3-oss/env-nextjs`). Backend parity with Joi is not load-bearing: env schemas are not shared FE↔BE.
**Libraries:** `zod`

### next-frontend-config-base/TD-02

**Recommendation:** Option A (`@t3-oss/env-nextjs`). The only option that combines (i) type-level NEXT_PUBLIC_ prefix enforcement, (ii) runtime Proxy-based leak detection, and (iii) single-file, single-import-path consumer ergonomics.
**Libraries:** `@t3-oss/env-nextjs`

### next-frontend-config-base/TD-03

**Recommendation:** Option A (Strict BFF — single server-only `API_URL`). Aligned with the BFF testing strategy and architectural commitment in `next-frontend/CLAUDE.md`. Eliminates CORS, eliminates public exposure of the backend URL, and produces the smallest correct foundation.
**Libraries:** —

### next-frontend-msw-foundation/TD-01

**Recommendation:** Option B (per-domain modules + barrel). MSW's own best-practice recommends it. Domain ownership tracks the codebase — components, `app/api/`, and feature folders are organized by domain. Append-only growth with minimal merge conflicts.
**Libraries:** —

### next-frontend-msw-foundation/TD-02

**Recommendation:** Option A (test-only, `setupServer` only at the foundation). The browser worker is a future capability with no documented current consumer; wiring it now is speculative investment.
**Libraries:** —

### next-frontend-msw-foundation/TD-03

**Recommendation:** Option D (hand-written defaults as the default + opt-in seeded faker for bulk collections). Option B's determinism + readability is the right baseline — every fixture in Phase 02 is naturally hand-written. Bulk-collection cases will arrive and inline lists of 20+ items are tedious — keeping faker available as a scoped tool is pragmatic.
**Libraries:** —

### next-frontend-msw-foundation/TD-04

**Recommendation:** Option A (universal handler set + `server.use(...)` overrides + `onUnhandledRequest: "error"`). The "import only what it needs" requirement is satisfied at the authoring layer by TD-01 (per-domain files). At the runtime layer, loading all handlers is the canonical MSW v2 model.
**Libraries:** —

### next-frontend-openapi-typing/TD-01

**Recommendation:** Option A (`openapi-typescript` + `openapi-fetch`). Strict BFF makes the SDK surface valueless on the client — only Route Handlers ever call the upstream Nest. Types-first matches the rest of the FE foundation. MSW typing is solved by the same `paths` symbol.
**Libraries:** `openapi-typescript`, `openapi-fetch`

### next-frontend-openapi-typing/TD-02

**Recommendation:** Option B (committed local copy + repo-root sync script). Preserves the compose-stack independence. Drift is eliminated structurally when paired with TD-03's CI freshness check. The committed local file is a real artifact in PR review.
**Libraries:** —

### next-frontend-openapi-typing/TD-03

**Recommendation:** Option C (committed + CI freshness check). The only option that makes contract drift both visible (in PR diffs) and impossible to merge accidentally (CI fail).
**Libraries:** —

### next-frontend-openapi-typing/TD-04

**Recommendation:** Option A (single `lib/api/contracts.ts` with explicit aliases). The only option that (i) handles pass-through and reshape with the same mechanism, (ii) gives a single grep target for "what shape does the BFF expose", and (iii) decouples Component imports from App Router file paths.
**Libraries:** —

### next-frontend-openapi-typing/TD-05

**Recommendation:** Option A (hand-written, typed via `paths`). Determinism over auto-generation — BFF integration tests assert on specific values. Coherence with TD-01 — `openapi-typescript`'s `paths` type is the single contract anchor.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** `@nestjs/swagger` is the only option that preserves the prior `class-validator` decisions (phase-02-auth/TD-06) without re-platforming; the CLI plugin with `classValidatorShim: true` leverages existing `class-validator` decorators to infer schemas.
**Libraries:** `@nestjs/swagger`

### openapi-docs-nestjs/TD-02

**Recommendation:** Both (UI + exported JSON). The marginal cost over UI-only is a single npm script (~15 lines) and the benefit is a correct foundation for future FE integration (offline codegen) without losing the interactive UI that dev/QA use.
**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** Option B (dev/staging only). Aligns with the defensive posture from phase 02 and does not compromise legitimate consumers (the committed `openapi.json` serves the consultable spec role outside the UI). Re-opening as Option A is trivial if a public API use case appears.
**Libraries:** —

---

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: { allowUnknown: true, abortEarly: false } })`. _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for non-DI contexts (e.g., TypeORM CLI). _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options including `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_

---

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). `POST /api/auth/logout` BFF route handler is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | Umbrella bullet — confirmação and reset-password destination screens deferred; the 3 ship-this-phase telas (signup, login, forgot-password) are inventoried. |

---

## Non-UI / Deferred Capabilities

_None._

---

## Testing Requirements

### nestjs-project

| Artifact type | Required layers |
|---|---|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` fields, cascade rules |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (BullMQ, JWT) | Unit: real lib with test config; do NOT mock BullMQ internals |
| Service with side-effect dep (storage, queue publish) | Integration: real MinIO adapter or captured output |
| BullMQ Processor (`*.processor.ts`) | Unit: branch logic (mock storage/DB) + Integration: real queue if available (see `artifacts/future-types.md`) |
| Module with configured imports (`BullModule`, `TypeOrmModule`, etc.) | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (complex logic) | E2E + Unit if complex internal branching |
| Guard (simple, delegates to framework) | E2E only |
| Exception Filter | Unit + E2E |
