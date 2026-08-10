---
paths:
  - 'nestjs-project/**/*.spec.ts'
  - 'nestjs-project/**/*.integration-spec.ts'
  - 'nestjs-project/**/*.e2e-spec.ts'
  - 'nestjs-project/test/**'
description: 'Testing conventions for NestJS unit, integration, and e2e tests'
---

# Testing Rules

> Suffix selection (`*.spec.ts` vs `*.integration-spec.ts` vs `*.e2e-spec.ts`) and test file location are pre-creation decisions covered in `nestjs-project/CLAUDE.md` → "Test Type Selection". The rules below assume you are already inside a test file of the correct kind.

## Unit Tests (`*.spec.ts`)

- Use `Test.createTestingModule()` from `@nestjs/testing` to set up the test module
- Mock every external dependency (repositories via `getRepositoryToken`, services via `useValue`, etc.)
- Follow the naming pattern: `describe('ClassName')` with descriptive `it('should ...')` blocks
- A unit test that needs to "mock the database" by creating a real DataSource is not a unit test — convert it to `*.integration-spec.ts`

## Integration Tests (`*.integration-spec.ts`)

- Use `Test.createTestingModule()` from `@nestjs/testing` to set up the test module
- Use a real database — connect to the Docker `db` service (env vars from `.env` are available inside the container)
- **Table cleanup:** `repository.delete({})` throws `Empty criteria(s) are not allowed`. Use `dataSource.query('DELETE FROM table_name')` or `repository.clear()` to wipe tables between tests

## E2E Tests (`*.e2e-spec.ts`)

- Use `supertest` to make HTTP requests against the running app
- Test complete request/response cycles including status codes, response shape, and error cases
- Test authentication and authorization flows (valid token, invalid token, missing token)
- Use a real test database — do not mock the database layer in e2e tests
- **Reproduce `main.ts` global config manually:** `Test.createTestingModule()` does not execute `main.ts`. Global pipes, filters, and interceptors must be applied explicitly in `beforeAll`: `app.useGlobalPipes(new ValidationPipe({ whitelist: true }))`

## Modules with `forRootAsync` + `ConfigType`

When the module under test (or any of its imports) registers something with `MyModule.forRootAsync({ inject: [someConfig.KEY], useFactory: ... })`, the test module must include a **global** ConfigModule:

```typescript
ConfigModule.forRoot({ isGlobal: true, load: [someConfig] })
```

`forRootAsync`'s factory context does not inherit non-global providers, so omitting `isGlobal: true` (or trying to add `imports: [ConfigModule]` inside `forRootAsync`) leads to "Nest can't resolve dependencies of the (?)" errors that are easy to misdiagnose.

## Overriding Global Guards / Filters Registered with `useClass`

`overrideProvider(SomeGuard).useValue(...)` does **not** intercept guards registered as:

```typescript
{ provide: APP_GUARD, useClass: SomeGuard }
```

because `useClass` instantiates a fresh `SomeGuard`, not the provider token you overrode. Two correct strategies:

1. **Override the storage / state token** the guard depends on. Example: for `@nestjs/throttler`, inject `ThrottlerStorage` (a `Symbol` token) from the test module and call `storage.clear()` in `beforeEach` of every describe block that exercises rate-limited endpoints. This isolates state without faking the guard.
2. **Register the guard via `useExisting`** in test modules so `overrideProvider` can target it. Reserve this for cases where strategy 1 is impractical.

## Mocking `dataSource.transaction(callback)`

Services that use `dataSource.transaction(async (manager) => { ... })` should be unit-tested by stubbing `transaction` to invoke the callback with a mock `EntityManager`:

```typescript
const mockManager = {
  save: jest.fn(),
  findOne: jest.fn(),
  // ...the methods the service actually calls
};
const mockDataSource = {
  transaction: jest.fn((cb) => cb(mockManager)),
};
```

For integration tests, use the real `DataSource` and assert side effects on the actual repository.

## Compensation Logic

When a service performs a multi-step operation that has a compensating action on failure (e.g., delete the saved user if the follow-up channel creation fails), the integration test for the compensation path should `jest.spyOn` the failing collaborator to throw, and then assert that the compensating delete really ran against the DB.

## Test Data

- Use factories or builders to create test data objects
- Avoid hardcoding values in tests; use variables or helper functions to generate test data
- Use realistic data that reflects actual use cases to catch edge cases and ensure test reliability
- Clean up test data after each test to maintain isolation and prevent side effects
- For e2e tests, consider using a separate test database to avoid conflicts with development data

## Test Structure

- Follow the Arrange-Act-Assert (AAA) pattern in test cases:
  - **Arrange:** Set up the necessary preconditions and inputs
  - **Act:** Execute the code being tested
  - **Assert:** Verify that the outcome is as expected
- Use descriptive test names that clearly indicate the expected behavior being tested
- Group related tests together using `describe()` blocks for better organization and readability
- Avoid testing multiple behaviors in a single test case; each test should focus on one specific aspect
- Use `beforeAll` and `afterAll` for setup and teardown that applies to all tests in a suite, and `beforeEach` and `afterEach` for setup and teardown that applies to individual tests
