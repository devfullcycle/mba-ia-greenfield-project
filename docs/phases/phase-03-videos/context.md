---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-08-18T09:44:18-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-08-21T13:11:33-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-08-18T09:44:18-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-08-18T09:44:18-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-08-18T09:44:18-03:00"
  docs/phases/phase-02-auth/context.md: "2026-08-18T09:44:18-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-08-18T09:44:18-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-08-18T09:44:18-03:00"
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

**Out of scope:** _Not specified._ (per enunciado do curso: a interface de vídeo no `next-frontend` está explicitamente fora do escopo desta fase — é um desafio de backend puro)

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** `nestjs-project/` (todas as 9 capabilities).

**Deferred subprojects:** `next-frontend/` — interface de vídeo fora de escopo por definição do enunciado do curso, não por decisão técnica desta fase.

**Sequencing notes:** Depende de: Fase 01, Fase 02. Upload de arquivos grandes sem travar o sistema, processamento automático do vídeo e geração de URL única.

**Neighbors (for boundary detection only):**

- **Phase 02:** Fase 02 — Cadastro, Login e Gerenciamento de Conta (Depende de: Fase 01)
- **Phase 04:** Fase 04 — Gerenciamento de Vídeos e Canal (Depende de: Fase 02, Fase 03)

## Decisions Index

_(from decisions-reader — one row per TD across phase-scope + ad-hoc docs)_

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Message Queue Technology | decided | A | — |
| phase-03-videos/TD-02 | phase | Backend | Large File Upload Strategy (10GB) | decided | A | — |
| phase-03-videos/TD-03 | phase | Backend | Video Processing & Thumbnail Generation | decided | A | — |
| phase-03-videos/TD-04 | phase | Backend | Video Status Lifecycle & Processing Failure Handling | decided | A | — |
| phase-03-videos/TD-05 | phase | Backend | Unique Video Identifier Strategy | decided | B | — |
| phase-03-videos/TD-06 | phase | Backend | Video Delivery Strategy (Streaming & Download) | decided | A | — |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3])

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-02 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-04 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-03, phase-03-videos/TD-04 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-03 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-05 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-06 |
| Download do vídeo pelo usuário | phase-03-videos/TD-06 |

## Decisions Detail

_(current-phase TDs only — from decisions-detail-reader)_

### phase-03-videos/TD-01

**Recommendation:** é a leitura mais direta do container "Message Queue" do diagrama, tem transporte oficial do NestJS tanto quanto BullMQ (não é mais arriscada nesse quesito), e ganha de graça uma UI administrativa que as outras opções não têm sem dependência adicional. O custo de configuração de AMQP é real, mas proporcional ao valor didático de demonstrar mensageria "de verdade" em vez de uma lib de job queue.
**Libraries:** —

### phase-03-videos/TD-02

**Recommendation:** é a única opção que mantém a API sem estado em relação aos bytes do arquivo, oferecendo retry por chunk numa transferência de 10GB sujeita a conexões instáveis; casa com a relação direta cliente↔storage do diagrama. D é exatamente o antipadrão que os critérios de aceite do enunciado alertam; C introduz um componente fora do diagrama; B não tem resumibilidade na escala de 10GB.
**Libraries:** —

### phase-03-videos/TD-03

**Recommendation:** é a única opção sem uma bandeira vermelha de risco de dependência. `fluent-ffmpeg` está arquivado (desqualificado pelo próprio precedente do projeto de evitar tooling sem manutenção), e `mediaforge` é novo demais para ter histórico. `child_process` é nativo do Node, não uma dependência de terceiros — nada para ficar abandonado. As necessidades do worker (extrair metadados JSON, capturar um frame) são simples o bastante para que uma API fluente agregue pouco sobre duas invocações diretas de CLI.
**Libraries:** —

### phase-03-videos/TD-04

**Recommendation:** falhas transitórias são plausíveis e caras de forçar reupload manual num arquivo de até 10GB; o mecanismo de retry aproveita o que TD-01 já traz, então o custo de implementação marginal é baixo. Option C foi considerada e descartada por não introduzir nenhuma distinção funcional real (discutido e confirmado em conversa prévia com o usuário).
**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** atende diretamente ao ponto de atenção "URL curta" do próprio `project-plan.md` sem abandonar o padrão UUID que o resto do schema já usa; a Option A sozinha não cumpre "curta" apesar de cumprir "única"; a Option C reintroduz vazamento de informação sequencial sem vantagem real sobre o nanoid.
**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** é a única opção consistente com a relação direta ao storage do diagrama de arquitetura, ganha suporte nativo a Range/206 de graça da camada de storage, e preserva a capacidade de controlar acesso por requisição (necessário quando a visibilidade `unlisted` da Fase 04 chegar) — ao contrário do bucket permanentemente público da Option C.
**Libraries:** —

## Inherited Decisions Detail

