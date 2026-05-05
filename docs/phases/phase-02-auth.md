# Phase 02 — Cadastro, Login e Gerenciamento de Conta

## Objective

Deliver the complete authentication lifecycle — registration with automatic channel creation, email confirmation, login with JWT access/refresh token rotation, logout, and password recovery — establishing the identity and session foundation for all subsequent phases.

---

## Step Implementations

### SI-02.1 — Dependencies, Configuration Namespaces, and Docker Compose

**Description:** Install all Phase 02 production dependencies, create `auth` and `mail` config namespaces following the `registerAs` pattern from Phase 01, extend the Joi validation schema, and add the Mailpit SMTP service to Docker Compose.

**Technical actions:**

- Install production dependencies in nestjs-project: `argon2@^0.41.x`, `@nestjs/jwt@^11.0.0`, `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`, `@nestjs/throttler@^6.x`, `class-validator@^0.14.x`, `class-transformer@^0.5.x`
- Create `src/config/auth.config.ts` — `registerAs('auth', ...)` reading `JWT_SECRET` (string, required — used for access tokens), `JWT_REFRESH_SECRET` (string, required — separate secret for refresh tokens), `JWT_ACCESS_EXPIRATION` (string, default `'15m'`), `JWT_REFRESH_EXPIRATION` (string, default `'7d'`), `CONFIRMATION_TOKEN_EXPIRATION_HOURS` (number, default `1`), `PASSWORD_RESET_TOKEN_EXPIRATION_HOURS` (number, default `1`)
- Create `src/config/mail.config.ts` — `registerAs('mail', ...)` reading `MAIL_HOST` (string, default `'mailpit'`), `MAIL_PORT` (number, default `1025`), `MAIL_FROM` (string, default `'"StreamTube" <noreply@streamtube.com>'`)
- Update `src/config/env.validation.ts` — add all new environment variables to the Joi schema (`JWT_SECRET` and `JWT_REFRESH_SECRET` required, others with defaults). Update `.env.example` with all new variables and Docker Compose-compatible defaults
- Add Mailpit service to `nestjs-project/compose.yaml` — image `axllent/mailpit`, SMTP on port 1025, Web UI on port 8025, with `nestjs-api` depending on it

**Dependencies:** None

**Acceptance criteria:**

- Application starts without errors when all new environment variables are provided — existing E2E test (`GET /` returns 200) still passes
- Starting the application without `JWT_SECRET` causes a Joi validation error at bootstrap — the app does not start
- Mailpit service is reachable at `localhost:8025` (Web UI) and accepts SMTP connections on port 1025 inside the Docker network

---

### SI-02.2 — Global ValidationPipe and Domain Exception Filter

**Description:** Configure the global `ValidationPipe` for DTO validation, define domain exception base classes, and create an exception filter that maps domain exceptions to the standardized `{ statusCode, error, message }` error response format. This is the first phase introducing HTTP endpoints — the error format established here is inherited by all subsequent phases.

**Technical actions:**

- Configure global `ValidationPipe` in `src/main.ts` with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true` — rejects unknown properties and auto-transforms payloads to DTO instances
- Create `src/common/exceptions/domain.exception.ts` — abstract base class `DomainException` extending `Error` with fields `errorCode: string` and `httpStatus: number`. Create concrete subclasses for Phase 02 errors: `EmailAlreadyExistsException`, `InvalidCredentialsException`, `EmailNotConfirmedException`, `InvalidTokenException`, `TokenExpiredException`, `TokenReuseDetectedException`
- Create `src/common/filters/domain-exception.filter.ts` — an `@Catch(DomainException)` filter that returns `{ statusCode, error, message }` where `error` is the domain error code (e.g., `EMAIL_ALREADY_EXISTS`) and `statusCode` is the HTTP status
- Register the `DomainExceptionFilter` globally in `src/main.ts` via `app.useGlobalFilters()`
- Create `src/common/filters/validation-exception.filter.ts` — an `@Catch(BadRequestException)` filter that normalizes class-validator errors into `{ statusCode: 400, error: 'VALIDATION_ERROR', message: <array of field errors> }` for consistent validation error responses

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/common/filters/domain-exception.filter.spec.ts` | Unit | Maps each DomainException subclass to the correct `{ statusCode, error, message }` shape |
| `src/common/filters/validation-exception.filter.spec.ts` | Unit | Normalizes class-validator errors into the standard error shape |

**Dependencies:** SI-02.1

**Acceptance criteria:**

- A request with an invalid JSON body returns 400 with `{ statusCode: 400, error: 'VALIDATION_ERROR', message: [...] }` — field-level error messages included
- A request with unknown properties in the body returns 400 — unknown fields are stripped and rejected
- A service throwing `EmailAlreadyExistsException` results in `{ statusCode: 409, error: 'EMAIL_ALREADY_EXISTS', message: 'Email is already registered' }` in the HTTP response

---

### SI-02.3 — User and Channel Entities

**Description:** Create the `User` and `Channel` entities with a one-to-one relationship. The `User` holds authentication fields; the `Channel` holds the public identity (nickname slug, display name). Generate the migration for both tables.

**Technical actions:**

