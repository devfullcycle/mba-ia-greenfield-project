> Part of the `testing-guide-nestjs-project` skill (see `../SKILL.md`).

# Exception Filters (`*.filter.ts`)

## What to test

Exception filters catch exceptions and map them to HTTP responses. In this project, services throw domain exceptions (custom Error subclasses) — filters map them to proper HTTP status codes and response bodies.

- **Domain exception → HTTP mapping** — each domain exception maps to the correct status code and response format
- **Unknown exception handling** — unexpected errors produce a generic 500 response without leaking internals
- **Error response format** — all error responses follow a consistent structure

## Layer assignment

| Scenario | Unit | E2E | Why |
|---|---|---|---|
| Custom exception filter with mapping logic | ✅ | ✅ | Unit tests mapping rules; E2E verifies wiring and real HTTP responses |
| Filter extending `BaseExceptionFilter` with custom logic | ✅ | ✅ | Unit for the custom logic; E2E for integration with NestJS pipeline |

Exception filters always need both unit AND E2E tests:
- **Unit** proves the mapping logic is correct in isolation
- **E2E** proves the filter is registered and receives exceptions from the real pipeline

## Setup pattern — Unit test

```typescript
// domain-exception.filter.spec.ts
import { DomainExceptionFilter } from './domain-exception.filter';
import { EntityNotFoundException } from '../exceptions/entity-not-found.exception';
import { DuplicateEntityException } from '../exceptions/duplicate-entity.exception';
import { ArgumentsHost } from '@nestjs/common';

describe('DomainExceptionFilter', () => {
  let filter: DomainExceptionFilter;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new DomainExceptionFilter();
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });

    mockHost = {
      switchToHttp: () => ({
        getResponse: () => ({ status: mockStatus }),
        getRequest: () => ({ url: '/test', method: 'GET' }),
      }),
      getArgs: () => [],
      getArgByIndex: () => null,
      switchToRpc: () => ({} as any),
      switchToWs: () => ({} as any),
      getType: () => 'http',
    } as ArgumentsHost;
  });

  it('should map EntityNotFoundException to 404', () => {
    const exception = new EntityNotFoundException('User', 'abc-123');

    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(404);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: expect.stringContaining('User'),
      }),
    );
  });

  it('should map DuplicateEntityException to 409', () => {
    const exception = new DuplicateEntityException('User', 'email');

    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(409);
  });

  it('should map unknown exceptions to 500 without leaking details', () => {
    const exception = new Error('Internal database error');

    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(500);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
      }),
    );
  });
});
```

## Setup pattern — E2E

```typescript
// Inside controller E2E tests

it('should return 404 when user not found', () => {
  return request(app.getHttpServer())
    .get('/users/non-existent-id')
    .set('Authorization', `Bearer ${validToken}`)
    .expect(404)
    .expect((res) => {
      expect(res.body).toHaveProperty('statusCode', 404);
      expect(res.body).toHaveProperty('message');
    });
});
```

**Key points:**
- Mock `ArgumentsHost` with `switchToHttp()` returning mock request/response for unit tests
- Mock `response.status()` to return an object with `json()` for chaining
- Test each domain exception type maps to the correct HTTP status
- Always test the "unknown exception" path — verify no internal details are leaked
- E2E tests verify the filter is correctly registered (globally or per-controller)

## When to skip

- NestJS built-in exception handling (default `HttpException` hierarchy) — trust the framework
- If using only NestJS's default exception filter without customization — E2E tests cover it

## Examples from project

No exception filters exist yet. Expected per project plan:
- **DomainExceptionFilter** — maps domain exceptions (`EntityNotFoundException`, `DuplicateEntityException`, `InvalidCredentialsException`) to HTTP responses
- Per project rules, services throw domain exceptions (not HTTP exceptions), so this filter is essential
