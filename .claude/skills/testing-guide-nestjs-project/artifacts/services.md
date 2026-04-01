> Part of the `testing-guide-nestjs-project` skill (see `../SKILL.md`).

# Services (`*.service.ts`)

## What to test

- **Branch logic** — conditionals, permission checks, state transitions, validation rules
- **Database contracts** — queries return expected results, constraints are respected, transactions work
- **External system contracts** — storage uploads succeed, emails are sent via Mailpit, queue jobs are published
- **Configured lib behavior** — JWT tokens encode correct claims, cache TTL works, throttle limits apply
- **Error paths** — service throws correct domain exceptions for invalid states, missing resources, duplicates

## Layer assignment

Services are the most varied artifact type. The test layer depends on the service's characteristics:

| Scenario | Unit | Integration | Why |
|---|---|---|---|
| Branching logic only (no system boundary) | ✅ mock owned services | — | Logic can be proven in isolation |
| DB access only (no branching) | — | ✅ real DB | No logic to unit-test; the DB contract IS the behavior |
| Branching + DB access | ✅ mock repo (test branches) | ✅ real DB (test queries) | Unit proves logic; integration proves queries — neither substitutes the other |
| Configured lib (JWT, cache, throttle) | ✅ real lib with test config | — | Mocking hides config bugs; use real lib with test-safe values |
| Side-effect dep (email, storage) | — | ✅ real capture service | Mailpit captures SMTP; local filesystem for storage |
| Branching + side-effect dep | ✅ mock the dep (test branches) | ✅ real capture service | Both layers needed |
| Pure delegation (no branching, no boundary) | — | — | Skip — no testable behavior |

**Critical rule:** A unit test that mocks a repository does NOT prove the query is correct. If a service accesses the database, it needs an integration test with a real DB — regardless of whether it also has a unit test.

## Setup pattern — Unit test (branching logic)

```typescript
// auth.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtModule } from '@nestjs/jwt';

describe('AuthService (unit)', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<Partial<UsersService>>;

  beforeAll(async () => {
    usersService = {
      findByEmail: jest.fn(),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: 'test-secret', signOptions: { expiresIn: '1h' } }),
      ],
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    authService = module.get(AuthService);
  });

  it('should throw when user not found', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    await expect(authService.login('no@user.com', 'pass'))
      .rejects.toThrow(/* domain exception */);
  });

  it('should throw when password is invalid', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: '1', email: 'user@test.com', password: 'hashed',
    } as any);

    await expect(authService.login('user@test.com', 'wrong'))
      .rejects.toThrow(/* domain exception */);
  });
});
```

**Key points:**
- Mock **owned services** (`UsersService`) with `useValue` — they have their own tests
- Use **real** `JwtModule` with test config — it's a configured lib; mocking hides config bugs
- Test each branch: success path, not found, invalid credentials, duplicate, etc.
- Mock return values with `jest.fn().mockResolvedValue()`

## Setup pattern — Integration test (DB contract)

```typescript
// users.service.integration.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UsersService } from './users.service';
import { User } from './user.entity';

describe('UsersService (integration)', () => {
  let service: UsersService;
  let dataSource: DataSource;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
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
        TypeOrmModule.forFeature([User]),
      ],
      providers: [UsersService],
    }).compile();

    service = module.get(UsersService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "users"');
  });

  it('should find user by email', async () => {
    await dataSource.query(
      `INSERT INTO "users" (email, password) VALUES ($1, $2)`,
      ['test@example.com', 'hashed'],
    );

    const user = await service.findByEmail('test@example.com');
    expect(user).toBeDefined();
    expect(user?.email).toBe('test@example.com');
  });

  it('should throw on duplicate email', async () => {
    await service.create({ email: 'dup@test.com', password: 'hashed' });

    await expect(
      service.create({ email: 'dup@test.com', password: 'other' }),
    ).rejects.toThrow();
  });
});
```

**Key points:**
- Use real PostgreSQL via Docker
- Import `TypeOrmModule.forRoot()` and `TypeOrmModule.forFeature()` in the test module
- Clean up with `dataSource.query('DELETE FROM "table"')` between tests
- Test the actual queries the service makes — not mocked return values

## When to skip

- Services that only delegate without branching (e.g., a service that calls `repository.findOneBy()` and returns the result). The integration test for the entity/repository covers this.
- `AppService.getHello()` — no branching, no system boundary, trivial return value

## Examples from project

Currently only `AppService` exists (scaffolding — no branching, no DB → skip).

When domain services are created:
- **AuthService** [branching + configured lib (JWT)] → Unit: test login/register/reset branches with mocked UsersService + real JwtModule. Integration: if it directly queries the DB.
- **UsersService** [DB access + possible branching] → Unit: test branch logic if any (mock repo). Integration: test DB queries with real PostgreSQL.
- **VideosService** [DB + storage + queue] → Unit: test status transitions, visibility rules (mock deps). Integration: test DB queries, storage uploads (local adapter), queue publishing.
- **CommentsService** [DB + branching for nesting] → Unit: test nesting depth validation. Integration: test nested comment queries.
- **ChannelsService** [DB access] → Integration: test slug uniqueness, ownership queries.
