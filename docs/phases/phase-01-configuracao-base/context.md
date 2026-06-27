---
kind: phase
name: phase-01-configuracao-base
sources_mtime:
  docs/project-plan.md: "2026-04-08T14:58:57-03:00"
  docs/decisions/technical-decisions-phase-01-configuracao-base.md: "2026-05-12T12:21:12-03:00"
---

# phase-01-configuracao-base — Context

## Scope

**Phase name:** Fase 01 — Configuração Base do Projeto

**Capabilities**

- Repositório com estrutura de monorepo (frontend e backend)
- Projeto Next.js (frontend) (será criado depois, não agora) e Nest.js (backend) inicializados
- Ambiente de desenvolvimento local com todos os serviços via Docker Compose
- Estrutura inicial do banco de dados PostgreSQL (schema, migrations e seeds) (sem tabelas ainda)
- Fundação de IA para coding.

**Out of scope:** All runtime features that depend on entities (auth, uploads, comments, etc.) — they start in Phase 02+.

**Deliverables:** ambiente de desenvolvimento funcional, banco de dados configurado.

**Affected subprojects:** `nestjs-project/`

**Deferred subprojects:** `next-frontend/` — not initialized in this phase.

**Sequencing notes:** This is the first phase; no prior phase to depend on.

**Neighbors (for boundary detection only):** Fase 02 — Cadastro, Login e Gerenciamento de Conta.

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-01-configuracao-base/TD-01 | technical-decisions-phase-01-configuracao-base.md | Backend | Configuration Module Approach | decided | A (@nestjs/config) | @nestjs/config@^4.x |
| phase-01-configuracao-base/TD-02 | technical-decisions-phase-01-configuracao-base.md | Backend | Environment Variable Validation Strategy | decided | A (Joi) | joi@^17.x |
| phase-01-configuracao-base/TD-03 | technical-decisions-phase-01-configuracao-base.md | Backend | Configuration Organization | decided | B (Namespaced with registerAs) | — |
| phase-01-configuracao-base/TD-04 | technical-decisions-phase-01-configuracao-base.md | Backend | Sharing Config Between NestJS App and TypeORM CLI | decided | A (Shared registerAs factory) | dotenv (transitive) |

_Source files:_

- `docs/decisions/technical-decisions-phase-01-configuracao-base.md`

## Capability Coverage

| Capability | Covered by |
|------------|------------|
| Repositório com estrutura de monorepo (frontend e backend) | _Not covered by a TD — pre-existing repo structure; no open technical decision._ |
| Projeto Next.js (frontend) (será criado depois, não agora) e Nest.js (backend) inicializados | phase-01-configuracao-base/TD-01, phase-01-configuracao-base/TD-03 |
| Ambiente de desenvolvimento local com todos os serviços via Docker Compose | phase-01-configuracao-base/TD-02, phase-01-configuracao-base/TD-03 |
| Estrutura inicial do banco de dados PostgreSQL (schema, migrations e seeds) (sem tabelas ainda) | phase-01-configuracao-base/TD-04 |
| Fundação de IA para coding. | _Not covered by a TD — handled by CLAUDE.md, Claude skills, and editor configuration; no open technical decision._ |

## Decisions Detail

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

## Inherited Decisions Detail

_No inherited TD details._

## Inherited Conventions

_No inherited conventions — this is the first phase._

## Inherited Deferred Capabilities

_No inherited deferred capabilities._

## Non-UI / Deferred Capabilities

| Capability | Status | Rationale | TD refs |
|------------|--------|-----------|---------|
| Telas de frontend | deferred | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. | — |

## Testing Requirements

Refer to the `testing-guide-nestjs-project` Skill for layer requirements per artifact type in `nestjs-project/`. Phase 01 produces no application-layer code that warrants new unit tests; AppModule wiring and DataSource bootstrap are validated by the existing E2E test (`test/app.e2e-spec.ts`).
