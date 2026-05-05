# Phase 02 — Cadastro, Login e Gerenciamento de Conta — Progress

**Status:** completed
**SIs:** 18/18 completed

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
- **Status:** completed
- **Tests:** 25 unit + 7 integration passing (auth.service.spec + auth.service.integration-spec total: 52 tests); 43 E2E passing (9 new password-reset tests, 0 regressions)
- **Observations:** Reused logout() to revoke refresh tokens after reset. Reused createVerificationToken helper for password_reset type. Added sendPasswordResetEmail mock to buildTestModule. Added argon2 import to integration spec.

### SI-02.13 — Rate Limiting on Auth Endpoints
- **Status:** completed
- **Tests:** 2 E2E passing (rate-limiting describe block: 429 on 11th request; GET / not throttled); 46/46 E2E total, 117/117 unit+integration (--runInBand)
- **Observations:** overrideProvider(ThrottlerGuard) does not intercept useClass-based APP_GUARD registration; correct isolation is done by injecting ThrottlerStorage (Symbol token) and calling .storage.clear() in beforeEach of all E2E describe blocks.

### SI-02.14 — TypeScript Compilation Error Fixes
- **Status:** completed
- **Tests:** no tests — `npx tsc --noEmit` exits with code 0
- **Observations:** Fixed 6 files: import type for JwtPayload (auth.controller), ConfigType (auth.service, mail.service, auth.module), StringValue import+casts for expiresIn in auth.module/auth.service/auth.service.integration-spec, port fallback in main.ts, entities type in create-test-data-source.ts.

### SI-02.15 — ChannelsModule Extraction, Nickname Ownership, and Pre-Check Refactor
- **Status:** completed
- **Tests:** 32/32 passing — nickname.util.spec: 11 unit, channels.service.spec: 6 unit, channels.service.integration-spec: 5 integration, channels.module.spec: 1 module, users.service.integration-spec: 7 integration, users.module.spec: 1 module
- **Observations:** Moved nickname.util to src/channels/; ChannelsService now injects Repository<Channel> and DataSource, derives nickname from email internally, manages its own transaction via dataSource.transaction; UsersService uses userRepository.save() directly and compensates by deleting the saved user if channel creation fails. Unit test for channels.service mocks dataSource.transaction by calling its callback with a mock manager; integration test for users.service uses jest.spyOn to simulate irrecoverable channel failure for the compensation test.

### SI-02.16 — Migration Runner Integration Test
- **Status:** completed
- **Tests:** 2/2 passing (migrations.integration-spec.ts)
- **Observations:** Imported migration classes directly (not via glob) to ensure ts-jest resolves them correctly in the test environment.

### SI-02.17 — Fix confirm-email Endpoint: POST → GET with Query Token
- **Status:** completed
- **Tests:** 46/46 E2E passing (auth.e2e-spec.ts updated; all confirm-email calls changed to GET with .query())
- **Observations:** Found two bugs from SI-02.15: (1) ChannelsModule was missing TypeOrmModule.forFeature([Channel]), causing autoLoadEntities to miss Channel and breaking E2E app startup; (2) migrations.integration-spec.ts left DB without token tables after undoLastMigration — fixed by re-running migrations in afterAll to restore DB state.

### SI-02.18 — Mail Template Asset Copying
- **Status:** completed
- **Tests:** no tests — `npm run build` produces confirmation.hbs and password-reset.hbs in dist/mail/templates/
- **Observations:** none