- Create `src/users/entities/user.entity.ts` — `@Entity('users')` with columns: `id` (uuid PK generated), `email` (varchar, unique), `password` (varchar, `select: false`), `is_confirmed` (boolean, default `false`), `created_at` (CreateDateColumn), `updated_at` (UpdateDateColumn). Define `@OneToOne(() => Channel, channel => channel.user, { cascade: true })` relation
- Create `src/users/entities/channel.entity.ts` — `@Entity('channels')` with columns: `id` (uuid PK generated), `name` (varchar(50)), `nickname` (varchar(50), unique), `description` (text, nullable), `user_id` (uuid, unique FK → users), `created_at` (CreateDateColumn), `updated_at` (UpdateDateColumn). Define `@OneToOne(() => User, user => user.channel)` with `@JoinColumn({ name: 'user_id' })`
- Generate migration via `npm run migration:generate -- src/database/migrations/CreateUsersAndChannels` and review the generated SQL for correct columns, constraints, and indexes
- Create `src/users/users.module.ts` — `UsersModule` with `TypeOrmModule.forFeature([User, Channel])` in imports, exports `TypeOrmModule` so other modules can access the repositories

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/users/entities/user.entity.integration-spec.ts` | Integration | Unique email constraint, `password` excluded from default SELECT, `is_confirmed` defaults to `false`, timestamps auto-populated |
| `src/users/entities/channel.entity.integration-spec.ts` | Integration | Unique nickname constraint, nickname max length (50), one-to-one relation with user, `description` nullable |
| `src/users/users.module.spec.ts` | Unit | Module compiles with TypeOrmModule.forFeature wiring |

**Dependencies:** SI-02.1

**Acceptance criteria:**

- `npm run migration:run` creates `users` and `channels` tables with all columns, constraints, and indexes
- Inserting a user with a duplicate email fails with a unique constraint violation
- Inserting a channel with a duplicate nickname fails with a unique constraint violation
- Querying a user via `find()` does not return the `password` field unless explicitly selected with `addSelect`
- A newly created user has `is_confirmed = false` by default

---

### SI-02.4 — RefreshToken and VerificationToken Entities

**Description:** Create the `RefreshToken` entity for JWT refresh token rotation with family tracking, and the `VerificationToken` entity for email confirmation and password reset opaque tokens. Generate the migration.

**Technical actions:**

- Create `src/auth/entities/refresh-token.entity.ts` — `@Entity('refresh_tokens')` with columns: `id` (uuid PK generated), `token_hash` (varchar), `family` (uuid — groups tokens in the same rotation chain), `user_id` (uuid FK → users), `expires_at` (timestamp), `revoked_at` (timestamp, nullable), `created_at` (CreateDateColumn). Define `@ManyToOne(() => User)` with `@JoinColumn({ name: 'user_id' })`. Add index on `token_hash` and composite index on `(family, revoked_at)` for rotation queries
- Create `src/auth/entities/verification-token.entity.ts` — `@Entity('verification_tokens')` with columns: `id` (uuid PK generated), `token_hash` (varchar), `type` (enum: `'email_confirmation'`, `'password_reset'`), `user_id` (uuid FK → users), `expires_at` (timestamp), `used_at` (timestamp, nullable), `created_at` (CreateDateColumn). Define `@ManyToOne(() => User)` with `@JoinColumn({ name: 'user_id' })`. Add index on `token_hash`
- Generate migration via `npm run migration:generate -- src/database/migrations/CreateAuthTokens` and review

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/auth/entities/refresh-token.entity.integration-spec.ts` | Integration | Token hash index, family column, user relation, `revoked_at` nullable, `expires_at` required |
| `src/auth/entities/verification-token.entity.integration-spec.ts` | Integration | Token hash index, type enum values, user relation, `used_at` nullable, `expires_at` required |

**Dependencies:** SI-02.3

**Acceptance criteria:**

- `npm run migration:run` creates `refresh_tokens` and `verification_tokens` tables with correct columns, constraints, and indexes
- A refresh token can be linked to a user and queried by `token_hash`
- A verification token can be created with type `'email_confirmation'` or `'password_reset'` — any other value is rejected by the enum constraint

---

### SI-02.5 — Mail Module and Email Templates

**Description:** Configure `@nestjs-modules/mailer` with Handlebars templates via `MailerModule.forRootAsync`, create a `MailService` that wraps email sending with typed methods, and add Handlebars templates for confirmation and password reset emails.

**Technical actions:**

- Create `src/mail/mail.module.ts` — import `MailerModule.forRootAsync` with `inject: [mailConfig.KEY]`, configure SMTP transport using `mail.host` and `mail.port` from `mailConfig`, set `defaults.from` from `mailConfig`, configure `HandlebarsAdapter` with template directory `join(__dirname, 'templates')` and `options: { strict: true }`
- Create `src/mail/mail.service.ts` — `MailService` injecting `MailerService`. Implement `sendConfirmationEmail(email: string, name: string, token: string): Promise<void>` — sends to `email` using template `'confirmation'` with context `{ name, confirmationUrl }` where `confirmationUrl` is built from a base URL + token. Implement `sendPasswordResetEmail(email: string, name: string, token: string): Promise<void>` — sends using template `'password-reset'` with context `{ name, resetUrl }`
- Create `src/mail/templates/confirmation.hbs` — Handlebars template with user greeting by `name` and a clickable confirmation link using `confirmationUrl`
- Create `src/mail/templates/password-reset.hbs` — Handlebars template with user greeting by `name`, a clickable reset link using `resetUrl`, and an expiry notice

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/mail/mail.service.integration-spec.ts` | Integration | `sendConfirmationEmail` delivers to Mailpit with correct subject, recipient, and template-rendered body; `sendPasswordResetEmail` delivers with correct content |
| `src/mail/mail.module.spec.ts` | Unit | Module compiles with MailerModule.forRootAsync wiring |

**Dependencies:** SI-02.1

**Acceptance criteria:**

- Calling `sendConfirmationEmail` delivers an email to Mailpit — visible in Mailpit Web UI with the user's name and a confirmation link containing the token
- Calling `sendPasswordResetEmail` delivers an email to Mailpit — visible with the user's name, a reset link, and an expiry notice
- Both emails use the configured `MAIL_FROM` address as the sender

---

### SI-02.6 — User Registration with Automatic Channel Creation

**Description:** Implement the registration endpoint that creates a user and their channel atomically within a transaction. The channel nickname is derived from the email prefix (sanitized: only lowercase letters, numbers, underscores; max 50 chars; random suffix on collision). A confirmation email is sent after successful registration.

**Technical actions:**

- Create `src/users/users.service.ts` — `UsersService` injecting `Repository<User>`, `Repository<Channel>`, and `DataSource`. Implement `createUserWithChannel(email: string, hashedPassword: string): Promise<User>` — within a `dataSource.transaction()`: (1) create and save User, (2) derive nickname from email prefix via `sanitizeNickname()`, (3) on unique constraint violation for nickname, retry with a random 4-character alphanumeric suffix appended, (4) create and save Channel with `name = nickname` (display name, editable later), (5) return user with channel. Implement `findByEmail(email: string): Promise<User | null>` with `addSelect('user.password')` to include the password field
- Create `src/users/nickname.util.ts` — export `sanitizeNickname(emailPrefix: string): string` — lowercase, strip all characters except `[a-z0-9_]`, truncate to 46 chars (reserve 4 for suffix), return `'user_' + random(8)` if result is empty. Export `appendRandomSuffix(nickname: string): string` — append `'_' + random(3)` alphanumeric, ensuring total ≤ 50 chars
- Create `src/auth/dto/register.dto.ts` — `RegisterDto` with `@IsEmail()` email (required) and `@IsString() @MinLength(8) @MaxLength(128)` password (required)
- Create `src/auth/auth.service.ts` — `AuthService` injecting `UsersService`, `MailService`, and `Repository<VerificationToken>`. Implement `register(dto: RegisterDto): Promise<{ id, email }>` — check email uniqueness (throw `EmailAlreadyExistsException` if exists), hash password with `argon2.hash()`, call `usersService.createUserWithChannel()`, generate confirmation token via `crypto.randomBytes(32)`, store SHA-256 hash in `verification_tokens` with type `email_confirmation` and `expires_at = now + CONFIRMATION_TOKEN_EXPIRATION_HOURS`, send confirmation email with raw hex token, return `{ id, email }`
- Create `src/auth/auth.controller.ts` — `AuthController` with route prefix `'auth'`. Implement `@Post('register')` calling `authService.register()`, returning 201 with `{ id, email }`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/users/nickname.util.spec.ts` | Unit | Sanitization strips invalid chars, handles empty prefix, truncates to limit, suffix appending stays ≤ 50 |
| `src/auth/auth.service.spec.ts` | Unit | Register: hashes password, calls user creation, generates token, sends email; throws on duplicate email |
| `src/users/users.service.integration-spec.ts` | Integration | `createUserWithChannel` creates user+channel atomically, handles nickname collision with suffix, rolls back on failure |
| `src/auth/auth.service.integration-spec.ts` | Integration | Register persists user, channel, and verification token in DB; confirmation token hash matches raw token |
| `test/auth.e2e-spec.ts` | E2E | `POST /auth/register` returns 201 with `{ id, email }`, 409 on duplicate email, 400 on invalid body |

