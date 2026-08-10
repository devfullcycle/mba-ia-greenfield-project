> Part of the `testing-guide-nestjs-project` skill (see `../SKILL.md`).

# Gotchas & Pitfalls

Stack-specific pitfalls for NestJS 11 + Jest 30 + TypeORM + PostgreSQL + ts-jest 29.

---

## 1. `repository.delete({})` throws on empty criteria

**Problem:** `repository.delete({})` throws `Empty criteria(s) are not allowed for delete.` in TypeORM.

**Fix:** Use `dataSource.query('DELETE FROM "table_name"')` or `repository.clear()` for table cleanup between tests.

```typescript
// BAD
await userRepository.delete({});

// GOOD
await dataSource.query('DELETE FROM "users"');
// or
await userRepository.clear();
```

For tables with foreign key dependencies, use `TRUNCATE ... CASCADE`:
```typescript
await dataSource.query('TRUNCATE "videos", "channels", "users" CASCADE');
```

---

## 2. `Test.createTestingModule()` does NOT execute `main.ts`

**Problem:** Global pipes, filters, interceptors, and prefixes set in `main.ts` are NOT applied in test modules. E2E tests that don't reproduce this config will behave differently from production.

**Fix:** Manually apply all global config in E2E test setup:

```typescript
beforeAll(async () => {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleFixture.createNestApplication();

  // Reproduce main.ts config
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  // app.useGlobalFilters(new DomainExceptionFilter());
  // app.useGlobalInterceptors(new ResponseTransformInterceptor());
  // app.setGlobalPrefix('api');

  await app.init();
});
```

**Tip:** Extract global config into a shared function used by both `main.ts` and E2E setup to keep them in sync.

---

## 3. Forgetting `app.close()` causes Jest to hang

**Problem:** If `afterAll(() => app.close())` is missing, Jest will hang after tests complete because database connections, queue connections, or HTTP server handles remain open.

**Fix:** Always close the app and data sources:

```typescript
afterAll(async () => {
  await app.close(); // closes all connections managed by NestJS
});

// For standalone DataSource (entity integration tests):
afterAll(async () => {
  await dataSource.destroy();
});
```

If Jest still hangs, use `--forceExit` as a last resort, but investigate the leak first.

---

## 4. ts-jest version mismatch with Jest 30

**Problem:** The project uses Jest 30 but ts-jest 29.2.5. While ts-jest 29 is compatible with Jest 30 via a compatibility layer, you may encounter edge cases with ESM transforms or snapshot serializers.

**Fix:** Monitor for issues. If transform errors appear, check if ts-jest has released a version 30.x. Until then, the current setup works for the project's `commonjs` module output.

---

## 5. TypeORM `synchronize: true` in tests creates tables but doesn't reset

**Problem:** `synchronize: true` creates tables if they don't exist and adds new columns, but it does NOT drop tables or remove columns. If you rename a column in an entity, the old column persists in the test DB.

**Fix:** For a clean slate, either:
- Drop and recreate the test database before the test suite
- Use `dataSource.synchronize(true)` which drops all tables and recreates (destructive — only in tests)

```typescript
beforeAll(async () => {
  await dataSource.initialize();
  await dataSource.synchronize(true); // drop + recreate all tables
});
```

---

## 6. PostgreSQL table names are case-sensitive in raw queries

**Problem:** TypeORM may generate table names in different cases. Raw queries like `DELETE FROM users` will fail if the table is actually `"Users"`.

**Fix:** Always quote table names in raw queries:
```typescript
// BAD
await dataSource.query('DELETE FROM users');

// GOOD
await dataSource.query('DELETE FROM "users"');
```

**Better:** Use the entity metadata to get the actual table name:
```typescript
const tableName = dataSource.getRepository(User).metadata.tableName;
await dataSource.query(`DELETE FROM "${tableName}"`);
```

---

## 7. E2E test imports vs unit test imports

**Problem:** E2E tests import `AppModule` (the full application), while unit/integration tests import only the specific module or providers. Mixing these up leads to slow tests or incomplete setups.

**Rule of thumb:**
- **E2E** (`*.e2e-spec.ts`): `imports: [AppModule]` → full app, real HTTP stack
- **Integration** (`*.integration.spec.ts`): `imports: [TypeOrmModule.forRoot(...), TypeOrmModule.forFeature([Entity])]` + specific providers
- **Unit** (`*.spec.ts`): `providers: [ServiceUnderTest, { provide: Dep, useValue: mock }]` — no module imports

---

## 8. `jest.mock()` with NestJS DI — prefer `useValue` over `jest.mock()`

**Problem:** `jest.mock('./users.service')` at the module level replaces the entire module and fights with NestJS's DI system. It can cause subtle issues where the mock doesn't match the provider token.

**Fix:** Use NestJS's built-in DI mocking:
```typescript
// GOOD — works with NestJS DI
{ provide: UsersService, useValue: { findByEmail: jest.fn() } }

// AVOID — fights with NestJS DI
jest.mock('./users.service');
```

---

## 9. Parallel test execution and shared database

**Problem:** Jest runs test files in parallel by default. If multiple integration test files share the same database tables, they can interfere with each other (e.g., one test cleans a table while another is mid-assertion).

**Fix options:**
- Run integration tests with `--runInBand` to serialize execution
- Use transactions that rollback after each test (if feasible)
- Use schema-per-test-file isolation (complex but fully parallel)

For the `npm test` command, consider adding `--runInBand` when running integration tests:
```bash
npx jest --testPathPattern integration --runInBand
```

---

## 10. Supertest response types with `import request from 'supertest'`

**Problem:** With `moduleResolution: "nodenext"`, supertest's default import may require specific type imports.

**Fix:** Import as used in the project's existing E2E test:
```typescript
import request from 'supertest';
import { App } from 'supertest/types';

let app: INestApplication<App>;
```

This matches the existing `test/app.e2e-spec.ts` pattern and ensures type compatibility.

---

## 11. Bcrypt in tests — use lower cost factor

**Problem:** `bcrypt.hash()` with the default cost factor (10-12) is intentionally slow. Running many tests that hash passwords slows down the suite significantly.

**Fix:** Use a lower cost factor in test environment:
```typescript
const SALT_ROUNDS = process.env.NODE_ENV === 'test' ? 1 : 12;
await bcrypt.hash(password, SALT_ROUNDS);
```

Do NOT mock bcrypt — a lower cost factor is safe for tests and still exercises the real hashing code path.
