---
name: testing-guide-nestjs-project
description: >
  Testing guide for nestjs-project. Reference this skill when planning features,
  implementing code, creating tests, or reviewing changes in nestjs-project.
  Covers what to test, at which layer, and how to set up each test —
  organized by artifact type.
  Triggers on: planning nestjs-project features, implementing nestjs-project features,
  writing tests for nestjs-project, reviewing nestjs-project code, reviewing nestjs-project tests,
  what should I test in nestjs-project, how to test nestjs-project, nestjs-project test guide.
---

## 0. Purpose

This guide helps you decide **what to test**, at **which layer**, and **how to set up tests** for each type of artifact in `nestjs-project`. When working on a specific artifact type, read the corresponding guide in `artifacts/` for the complete recipe. Supporting references (mock strategies, file conventions, gotchas) are in `references/`.

Artifact types covered: entities, services, controllers, modules, DTOs, guards, strategies, pipes, interceptors, filters, middleware. For anticipated types not yet in the project, see `artifacts/future-types.md`.

## 1. Testability Foundations

NestJS's DI container makes testing natural — `Test.createTestingModule()` lets you replace any provider with a mock via `useValue`, `useFactory`, or `useClass`. This is why unit tests mock at service boundaries rather than patching internal methods.

**Why module compilation tests matter:** TypeScript catches type errors at compile time, but NestJS resolves dependencies at *runtime* via the DI container. A missing `imports` entry, a wrong provider token, or a forgotten `exports` array causes a runtime crash that TypeScript cannot catch. Module compilation tests (`Test.createTestingModule({ imports: [MyModule] }).compile()`) are the only way to catch DI wiring errors before production.

**Mock boundary principle in NestJS terms:** Mock across module boundaries, not within. If `AuthService` depends on `UsersService`, mock `UsersService` in `AuthService`'s unit test — `UsersService` has its own tests. But use *real* `JwtModule` with test config because it's a configured library — mocking `JwtService.sign()` returning `'fake-token'` never catches a wrong secret, bad expiration, or malformed payload.

**Why integration tests aren't redundant with E2E:** E2E tests prove the HTTP contract (status codes, validation wiring, response shape). Integration tests prove the *database contract* (correct queries, constraint enforcement, transaction behavior). A service that builds a wrong `WHERE` clause will pass E2E tests with mocked repositories but fail in production. Both layers are required; neither substitutes the other.

**Configured dependency contracts:** When you configure a framework module (`JwtModule.register()`, `ThrottlerModule.forRoot()`, `CacheModule.register()`), that configuration is a contract. The library's tests verify its internals — they cannot verify YOUR config values. Test configured libs with real instances and test-appropriate config.

**NestJS 11 + Jest 30 + ts-jest 29:** The project uses NestJS 11 with Jest 30 and ts-jest 29.2.5. Jest 30 introduces ESM-first defaults — ensure `ts-jest` transform is configured in both unit and E2E jest configs. The `@nestjs/testing` module version 11 provides `Test.createTestingModule()` with full DI support. Note that `overrideProvider()` in the test module builder is the idiomatic way to replace providers without modifying module imports.

## 2. Testing Criteria

### Worth testing

- Services with branching logic (e.g., conditional flows for registration, login, password reset)
- Entity constraints and defaults — unique indexes, `select: false` fields, `@CreateDateColumn` behavior, cascade rules
- Service-to-database contracts — repository queries, TypeORM relation loading, transaction boundaries
- Service-to-external-system contracts — local storage uploads, SMTP sends via Mailpit, queue publishing
- Module DI wiring — every module with configured imports (`TypeOrmModule.forFeature()`, `JwtModule.register()`, `BullModule.registerQueue()`)
- Guard authorization logic — role checks, ownership verification, token validation flows
- Exception filter error mapping — domain exceptions to HTTP responses
- Controller HTTP contracts — status codes, validation rejection, auth enforcement, response shape
- DTO validation wiring — one E2E test per endpoint proving `ValidationPipe` is active
- Security boundaries — authentication flows (JWT), rate limiting, input sanitization
- Race conditions — concurrent video uploads, duplicate likes/subscriptions, optimistic locking

### NOT worth testing

- Controllers in isolation (unit tests) — they are thin delegation; test via E2E only
- Validation decorator behavior (e.g., does `@IsEmail()` reject invalid emails?) — trust `class-validator`; one wiring test per endpoint is enough
- Framework routing — trust NestJS `@Get()`, `@Post()` decorators work
- TypeORM persistence mechanics — trust that `repository.save()` persists; test YOUR queries and constraints
- Mirror tests — assertions that copy the implementation's return value
- Static entity field existence — if a column exists in the entity, TypeORM will map it
- Single-path service methods with no branching and no system boundary (e.g., `getHello()`)
- Guard/pipe/filter behavior that is pure delegation to a framework feature (e.g., `AuthGuard('jwt')` with no custom logic)