**Dependencies:** SI-02.2, SI-02.3, SI-02.4, SI-02.5

**Acceptance criteria:**

- `POST /auth/register` with valid email and password returns 201 with `{ id, email }`; a channel is automatically created with nickname derived from the email prefix (sanitized)
- `POST /auth/register` with an already-registered email returns 409 with `EMAIL_ALREADY_EXISTS`
- `POST /auth/register` with an email whose prefix collides with an existing nickname succeeds — the channel is created with a random suffix appended to the nickname
- Registering a new user causes a confirmation email to be delivered to the registered address, containing the user's name and a confirmation link with the token
- Creating a user with channel is atomic — if channel creation fails, no user row is persisted
- `POST /auth/register` with missing or invalid fields (e.g., password < 8 chars) returns 400 with validation errors

---

### SI-02.7 — Email Confirmation (Confirm and Resend)

**Description:** Implement the email confirmation endpoint that validates an opaque token and marks the user as confirmed, and a resend endpoint that invalidates previous confirmation tokens and sends a new one.

**Technical actions:**

- Implement `confirm(token: string): Promise<void>` in `AuthService` — hash the incoming token with SHA-256, look up in `verification_tokens` where `type = 'email_confirmation'`, `used_at IS NULL`, and `expires_at > now`. If not found, throw `InvalidTokenException`. If expired, throw `TokenExpiredException`. Mark token as used (`used_at = now`), set `user.is_confirmed = true`
- Implement `resendConfirmation(email: string): Promise<void>` in `AuthService` — find user by email. If not found, return silently (do not reveal email existence). If already confirmed, return silently. Invalidate all unused confirmation tokens for this user (`used_at = now`). Generate new token, store hash, send confirmation email. Token expires in `CONFIRMATION_TOKEN_EXPIRATION_HOURS`
- Create `src/auth/dto/confirm-email.dto.ts` — `ConfirmEmailDto` with `@IsString() @IsNotEmpty()` token
- Create `src/auth/dto/resend-confirmation.dto.ts` — `ResendConfirmationDto` with `@IsEmail()` email
- Add `@Post('confirm-email')` and `@Post('resend-confirmation')` to `AuthController` — confirm returns 204 with no body, resend returns 204 with no body

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/auth/auth.service.spec.ts` | Unit | Confirm: valid token sets confirmed, expired token throws, used token throws; Resend: invalidates old tokens, generates new token, silent on unknown email |
| `src/auth/auth.service.integration-spec.ts` | Integration | Confirm persists `is_confirmed = true` and `used_at` in DB; Resend invalidates old tokens and creates new one |
| `test/auth.e2e-spec.ts` | E2E | `POST /auth/confirm-email` 204 with valid token, 401 with invalid/expired token; `POST /auth/resend-confirmation` 204 always (no leak) |

**Dependencies:** SI-02.6

**Acceptance criteria:**

- `POST /auth/confirm-email` with a valid, unused, non-expired token returns 204 with no response body — the user's `is_confirmed` becomes `true`
- `POST /auth/confirm-email` with an already-used token returns 401 with `INVALID_TOKEN`
- `POST /auth/confirm-email` with an expired token returns 401 with `TOKEN_EXPIRED`
- `POST /auth/resend-confirmation` with a registered, unconfirmed email invalidates previous confirmation tokens, sends a new confirmation email, and returns 204 with no response body
- `POST /auth/resend-confirmation` with a non-existent or already-confirmed email returns 204 with no response body — email existence is not revealed

---

### SI-02.8 — Login with Credential Validation and Token Issuance

**Description:** Implement the login endpoint that validates email/password, checks email confirmation status, and issues a JWT access token plus a JWT refresh token (starting a new rotation family).

**Technical actions:**

- Implement `login(dto: LoginDto): Promise<{ access_token, refresh_token }>` in `AuthService` — find user by email with `addSelect('user.password')`. If not found, throw `InvalidCredentialsException`. Verify password with `argon2.verify()`. If invalid, throw `InvalidCredentialsException` (same error — do not reveal whether email exists). If `is_confirmed = false`, throw `EmailNotConfirmedException`. Generate JWT access token via `jwtService.sign({ sub: user.id, email: user.email }, { expiresIn: authConfig.jwtAccessExpiration })`. Generate JWT refresh token via `jwtService.sign({ sub: user.id, family: newFamilyUuid, jti: newTokenUuid }, { secret: authConfig.jwtRefreshSecret, expiresIn: authConfig.jwtRefreshExpiration })`, store SHA-256 hash of the signed JWT in `refresh_tokens` with the `family` UUID and `expires_at`. Return `{ access_token, refresh_token }`
- Create `src/auth/dto/login.dto.ts` — `LoginDto` with `@IsEmail()` email and `@IsString() @IsNotEmpty()` password
- Create `src/auth/auth.module.ts` — `AuthModule` importing `UsersModule`, `MailModule`, `JwtModule.registerAsync` (inject `authConfig.KEY`, configure `secret` and default `signOptions.expiresIn` from auth config), `TypeOrmModule.forFeature([RefreshToken, VerificationToken])`. Provide `AuthService`, export `AuthService` and `JwtModule`
- Add `@Post('login')` to `AuthController` — returns 200 with `{ access_token, refresh_token }`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/auth/auth.service.spec.ts` | Unit | Login: valid credentials return tokens, wrong password throws, non-existent email throws same error, unconfirmed user throws |
| `src/auth/auth.service.integration-spec.ts` | Integration | Login persists refresh token in DB with correct family and expiry; access token is a valid JWT decodable with the configured secret |
| `src/auth/auth.module.spec.ts` | Unit | Module compiles with JwtModule.registerAsync, TypeOrmModule.forFeature, UsersModule, MailModule wiring |
| `test/auth.e2e-spec.ts` | E2E | `POST /auth/login` 200 with tokens, 401 with wrong password, 401 with unknown email, 403 unconfirmed |

