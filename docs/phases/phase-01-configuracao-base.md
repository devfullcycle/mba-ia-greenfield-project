# Phase 01 — Configuracao Base do Projeto

## Objective

Set up the remaining project foundation — TypeORM integration with PostgreSQL, migration CLI infrastructure, seed runner, and a centralized configuration system — completing the database and configuration layers of the development environment. The monorepo structure, NestJS project, Docker Compose environment, and AI coding foundation are already in place.

---

## Step Implementations

### SI-01.1 — TypeORM Installation and Migration Infrastructure

**Description:** Install TypeORM with the PostgreSQL driver, configure the NestJS integration, create the CLI data source file, and add migration convenience scripts to package.json.

**Technical actions:**

- Install `@nestjs/typeorm@^11.0.0`, `typeorm@^0.3.x`, and `pg@^8.x` as production dependencies in nestjs-project
- Create `src/database/data-source.ts` exporting a `DataSource` instance for the TypeORM CLI — type `postgres`, connection params from environment variables with defaults matching Docker Compose (`host: localhost, port: 5432, username: streamtube, password: streamtube, database: streamtube`), `synchronize: false`, migrations path pointing to `src/database/migrations/*.ts`
- Configure `TypeOrmModule.forRoot()` in `AppModule` using the same connection parameters as `data-source.ts`, with `autoLoadEntities: true` and `synchronize: false`
- Add TypeORM CLI scripts to `package.json`: base `"typeorm"` script using `typeorm-ts-node-commonjs`, plus convenience scripts `migration:run`, `migration:revert`, `migration:generate`, and `migration:create` — all pointing to `-d src/database/data-source.ts` where applicable

**Tests:**

AppModule is tested implicitly by E2E tests (per testing guide — modules.md §When to skip). The existing `test/app.e2e-spec.ts` will validate that AppModule compiles and connects to PostgreSQL after TypeORM is added. No new test files are required.

**Dependencies:** None

**Acceptance criteria:**

- Application starts without errors and connects to PostgreSQL — `GET /` returns 200 with "Hello World!" (verified by existing E2E test passing with TypeOrmModule in AppModule)
- `npm run migration:run` executes successfully against the database with no pending migrations
- `npm run migration:create -- src/database/migrations/TestMigration` creates a new empty migration file in `src/database/migrations/`

---

### SI-01.2 — Seed Infrastructure

**Description:** Set up a lightweight, custom seed runner that initializes the DataSource, executes seed functions, and closes the connection. No external seeding library — just a ts-node script that future phases will populate with seed data.

**Technical actions:**

- Create `src/database/seeds/seed.ts` — a runner script that imports the DataSource from `data-source.ts`, calls `dataSource.initialize()`, logs completion, and calls `dataSource.destroy()`. The script should support importing and executing seed functions from sibling files when they exist.
- Add `"seed": "ts-node src/database/seeds/seed.ts"` script to `package.json`

**Dependencies:** SI-01.1

**Acceptance criteria:**

- `npm run seed` executes successfully with no errors and exits cleanly (on an empty seed set with no tables)

---

### SI-01.3 — Namespaced Configuration Files and Validation Schema

**Description:** Create the centralized configuration layer using `@nestjs/config` with namespaced `registerAs` factories and a Joi validation schema. This establishes the config files that both the NestJS app and TypeORM CLI will consume.

**Technical actions:**

- Install `@nestjs/config@^4.x` and `joi@^17.x` as production dependencies in nestjs-project
- Create `src/config/database.config.ts` — export default a `registerAs('database', () => ({...}))` factory reading `DB_HOST` (string, default `'localhost'`), `DB_PORT` (parsed to number, default `5432`), `DB_USERNAME` (string, default `'streamtube'`), `DB_PASSWORD` (string, default `'streamtube'`), `DB_NAME` (string, default `'streamtube'`) from `process.env`
- Create `src/config/app.config.ts` — export default a `registerAs('app', () => ({...}))` factory reading `PORT` (parsed to number, default `3000`) and `NODE_ENV` (string, default `'development'`) from `process.env`
- Create `src/config/env.validation.ts` — export a `Joi.object()` schema validating all environment variables: `NODE_ENV` (string, valid: `'development'`, `'production'`, `'test'`, default: `'development'`), `PORT` (number, port, default: `3000`), `DB_HOST` (string, default: `'localhost'`), `DB_PORT` (number, default: `5432`), `DB_USERNAME` (string, required), `DB_PASSWORD` (string, required), `DB_NAME` (string, required)
- Create `.env.example` in `nestjs-project/` root documenting all environment variables with example values matching Docker Compose defaults

