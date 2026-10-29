---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-10-27T22:40:04-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-28T08:40:20-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-28T09:13:49-03:00"
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-10-27T22:40:04-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-27T22:40:04-03:00"
  docs/phases/phase-02-auth/context.md: "2026-10-27T22:40:04-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-10-27T22:40:04-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-27T22:40:04-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

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
**Affected subprojects:** No subprojects explicitly mentioned in project-plan.md (decisions doc: `nestjs-project/` carries nearly every TD; `next-frontend/` only via cross-layer upload protocol TD-02 / TD-12; repo-wide infra via TD-01, TD-04, TD-13).
**Deferred subprojects:** _None._
**Sequencing notes:** Depende de: Fase 01, Fase 02. Intro: "Upload de arquivos grandes sem travar o sistema, processamento automático do vídeo e geração de URL única."

**Neighbors (for boundary detection only):**

- **Phase 02:** Fluxo completo de criação de conta, confirmação por e-mail, login, logout e recuperação de senha.
- **Phase 04:** Gerenciamento de Vídeos e Canal (depends on Fase 02, Fase 03).

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Queue Technology | decided | A | `@nestjs/bullmq`, `bullmq` |
| phase-03-videos/TD-02 | phase | Cross-layer | Large-File Upload Strategy (up to 10GB) | decided | A | — |
| phase-03-videos/TD-03 | phase | Backend | Storage Organization (Buckets and Key Scheme) | decided | A | — |
| phase-03-videos/TD-04 | phase | Backend | Worker Runtime Model | decided | A | — |
| phase-03-videos/TD-05 | phase | Backend | Metadata and Thumbnail Extraction | decided | A | — |
| phase-03-videos/TD-06 | phase | Backend | Job Trigger After Upload | decided | A | — |
| phase-03-videos/TD-07 | phase | Backend | Unique Public Video Identifier | decided | A | — |
| phase-03-videos/TD-08 | phase | Backend | Streaming Delivery | decided | A | — |
| phase-03-videos/TD-09 | phase | Backend | Download Delivery | decided | A | — |
| phase-03-videos/TD-10 | phase | Backend | Video Status Lifecycle and Failure Handling | decided | B | — |
| phase-03-videos/TD-11 | phase | Backend | Authorization for Upload, Stream and Download | decided | A | — |
| phase-03-videos/TD-12 | phase | Cross-layer | Upload Limits and Validation | decided | A | — |
| phase-03-videos/TD-13 | phase | Repo-wide | Object Storage Engine and S3 Client Wiring | decided | A | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3])

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-03, phase-03-videos/TD-13 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-04 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02, phase-03-videos/TD-11, phase-03-videos/TD-12 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-02, phase-03-videos/TD-10 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-04, phase-03-videos/TD-05, phase-03-videos/TD-06, phase-03-videos/TD-10 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-05 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-07 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-08, phase-03-videos/TD-11 |
| Download do vídeo pelo usuário | phase-03-videos/TD-09, phase-03-videos/TD-11 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** BullMQ + Redis — first-class Nest integration with retry/backoff/stalled-job handling out of the box; failed set acts as DLQ. Redis with AOF enabled in compose.
**Libraries:** `@nestjs/bullmq`, `bullmq`

### phase-03-videos/TD-02

**Recommendation:** S3 multipart upload with presigned URLs per part — the only option that satisfies 10GB without proxying bytes; resumable at part granularity. Part sizing and limits in TD-12; signing/public endpoint in TD-13.
**Libraries:** —

### phase-03-videos/TD-03

**Recommendation:** Single bucket, per-video prefix (`videos/{videoId}/original.{ext}`, `videos/{videoId}/thumbnail.jpg`) — thumbnails are served like videos in this phase. Include the abort-incomplete-multipart lifecycle rule (verify support in the chosen engine, TD-13), backed by the application-level cleanup in TD-10.
**Libraries:** —

### phase-03-videos/TD-04