## 3. Feature Implementation Checklist

When implementing a new feature, use this checklist to ensure all artifacts have appropriate test coverage:

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

**How to use:** After implementing a feature, walk through each row. For each artifact you created or modified, read the corresponding guide and verify the tests exist.

## 4. Artifact Type Testing Guide

When creating or modifying an artifact, read the corresponding guide for the complete recipe.

| Artifact Type | Pattern | Test Layer(s) | Guide |
|---|---|---|---|
| Entities | `*.entity.ts` | Integration (real DB) | `artifacts/entities.md` |
| Services | `*.service.ts` | Unit and/or Integration | `artifacts/services.md` |
| Modules | `*.module.ts` | Unit (compilation) | `artifacts/modules.md` |
| Controllers | `*.controller.ts` | E2E only | `artifacts/controllers.md` |
| DTOs | `*.dto.ts` | E2E (validation wiring) | `artifacts/dtos.md` |
| Guards | `*.guard.ts` | E2E or Unit+E2E | `artifacts/guards.md` |
| Strategies | `*.strategy.ts` | E2E (via guard) | `artifacts/strategies.md` |
| Pipes | `*.pipe.ts` | Unit | `artifacts/pipes.md` |
| Interceptors | `*.interceptor.ts` | Unit and/or E2E | `artifacts/interceptors.md` |
| Filters | `*.filter.ts` | Unit + E2E | `artifacts/filters.md` |
| Middleware | `*.middleware.ts` | E2E | `artifacts/middleware.md` |
| Future types | — | — | `artifacts/future-types.md` |

## 5. Anti-patterns — Do NOT Do This

- ❌ **Unit test controllers** — controllers are thin delegation layers; test via E2E only (see `artifacts/controllers.md`)
- ❌ **Mock configured libs** (JwtService, CacheManager, ThrottlerGuard) — use real instances with test config; mocking hides configuration bugs (§1)
- ❌ **Skip integration tests for services with DB access** — unit tests with mocked repos don't prove queries are correct (see `artifacts/services.md`)
- ❌ **Skip module compilation tests** — TypeScript catches type errors but cannot catch DI wiring errors; a missing import only fails at runtime (see `artifacts/modules.md`)
- ❌ **Use `repository.delete({})` for cleanup** — throws on empty criteria; use `dataSource.query('DELETE FROM table')` or `repository.clear()` (see `references/gotchas.md`)
- ❌ **Write mirror tests** — assertions that copy the implementation's return value prove nothing (§2)
- ❌ **Forget `afterAll(() => app.close())`** — causes Jest to hang on open handles (see `references/gotchas.md`)
- ❌ **Mock owned services' internals** — mock at the boundary (the injected service), not internal methods; if you need to mock `private` methods, the unit is too large (see `references/mock-health-rules.md`)
- ❌ **Skip reproducing `main.ts` global config in E2E** — `Test.createTestingModule()` does NOT execute `main.ts`; global pipes, filters, and interceptors must be applied explicitly (see `references/gotchas.md`)
- ❌ **Test every DTO rule individually** — one E2E test per endpoint proving `ValidationPipe` rejects bad input is enough; don't test `class-validator` internals (see `artifacts/dtos.md`)
- ❌ **Throw NestJS HTTP exceptions from services** — services throw domain exceptions; exception filters map them to HTTP responses (see `artifacts/filters.md`)

## 6. E2E Terminology Note

This guide uses "E2E" to mean **HTTP-layer integration tests** — tests that use supertest to exercise the full request-to-response chain (routing → guards → pipes → controller → service → response). This is NOT browser-based or multi-service end-to-end testing. Industry sources may call these "API integration tests" or "HTTP integration tests."

## 7. References

| Topic | File |
|---|---|
| External system strategies (DB, storage, queue, email) | `references/external-systems.md` |
| Mock health rules & boundary principle | `references/mock-health-rules.md` |
| File naming, directory structure, coverage targets | `references/file-conventions.md` |
| Stack-specific gotchas & pitfalls | `references/gotchas.md` |

## 8. How to Use This Guide

This guide is organized as a multi-file skill:
- **This file (SKILL.md)** — always loaded. Contains core rules, quick reference, and anti-patterns.
- **`artifacts/`** — one file per artifact type. Read the relevant file when creating or modifying that type.
- **`references/`** — supporting content. Read when you need details on mock strategies, file conventions, or gotchas.

When working on a feature:
1. Check §3 (Feature Implementation Checklist) to identify which artifacts need tests
2. Read the corresponding `artifacts/*.md` file for the complete testing recipe
3. Consult `references/` files as needed for mock strategies, conventions, or pitfalls