_(inherited TDs from prior phases + user-confirmed correlated docs, dedupe applied)_

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.
**Libraries:** —

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.
**Libraries:** —

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.
**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.
**Libraries:** —

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.
**Libraries:** —

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier. **Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.
**Libraries:** —

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.
**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.
**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.
**Libraries:** —

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.
**Libraries:** —

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.
**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.
**Libraries:** —

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate. **Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.
**Libraries:** —

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.
**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) **Architectural fit.** The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority. (2) **Smaller blast radius.** A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern. (3) **Compatibility with Next.js 16 / React 19.** Built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use. Option C is rejected as unsafe (`localStorage` for refresh tokens).
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) **Defense in depth on the cookie content** — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection. (2) **Single cookie to manage** simplifies logout. (3) **Room to carry minimal user metadata** (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render authenticated chrome without a per-render `/auth/me` round-trip.
**Libraries:** —

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A. Option C's pre-emptive timer is rejected because the failure modes outweigh the latency saving.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) **Decoupled from TD-05** — works with Route Handlers OR Server Actions. (2) **Aligned with shadcn's canonical form primitive.** (3) **Zod-first developer ergonomics match the rest of the FE foundation** — `next-frontend-config-base/TD-01` chose Zod 4 for env; the same schemas-as-source-of-truth pattern carries to forms.
**Libraries:** —

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) **Strict-BFF alignment** — `next-frontend-config-base/TD-03` named Route Handlers as the BFF surface. (2) **Test scaffold already exists.** (3) **Single mutation surface** — Phase 02 sets the precedent for Phases 03–07.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) **No first-render flicker, no round-trip** — the session is delivered in the same response as the page HTML. (2) **No new BFF endpoint** — the cookie is the source of truth, RSC reads it, the Provider broadcasts it.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) **First-paint-correct.** (2) **Single integration pattern across both flows** — confirmation is RSC-only; reset is RSC + Client form. (3) **Email-prefetch behavior** is solved at the backend's idempotent-confirmation level.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** Option A (`@nestjs/swagger`) — é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo. Nestia tem mérito técnico real mas o custo de migração do stack de validação inviabiliza-a sem uma decisão upstream de supersede de TD-06. Manual authoring é descartado.
**Libraries:** @nestjs/swagger

### openapi-docs-nestjs/TD-02

**Recommendation:** Option C (Ambos) — o custo marginal sobre Option A é apenas um npm script (~15 linhas) e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam. Option B sozinho pune a experiência de desenvolvimento em dev/local; Option A sozinho compromete o pipeline de codegen futuro.
**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** Option B (Apenas em dev/staging) — alinha com a postura defensiva já estabelecida em phase 02 e não compromete consumidores legítimos (o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI"). Re-abrir como Option A ou C é trivial no futuro se um caso de uso de API pública aparecer.
**Libraries:** —

### next-frontend-config-base/TD-01

**Recommendation:** Option A (Zod 4). Three converging reasons: (1) Type-inference matches the FE's strict-TS culture. (2) Ecosystem gravity in Next.js / React 19 — Zod is the de-facto schema language for App Router. (3) Direct enablement of TD-02 Option A (`@t3-oss/env-nextjs`). Backend parity with Joi is not load-bearing: env schemas are not shared FE↔BE.
**Libraries:** zod

### next-frontend-config-base/TD-02

**Recommendation:** Option A (`@t3-oss/env-nextjs`). The only option that combines type-level `NEXT_PUBLIC_` prefix enforcement, runtime Proxy-based leak detection, and single-file consumer ergonomics. Option B reaches roughly the same structural outcome at higher cost with weaker guarantees. Option C is unsafe at any non-trivial team size.
**Libraries:** @t3-oss/env-nextjs

### next-frontend-config-base/TD-03

**Recommendation:** Option A (Strict BFF — single server-only `API_URL`). Aligned with the BFF testing strategy already documented in `next-frontend/CLAUDE.md`. Eliminates CORS, eliminates public exposure of the backend URL. Option B's `NEXT_PUBLIC_API_URL` is a future-proofing concession with no current consumer. Option C ties a foundational decision to infra work explicitly deferred elsewhere.
**Libraries:** —

## Inherited Conventions

_(from phases-reader — compact list)_

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: { allowUnknown: true, abortEarly: false } })`. _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for non-DI contexts (e.g., TypeORM CLI). _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options including `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_

## Inherited Deferred Capabilities

_(from phases-reader — informational-only; plan-validate does NOT fire issues based on unaddressed entries)_

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout`. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both deferred per rows above. |

## Non-UI / Deferred Capabilities

_(empty on first assembly — plan-resolve appends rows as user marks capabilities)_

| Capability | Status | Rationale | TD refs |
|-----------|--------|-----------|---------|
| _None._ | | | |

## Testing Requirements

_(from testing-guide-nestjs-project skill)_

### nestjs-project

| Artifact created | Required tests | Guide |
|---|---|---|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` | `artifacts/entities.md` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract | `artifacts/services.md` |
| Service with DB only (no branching) | Integration: DB contract | `artifacts/services.md` |
| Service with configured lib (JWT, cache) | Unit: real lib with test config | `artifacts/services.md` |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit) or local adapter | `artifacts/services.md` |
| Module with configured imports | Unit: compilation test | `artifacts/modules.md` |
| Controller | E2E only — do NOT write unit tests | `artifacts/controllers.md` |
| DTO | E2E: one validation wiring test per endpoint | `artifacts/dtos.md` |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic | `artifacts/guards.md` |
| Guard (simple, delegates to Passport) | E2E only | `artifacts/guards.md` |
| Strategy (Passport) | E2E via guard | `artifacts/strategies.md` |
| Pipe (custom transformation/validation) | Unit | `artifacts/pipes.md` |
| Interceptor (response transform, logging) | Unit and/or E2E | `artifacts/interceptors.md` |
| Exception Filter | Unit + E2E | `artifacts/filters.md` |
| Middleware | E2E | `artifacts/middleware.md` |

_Note: this phase introduces new artifact categories not yet covered by name in the checklist above (queue producer/consumer, worker process, `child_process` wrapper for FFmpeg, presigned-URL storage client). `implement` should consult `artifacts/future-types.md` and the general principles in §1–2 of the guide (mock at module boundaries; test service-to-external-system contracts with real capture services, not mocks) when these artifacts are built._