**Dependencies:** SI-02.6, SI-02.7

**Acceptance criteria:**

- `POST /auth/login` with valid credentials of a confirmed user returns 200 with `{ access_token, refresh_token }`
- `POST /auth/login` with a non-existent email returns 401 with `INVALID_CREDENTIALS` — same error as wrong password, not revealing email existence
- `POST /auth/login` with a wrong password returns 401 with `INVALID_CREDENTIALS`
- `POST /auth/login` with a user whose `is_confirmed = false` returns 403 with `EMAIL_NOT_CONFIRMED`
- The `access_token` is a valid JWT containing `sub` (user ID) and `email` claims, verifiable with the configured secret
- A refresh token record is persisted in the database with a new rotation `family` UUID

---

### SI-02.9 — JWT Access Token Guard

**Description:** Create a custom JWT guard that extracts the Bearer token from the `Authorization` header, verifies it with `JwtService`, and attaches the decoded payload to `request.user`. Create an `@Public()` decorator to bypass the guard on public endpoints.

**Technical actions:**

- Create `src/auth/guards/jwt-auth.guard.ts` — `JwtAuthGuard` implementing `CanActivate`. Inject `JwtService` and `Reflector`. In `canActivate()`: check for `@Public()` metadata via reflector — if present, allow. Otherwise, extract Bearer token from `Authorization` header, call `jwtService.verifyAsync(token)`, attach decoded payload to `request.user`. Throw `UnauthorizedException` if token is missing, malformed, or invalid
- Create `src/auth/decorators/public.decorator.ts` — `@Public()` custom decorator using `SetMetadata(IS_PUBLIC_KEY, true)`
- Create `src/auth/decorators/current-user.decorator.ts` — `@CurrentUser()` parameter decorator that extracts `request.user` — convenience for controllers to access the authenticated user's payload
- Register `JwtAuthGuard` as a global guard via `APP_GUARD` in `AuthModule` providers — all endpoints require authentication by default; use `@Public()` to opt out
- Add `@Public()` to all existing auth endpoints in `AuthController` (register, confirm-email, resend-confirmation, login) and to `AppController.getHello()`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/auth/guards/jwt-auth.guard.spec.ts` | Unit | Valid JWT passes, expired JWT rejected, missing header rejected, `@Public()` routes bypass guard |
| `test/auth.e2e-spec.ts` | E2E | Protected endpoint returns 401 without token, 200 with valid token; public endpoints remain accessible |

**Dependencies:** SI-02.8

**Acceptance criteria:**

- A request to a non-public endpoint without an `Authorization` header returns 401
- A request with an invalid or expired JWT returns 401
- A request with a valid JWT passes the guard and `request.user` contains `{ sub, email }`
- Endpoints decorated with `@Public()` are accessible without a token
- Existing public auth endpoints (register, login, confirm, resend) continue to work without authentication

---

### SI-02.10 — Refresh Token Rotation

**Description:** Implement the refresh endpoint that performs token rotation with family-based theft detection and a 10-second grace period for concurrent requests.

**Technical actions:**

- Implement `refresh(rawToken: string): Promise<{ access_token, refresh_token }>` in `AuthService` — hash incoming token with SHA-256, look up in `refresh_tokens`. If not found, throw `InvalidTokenException`. If expired (`expires_at < now`), throw `TokenExpiredException`. If revoked (`revoked_at IS NOT NULL`): check grace period — if `(now - revoked_at) <= 10 seconds`, find the latest non-revoked token in the same family and return a new access token paired with that token (do not create yet another token); if `(now - revoked_at) > 10 seconds`, this is reuse — revoke ALL tokens in the family (`UPDATE refresh_tokens SET revoked_at = now WHERE family = :family AND revoked_at IS NULL`), throw `TokenReuseDetectedException`. If valid: revoke current token (`revoked_at = now`), generate new JWT refresh token in the same family (same `family` UUID, new `jti`), store its SHA-256 hash in `refresh_tokens`, generate new access token, return both
- Create `src/auth/dto/refresh-token.dto.ts` — `RefreshTokenDto` with `@IsString() @IsNotEmpty()` refresh_token
- Add `@Public() @Post('refresh')` to `AuthController` — accepts `{ refresh_token }`, returns 200 with `{ access_token, refresh_token }`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/auth/auth.service.spec.ts` | Unit | Refresh: valid token rotates, expired rejects, reuse within grace period returns latest token, reuse beyond grace period revokes family |
| `src/auth/auth.service.integration-spec.ts` | Integration | Rotation persists new token and revokes old; family revocation updates all tokens in family |
| `test/auth.e2e-spec.ts` | E2E | `POST /auth/refresh` 200 with rotated tokens, 401 on invalid/expired, 401 with `TOKEN_REUSE_DETECTED` on reused token |

**Dependencies:** SI-02.8

**Acceptance criteria:**

- `POST /auth/refresh` with a valid refresh token returns 200 with new `{ access_token, refresh_token }`; the old refresh token is revoked
- `POST /auth/refresh` with an expired refresh token returns 401 with `TOKEN_EXPIRED`
- `POST /auth/refresh` with an already-used refresh token beyond the 10-second grace period returns 401 with `TOKEN_REUSE_DETECTED` and all refresh tokens in the same rotation family are revoked
- `POST /auth/refresh` with an already-used refresh token within the 10-second grace period succeeds — returns a valid access token without triggering family revocation
- The new refresh token belongs to the same rotation family as the original

---

### SI-02.11 — Logout and Session Revocation

**Description:** Implement the logout endpoint that revokes all refresh tokens for the authenticated user, ending all active sessions.

**Technical actions:**

