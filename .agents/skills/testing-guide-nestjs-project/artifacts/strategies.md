> Part of the `testing-guide-nestjs-project` skill (see `../SKILL.md`).

# Strategies (`*.strategy.ts`)

## What to test

Passport strategies handle authentication (typically JWT validation). They extract credentials from the request, validate them, and attach the user to the request object.

- **Token validation** — valid tokens produce the expected user payload
- **Token rejection** — expired, malformed, or missing tokens are rejected
- **User lookup** — the strategy correctly retrieves the user from the database based on token claims

## Layer assignment

| Scenario | Layer | Why |
|---|---|---|
| Passport strategy (JWT, Local, etc.) | **E2E** (via guard) | Strategies are invoked by guards during the request lifecycle; test the full chain |

Strategies are **not** tested in isolation (no unit tests). They are tested through the guards that use them, in E2E tests. The strategy's `validate()` method is called by Passport during request processing — testing it directly would require mocking Passport internals, which is fragile and low value.

## Setup pattern

Strategies are tested as part of E2E tests for protected endpoints (see `artifacts/guards.md` and `artifacts/controllers.md`):

```typescript
// Inside a controller E2E test file

describe('JWT Strategy (via auth guard)', () => {
  let validToken: string;

  beforeAll(async () => {
    // Create a test user and generate a real JWT token
    // Use the real JwtService from the app
    const jwtService = app.get(JwtService);
    validToken = jwtService.sign({ sub: testUser.id, email: testUser.email });
  });

  it('should authenticate with valid JWT and attach user to request', () => {
    return request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.id).toBe(testUser.id);
        expect(res.body.email).toBe(testUser.email);
      });
  });

  it('should reject expired token', () => {
    const jwtService = app.get(JwtService);
    const expiredToken = jwtService.sign(
      { sub: testUser.id },
      { expiresIn: '0s' },
    );

    return request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);
  });

  it('should reject token with invalid signature', () => {
    return request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', 'Bearer invalid.token.here')
      .expect(401);
  });

  it('should reject request without Authorization header', () => {
    return request(app.getHttpServer())
      .get('/users/me')
      .expect(401);
  });
});
```

**Key points:**
- Use real `JwtService` to generate tokens in tests — this tests the full JWT configuration chain
- Test with both valid and invalid tokens to cover success and failure paths
- The E2E test implicitly tests the strategy's `validate()` method through the guard

## When to skip

- Do NOT write separate unit tests for strategy `validate()` methods
- If the strategy only extracts the user ID from the token and calls `UsersService.findById()`, the integration is covered by the E2E guard tests + the service's own integration tests

## Examples from project

No strategies exist yet. Expected per project plan:
- **JwtStrategy** [extracts user from JWT, calls `UsersService.findById()`] → E2E via `JwtAuthGuard`
- **LocalStrategy** [validates email/password, calls `AuthService.validateUser()`] → E2E via login endpoint