**Recommendation:** Dedicated `video-worker` container, same codebase, standalone Nest entrypoint — what the diagram specifies and the cheap way to keep FFmpeg off the API. Install FFmpeg only in the worker image target.
**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** `ffprobe`/`ffmpeg` via `execFile` reading a presigned URL, frame taken at ~10% of the duration (clamped for very short videos), with automatic fallback to download-to-temp-file if the URL read fails. Thumbnail percentage is a tunable, not a contract.
**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** API publishes the job in an idempotent `complete` — simplest testable path; residual failure mode is recoverable by client retry plus the stale-upload sweeper (TD-10).
**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** Short random id (11 chars, URL-safe) in a separate `UNIQUE` column — stable, short, unguessable; the unique index is the guarantee, the retry loop handles rare collisions. Check `nanoid` ESM/CJS compatibility with the project's build before choosing the library over `crypto`.
**Libraries:** —

### phase-03-videos/TD-08

**Recommendation:** `GET /videos/{id}/stream` → `302` to a presigned GET URL — keeps the API out of the data path; presigned TTL must exceed typical watch time.
**Libraries:** —

### phase-03-videos/TD-09

**Recommendation:** `GET /videos/{id}/download` → `302` to presigned URL with `response-content-disposition`, consistent with TD-08.
**Libraries:** —

### phase-03-videos/TD-10

**Recommendation:** Two orthogonal fields — `processingStatus` (`UPLOADING → PROCESSING → READY | FAILED`) plus publication state (`DRAFT` now, `PUBLISHED` in Phase 04). `FAILED` only after all retries are exhausted; idempotent worker; repeatable sweeper for stuck uploads. Sweeper cadence and retry counts fixed at planning time.
**Libraries:** —

### phase-03-videos/TD-11

**Recommendation:** Authenticated owner uploads; stream/download public by `publicId` for `READY` videos behind a single `VideoAccessPolicy` seam — unguessable-link semantics match the unlisted model; Phase 04 tightens the policy.
**Libraries:** —

### phase-03-videos/TD-12

**Recommendation:** Server-fixed part size, declared-metadata validation at init, object verification at complete, media verification in the worker. Keep the MIME/extension allowlist narrow; surface a clear `failureReason`; transcoding out of this phase.
**Libraries:** —

### phase-03-videos/TD-13