- Implement `logout(userId: string): Promise<void>` in `AuthService` — revoke all non-revoked refresh tokens for the user: `UPDATE refresh_tokens SET revoked_at = now WHERE user_id = :userId AND revoked_at IS NULL`
- Add `@Post('logout')` to `AuthController` (requires authentication — no `@Public()` decorator). Extract user ID from `@CurrentUser()` decorator, call `authService.logout(userId)`, return 204 with no body

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/auth/auth.service.spec.ts` | Unit | Logout revokes all tokens for user |
| `src/auth/auth.service.integration-spec.ts` | Integration | After logout, all user's refresh tokens have `revoked_at` set; tokens from other users are unaffected |
| `test/auth.e2e-spec.ts` | E2E | `POST /auth/logout` 204 with valid access token, 401 without token; after logout, refresh token is invalid |

**Dependencies:** SI-02.9, SI-02.10

**Acceptance criteria:**

- `POST /auth/logout` with a valid access token returns 204 with no response body — all refresh tokens for that user are revoked
- `POST /auth/logout` without an access token returns 401
- After logout, attempting to use any of the user's previous refresh tokens returns 401 with `TOKEN_REUSE_DETECTED` (beyond grace period) or `INVALID_TOKEN`
- Logout does not affect refresh tokens belonging to other users

---

### SI-02.12 — Password Reset (Request and Execute)

**Description:** Implement the forgot-password endpoint that sends a reset email with an opaque token, and the reset-password endpoint that validates the token, updates the password, and revokes all refresh tokens.

**Technical actions:**

- Implement `forgotPassword(email: string): Promise<void>` in `AuthService` — find user by email. If not found, return silently (do not reveal email existence). Invalidate all unused password reset tokens for this user (`used_at = now`). Generate new token via `crypto.randomBytes(32)`, store SHA-256 hash in `verification_tokens` with type `password_reset` and `expires_at = now + PASSWORD_RESET_TOKEN_EXPIRATION_HOURS`. Send password reset email with raw hex token
- Implement `resetPassword(token: string, newPassword: string): Promise<void>` in `AuthService` — hash incoming token, look up in `verification_tokens` where `type = 'password_reset'`, `used_at IS NULL`, `expires_at > now`. If not found, throw `InvalidTokenException`. If expired, throw `TokenExpiredException`. Mark token as used. Hash new password with `argon2.hash()`. Update user's password. Revoke all refresh tokens for this user (reuse `logout()` logic)
- Create `src/auth/dto/forgot-password.dto.ts` — `ForgotPasswordDto` with `@IsEmail()` email
- Create `src/auth/dto/reset-password.dto.ts` — `ResetPasswordDto` with `@IsString() @IsNotEmpty()` token and `@IsString() @MinLength(8) @MaxLength(128)` new_password
- Add `@Public() @Post('forgot-password')` and `@Public() @Post('reset-password')` to `AuthController` — forgot returns 204 with no body, reset returns 204 with no body

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/auth/auth.service.spec.ts` | Unit | Forgot: generates token and sends email, silent on unknown email; Reset: validates token, hashes new password, revokes all refresh tokens |
| `src/auth/auth.service.integration-spec.ts` | Integration | Forgot persists token in DB; Reset updates password hash, marks token used, revokes refresh tokens |
| `test/auth.e2e-spec.ts` | E2E | `POST /auth/forgot-password` 204 always; `POST /auth/reset-password` 204 with valid token, 401 with invalid/expired token |

**Dependencies:** SI-02.7, SI-02.10

**Acceptance criteria:**

- `POST /auth/forgot-password` with a registered email causes a password reset email to be delivered containing the user's channel name and a reset link with the token
- `POST /auth/forgot-password` with a non-existent email returns 204 with no response body — email existence is not revealed
- `POST /auth/reset-password` with a valid, unused, non-expired token and a new password returns 204 with no response body — the password is updated and all refresh tokens for that user are revoked
- `POST /auth/reset-password` with an expired token returns 401 with `TOKEN_EXPIRED`
- `POST /auth/reset-password` with an already-used token returns 401 with `INVALID_TOKEN`
- After password reset, the user can login with the new password and the old password no longer works
- Requesting a new password reset invalidates any previous unused reset tokens for that user

---

### SI-02.13 — Rate Limiting on Auth Endpoints

**Description:** Configure `@nestjs/throttler` to enforce a rate limit of 10 requests per minute on all auth endpoints. Non-auth endpoints are excluded from throttling.

**Technical actions:**

- Configure `ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }])` in `AuthModule` imports — scoped to auth endpoints only, not globally
- Register `ThrottlerGuard` as an `APP_GUARD` in `AuthModule` providers — applies to all auth endpoints. Since `ThrottlerModule` is imported in `AuthModule` (not `AppModule`), the guard only activates for routes handled by `AuthController`
- Add `@SkipThrottle()` decorator to `AppController` to ensure the health endpoint and any non-auth routes are exempt from rate limiting even if the guard scope changes in the future

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `test/auth.e2e-spec.ts` | E2E | 11th request to an auth endpoint within 60s returns 429 Too Many Requests; non-auth endpoint is not rate-limited |

**Dependencies:** SI-02.8

**Acceptance criteria:**

- The 11th request to any auth endpoint within a 60-second window returns 429 Too Many Requests
- Non-auth endpoints (e.g., `GET /`) are not rate-limited and continue to respond normally regardless of auth endpoint throttling
- Rate limiting is per-IP (default `ThrottlerGuard` behavior)

---

### SI-02.14 — TypeScript Compilation Error Fixes

**Description:** Fix 11 pre-existing TypeScript errors across five patterns: `import type` for interface types used in decorated signatures (TS1272), `StringValue` cast for JWT `expiresIn` values (TS2322/TS2769), `undefined` coalescing for `port` in `main.ts` (TS2345), and correct `entities` parameter type in `create-test-data-source.ts` (TS2322).

**Technical actions:**

- In `src/auth/auth.controller.ts`: change `import { JwtPayload }` to `import type { JwtPayload }` from `./auth.types` — fixes TS1272 on the `logout` and `me` method signatures where `JwtPayload` appears as a type-only reference in decorated parameter positions
- In `src/auth/auth.service.ts`: change `import { ConfigType }` to `import type { ConfigType }` from `@nestjs/config` — fixes TS1272 on the `@Inject(authConfig.KEY)` constructor parameter
- In `src/mail/mail.service.ts`: change `import { ConfigType }` to `import type { ConfigType }` from `@nestjs/config` — fixes TS1272 on the `@Inject(appConfig.KEY)` constructor parameter
- In `src/auth/auth.module.ts`, `src/auth/auth.service.ts`, and `src/auth/auth.service.integration-spec.ts`: add `import type { StringValue } from 'ms'` (transitive dep of `@nestjs/jwt`, no install needed) and cast each `expiresIn` string value as `StringValue` — e.g. `expiresIn: cfg.jwtAccessExpiration as StringValue` — fixes TS2322 in `auth.module.ts` (JwtModule `signOptions`) and TS2769 in `auth.service.ts` (`generateAccessToken` / `generateRefreshToken` calls to `jwtService.sign`)
- In `src/main.ts`: add `?? 3000` fallback when reading port — `configService.get<number>('app.port') ?? 3000` — fixes TS2345 (`number | undefined` not assignable to `string | number` in `app.listen()`)
- In `src/test/create-test-data-source.ts`: change the `entities` parameter type from `EntityTarget<ObjectLiteral>[]` to `(Function | string | EntitySchema<any>)[]`, importing `EntitySchema` from `typeorm` — fixes TS2322 where the broader `EntityTarget` union included object literal shapes not compatible with `DataSourceOptions.entities`

**Dependencies:** None

**Acceptance criteria:**

- `npx tsc --noEmit` reports zero errors after applying all fixes
- All existing unit and integration tests continue to pass (`npm test -- --runInBand`)
- All existing E2E tests continue to pass (`npm run test:e2e`)

