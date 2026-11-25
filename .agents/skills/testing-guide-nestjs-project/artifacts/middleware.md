> Part of the `testing-guide-nestjs-project` skill (see `../SKILL.md`).

# Middleware (`*.middleware.ts`)

## What to test

NestJS middleware runs before the route handler and guards. It preprocesses requests — adding headers, logging, parsing, or rejecting early.

- **Request preprocessing** — middleware correctly modifies the request (adds headers, parses data)
- **Early rejection** — middleware rejects invalid requests before they reach the guard/handler chain
- **Passthrough behavior** — middleware calls `next()` for valid requests

## Layer assignment

| Scenario | Layer | Why |
|---|---|---|
| Middleware with simple preprocessing or passthrough | **E2E** | Test through the HTTP chain; middleware is infrastructure |
| Middleware with complex internal logic (multi-step auth, rate limiting) | **Integration + E2E** | Complex logic may warrant targeted testing beyond E2E |

Middleware is **primarily** tested at the E2E layer. If a middleware has complex logic, per project rules it should delegate to a service — and the service gets its own unit/integration tests.

## Setup pattern

```typescript
// Inside a controller E2E test file

describe('CORS middleware', () => {
  it('should include CORS headers in response', () => {
    return request(app.getHttpServer())
      .get('/users')
      .expect((res) => {
        expect(res.headers['access-control-allow-origin']).toBeDefined();
      });
  });
});

describe('Request logging middleware', () => {
  it('should not break the request chain', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200);
  });
});
```

**Key points:**
- Middleware behavior is observed through HTTP response headers, status codes, or side effects
- If middleware modifies the request and downstream handlers depend on it, test the final response
- For middleware that rejects requests (e.g., IP whitelist), test both acceptance and rejection via E2E

## When to skip

- Express built-in middleware (`cors`, `helmet`, `compression`) — trust the library; verify wiring in E2E only if critical
- Middleware that only calls `next()` with no modification — zero testable behavior

## Examples from project

No middleware exists yet. Potential middleware:
- **RequestLoggerMiddleware** — logs request method, path, and timing (side-effect → E2E passthrough test)
- **CorsMiddleware** — if custom CORS logic beyond NestJS's built-in `enableCors()`
