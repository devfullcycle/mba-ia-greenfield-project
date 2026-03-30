---
paths:
  - 'nestjs-project/src/**/*.ts'
description: 'NestJS common conventions'
---

# NestJS Standard Conventions

## Naming

| Artifact   | File Name              | Class Name          |
|---|---|---|
| Module     | `users.module.ts`      | `UsersModule`       |
| Service    | `users.service.ts`     | `UsersService`      |
| Controller | `users.controller.ts`  | `UsersController`   |
| Entity     | `user.entity.ts`       | `User`              |
| DTO        | `create-user.dto.ts`   | `CreateUserDto`     |
| Guard      | `auth.guard.ts`        | `AuthGuard`         |
| Constants  | `auth.constants.ts`    | (named exports)     |

- **Files:** kebab-case
- **Classes:** PascalCase
- **Modules:** pluralize (`UsersModule`); **Entities:** singularize (`User`)
- **Variables/Functions:** camelCase


## Dependency Injection

- Inject via constructor: `constructor(private readonly service: SomeService) {}`
- Never use `new` to instantiate services or repositories
- Use `private readonly` by default; `protected` only for subclasses
- Use `@Inject()` only when needed: for custom providers with string/symbol tokens (e.g., `@Inject('CONFIG')`) or NestJS symbols (e.g., `APP_GUARD`). For standard class-based providers, constructor injection without `@Inject()` is sufficient

## Async/Await

- Every I/O method: `async` with explicit `Promise<T>` return type
- Use `await`, never `.then()` / `.catch()`
- No un-awaited Promises

## Constants

- Repeated strings/numbers in `<module>.constants.ts` (e.g., `auth.constants.ts`)
- Always `as const` for literal types
- Group related constants: `AUTH_COOKIES = { ACCESS_TOKEN: '...', ... } as const`
- Never duplicate string literals across files