---

### SI-02.15 — ChannelsModule Extraction, Nickname Ownership, and Pre-Check Refactor

**Description:** Move the `Channel` entity and nickname utilities into a new `ChannelsModule`. `ChannelsService` owns the full channel creation lifecycle — injecting `Repository<Channel>` and `DataSource`, deriving the nickname from email internally, and managing its own transaction. `UsersService` delegates channel creation by passing only the user ID and email; it no longer injects `DataSource`, handles nickname logic, or opens transactions — it compensates if channel creation fails.

**Technical actions:**

- Move `src/users/entities/channel.entity.ts` to `src/channels/entities/channel.entity.ts` and `src/users/entities/channel.entity.integration-spec.ts` to `src/channels/entities/channel.entity.integration-spec.ts`. Move `src/common/nickname.util.ts` and `src/common/nickname.util.spec.ts` to `src/channels/nickname.util.ts` and `src/channels/nickname.util.spec.ts`. Update all import paths across the codebase that reference the old locations.
- Create `src/channels/channels.service.ts` — `ChannelsService` injecting `@InjectRepository(Channel) private readonly channelRepository: Repository<Channel>` and `private readonly dataSource: DataSource`. Implement `createChannel(userId: string, email: string): Promise<Channel>`: open `this.dataSource.transaction(async (manager) => { ... })` and inside: (1) derive `baseNickname` via `sanitizeNickname(email.split('@')[0])`; (2) use `manager.findOne(Channel, { where: { nickname } })` — if a row exists, generate a suffix candidate via `appendRandomSuffix(baseNickname)` and re-check (up to `maxRetries = 5`); (3) call `manager.save(manager.create(Channel, { name: baseNickname, nickname, user_id: userId }))`; (4) catch `QueryFailedError` with PostgreSQL code `'23505'` and detail containing `'nickname'` → generate new suffix and retry from step 2; (5) throw after exhausting retries.
- Create `src/channels/channels.module.ts` — `ChannelsModule` with `TypeOrmModule.forFeature([Channel])` in imports, `ChannelsService` in providers, and `[TypeOrmModule, ChannelsService]` in exports.
- Update `src/users/users.module.ts` — remove `Channel` from `TypeOrmModule.forFeature`, leaving only `User`; add `ChannelsModule` to imports and exports.
- Update `src/users/users.service.ts` — remove `DataSource` injection, all transaction logic, and any `sanitizeNickname` import; save user via `this.userRepository.save()`; call `this.channelsService.createChannel(savedUser.id, email)` — no manager passed; wrap in try/catch: on failure, compensate by deleting the saved user with `this.userRepository.delete(savedUser.id)` and re-throwing.
- Create `src/channels/channels.module.spec.ts` — module compilation test verifying `ChannelsModule` resolves with `TypeOrmModule.forFeature([Channel])` and `ChannelsService`.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/channels/nickname.util.spec.ts` | Unit | `sanitizeNickname` and `appendRandomSuffix` correctness (moved from `src/common/`) |
| `src/channels/channels.service.spec.ts` | Unit | `createChannel`: mocks `dataSource.transaction` to invoke its callback with a mock manager; derives nickname from email; pre-check finds existing → retries with suffix; pre-check passes → saves; concurrent unique violation → retries; max retries → throws; constructor receives `(channelRepository, dataSource)` |
| `src/channels/channels.service.integration-spec.ts` | Integration | `createChannel(userId, email)` persists channel with nickname derived from email (no outer transaction wrapper needed); collision resolved by suffix; transaction managed internally; constructor receives `(channelRepository, dataSource)` |
| `src/channels/channels.module.spec.ts` | Unit | `ChannelsModule` compiles with `TypeOrmModule.forFeature([Channel])` and `ChannelsService` wiring |
| `src/users/users.service.integration-spec.ts` | Integration | `createUserWithChannel` creates user+channel; compensation: user is deleted when channel creation fails irrecoverably; constructor receives `(userRepository, channelsService)` — no `DataSource` |
| `src/users/users.module.spec.ts` | Unit | `UsersModule` compiles with `ChannelsModule` dependency |

**Dependencies:** SI-02.14

**Acceptance criteria:**

- `Channel` entity, `Repository<Channel>`, `DataSource` for channel ops, nickname utilities, and nickname derivation logic all live within `ChannelsModule` — `UsersModule` contains no reference to `Channel`, `sanitizeNickname`, or `appendRandomSuffix`
- `ChannelsService.createChannel(userId, email)` accepts no `EntityManager` parameter — it opens its own transaction internally via the injected `DataSource`
- `UsersService` no longer injects `DataSource` — user creation uses `Repository<User>.save()` directly
- If channel creation fails after exhausting retries, `UsersService` compensates by deleting the saved user row — no orphaned users remain
- Nickname collision is resolved by querying before insert — savepoints (`SAVEPOINT`/`ROLLBACK TO SAVEPOINT`) are no longer used in the channel creation flow
- On a concurrent unique constraint violation (another process inserted between the pre-check and the save), the retry logic resolves the collision without propagating an unhandled exception

---

### SI-02.16 — Migration Runner Integration Test

**Description:** Add an integration test that programmatically runs all pending migrations against a test database via `DataSource.runMigrations()`, verifies all expected tables are present in `information_schema`, and confirms bidirectional integrity by reverting the last migration with `dataSource.undoLastMigration()`.

**Technical actions:**

- Create `src/database/migrations.integration-spec.ts` — instantiate a dedicated `DataSource` with `type: 'postgres'`, connection params from the same environment variables used by `create-test-data-source.ts`, `synchronize: false`, `migrationsRun: false`, and the migrations glob `src/database/migrations/*.ts`. This DataSource must register all four entity classes (User, Channel, RefreshToken, VerificationToken) so TypeORM can resolve foreign key metadata
- In `beforeAll`: `initialize()` the DataSource. Drop all managed tables and the `migrations` tracking table if they exist (using `dataSource.query(...)` with `DROP TABLE IF EXISTS ... CASCADE`) to guarantee a clean schema before the test; then call `dataSource.runMigrations()` and store the result
- Assert that `runMigrations()` returns an array of exactly two migration objects (corresponding to `CreateUsersAndChannels` and `CreateAuthTokens`). Query `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY(ARRAY['users','channels','refresh_tokens','verification_tokens'])` and assert all four table names are returned
- Call `dataSource.undoLastMigration()` to revert the most recent migration. Re-query `information_schema.tables` for `refresh_tokens` and `verification_tokens` and assert neither is present (confirming the `CreateAuthTokens` migration was reversed)
- In `afterAll`: `destroy()` the DataSource

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/database/migrations.integration-spec.ts` | Integration | `runMigrations` applies both migrations and all four tables exist; `undoLastMigration` removes the token tables |

**Dependencies:** SI-02.14

**Acceptance criteria:**

- After `dataSource.runMigrations()`, the `users`, `channels`, `refresh_tokens`, and `verification_tokens` tables are present in the database
- `runMigrations()` returns an array of exactly two migration records
- After `dataSource.undoLastMigration()`, `refresh_tokens` and `verification_tokens` no longer exist in `information_schema.tables`

---

### SI-02.17 — Fix confirm-email Endpoint: POST → GET with Query Token

**Description:** Change `POST /auth/confirm-email` (token in request body) to `GET /auth/confirm-email?token=xxx` (token in query string), aligning the endpoint with how email confirmation links are opened in a browser. The outgoing email URL is already formatted as a query string link, so only the controller and E2E tests change.

**Technical actions:**

- Update `src/auth/auth.controller.ts` — replace `@Post('confirm-email')` with `@Get('confirm-email')`; change the parameter decorator from `@Body() dto: ConfirmEmailDto` to `@Query() dto: ConfirmEmailDto`; keep `@HttpCode(HttpStatus.NO_CONTENT)` and `@Public()` decorators unchanged. The global `ValidationPipe` with `transform: true` validates query params against `ConfirmEmailDto` the same way it validates bodies
- Update `test/auth.e2e-spec.ts` — change all confirm-email test cases from `.post('/auth/confirm-email').send({ token })` to `.get('/auth/confirm-email').query({ token })`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `test/auth.e2e-spec.ts` | E2E | `GET /auth/confirm-email?token=<valid>` returns 204; `?token=<invalid>` returns 401 INVALID_TOKEN; `?token=<expired>` returns 401 TOKEN_EXPIRED; missing token query param returns 400 |

**Dependencies:** None

**Acceptance criteria:**

- `GET /auth/confirm-email?token=<valid-token>` returns 204 with no response body — the user's `is_confirmed` becomes `true`
- `GET /auth/confirm-email?token=<invalid-token>` returns 401 with `INVALID_TOKEN`
- `GET /auth/confirm-email?token=<expired-token>` returns 401 with `TOKEN_EXPIRED`
- `GET /auth/confirm-email` without a `token` query parameter returns 400 with a validation error
- The confirmation link generated in outgoing emails (`${appUrl}/auth/confirm-email?token=${token}`) opens correctly when clicked in a browser

---

### SI-02.18 — Mail Template Asset Copying

**Description:** Configure `nest-cli.json` to treat `.hbs` files in `src/mail/templates/` as build assets, ensuring they are copied to `dist/mail/templates/` during `nest build` and watched for changes during `nest start --watch`.

**Technical actions:**

- Update `nestjs-project/nest-cli.json` — inside `compilerOptions`, add `"assets": [{ "include": "mail/templates/**/*.hbs", "watchAssets": true }]` alongside the existing `"deleteOutDir": true` entry. The Nest CLI copies each matched file relative to `sourceRoot` into the same relative path under `outDir`

