> Part of the `testing-guide-nestjs-project` skill (see `../SKILL.md`).

# Guards (`*.guard.ts`)

## What to test

Guards control access to routes. In this project, guards delegate business logic to services (per `nestjs-layer-separation` rule). Testing focuses on:

- **Access control enforcement** — protected routes reject unauthenticated/unauthorized requests
- **Role/permission checks** — guards correctly allow/deny based on user roles or resource ownership
- **Token validation** — JWT guard rejects expired, malformed, or missing tokens
- **Guard composition** — when multiple guards are applied, they execute in the correct order

## Layer assignment

| Scenario | Unit | E2E | Why |
|---|---|---|---|
| Simple Passport guard (`AuthGuard('jwt')` with no custom logic) | ❌ Skip | ✅ | Pure framework delegation — test the HTTP behavior |
| Guard with custom `canActivate` that delegates to a service | ❌ Skip | ✅ | Business logic is in the service (tested separately); guard wiring is an HTTP concern |
| Guard with complex internal logic (multi-step auth, stateful checks) | ✅ | ✅ | Complex logic warrants isolated unit test + E2E for HTTP behavior |

**Design principle:** Per project rules, guards should delegate business logic to services. A guard that needs a unit test may signal that business logic has leaked into the guard.

## Setup pattern — E2E (primary approach)

```typescript
// Inside a controller E2E test file

describe('Auth guard enforcement', () => {
  it('should return 401 when no token is provided', () => {
    return request(app.getHttpServer())
      .get('/users/me')
      .expect(401);
  });

  it('should return 401 when token is expired', () => {
    return request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', 'Bearer expired-token-here')
      .expect(401);
  });

  it('should return 200 when valid token is provided', () => {
    return request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200);
  });
});

describe('Ownership guard enforcement', () => {
  it('should return 403 when user does not own the channel', () => {
    return request(app.getHttpServer())
      .patch(`/channels/${otherUserChannel.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'Stolen Channel' })
      .expect(403);
  });

  it('should return 200 when user owns the channel', () => {
    return request(app.getHttpServer())
      .patch(`/channels/${ownChannel.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'My Channel' })
      .expect(200);
  });
});
```

## Setup pattern — Unit (complex guards only)

```typescript
// channel-owner.guard.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { ChannelOwnerGuard } from './channel-owner.guard';
import { ChannelsService } from '../channels/channels.service';

describe('ChannelOwnerGuard (unit)', () => {
  let guard: ChannelOwnerGuard;
  let channelsService: jest.Mocked<Partial<ChannelsService>>;

  beforeAll(async () => {
    channelsService = {
      isOwner: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelOwnerGuard,
        { provide: ChannelsService, useValue: channelsService },
      ],
    }).compile();

    guard = module.get(ChannelOwnerGuard);
  });

  it('should return true when user is the owner', async () => {
    channelsService.isOwner.mockResolvedValue(true);

    const context = createMockExecutionContext({
      params: { channelId: 'ch-1' },
      user: { id: 'user-1' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('should return false when user is not the owner', async () => {
    channelsService.isOwner.mockResolvedValue(false);

    const context = createMockExecutionContext({
      params: { channelId: 'ch-1' },
      user: { id: 'user-2' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(false);
  });
});

// Helper to create mock ExecutionContext
function createMockExecutionContext(request: Record<string, any>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
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

## When to skip

- `AuthGuard('jwt')` with no custom logic — pure Passport delegation; E2E tests cover the behavior
- Guards that only check `request.user` existence (the Passport strategy handles this)

## Examples from project

No guards exist yet. Expected per project plan:
- **JwtAuthGuard** [extends `AuthGuard('jwt')`] → E2E only (Passport delegation)
- **ChannelOwnerGuard** [delegates to `ChannelsService.isOwner()`] → E2E primarily; unit if complex
- **VideoOwnerGuard** [delegates to `VideosService.isOwner()`] → E2E primarily
