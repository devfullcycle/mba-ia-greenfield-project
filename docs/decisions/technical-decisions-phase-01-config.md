# Technical Decisions — Phase 01: Configuration System

> **Phase:** 01 — Configuração Base do Projeto (Configuration Extension)
> **Status:** Decided
> **Date:** 2026-04-06

---

## TD-01: Configuration Module Approach

**Context:** The application reads environment variables via `process.env` with inline fallback defaults in three files (`app.module.ts`, `data-source.ts`, `main.ts`). There is no centralized configuration layer. As the project grows (auth, email, S3, queues), a structured configuration system is needed. The choice must account for the TypeORM CLI constraint: `data-source.ts` runs outside the NestJS DI context.

**Options:**

### Option A: @nestjs/config (official NestJS package)

Built on `dotenv` and `dotenv-expand`. Provides `ConfigModule.forRoot()` for global registration, `ConfigService` for DI injection, `registerAs()` for namespaced config factories, and `forRootAsync` patterns for other modules. Loads `.env` files automatically.

- **Pros:** Official NestJS package — maintained by the core team, guaranteed NestJS 11 compatibility. First-class DI integration via `ConfigService`. Supports namespaced configs via `registerAs()`. Built-in `.env` file loading. Supports both Joi and class-validator validation. `isGlobal: true` eliminates per-module imports.
- **Cons:** Adds one dependency. `ConfigService.get()` returns `string | undefined` by default — requires `infer: true` or manual typing. Config factories registered with `registerAs()` can still be imported as plain functions outside DI (important for `data-source.ts`).

### Option B: Custom config module (plain TypeScript + manual dotenv)

Plain TypeScript files that call `dotenv.config()` and export typed config objects. Wrap in a NestJS module manually using custom providers.

- **Pros:** Zero additional dependencies. Full control over loading logic. Plain functions are trivially importable from `data-source.ts`.
- **Cons:** Must manually replicate what `@nestjs/config` provides: `.env` loading, validation integration, global module registration, `forRootAsync` patterns. Diverges from NestJS ecosystem conventions. No `registerAs()` token injection. Re-inventing a solved problem.

### Option C: Third-party package (e.g., nest-typed-config)

Alternative config packages from the community.

- **Pros:** Some offer stronger typing than `@nestjs/config` out of the box.
- **Cons:** Small community (10-50x less downloads). Risk of abandonment. NestJS 11 compatibility not guaranteed.

**Recommendation:** **Option A (@nestjs/config)** — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.

**Decision:** **A (@nestjs/config)**

---

## TD-02: Environment Variable Validation Strategy

**Context:** Environment variables are untyped strings. Missing or malformed values cause runtime errors that surface late. Validation at startup guarantees fail-fast behavior with clear error messages.

**Options:**

### Option A: Joi

Schema-based validation. Officially documented in `@nestjs/config` via the `validationSchema` option in `ConfigModule.forRoot()`. Defines schemas with a chained fluent API.

- **Pros:** First-class support in `@nestjs/config` — just pass `validationSchema` to `forRoot()`, no custom `validate` function needed. Mature (~9M weekly downloads). Rich validation API with string-to-number coercion. `abortEarly: false` gives all errors at once.
- **Cons:** Adds a dependency (`joi`, ~250KB). Schema defined separately from TypeScript type — no automatic type inference. Fluent API style differs from decorator-based patterns used elsewhere in NestJS.

### Option B: class-validator + class-transformer

Decorator-based validation, also documented in `@nestjs/config`. Define a class with `@IsString()`, `@IsNumber()` decorators, use `plainToInstance()` + `validateSync()` in a custom `validate` function.

- **Pros:** Same validation library used for NestJS DTOs — one paradigm. The class serves as both schema and TypeScript type. Will be installed anyway for Phase 02 (request DTOs).
- **Cons:** Requires a custom `validate` function (not built into `ConfigModule.forRoot`). `@Transform()` needed for string-to-number coercion. The validated class lives inside NestJS context; `data-source.ts` (TypeORM CLI) cannot use it for validation.

### Option C: Zod

TypeScript-first schema validation. Defines schemas and infers TypeScript types: `const schema = z.object({ DB_PORT: z.coerce.number() }); type Config = z.infer<typeof schema>`.

- **Pros:** Types inferred from schema — single source of truth. `z.coerce.number()` handles string-to-number cleanly. Schema is a plain value — can be imported by `data-source.ts`. Lightweight (~15KB).
- **Cons:** Not documented in official `@nestjs/config` docs — requires custom `validate` function. Introduces a third validation paradigm alongside class-validator (DTOs) and TypeORM decorators. New dependency not otherwise needed.

**Recommendation:** **Option A (Joi)** — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.

**Decision:** **A (Joi)**

---

## TD-03: Configuration Organization

**Context:** Currently 6 environment variables (5 DB + 1 PORT). Phase 02 adds JWT secrets and email SMTP. Future phases add S3, queue config, etc. The structure must scale.

**Options:**

### Option A: Flat config — single file, single namespace

All variables in one config file returning a flat object: `{ dbHost, dbPort, jwtSecret, smtpHost, ... }`.

