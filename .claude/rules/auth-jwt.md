---
paths:
  - 'nestjs-project/src/auth/**'
description: 'JWT and refresh-token rotation rules'
---

# Auth / JWT Rules

## `jti` is mandatory in every signed token

Every JWT signed by the auth service must include a unique `jti` claim:

```typescript
import { randomUUID } from 'node:crypto';

await this.jwtService.signAsync({
  sub: user.id,
  family: familyId,
  jti: randomUUID(),
});
```

JWT signatures are deterministic over `(header, payload, secret)`. Two tokens issued in the **same second** for the same `sub` / `family` produce **identical** strings without a `jti`, breaking refresh-token rotation (the "new" token equals the old one and is rejected as already used). The `iat` claim has 1-second resolution and is not enough.

This applies to access tokens, refresh tokens, and any short-lived verification token signed via `JwtService`.

## Refresh-Token Rotation

- Every refresh issues a new token in the same family and revokes the previous one.
- Reuse of a revoked token (outside the grace window) revokes the **entire family** and forces re-login.
- Grace window: a brief period after rotation during which the previous token may be presented again (e.g., concurrent client request that raced the rotation). Within the window, return the **just-issued** token without creating a new one and without revoking the family.
- **Edge case:** if the family has been fully revoked (e.g., by logout or a previous reuse detection), the grace-window branch must throw `InvalidTokenException` instead of silently returning a token. Returning a token to a revoked session re-opens it.

## Logout

- Logout revokes every active refresh token in the user's session/family.
- Subsequent uses of any of those refresh tokens must fail with `InvalidTokenException` — including tokens that would otherwise fall into the grace window.

## Password Reset

- Password reset on success must revoke every active refresh token for the user (re-use the logout flow).
- Reset tokens use the same `createVerificationToken(userId, type, expirationHours)` helper as email confirmation — do not duplicate the helper per flow; pass the `type` argument.

## Token TTL Types (`StringValue`)

`@nestjs/jwt`'s `signOptions.expiresIn` accepts either a number (seconds) or a `StringValue` from the `ms` package. A plain `string` from a config value will not type-check. Cast at the boundary where the value enters the JWT API:

```typescript
import type { StringValue } from 'ms';

JwtModule.registerAsync({
  inject: [authConfig.KEY],
  useFactory: (config: ConfigType<typeof authConfig>) => ({
    secret: config.accessTokenSecret,
    signOptions: { expiresIn: config.accessTokenTtl as StringValue },
  }),
});
```

Do **not** widen the config field type to `string` — keep the cast localized to the JWT call site.

## Global JWT Guard Registration

This module is responsible for registering `JwtAuthGuard` as `APP_GUARD`. The decision that *every* endpoint is protected by default — and the `@Public()` opt-out convention used by all other controllers — is documented in `nestjs-controllers.md`. Keep the registration here in sync: if the global guard is ever removed or replaced, update `nestjs-controllers.md` accordingly.

## Rate Limiting

- Rate limits on auth endpoints are enforced by the global `ThrottlerGuard`.
- E2E tests for non-throttled endpoints must clear the throttler storage in `beforeEach` to avoid leaking 429s across describe blocks. See `.claude/rules/nestjs-testing.md` for the override pattern.