**Dependencies:** None

**Acceptance criteria:**

- `npm run build` copies `src/mail/templates/confirmation.hbs` and `src/mail/templates/password-reset.hbs` to `dist/mail/templates/` — both files are present after a clean build
- `npm run start:dev` watches `.hbs` file changes and reloads without requiring a full restart
- The production entrypoint (`npm run start:prod`) sends confirmation and password reset emails successfully — no "template not found" error at runtime

---

## Technical Specifications

### Data Model

#### User

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | |
| email | varchar | unique, not null | |
| password | varchar | not null, `select: false` | Argon2id hash |
| is_confirmed | boolean | not null, default `false` | Set to `true` after email confirmation |
| created_at | timestamp | not null, auto-generated | `@CreateDateColumn` |
| updated_at | timestamp | not null, auto-generated | `@UpdateDateColumn` |

**Relations:** User → Channel (one-to-one, cascade: true)
**Indexes:** `(email)` — unique

#### Channel

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | |
| name | varchar(50) | not null | Display name; initially equals nickname |
| nickname | varchar(50) | unique, not null | URL slug derived from email prefix; only `[a-z0-9_]` |
| description | text | nullable | Filled later by user after confirmation |
| user_id | uuid | FK → users.id, unique, not null | Owning side of one-to-one |
| created_at | timestamp | not null, auto-generated | |
| updated_at | timestamp | not null, auto-generated | |

**Relations:** Channel → User (one-to-one, owning side via `user_id`)
**Indexes:** `(nickname)` — unique, `(user_id)` — unique

#### RefreshToken

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | |
| token_hash | varchar | not null | SHA-256 hash of the signed JWT refresh token |
| family | uuid | not null | Groups tokens in the same rotation chain |
| user_id | uuid | FK → users.id, not null | |
| expires_at | timestamp | not null | |
| revoked_at | timestamp | nullable | Set when token is rotated or revoked |
| created_at | timestamp | not null, auto-generated | |

**Relations:** RefreshToken → User (many-to-one)
**Indexes:** `(token_hash)`, `(family, revoked_at)` — composite for rotation queries, `(user_id)` — FK

#### VerificationToken

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | |
| token_hash | varchar | not null | SHA-256 hash of the raw opaque token |
| type | enum | not null, values: `'email_confirmation'`, `'password_reset'` | PostgreSQL enum type |
| user_id | uuid | FK → users.id, not null | |
| expires_at | timestamp | not null | |
| used_at | timestamp | nullable | Set when token is consumed |
| created_at | timestamp | not null, auto-generated | |

**Relations:** VerificationToken → User (many-to-one)
**Indexes:** `(token_hash)`, `(user_id, type)` — for querying user's tokens by type

---

### API Contracts

#### POST /auth/register (SI-02.6)

**Request headers:**
- Content-Type: application/json

**Request body:**
- email: string, required — valid email format
- password: string, required — min 8, max 128 characters

**Response 201:**
- id: string (uuid)
- email: string

**Error responses:**
- 409 EMAIL_ALREADY_EXISTS: when the email is already registered
- 400 validation error: when the request body fails schema validation

---

#### GET /auth/confirm-email (SI-02.7, corrected in SI-02.17)

**Request query parameters:**
- token: string, required — the raw hex token from the confirmation email

**Response 204:** No content.

**Error responses:**
- 401 INVALID_TOKEN: when the token is not found or already used
- 401 TOKEN_EXPIRED: when the token has expired
- 400 validation error: when `token` query parameter is missing or empty

---

#### POST /auth/resend-confirmation (SI-02.7)

**Request headers:**
- Content-Type: application/json

**Request body:**
- email: string, required — valid email format

**Response 204:** No content.

**Error responses:**
- 400 validation error: when the request body fails schema validation

---

#### POST /auth/login (SI-02.8)

**Request headers:**
- Content-Type: application/json

**Request body:**
- email: string, required — valid email format
- password: string, required — non-empty

