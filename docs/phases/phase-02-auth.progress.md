# Phase 02 — Cadastro, Login e Gerenciamento de Conta — Progress

**Status:** in_progress
**SIs:** 11/13 completed

### SI-02.1 — Dependencies, Configuration Namespaces, and Docker Compose
- **Status:** completed
- **Tests:** no tests
- **Observations:** none

### SI-02.2 — Global ValidationPipe and Domain Exception Filter
- **Status:** completed
- **Tests:** 8/8 passing (domain-exception.filter.spec.ts, validation-exception.filter.spec.ts)
- **Observations:** rodou comando de teste no host, em vez do container

### SI-02.3 — User and Channel Entities
- **Status:** completed
- **Tests:** 11/11 passing (user.entity.integration-spec.ts, channel.entity.integration-spec.ts, users.module.spec.ts)
- **Observations:** DB had leftover tables from a previous session (no migration files on disk); dropped tables and regenerated migration cleanly. Added `setupFiles: ["dotenv/config"]` to jest config so integration tests pick up DB_HOST from .env. Extended testRegex to `(spec|integration-spec).ts$` to discover integration test files.
Review how env values are being used in tests (avoid localhost). And in UsersModule, better demonstrate that it's a unit test when using .spec, as it is using a database with .spec.


### SI-02.4 — RefreshToken and VerificationToken Entities
- **Status:** completed
- **Tests:** 15/15 passing (refresh-token.entity.integration-spec.ts, verification-token.entity.integration-spec.ts)
- **Observations:** Dropped pre-existing token tables created by a previous session's synchronize before regenerating migration. Tests require --runInBand to avoid parallel FK violations between suites sharing the same DB.

### SI-02.5 — Mail Module and Email Templates
- **Status:** completed
- **Tests:** 6/6 passing (mail.service.integration-spec.ts, mail.module.spec.ts)
- **Observations:** MailerModule.forRootAsync with inject:[mailConfig.KEY] requires ConfigModule.forRoot({ isGlobal: true }) in tests — the forRootAsync factory context does not inherit global providers without isGlobal; no imports:[ConfigModule] needed in forRootAsync when ConfigModule is global.

### SI-02.6 — User Registration with Automatic Channel Creation
- **Status:** completed
- **Tests:** 28/28 passing (nickname.util.spec, auth.service.spec, users.service.integration-spec, auth.service.integration-spec, auth.e2e-spec)
- **Observations:** PostgreSQL aborts the transaction on unique constraint violation — used savepoints (SAVEPOINT/ROLLBACK TO SAVEPOINT) for nickname collision retry within the transaction. Added JWT_SECRET and JWT_REFRESH_SECRET to .env. Added setupFiles:["dotenv/config"] to jest-e2e.json. Removed MAIL_FROM with angle brackets from .env (causes shell parse error) — let mail.config.ts default handle it.

### SI-02.7 — Email Confirmation (Confirm and Resend)
- **Status:** completed
- **Tests:** 36/36 passing (auth.service.spec: 12 unit, auth.service.integration-spec: 9 integration, auth.e2e-spec: 15 e2e)
- **Observations:** TypeORM ignores `null` literal in `where` clause — must use `IsNull()` from typeorm to generate IS NULL SQL. Added `findByEmailWithChannel` and `save` methods to UsersService for confirm/resend flows.

### SI-02.8 — Login with Credential Validation and Token Issuance
- **Status:** completed
- **Tests:** 32/32 passing (auth.service.spec: 16 unit, auth.service.integration-spec: 11 integration, auth.module.spec: 1 module, auth.e2e-spec: 20 e2e)
- **Observations:** Renamed private `createConfirmationToken` to `createVerificationToken(userId, type, expirationHours)` to be reused for password reset (SI-02.12). JwtModule.registerAsync added to AuthModule with JwtModule exported. Existing test modules updated to include JwtModule.register and RefreshToken repository mock.

### SI-02.9 — JWT Access Token Guard
- **Status:** completed
- **Tests:** 30/30 passing (jwt-auth.guard.spec.ts: 5 unit, auth.e2e-spec.ts: 25 e2e — 5 new guard tests + 20 existing)
- **Observations:** Added GET /auth/me (protected, no @Public) to AuthController to demonstrate guard protection in E2E tests — needed to satisfy ACs requiring a protected endpoint. Added @Public() to all existing auth endpoints and AppController.getHello(). Registered JwtAuthGuard as APP_GUARD in AuthModule providers.

### SI-02.10 — Refresh Token Rotation
- **Status:** completed
- **Tests:** 36/36 unit+integration passing (auth.service.spec: 21 unit, auth.service.integration-spec: 15 integration); 31/31 E2E passing (auth.e2e-spec: 6 new refresh tests + 25 existing)
- **Observations:** JWT refresh tokens required jti: crypto.randomUUID() in the payload to guarantee uniqueness within the same second (same family+sub+iat would produce identical JWTs otherwise). Added jti to both login and refresh token signing. Grace period test returns rawToken back to the concurrent client (no new token created, no family revocation).

### SI-02.11 — Logout and Session Revocation
- **Status:** completed
- **Tests:** 22 unit + 17 integration + 34 E2E passing (3 new logout tests; 0 regressions)
- **Observations:** Grace period logic needed a fix: when all family tokens are revoked (e.g., by logout), the check for an active family token now throws InvalidTokenException instead of silently returning a token to a revoked session.

### SI-02.12 — Password Reset (Request and Execute)
- **Status:** pending
- **Tests:** pending
- **Observations:** none

### SI-02.13 — Rate Limiting on Auth Endpoints
- **Status:** pending
- **Tests:** pending
- **Observations:** none
