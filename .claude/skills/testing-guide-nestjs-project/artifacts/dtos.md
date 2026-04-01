> Part of the `testing-guide-nestjs-project` skill (see `../SKILL.md`).

# DTOs (`*.dto.ts`)

## What to test

DTOs define the shape and validation rules for API input using `class-validator` decorators. The testing goal is NOT to verify that individual decorators work (that's `class-validator`'s job) — it's to verify that **validation is wired correctly** at the HTTP layer.

- **Validation wiring** — `ValidationPipe` is active and rejects invalid input with 400
- **Whitelist enforcement** — unknown properties are stripped when `whitelist: true` is set
- **Security-critical validation** — if a DTO has business-critical rules (e.g., password strength, email format for registration), verify they reject at the HTTP layer
- **Transform behavior** — `class-transformer` decorators (`@Type()`, `@Transform()`) convert types correctly

## Layer assignment

| Scenario | Layer | Why |
|---|---|---|
| Standard DTO with class-validator decorators | **E2E** (one test per endpoint) | Proves validation is wired; don't test decorator behavior |
| DTO with security-critical validation | **E2E** (test the critical rules) | Security rules must be verified at the HTTP boundary |
| DTO with complex transform logic | **Unit** (rare) | Only if `@Transform()` contains non-trivial logic worth isolating |

DTOs do NOT get their own test files. Validation is tested as part of the controller's E2E tests.

## Setup pattern

DTO validation is tested within E2E tests (see `artifacts/controllers.md` for the full E2E setup):

```typescript
// Inside a controller E2E test file (e.g., test/users.e2e-spec.ts)

describe('POST /users — DTO validation', () => {
  it('should reject missing email with 400', () => {
    return request(app.getHttpServer())
      .post('/users')
      .send({ password: 'StrongPass1!' })
      .expect(400);
  });

  it('should reject invalid email format with 400', () => {
    return request(app.getHttpServer())
      .post('/users')
      .send({ email: 'not-an-email', password: 'StrongPass1!' })
      .expect(400);
  });

  it('should strip unknown properties (whitelist)', () => {
    return request(app.getHttpServer())
      .post('/users')
      .send({ email: 'new@test.com', password: 'StrongPass1!', isAdmin: true })
      .expect(201)
      .expect((res) => {
        expect(res.body).not.toHaveProperty('isAdmin');
      });
  });
});
```

**Key points:**
- DTO tests live in the E2E test file for the corresponding controller — not in a separate file
- One test sending a clearly invalid payload per endpoint is enough to prove the pipe is wired
- Do NOT write exhaustive tests for every `@IsString()`, `@IsNotEmpty()`, `@MaxLength()` — trust `class-validator`
- **Exception:** security-critical rules (password format, email uniqueness at validation level) deserve explicit tests
- Make sure `app.useGlobalPipes(new ValidationPipe({ whitelist: true }))` is applied in the E2E setup

## When to skip

- Do NOT create separate test files for DTOs (e.g., `create-user.dto.spec.ts`) — validation is an HTTP concern, tested at the E2E layer
- Do NOT test individual decorator behavior (`@IsEmail()` rejects "abc") — that's testing `class-validator`, not your code
- Skip `UpdateXDto` if it uses `PartialType(CreateXDto)` and `CreateXDto` validation is already tested

## Examples from project

No DTOs exist yet. When created (per project plan), validation tests will be part of E2E tests:
- `CreateUserDto` — tested in `UsersController` E2E: reject missing email, reject weak password
- `CreateVideoDto` — tested in `VideosController` E2E: reject missing title
- `CreateCommentDto` — tested in `CommentsController` E2E: reject empty body
- `UpdateChannelDto` — tested in `ChannelsController` E2E: reject invalid fields
