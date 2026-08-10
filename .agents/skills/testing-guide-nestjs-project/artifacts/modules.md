> Part of the `testing-guide-nestjs-project` skill (see `../SKILL.md`).

# Modules (`*.module.ts`)

## What to test

- **DI compilation** — the module compiles without missing providers or circular dependencies
- **Configured import resolution** — `TypeOrmModule.forFeature()`, `JwtModule.register()`, `BullModule.registerQueue()` resolve correctly with all required config
- **Export availability** — exported providers are accessible to importing modules

## Layer assignment

| Scenario | Layer | Why |
|---|---|---|
| Module with configured imports (TypeORM, JWT, Bull, Throttler, etc.) | **Unit** (compilation test) | DI wiring errors are runtime-only; TypeScript cannot catch missing imports |
| Simple module with only local providers and no configured imports | **Skip** | If the module only registers plain services/controllers, DI errors will surface in other tests |

**Critical:** Module compilation tests are NOT wiring tests. They verify that the DI container can resolve all dependencies — a real runtime concern that TypeScript's type system cannot check.

## Setup pattern

```typescript
// users.module.spec.ts
import { Test } from '@nestjs/testing';
import { UsersModule } from './users.module';

describe('UsersModule', () => {
  it('should compile successfully', async () => {
    const module = await Test.createTestingModule({
      imports: [UsersModule],
    }).compile();

    expect(module).toBeDefined();
  });
});
```

**For modules with database dependencies** (TypeORM):

```typescript
// users.module.spec.ts
import { Test } from '@nestjs/testing';
import { UsersModule } from './users.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';

describe('UsersModule', () => {
  it('should compile successfully', async () => {
    const module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.DB_HOST ?? 'localhost',
          port: Number(process.env.DB_PORT ?? 5432),
          username: process.env.DB_USERNAME ?? 'streamtube',
          password: process.env.DB_PASSWORD ?? 'streamtube',
          database: process.env.DB_DATABASE ?? 'streamtube',
          entities: [User],
          synchronize: true,
        }),
        UsersModule,
      ],
    }).compile();

    expect(module).toBeDefined();
    await module.close();
  });
});
```

**For modules that import other domain modules:**

If `VideosModule` imports `UsersModule` and `ChannelsModule`, the compilation test must include those dependencies. Use `overrideProvider()` to mock providers from imported modules when a full dependency chain is impractical:

```typescript
describe('VideosModule', () => {
  it('should compile successfully', async () => {
    const module = await Test.createTestingModule({
      imports: [VideosModule],
    })
      .overrideProvider(UsersService)
      .useValue({})
      .overrideProvider(ChannelsService)
      .useValue({})
      .compile();

    expect(module).toBeDefined();
  });
});
```

**Key points:**
- The test only calls `.compile()` and asserts the module is defined — no behavior assertions
- If compilation fails, the error message tells you exactly which provider is missing
- Always call `module.close()` in `afterAll` when the module opens connections (DB, queues)
- For modules with DB dependencies, you need a real or overridden TypeORM root config

## When to skip

- `AppModule` — tested implicitly by every E2E test (E2E tests import `AppModule`)
- Modules with no configured imports — only plain providers and controllers; DI errors will surface in service/E2E tests

## Examples from project

Currently only `AppModule` exists (basic, no configured imports — skip).

When domain modules are created, each module with configured imports needs a compilation test:
- **UsersModule** [TypeOrmModule.forFeature([User])] → compilation test
- **AuthModule** [JwtModule.register(), PassportModule] → compilation test
- **VideosModule** [TypeOrmModule.forFeature([Video]), BullModule.registerQueue()] → compilation test
- **ChannelsModule** [TypeOrmModule.forFeature([Channel])] → compilation test
