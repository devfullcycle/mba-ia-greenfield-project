> Part of the `testing-guide-nestjs-project` skill (see `../SKILL.md`).

# Interceptors (`*.interceptor.ts`)

## What to test

Interceptors wrap the entire request-response lifecycle. They can modify the request before reaching the handler, modify the response after the handler returns, or add cross-cutting behavior (logging, caching, timing).

- **Response transformation** — interceptor correctly maps or wraps the response
- **Conditional behavior** — interceptor applies logic based on request/response characteristics
- **Error handling** — interceptor correctly handles or transforms errors from the handler

## Layer assignment

| Scenario | Unit | E2E | Why |
|---|---|---|---|
| Interceptor with transformation logic (e.g., response wrapping, serialization) | ✅ | ✅ | Unit tests the logic; E2E verifies wiring and real HTTP behavior |
| Interceptor with only side effects (logging, timing) | — | ✅ | No observable output to unit test; E2E verifies it doesn't break the chain |
| Interceptor using a configured lib (cache) | ✅ real lib | ✅ | Don't mock the cache — use real cache with test config |

## Setup pattern — Unit test

```typescript
// response-transform.interceptor.spec.ts
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { ResponseTransformInterceptor } from './response-transform.interceptor';

describe('ResponseTransformInterceptor', () => {
  let interceptor: ResponseTransformInterceptor;

  beforeAll(() => {
    interceptor = new ResponseTransformInterceptor();
  });

  it('should wrap response in data envelope', (done) => {
    const context = createMockExecutionContext();
    const callHandler: CallHandler = {
      handle: () => of({ id: '1', name: 'Test' }),
    };

    interceptor.intercept(context, callHandler).subscribe((result) => {
      expect(result).toEqual({
        data: { id: '1', name: 'Test' },
        statusCode: 200,
      });
      done();
    });
  });
});

function createMockExecutionContext(): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({}),
      getResponse: () => ({ statusCode: 200 }),
      getNext: () => jest.fn(),
    }),
    getClass: () => Object,
    getHandler: () => jest.fn(),
    getArgs: () => [],
    getArgByIndex: () => null,
    switchToRpc: () => ({} as any),
    switchToWs: () => ({} as any),
    getType: () => 'http',
  } as ExecutionContext;
}
```

**Key points:**
- Mock `ExecutionContext` and `CallHandler` for unit tests
- Use `of()` from RxJS to create mock observables for `CallHandler.handle()`
- Subscribe to the interceptor's return value and assert the transformed output
- For interceptors with DI, use `Test.createTestingModule()` to inject dependencies

## When to skip

- Logging interceptors with no transformation logic — E2E verifies they don't break; no unit test needed
- Framework interceptors (`ClassSerializerInterceptor`, `CacheInterceptor`) — trust the framework

## Examples from project

No interceptors exist yet. Potential interceptors:
- **ResponseTransformInterceptor** — wraps all responses in a standard envelope
- **TimeoutInterceptor** — aborts requests that exceed a time limit
- **LoggingInterceptor** — logs request/response timing (side-effect only → E2E)