- **Pros:** Simple to start — one file, one place to look.
- **Cons:** File grows unbounded as config domains multiply. No clear ownership boundary. Cannot selectively inject only the config a service needs. Violates single-responsibility as the project grows.

### Option B: Namespaced/grouped config with registerAs

Separate config file per domain: `src/config/database.config.ts`, `src/config/app.config.ts`, and later `auth.config.ts`, `mail.config.ts`, `storage.config.ts`. Each uses `registerAs('namespace', () => ({...}))`. Injected via `@Inject(databaseConfig.KEY)`.

- **Pros:** Each domain's config is isolated — clear ownership, small files. `registerAs()` provides typed injection token via `ConfigType<typeof databaseConfig>`. Modules only import the config they need. Scales naturally. The factory function is also a plain callable — `data-source.ts` can import and call it directly.
- **Cons:** More files upfront (though each is small). Developers must know the `@Inject(config.KEY)` + `ConfigType<>` pattern.

### Option C: Hybrid — single file with nested objects, no registerAs

One config file returning a nested object. Access via `configService.get('database.host')`.

- **Pros:** Logical grouping without multiple files.
- **Cons:** `configService.get('database.host')` is stringly-typed — no compile-time safety. Single file still grows. Cannot use typed injection tokens. Misses the main benefit of `@nestjs/config`'s namespacing system.

**Recommendation:** **Option B (Namespaced/grouped with registerAs)** — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`.

Initial files for Phase 01:
- `src/config/database.config.ts` — DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_NAME
- `src/config/app.config.ts` — PORT, NODE_ENV

**Decision:** **B (Namespaced with registerAs)**

---

## TD-04: Sharing Config Between NestJS App and TypeORM CLI

**Context:** Database config is duplicated between `app.module.ts` (NestJS runtime) and `data-source.ts` (TypeORM CLI for migrations). TypeORM CLI runs outside NestJS DI — it cannot use `ConfigService`. Both must use identical connection parameters.

**Options:**

### Option A: Shared registerAs factory — importable by both

`src/config/database.config.ts` uses `registerAs('database', () => ({ host, port, ... }))`. The return value is a callable function. `data-source.ts` imports it, calls `dotenv.config()` for `.env` loading, then calls the factory to get the config object. NestJS loads it via `ConfigModule.forRoot({ load: [databaseConfig] })`.

- **Pros:** True single source of truth — one function, two consumers. `registerAs()` naturally supports this. No duplication of variable names, defaults, or parsing logic.
- **Cons:** `data-source.ts` must explicitly call `dotenv.config()` — a one-line addition.

### Option B: Separate shared helper function

A plain helper function `getDatabaseConfig()` in a separate file. Both the `registerAs` factory and `data-source.ts` call this helper.

- **Pros:** Clear separation: helper is "pure" (no NestJS dependency).
- **Cons:** Extra indirection — three files instead of two. The `registerAs()` factory is already callable as a plain function, making the helper redundant.

### Option C: Constants file with env var names only

A constants file exports `{ DB_HOST: 'DB_HOST', ... }`. Both consumers independently read `process.env[constant]`.

- **Pros:** Variable names are centralized — no typo risk.
- **Cons:** Parsing logic and defaults still duplicated. Only centralizes string keys. Adds ceremony without meaningful deduplication.

**Recommendation:** **Option A (Shared registerAs factory)** — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.

```
src/config/database.config.ts  →  registerAs('database', () => ({ host, port, ... }))
                                         |                          |
                                    NestJS loads via           data-source.ts imports
                                    ConfigModule.forRoot()     and calls directly
```

**Decision:** **A (Shared registerAs factory)**

---

## Decisions Summary

| ID | Decision | Recommendation | Choice |
|----|----------|---------------|--------|
| TD-01 | Configuration Module Approach | @nestjs/config (official) | **A (@nestjs/config)** |
| TD-02 | Env Variable Validation Strategy | Joi | **A (Joi)** |
| TD-03 | Configuration Organization | Namespaced with registerAs | **B (Namespaced with registerAs)** |
| TD-04 | Sharing Config: NestJS ↔ TypeORM CLI | Shared registerAs factory | **A (Shared registerAs factory)** |

---

## New Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@nestjs/config` | `^4.x` | Configuration module (official) |
| `joi` | `^17.x` | Env variable validation schema |
| `dotenv` | (transitive via @nestjs/config) | `.env` loading for TypeORM CLI |

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/config/database.config.ts` | Create | Database config with `registerAs('database', ...)` |
| `src/config/app.config.ts` | Create | App config with `registerAs('app', ...)` for PORT, NODE_ENV |
| `src/config/env.validation.ts` | Create | Joi validation schema for all env vars |
| `src/app.module.ts` | Modify | Add ConfigModule.forRoot, replace TypeOrmModule.forRoot with forRootAsync |
| `src/main.ts` | Modify | Use ConfigService for PORT |
| `src/database/data-source.ts` | Modify | Import databaseConfig factory, call dotenv.config() |
| `.env.example` | Create | Document all env vars with example values |