**Response 200:**
- access_token: string (JWT)
- refresh_token: string (JWT)

**Error responses:**
- 401 INVALID_CREDENTIALS: when email does not exist OR password is wrong (same error for both)
- 403 EMAIL_NOT_CONFIRMED: when the user's email has not been confirmed
- 400 validation error: when the request body fails schema validation

---

#### POST /auth/refresh (SI-02.10)

**Request headers:**
- Content-Type: application/json

**Request body:**
- refresh_token: string, required — the JWT refresh token

**Response 200:**
- access_token: string (JWT)
- refresh_token: string (new JWT refresh token)

**Error responses:**
- 401 INVALID_TOKEN: when the token is not found
- 401 TOKEN_EXPIRED: when the token has expired
- 401 TOKEN_REUSE_DETECTED: when a previously used token is reused beyond the 10s grace period (entire family revoked)

---

#### POST /auth/logout (SI-02.11)

**Request headers:**
- Authorization: Bearer <access_token>

**Response 204:** No content.

**Error responses:**
- 401: when the access token is missing or invalid

---

#### POST /auth/forgot-password (SI-02.12)

**Request headers:**
- Content-Type: application/json

**Request body:**
- email: string, required — valid email format

**Response 204:** No content.

**Error responses:**
- 400 validation error: when the request body fails schema validation

---

#### POST /auth/reset-password (SI-02.12)

**Request headers:**
- Content-Type: application/json

**Request body:**
- token: string, required — the raw hex token from the reset email
- new_password: string, required — min 8, max 128 characters

**Response 204:** No content.

**Error responses:**
- 401 INVALID_TOKEN: when the token is not found or already used
- 401 TOKEN_EXPIRED: when the token has expired
- 400 validation error: when the request body fails schema validation

#### Validation Rules — Registration and Password Reset

| Field | Rule | Error message |
|-------|------|---------------|
| email | Must be a valid email format | email must be an email |
| password / new_password | Min 8 characters | password must be longer than or equal to 8 characters |
| password / new_password | Max 128 characters | password must be shorter than or equal to 128 characters |

---

### Authorization Matrix

| Endpoint | Public | Authenticated | Notes |
|----------|--------|---------------|-------|
| POST /auth/register | ✓ | | |
| GET /auth/confirm-email | ✓ | | Token in query string (corrected in SI-02.17) |
| POST /auth/resend-confirmation | ✓ | | |
| POST /auth/login | ✓ | | |
| POST /auth/refresh | ✓ | | Uses refresh token, not access token |
| POST /auth/logout | | ✓ | Requires valid access token |
| POST /auth/forgot-password | ✓ | | |
| POST /auth/reset-password | ✓ | | Uses opaque token from email |

---

### Error Catalog

**Error response format:** (applies to all nestjs-project HTTP endpoints from this phase onward)
```
{ statusCode: number, error: string, message: string }
```
The `error` field carries the domain error code from the catalog (e.g., `"EMAIL_ALREADY_EXISTS"`). For validation errors, `error` is `"VALIDATION_ERROR"` and `message` is an array of field-level error strings.

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| EMAIL_ALREADY_EXISTS | 409 | Email is already registered | POST /auth/register with an email that exists in users table |
| INVALID_CREDENTIALS | 401 | Invalid email or password | POST /auth/login with unknown email OR wrong password (same code for both — do not reveal which) |
| EMAIL_NOT_CONFIRMED | 403 | Email not confirmed | POST /auth/login when user's `is_confirmed = false` |
| INVALID_TOKEN | 401 | Invalid or already used token | GET /auth/confirm-email, POST /auth/reset-password, or POST /auth/refresh with a token not found in DB or already consumed |
| TOKEN_EXPIRED | 401 | Token has expired | GET /auth/confirm-email, POST /auth/reset-password, or POST /auth/refresh with an expired token |
| TOKEN_REUSE_DETECTED | 401 | Token reuse detected — all sessions revoked | POST /auth/refresh with an already-revoked refresh token beyond the 10s grace period |

---

## Dependency Map

```
SI-02.1 (no deps)
├── SI-02.2
├── SI-02.3
│   └── SI-02.4
└── SI-02.5

SI-02.2 + SI-02.3 + SI-02.4 + SI-02.5
└── SI-02.6
    └── SI-02.7

SI-02.6 + SI-02.7
└── SI-02.8
    ├── SI-02.9
    ├── SI-02.10
    └── SI-02.13

SI-02.9 + SI-02.10
└── SI-02.11

SI-02.7 + SI-02.10
└── SI-02.12

SI-02.14 (no deps — corrections, independent of original SI chain)
├── SI-02.15
└── SI-02.16

SI-02.17 (no deps)
SI-02.18 (no deps)
```

Linearized implementation order: SI-02.1 → SI-02.2, SI-02.3, SI-02.5 (parallel) → SI-02.4 → SI-02.6 → SI-02.7 → SI-02.8 → SI-02.9, SI-02.10, SI-02.13 (parallel) → SI-02.11 → SI-02.12

Corrections (SI-02.14–18) are independent of the original chain and applied after the original phase is complete: SI-02.14 → SI-02.15, SI-02.16 (parallel); SI-02.17 and SI-02.18 anytime

## Deliverables

- [ ] User registration with automatic channel creation (nickname from email prefix, atomic transaction)
- [ ] Email confirmation flow (confirm + resend, 1h token expiry)
- [ ] Login with JWT access token + JWT refresh token (Argon2id password verification)
- [ ] Refresh token rotation with family-based theft detection and 10s grace period
- [ ] Logout revokes all refresh tokens for the user
- [ ] Password reset flow (forgot + reset, revokes all sessions)
- [ ] JWT auth guard protecting all endpoints by default, `@Public()` opt-out
- [ ] Rate limiting on auth endpoints (10 req/min per IP)
- [ ] Standardized error response format `{ statusCode, error, message }` with domain exception filter
- [ ] Global ValidationPipe with whitelist and transform
- [ ] Mailpit service in Docker Compose for local email testing
- [ ] Email templates (confirmation, password reset) via Handlebars
- [ ] Zero TypeScript compilation errors (`npx tsc --noEmit` exits with code 0)
- [ ] `Channel` entity and creation logic extracted to `ChannelsModule` with independent `ChannelsService`
- [ ] Nickname collision resolved by pre-check query before insert — no savepoints in the creation path
- [ ] Migration runner integration test verifying bidirectional migration apply/revert
- [ ] `GET /auth/confirm-email?token=xxx` replaces `POST /auth/confirm-email` — email links open correctly in browser
- [ ] `.hbs` templates copied to `dist/mail/templates/` on every `nest build`
- [ ] All SI tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation check passes (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Project builds successfully (`docker compose exec nestjs-api npm run build`)
