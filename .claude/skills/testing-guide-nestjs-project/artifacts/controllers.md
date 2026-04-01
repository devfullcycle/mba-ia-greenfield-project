> Part of the `testing-guide-nestjs-project` skill (see `../SKILL.md`).

# Controllers (`*.controller.ts`)

## What to test

Controllers are thin delegation layers — they receive HTTP requests, delegate to services, and return responses. The project's architecture rules enforce this (see `nestjs-layer-separation` rule). Testing what controllers do means testing the HTTP contract:

- **Status codes** — correct HTTP status for each operation (200, 201, 204, 400, 401, 403, 404, 409)
- **Validation rejection** — `ValidationPipe` rejects invalid payloads with 400
- **Auth enforcement** — protected routes return 401 without token, 403 without permission
- **Response shape** — response body matches expected structure
- **Error responses** — domain exceptions map to correct HTTP error format via exception filters

## Layer assignment

| Scenario | Unit | Integration | E2E |
|---|---|---|---|
| Any controller | ❌ Never | — | ✅ Always |

**Why no unit tests:** Controllers have no business logic (per project rules). A unit test for a controller that mocks the service and asserts the return value is a mirror test — it proves nothing. The existing `app.controller.spec.ts` is scaffolding from NestJS CLI and should not be used as a pattern for new controllers.

## Setup pattern

```typescript
// test/users.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('UsersController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // CRITICAL: reproduce main.ts global config
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    // Add other global config: filters, interceptors, prefix, etc.

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /users', () => {
    it('should create a user and return 201', () => {
      return request(app.getHttpServer())
        .post('/users')
        .send({ email: 'new@test.com', password: 'StrongPass1!' })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body.email).toBe('new@test.com');
          expect(res.body).not.toHaveProperty('password');
        });
    });

    it('should return 400 for invalid email', () => {
      return request(app.getHttpServer())
        .post('/users')
        .send({ email: 'not-an-email', password: 'StrongPass1!' })
        .expect(400);
    });

    it('should return 409 for duplicate email', () => {
      // Assumes a user with this email already exists from a prior test or seed
      return request(app.getHttpServer())
        .post('/users')
        .send({ email: 'existing@test.com', password: 'StrongPass1!' })
        .expect(409);
    });
  });

  describe('GET /users/:id', () => {
    it('should return 401 without auth token', () => {
      return request(app.getHttpServer())
        .get('/users/some-id')
        .expect(401);
    });

    it('should return 404 for non-existent user', () => {
      return request(app.getHttpServer())
        .get('/users/non-existent-id')
        .set('Authorization', 'Bearer valid-token')
        .expect(404);
    });
  });
});
```

**Key points:**
- Import `AppModule` (the real module) — no mocking at the E2E layer
- **Reproduce `main.ts` global config** — `ValidationPipe`, global filters, global interceptors, API prefix
- Use `beforeAll` / `afterAll` (not `beforeEach`) — creating the app is expensive
- Always call `app.close()` in `afterAll` to prevent Jest from hanging
- Test both success and error paths for each endpoint
- Use a real database (Docker) — the same one used in integration tests

## When to skip

- Do NOT write unit tests for any controller — ever
- Skip E2E tests for trivially simple endpoints that are already covered by other E2E tests in the same module (e.g., if `GET /users` is tested, you don't need a separate test for the pagination variant unless it has distinct behavior)

## Examples from project

Currently only `AppController` exists (scaffolding). The existing `app.controller.spec.ts` is a unit test for a controller — this is an anti-pattern per this guide. When real controllers are created, follow the E2E pattern above.

Expected controllers per project plan:
- **UsersController** (`/users`) — registration, profile management
- **AuthController** (`/auth`) — login, logout, password reset, email confirmation
- **ChannelsController** (`/channels`) — channel CRUD, public page
- **VideosController** (`/channels/:channelId/videos`) — video CRUD, upload, publish
- **CommentsController** (`/videos/:videoId/comments`) — comment CRUD, nesting
- **LikesController** — like/dislike on videos and comments
- **SubscriptionsController** — subscribe/unsubscribe to channels
