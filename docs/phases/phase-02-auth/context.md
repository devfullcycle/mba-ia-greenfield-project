---
kind: phase
name: phase-02-auth
sources_mtime:
  docs/project-plan.md: "2026-04-08T14:58:57-03:00"
  docs/decisions/technical-decisions-phase-02-auth.md: "2026-05-12T12:23:19-03:00"
  docs/decisions/technical-decisions-phase-01-configuracao-base.md: "2026-05-12T12:21:12-03:00"
  docs/phases/phase-01-configuracao-base/phase-01-configuracao-base.md: "2026-04-08T14:58:57-03:00"
---

# phase-02-auth — Context

## Scope

**Phase name:** Fase 02 — Cadastro, Login e Gerenciamento de Conta

**Capabilities**

- Serviço de envio de e-mails transacionais
- Cadastro de usuário com e-mail e senha
- Criação automática do canal do usuário a partir do prefixo do e-mail
- Confirmação de conta via e-mail com link de ativação
- Login e controle de sessão do usuário
- Logout
- Recuperação de senha: solicitação via e-mail → link com token → redefinição
- Telas de cadastro, login, confirmação de conta e recuperação de senha

**Out of scope:** Upload de vídeos, processamento, comments e demais funcionalidades de fases posteriores.

**Deliverables:** fluxo completo de cadastro → confirmação → login → recuperação de senha funcionando. Canal criado automaticamente para cada usuário.

**Affected subprojects:** `nestjs-project/`

**Deferred subprojects:** `next-frontend/` — telas de cadastro/login/confirmação/recuperação ficam diferidas para uma fase futura ao iniciar o subprojeto frontend.

**Sequencing notes:** Depends on Fase 01 — Configuração Base do Projeto.

**Neighbors (for boundary detection only):** Fase 01 (prior), Fase 03 — Upload e Processamento de Vídeos (next).

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-02-auth/TD-01 | technical-decisions-phase-02-auth.md | Backend | Password Hashing Algorithm | decided | B (Argon2id) | argon2@^0.41.x |
| phase-02-auth/TD-02 | technical-decisions-phase-02-auth.md | Backend | Auth Library Approach | decided | B (Custom guards with @nestjs/jwt only) | @nestjs/jwt@^11.0.0 |
| phase-02-auth/TD-03 | technical-decisions-phase-02-auth.md | Backend | Refresh Token Strategy | decided | A (Refresh Token Rotation) | — |
| phase-02-auth/TD-04 | technical-decisions-phase-02-auth.md | Backend | Email Confirmation & Password Reset Tokens | decided | B (Random Opaque Tokens in Database) | — |
| phase-02-auth/TD-05 | technical-decisions-phase-02-auth.md | Backend | Email Sending Infrastructure | decided | A (@nestjs-modules/mailer) | @nestjs-modules/mailer@^2.x, handlebars@^4.x |
| phase-02-auth/TD-06 | technical-decisions-phase-02-auth.md | Backend | Request Validation Library | decided | A (class-validator + class-transformer) | class-validator@^0.14.x, class-transformer@^0.5.x |
| phase-02-auth/TD-07 | technical-decisions-phase-02-auth.md | Cross-layer | Error Response Standardization | decided | A (Custom Domain Exception Filter) | — |
| phase-02-auth/TD-08 | technical-decisions-phase-02-auth.md | Backend | Rate Limiting Strategy | decided | A (@nestjs/throttler) | @nestjs/throttler@^6.x |
| phase-02-auth/TD-09 | technical-decisions-phase-02-auth.md | Backend | Refresh Token Format | decided | A (JWT) | @nestjs/jwt@^11.0.0 |
| phase-02-auth/TD-10 | technical-decisions-phase-02-auth.md | Backend | Nickname Generation from Email Prefix | decided | A (`[a-z0-9_]` + `user_<random>` fallback) | — |

_Source files:_

- `docs/decisions/technical-decisions-phase-02-auth.md`

## Capability Coverage

| Capability | Covered by |
|------------|------------|
| Serviço de envio de e-mails transacionais | phase-02-auth/TD-05 |
| Cadastro de usuário com e-mail e senha | phase-02-auth/TD-01, phase-02-auth/TD-06, phase-02-auth/TD-07 |
| Criação automática do canal do usuário a partir do prefixo do e-mail | phase-02-auth/TD-10 |
| Confirmação de conta via e-mail com link de ativação | phase-02-auth/TD-04 |
| Login e controle de sessão do usuário | phase-02-auth/TD-02, phase-02-auth/TD-03, phase-02-auth/TD-06, phase-02-auth/TD-07, phase-02-auth/TD-08, phase-02-auth/TD-09 |
| Logout | _Inherited from TD-02 (auth library) and TD-03 (refresh-token rotation) — revocation reuses the same session infrastructure; no separate TD._ |
| Recuperação de senha: solicitação via e-mail → link com token → redefinição | phase-02-auth/TD-04, phase-02-auth/TD-06, phase-02-auth/TD-07 |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | _Deferred — `next-frontend/` not initialized in this phase._ |

## Decisions Detail

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

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, zero custom wiring, native string-to-number coercion.

**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — Clear file boundaries per domain, typed injection via `ConfigType<typeof xxxConfig>`, natural scalability. The `registerAs()` factory is dual-purpose: DI token + plain importable function.

**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — `data-source.ts` imports the factory, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.

**Libraries:** `dotenv` (transitive via `@nestjs/config`)

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: { allowUnknown: true, abortEarly: false } })`. _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for non-DI contexts (e.g., TypeORM CLI). _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options including `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_

## Inherited Deferred Capabilities

_No inherited deferred capabilities._

## Non-UI / Deferred Capabilities

| Capability | Status | Rationale | TD refs |
|------------|--------|-----------|---------|
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. | — |

## Testing Requirements

Refer to the `testing-guide-nestjs-project` Skill for layer requirements per artifact type in `nestjs-project/`. Phase 02 introduces the first HTTP endpoints, DTOs, guards, exception filters, and domain services — each layer is exercised by unit, integration, and E2E tests per the testing guide's pyramid. Specific layer coverage by SI is recorded in `progress.md`.
