---
paths:
  - 'nestjs-project/src/**/*.ts'
  - 'nestjs-project/test/**/*.ts'
description: 'TypeScript strictness rules — keep tsc --noEmit clean at all times'
---

# TypeScript Rules

The project compiles with `strict` settings (`strictNullChecks`, etc.). `npx tsc --noEmit` must exit with code 0 before any task is considered done — never leave compilation errors as debt for a future cleanup task.

## Type-Only Imports

When an import is used **only** as a type (in annotations, generics, `extends`, `implements`), use `import type`:

```typescript
import type { JwtPayload } from './types/jwt-payload';
import type { ConfigType } from '@nestjs/config';
```

This avoids runtime imports of type-only modules (which can break with `verbatimModuleSyntax` / `isolatedModules`) and keeps the compiled output minimal.

If the same module exports both values and types, use the inline form:

```typescript
import { someFunction, type SomeType } from './module';
```

## NestJS ConfigType

When injecting a typed config built with `registerAs`, use `ConfigType<typeof myConfig>` from `@nestjs/config` — not `ReturnType<typeof myConfig>`:

```typescript
import authConfig from './auth.config';
import type { ConfigType } from '@nestjs/config';

constructor(
  @Inject(authConfig.KEY)
  private readonly config: ConfigType<typeof authConfig>,
) {}
```

`ConfigType` resolves promises returned by async factories; `ReturnType` does not.

## Strict Null Defaults

When reading optional env vars with `process.env.X` directly, narrow before use:

```typescript
const port = parseInt(process.env.PORT ?? '3000', 10);
```

Never rely on `parseInt(undefined)` or pass possibly-undefined values into APIs that require a defined argument.

## Library-Specific Type Casts

Some libraries use branded string types (`StringValue` from `ms`, etc.) that a plain `string` does not satisfy. Cast at the boundary where the value enters the library API rather than widening the source type. See `auth-jwt.md` for the JWT `expiresIn` example; the same principle applies to any branded-string library you integrate.

For typed config providers built with `registerAs`, see also the `typeorm-migrations.md` note on test `DataSource` entity arrays.