**Dependencies:** None

**Acceptance criteria:**

- Each config factory (`databaseConfig`, `appConfig`) is callable as a plain function and returns a typed object with the expected keys and parsed values
- The Joi validation schema rejects startup when a required variable (`DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`) is missing — application fails to bootstrap with a clear validation error message
- `.env.example` documents every environment variable used by the application

---

### SI-01.4 — ConfigModule Integration and process.env Elimination

**Description:** Wire `ConfigModule` into `AppModule`, replace all direct `process.env` access with config injection, and update `data-source.ts` to import the shared `databaseConfig` factory — achieving a single source of truth for database connection parameters.

**Technical actions:**

- Add `ConfigModule.forRoot()` to `AppModule` imports with `isGlobal: true`, `load: [databaseConfig, appConfig]`, `validationSchema` from `env.validation.ts`, and `validationOptions: { allowUnknown: true, abortEarly: false }`
- Replace `TypeOrmModule.forRoot({...})` with `TypeOrmModule.forRootAsync()` using `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, and a `useFactory` receiving `ConfigType<typeof databaseConfig>` to construct TypeORM options (`type: 'postgres'`, `host`, `port`, `username`, `password`, `database`, `autoLoadEntities: true`, `synchronize: false`)
- Update `src/main.ts` — retrieve `ConfigService` via `app.get(ConfigService)`, read PORT from the `'app'` namespace using `configService.get('app.port')`, and pass it to `app.listen()`
- Update `src/database/data-source.ts` — add `import 'dotenv/config'` at the top (loads `.env` before any config access), import `databaseConfig` from `'../config/database.config'`, call the factory to get the config object, and use its values in the `DataSource` constructor (preserving `migrations` and `entities` glob paths)

**Tests:**

AppModule compilation and database connection are verified by the existing E2E test (`test/app.e2e-spec.ts`). The test validates that `ConfigModule.forRoot()` + `TypeOrmModule.forRootAsync()` wiring resolves correctly and the application connects to PostgreSQL. No new test files are required.

**Dependencies:** SI-01.3

**Acceptance criteria:**

- Application starts without errors and connects to PostgreSQL — `GET /` returns 200 with "Hello World!" (existing E2E test passes with the new ConfigModule + TypeOrmModule.forRootAsync wiring)
- No `process.env` access remains in `app.module.ts`, `main.ts`, or `data-source.ts` — all environment variables are read through config factories or `ConfigService`
- `npm run migration:run` still executes successfully (verifies `data-source.ts` loads config correctly via `dotenv/config` + shared factory)
- `npm run seed` still executes successfully (verifies seed runner works with the updated `data-source.ts`)
- Starting the application without required environment variables (`DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`) and without defaults causes a Joi validation error at bootstrap — the app does not start

---

## Dependency Map

```
SI-01.1 (no deps)
├── SI-01.2
└── SI-01.3
    └── SI-01.4
```

## Deliverables

- [ ] TypeORM connected to PostgreSQL (application starts without connection errors)
- [ ] Migration CLI scripts functional (`migration:run`, `migration:revert`, `migration:generate`, `migration:create`)
- [ ] Seed runner functional (`npm run seed` executes and exits cleanly)
- [ ] Centralized configuration system with `@nestjs/config` — no direct `process.env` access in application code
- [ ] Joi validation rejects missing required environment variables at startup
- [ ] `.env.example` documents all environment variables
- [ ] All SI tests pass (`docker compose exec nestjs-api npm test`)
- [ ] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Project builds successfully (`docker compose exec nestjs-api npm run build`)
