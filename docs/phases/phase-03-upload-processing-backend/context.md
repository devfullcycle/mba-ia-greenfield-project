---
kind: phase
name: phase-03-upload-processing-backend
sources_mtime:
  docs/project-plan.md: "2026-11-28T00:17:07-03:00"
  docs/decisions/technical-decisions-phase-03-upload-processing-backend.md: "2026-11-28T02:32:09-03:00"
  docs/decisions/technical-decisions-backend-nest12-runtime-test-runner.md: "2026-11-28T02:27:13-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-11-28T00:17:07-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-11-28T00:17:07-03:00"
  docs/phases/phase-02-auth/context.md: "2026-11-28T00:17:07-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-11-28T00:17:07-03:00"
  docs/phases/phase-03-upload-processing-backend/library-refs.md: "2026-11-28T02:41:20-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-11-28T00:17:07-03:00"
---

# phase-03-upload-processing-backend — Context

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
**Affected subprojects:** No subprojects are explicitly mentioned for this phase in project-plan.md.
**Deferred subprojects:** _None._
**Sequencing notes:** Depende de: Fase 01, Fase 02. Summary line: "Upload de arquivos grandes sem travar o sistema, processamento automático do vídeo e geração de URL única."

**Neighbors (for boundary detection only):**

- **Phase 02:** Fluxo completo de criação de conta, confirmação por e-mail, login, logout e recuperação de senha.
- **Phase 04:** Edição das informações do vídeo, fluxo de rascunho e publicação, painel de administração do canal e página pública.

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-upload-processing-backend/TD-01 | phase | Repo-wide | Object storage e ambiente local | decided | A (MinIO no compose, via API S3) | @aws-sdk/client-s3 |
| phase-03-upload-processing-backend/TD-02 | phase | Cross-layer | Protocolo de upload de até 10GB — contract e handshake FE↔BE | decided | A (Presigned S3 multipart direto ao storage) | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner |
| phase-03-upload-processing-backend/TD-03 | phase | Backend | Fila de jobs de processamento | decided | A (BullMQ + Redis via @nestjs/bullmq) | @nestjs/bullmq, bullmq |
| phase-03-upload-processing-backend/TD-04 | phase | Backend | Topologia do worker | decided | A (mesmo codebase, 2º entrypoint em container próprio) | — |
| phase-03-upload-processing-backend/TD-05 | phase | Backend | Extração de metadados e thumbnail | decided | A (child_process.spawn direto com ffprobe/ffmpeg) | — |
| phase-03-upload-processing-backend/TD-06 | phase | Cross-layer | Entrega de streaming e download — contract de URLs | decided | A (presigned GET + HTTP Range direto do storage) | @aws-sdk/s3-request-presigner |
| phase-03-upload-processing-backend/TD-07 | phase | Backend | Modelo de dados e ciclo de vida do vídeo | decided | A (tabela videos com status enum) | — |
| phase-03-upload-processing-backend/TD-08 | phase | Cross-layer | Identificador público único da URL — contract do id | decided | B (id curto aleatório com unique index) | nanoid |
| phase-03-upload-processing-backend/TD-09 | phase | Cross-layer | Gatilho de conclusão do upload — contract do complete | decided | A (endpoint explícito complete) | — |
| phase-03-upload-processing-backend/TD-10 | phase | Backend | Limites, validação e limpeza | decided | A (validação em camadas, com job de limpeza da Option B) | — |
| phase-03-upload-processing-backend/TD-11 | phase | Backend | Estratégia de testes (storage, fila e ffmpeg) | decided | C (híbrido) | — |
| phase-03-upload-processing-backend/TD-12 | phase | Backend | Baseline de dependências do backend (defasagem e vulnerabilidades) | decided | B (Option A + migração para Nest 12 na própria fase) | @nestjs/core@^12, @nestjs/common@^12, @nestjs/platform-express@^12, @nestjs/testing@^12, @nestjs/cli@^12, @nestjs-modules/mailer@^4, typescript@^6 |
|     └─ Last revision: 2026-11-28 — As libs companheiras (`@nestjs/config`, `@nestjs/jwt`, `@nestjs/throttler`, `@ne… | | | | | | |
| backend-nest12-runtime-test-runner/TD-01 | ad-hoc | Repo-wide | Baseline de Node do projeto (imagem, engines e tipos) | decided | A (Node 24 LTS, a partir de 24.15) | @types/node@^24 |
| backend-nest12-runtime-test-runner/TD-02 | ad-hoc | Backend | Test runner do backend sob o Nest 12 (Jest ou Vitest) | decided | A (manter Jest 30 com ts-jest atualizado, sobre Node 24.9+) | jest@^30, ts-jest, @types/jest |

_Source files:_

- phase-03-upload-processing-backend — `docs/decisions/technical-decisions-phase-03-upload-processing-backend.md` (scope_type: phase, related_phases: [3])
- backend-nest12-runtime-test-runner — `docs/decisions/technical-decisions-backend-nest12-runtime-test-runner.md` (scope_type: ad-hoc, related_phases: [3])

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-upload-processing-backend/TD-01, TD-11, TD-12, backend-nest12-runtime-test-runner/TD-01, TD-02 |
| Serviço de processamento em segundo plano (filas) | phase-03-upload-processing-backend/TD-03, TD-04, TD-11, TD-12, backend-nest12-runtime-test-runner/TD-01, TD-02 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-upload-processing-backend/TD-02, TD-10 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-upload-processing-backend/TD-07 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-upload-processing-backend/TD-05, TD-09, TD-11, TD-12, backend-nest12-runtime-test-runner/TD-01, TD-02 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-upload-processing-backend/TD-05 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-upload-processing-backend/TD-08 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-upload-processing-backend/TD-06 |
| Download do vídeo pelo usuário | phase-03-upload-processing-backend/TD-06 |

## Decisions Detail

### phase-03-upload-processing-backend/TD-01

**Recommendation:** MinIO via API S3 — um contrato S3 serve em dev e produção e o diagrama já prevê "S3 or MinIO". Fica registrada a ressalva de lifecycle no TD-10.
**Libraries:** `@aws-sdk/client-s3`

### phase-03-upload-processing-backend/TD-02

**Recommendation:** presigned multipart — mantém a API fora do caminho dos 10GB e dá retomada por parte, usando só o SDK S3 já necessário pelo TD-01. O contrato (endpoints `init`, `part-urls` e `complete` e o shape das respostas) entra no `openapi.json`. Option C é a alternativa se a simplicidade do cliente pesar mais que manter a API fora do caminho dos dados.
**Libraries:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`

### phase-03-upload-processing-backend/TD-03

**Recommendation:** _sem recomendação forte_ — as duas primeiras são equivalentes para este volume. Inclino a **Option A (BullMQ)** pela integração Nest mais madura, se o custo de um Redis no compose for aceitável. Escolha **Option B (pg-boss)** se a prioridade for zero infra nova. A decisão é de preferência de equipe.
**Libraries:** `@nestjs/bullmq`, `bullmq`

### phase-03-upload-processing-backend/TD-04

**Recommendation:** isola CPU/ffmpeg da API sem duplicar entities nem config, e bate com o container "Video Worker" do diagrama.
**Libraries:** —

### phase-03-upload-processing-backend/TD-05

**Recommendation:** **Option A (`spawn` direto)**, com o frame a ~10% da duração, aproveitando a duração que o ffprobe já retorna. Evita uma dependência arquivada e mantém o controle de timeout.
**Libraries:** —

### phase-03-upload-processing-backend/TD-06

**Recommendation:** presigned GET + Range — mantém a API fora do caminho dos bytes e `Content-Disposition` cobre o download. HLS fica fora de escopo. Se o remux `+faststart` for necessário, ele entra no TD-05 como passo do worker.
**Libraries:** `@aws-sdk/s3-request-presigner`

### phase-03-upload-processing-backend/TD-07

**Recommendation:** **Option A (tabela `videos` + status enum)**, com as transições validadas no service. Os valores do enum são o contrato lido pelo frontend e entram no `openapi.json`. Visibilidade e publicação ficam para a Fase 04.
**Libraries:** —

### phase-03-upload-processing-backend/TD-08

**Recommendation:** id curto separado da PK — gerado no pré-cadastro, com unique index, e estável mesmo se o título mudar. O slug puro não serve porque o título não existe no início do upload. O shape do campo `publicId` entra no contrato da API.
**Libraries:** `nanoid`

### phase-03-upload-processing-backend/TD-09

**Recommendation:** endpoint `complete` — a API verifica o objeto antes de enfileirar, sem infra adicional. Os uploads órfãos são tratados no TD-10.
**Libraries:** —

### phase-03-upload-processing-backend/TD-10

**Recommendation:** **Option A, com o job de limpeza da Option B como parte dela** — sem validação o limite de 10GB não existe com presigned upload, e a limpeza precisa de job próprio porque o MinIO não suporta o lifecycle de abort. Em produção com S3 real, a regra de lifecycle pode substituir o job.
**Libraries:** —

### phase-03-upload-processing-backend/TD-11

**Recommendation:** híbrido — segue a política atual (integration real, unit com mock) e cobre os pontos onde o mock esconderia bugs, como a assinatura de presigned URL com host público.
**Libraries:** —

### phase-03-upload-processing-backend/TD-12

**Recommendation:** **Option A**, executada como tarefa própria (branch `bugfix/` ou `feature/` a partir de `dev`) **antes** de qualquer lib nova da fase, com `npm audit` e a suíte completa verdes como critério. A migração para o Nest 12 fica como decisão separada (`/research` próprio), porque exige Node ≥24.9 e TS 6 e não é pré-requisito de nenhum bullet da fase. Se você preferir fazer a Option B, a ordem natural é B antes de TD-03.
**Libraries:** `@nestjs/core@^12`, `@nestjs/common@^12`, `@nestjs/platform-express@^12`, `@nestjs/testing@^12`, `@nestjs/cli@^12`, `@nestjs-modules/mailer@^4`, `typescript@^6`

**Revisions:**
- 2026-11-28 — A Decision B (Option A + migração para Nest 12 na própria fase) prevalece sobre a Recommendation acima, que sugeria a Option A e deixava o Nest 12 como decisão separada; a migração é executada antes de TD-03 e TD-08, depois de definidos o Node e o test runner em `backend-nest12-runtime-test-runner/TD-01` e `TD-02`. Rationale: priorizar zerar vulnerabilidades e defasagem de major já nesta fase.
- 2026-11-28 — As libs companheiras (`@nestjs/config`, `@nestjs/jwt`, `@nestjs/throttler`, `@nestjs/swagger`, `@nestjs/typeorm`, `joi` e `@nestjs-modules/mailer`) seguem as versões que o `nest upgrade` fixar, e substituem as majors citadas nos TDs herdados das Fases 01 e 02 (mailer ^2.x, joi ^17.x, config ^4.x, jwt ^11, throttler ^6.x). Rationale: o `nest upgrade` move todos os pacotes `@nestjs/*` para a mesma major de uma só vez.

### backend-nest12-runtime-test-runner/TD-01

**Recommendation:** é o menor passo seguro: satisfaz os pisos do Nest 12 e do Jest, tem suporte até 2028 e não depende de o ecossistema ter alcançado a linha 26. A Option B é a candidata natural se, na instalação, o `argon2` e as demais dependências nativas já tiverem suporte confirmado.
**Libraries:** `@types/node@^24`

### backend-nest12-runtime-test-runner/TD-02

**Recommendation:** o app continua CommonJS, que é o caso em que o Nest 12 mantém o Jest, e o custo de migração (26 specs mais a documentação) só se justifica se o Jest realmente falhar. Se aparecer `ERR_REQUIRE_ASYNC_MODULE` ou se o TD-01 optar pelo Node 22 (Option C), a Option B passa a ser obrigatória. Essa decisão pode ser revertida depois com custo conhecido.
**Libraries:** `jest@^30`, `ts-jest`, `@types/jest`

## Inherited Decisions Detail

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

**Recommendation:** Three reasons. (1) **Architectural fit.** The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority — Auth.js's value (DB adapters, OAuth providers, magic-link, `getServerSession` helpers) is mostly unused in this configuration. (2) **Smaller blast radius.** A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern; a misconfigured Auth.js callback is a longer fault-isolation loop. (3) **Compatibility with Next.js 16 / React 19.** Built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use; Auth.js v5 versions track Next.js majors with a lag, adding compatibility risk that Option A does not have. Option C is rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive (loses RSC personalization).
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) **Defense in depth on the cookie content** — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection; the marginal cost is one ~3KB dep. (2) **Single cookie to manage** simplifies logout (one `session.destroy()` call) and avoids the orphan-cookie failure mode of Option A. (3) **Room to carry minimal user metadata** (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render the authenticated chrome (avatar, channel name) without a per-render `/auth/me` round-trip — Phase 04+ gains compound here. Option A is a viable downgrade if the team rejects `iron-session` for any reason; the migration A→B (or B→A) is a one-Route-Handler refactor with no test changes downstream because the BFF interface is unchanged. Option C is rejected: it solves a problem (server-side revocation) the project does not have at the cost of infrastructure the project does not own.
**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A (RSC still needs server-side refresh) — adopting B means doing both. Option C's pre-emptive timer is rejected because the failure modes (multiple tabs, sleep/wake) outweigh the latency saving and force a `"use client"` shell near the root.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) **Decoupled from TD-05** — works with Route Handlers OR Server Actions; the form code does not change if TD-05 is revisited later. (2) **Aligned with shadcn's canonical form primitive** — the project already commits to `radix-nova` shadcn (`components.json`); `npx shadcn@latest add form` produces react-hook-form wrappers; choosing react-hook-form means using the supported primitive instead of hand-rolling around it. (3) **Zod-first developer ergonomics match the rest of the FE foundation** — `next-frontend-config-base/TD-01` chose Zod 4 for env; the same schemas-as-source-of-truth pattern carries to forms with zero new validator paradigm. Option B is rejected for impedance with shadcn's primitive and for over-investing in progressive-enhancement that the strict-BFF model does not require. Option C is rejected for the per-field boilerplate and the loss of client-side feedback on a project that values quick, type-safe form iteration.
**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) **Strict-BFF alignment.** `next-frontend-config-base/TD-03` named Route Handlers as the BFF surface; Option A keeps every mutation visible under `app/api/**`. (2) **Test scaffold already exists** — `next-frontend/CLAUDE.md` § Testing and `next-frontend-msw-foundation` were authored for Route-Handlers-as-functions; Option A reuses them with zero invention. (3) **Single mutation surface** — Phase 02 sets the precedent for Phases 03–07; uniformity beats per-mutation idiom-picking when the cost of inconsistency compounds (Option C). Option B has real ergonomic appeal for the simplest forms but fragments the BFF surface and forces test-pattern reinvention; if the team later wants progressive enhancement for specific forms, the migration A→B is per-form and doesn't require touching unrelated routes — A is the safer default and the cheaper baseline.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) **No first-render flicker, no round-trip** — the session is delivered in the same response as the page HTML; the Client Provider hydrates with the correct initial state; users never see "Login" briefly turn into their avatar. (2) **No new BFF endpoint** — the cookie is the source of truth, RSC reads it, the Provider broadcasts it; the BFF surface stays minimal. The `router.refresh()` requirement after mid-session mutations is a small price (one line in the relevant mutation handler) for the structural benefits. Option B is rejected for the double-read-and-flicker; Option C is dominated by Option B and rejected.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) **First-paint-correct** — the user sees the right outcome on the first paint, no skeleton, no flicker. (2) **Single integration pattern across both flows** — confirmation is RSC-only; reset is RSC + Client form (TD-04, TD-05 patterns reused) — both share the "RSC owns the token, Client Component owns the input" split. (3) **Email-prefetch behavior** is solved at the backend's idempotent-confirmation level (a small note for `/plan-build` to confirm; not a separate TD). Option B's Route-Handler-as-link-target adds redirects for no clean gain. Option C is dominated.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** Option A (`@nestjs/swagger`) — the only option that preserves the earlier decisions (`class-validator` in phase-02-auth/TD-06) without a re-platform. The CLI plugin with `classValidatorShim: true` reuses the existing `class-validator` decorators to infer schemas, keeping boilerplate low.

**Libraries:** @nestjs/swagger

### openapi-docs-nestjs/TD-02

**Recommendation:** Option C (both) — runtime Swagger UI plus an exported `openapi.json`. The marginal cost over Option A is one npm script, and it gives a correct foundation for future FE offline codegen while keeping the interactive UI for dev/QA.

**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** Option B (only in dev/staging via env flag) — consistent with the defensive posture set in phase 02. The committed `openapi.json` from TD-02 serves as the spec readable outside the UI.

**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: {...}...` _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function... _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options includ... _(from phase 01)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` (BFF route handler + `session.destroy()`) so the contract is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen via `/screen-inventory` extension run. Documented as a known gap. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | a tela de confirmação da conta não será implementada nesta fase corrente, será adiada — the umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both are deferred per Non-UI rows above. The 3 ship-this-phase telas (signup, login, forgot-password) are inventoried and covered by their own verbs; the umbrella bullet itself is deferred to the phase that lands the missing screens. |

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
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic |
| Guard (simple, delegates to Passport) | E2E only |
| Strategy (Passport) | E2E via guard |
| Pipe (custom transformation/validation) | Unit |
| Interceptor (response transform, logging) | Unit and/or E2E |
| Exception Filter | Unit + E2E |
| Middleware | E2E |