**Recommendation:** SeaweedFS (S3 gateway) in compose with AWS SDK v3, conditional on a short spike validating CORS `ExposeHeaders`, multipart presign, `response-content-disposition`, lifecycle abort and `Range`; fall back to MinIO for dev only if it fails. Env keys: `S3_ENDPOINT` (internal), `S3_PUBLIC_ENDPOINT` (signing), bucket, region, credentials, presign TTLs, validated in Joi and mirrored in `compose.yaml`/`.env.example`.
**Libraries:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`

## Inherited Decisions Detail

_(inherited TDs from prior phases — from phases-reader, plus correlator-confirmed docs; dedupe applied)_

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.
**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.
**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.
**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.
**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.
**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.
**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.
**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.
**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.
**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.
**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.
**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.
**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.
**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.
**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) **Architectural fit.** The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority. (2) **Smaller blast radius.** A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern. (3) **Compatibility with Next.js 16 / React 19.** Built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use. Option C is rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive (loses RSC personalization).
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) **Defense in depth on the cookie content** — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection; the marginal cost is one ~3KB dep. (2) **Single cookie to manage** simplifies logout (one `session.destroy()` call). (3) **Room to carry minimal user metadata** (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render the authenticated chrome without a per-render `/auth/me` round-trip. Option C is rejected: it solves a problem (server-side revocation) the project does not have.
**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A (RSC still needs server-side refresh). Option C's pre-emptive timer is rejected because the failure modes (multiple tabs, sleep/wake) outweigh the latency saving.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) **Decoupled from TD-05** — works with Route Handlers OR Server Actions. (2) **Aligned with shadcn's canonical form primitive** — `npx shadcn@latest add form` produces react-hook-form wrappers. (3) **Zod-first developer ergonomics match the rest of the FE foundation** — `next-frontend-config-base/TD-01` chose Zod 4 for env. Option B is rejected for impedance with shadcn's primitive; Option C for per-field boilerplate.
**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) **Strict-BFF alignment.** `next-frontend-config-base/TD-03` named Route Handlers as the BFF surface; Option A keeps every mutation visible under `app/api/**`. (2) **Test scaffold already exists** — `next-frontend/CLAUDE.md` § Testing and `next-frontend-msw-foundation` were authored for Route-Handlers-as-functions. (3) **Single mutation surface** — Phase 02 sets the precedent for Phases 03–07; uniformity beats per-mutation idiom-picking.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) **No first-render flicker, no round-trip** — the session is delivered in the same response as the page HTML; the Client Provider hydrates with the correct initial state. (2) **No new BFF endpoint** — the cookie is the source of truth, RSC reads it, the Provider broadcasts it. The `router.refresh()` requirement after mid-session mutations is a small price.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) **First-paint-correct** — the user sees the right outcome on the first paint, no skeleton, no flicker. (2) **Single integration pattern across both flows** — "RSC owns the token, Client Component owns the input". (3) **Email-prefetch behavior** is solved at the backend's idempotent-confirmation level. Option B adds redirects for no clean gain; Option C is dominated.
**Libraries:** —

### next-frontend-openapi-typing/TD-01 _(correlator-confirmed)_

**Recommendation:** `openapi-typescript` + `openapi-fetch`. Strict BFF makes the SDK surface valueless on the client — only Route Handlers call the upstream Nest, already via native `fetch`. Types-first matches the rest of the FE foundation (Zod-derived env types, `cva` variants): `paths` is a single `.d.ts` imported wherever the contract is touched. MSW typing is solved by the same `paths` symbol.
**Libraries:** openapi-typescript, openapi-fetch

### next-frontend-openapi-typing/TD-02 _(correlator-confirmed)_

**Recommendation:** Committed local copy at `next-frontend/openapi.json` + repo-root sync script. Preserves compose-stack independence between subprojects; drift is eliminated structurally when paired with TD-03's CI freshness check; the committed file makes the contract change visible in PR review alongside the backend change.
**Libraries:** —

### next-frontend-openapi-typing/TD-03 _(correlator-confirmed)_

**Recommendation:** Committed generated output + CI freshness check covering `openapi.json` and `types.gen.ts`. Only option that makes contract drift both visible in PR diffs and impossible to merge accidentally; cost over the simpler option is one CI step.
**Libraries:** —

### next-frontend-openapi-typing/TD-04 _(correlator-confirmed)_

**Recommendation:** Single `lib/api/contracts.ts` with explicit aliases. Handles pass-through and reshape with the same mechanism, gives one grep target for the BFF-exposed shape, and decouples Component imports from App Router file paths. It is the only file that imports `paths` from `types.gen.ts`; every other consumer imports from `contracts.ts`.
**Libraries:** —

### next-frontend-openapi-typing/TD-05 _(correlator-confirmed)_

**Recommendation:** Hand-written MSW handlers typed via `paths`. Determinism over auto-generation (BFF tests assert on specific values); coherence with TD-01 (spec ↔ handler ↔ assertion is one type chain); negligible manual cost at current endpoint count.
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: { allowUnknown: true, abortEarly: false } })`. _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for non-DI contexts (e.g., TypeORM CLI). _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options including `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_

## Inherited Deferred Capabilities

_(informational-only; plan-validate does NOT fire issues based on unaddressed entries)_

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` so the contract is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen. Documented as a known gap. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | umbrella bullet deferred to the phase that lands the missing confirmation and reset-password destination screens; signup, login and forgot-password shipped. |

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache) | Unit: real lib with test config |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit) or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — no unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (business logic delegated to service) | E2E + Unit if complex internal logic |
| Guard (simple, Passport) | E2E only |
| Strategy (Passport) | E2E via guard |
| Pipe (custom) | Unit |
| Interceptor | Unit and/or E2E |
| Exception Filter | Unit + E2E |
| Middleware | E2E |

### next-frontend

_No testing guide loaded — no frontend-only TD or UI surface in this phase; layer requirements deferred to implementation if the cross-layer upload contract (TD-02 / TD-12) touches it._
