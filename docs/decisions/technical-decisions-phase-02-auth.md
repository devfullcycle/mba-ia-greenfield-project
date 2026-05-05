# Technical Decisions — Phase 02: Cadastro, Login e Gerenciamento de Conta

> **Phase:** 02 — Cadastro, Login e Gerenciamento de Conta
> **Status:** Finalized
> **Date:** 2026-04-07

---

## TD-01: Password Hashing Algorithm

**Context:** User registration requires securely storing passwords. The choice of hashing algorithm impacts security against brute-force/GPU attacks and runtime performance.

**Options:**

### Option A: bcrypt
- Industry standard since 1999, adaptive cost factor. Uses `bcrypt` npm package (~800K weekly downloads). Fixed 4KB memory per hash.
- **Pros:** Battle-tested, mature ecosystem, widely understood, simple API (`bcrypt.hash(password, 10)`), excellent NestJS community examples.
- **Cons:** Fixed 4KB memory usage — vulnerable to GPU/ASIC attacks at scale. No memory-hardness tuning. Cost factor is the only knob.

### Option B: Argon2id
- Winner of the 2015 Password Hashing Competition. Uses `argon2` npm package. Hybrid mode (data-dependent + data-independent) resists both GPU and side-channel attacks. Configurable memory (64-128MB+), iterations, and parallelism.
- **Pros:** OWASP-recommended algorithm for new projects (2025+). Memory-hard — GPU/ASIC attacks are orders of magnitude more expensive. Three tunable parameters (memory, time, parallelism). Modern security standard.
- **Cons:** Requires native compilation (uses C bindings — may need build tools in Docker). Slightly more complex configuration (memory/time/parallelism params). Less NestJS-specific documentation compared to bcrypt.

**Recommendation:** **Argon2id** — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.

**Decision:** B (Argon2id)

---

## TD-02: Auth Library Approach

**Context:** NestJS offers two main paths for implementing JWT authentication: using the Passport.js integration (`@nestjs/passport`) or building custom guards directly with `@nestjs/jwt`. This affects code complexity, extensibility, and how auth strategies are organized.

**Options:**

### Option A: @nestjs/passport + @nestjs/jwt (Passport strategies)
- Official NestJS recipe. Uses Passport's strategy pattern: `LocalStrategy` for login (email/password), `JwtStrategy` for protected routes. Guards delegate to Passport for validation.
- **Pros:** Official NestJS documentation and recipe. Plugin architecture — easy to add OAuth, Google, GitHub login later. Well-established pattern with `LocalAuthGuard` and `JwtAuthGuard`. Separates credential validation from JWT validation cleanly.
- **Cons:** Adds abstraction layer (Passport's `validate()` callback pattern). Two extra dependencies (`passport`, `passport-jwt`). Slightly more boilerplate (strategy classes, guard classes). Magic behavior (Passport auto-attaches `req.user`).

### Option B: Custom guards with @nestjs/jwt only (no Passport)
- Build `AuthGuard` directly using NestJS `CanActivate` interface + `JwtService` for token verification. Login endpoint validates credentials manually in the service layer.
- **Pros:** Fewer dependencies (just `@nestjs/jwt`). Full control over the auth flow — no Passport abstractions. Simpler mental model — guard just verifies JWT, service handles login. Less boilerplate for a project that only needs email/password + JWT.
- **Cons:** No plugin architecture for future OAuth/social login. Must manually implement what Passport provides out of the box. Less alignment with official NestJS documentation. Harder to add new auth strategies later.

**Recommendation:** **Option A (@nestjs/passport)** — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.

**Decision:** B (Custom guards with @nestjs/jwt only)

---

## TD-03: Refresh Token Strategy

**Context:** JWT access tokens should be short-lived (15min). A refresh token strategy is needed to maintain sessions without forcing re-login. The choice affects security, database load, and complexity. Depends on TD-02 (auth approach).

**Options:**

### Option A: Refresh Token Rotation (stored in DB)
- Each refresh generates a new access token AND a new refresh token. The old refresh token is invalidated. If a reused (old) token is detected, all tokens for that user are revoked (theft detection). Tokens stored in a `refresh_tokens` table in PostgreSQL.
- **Pros:** Theft detection — reuse of an old token signals compromise and triggers revocation. Each token is single-use, limiting attack window. RFC-aligned pattern. No need for Redis — PostgreSQL (already in stack) suffices.
- **Cons:** DB write on every refresh (not just login). Race conditions possible if client sends concurrent refresh requests. More complex implementation (token family tracking, reuse detection). Slightly more DB schema complexity.

### Option B: Long-lived Refresh Token with Blacklist
- Refresh token issued at login, stored in DB. Remains valid until expiry (e.g., 30 days) or explicit revocation. On logout or password change, token is added to a blacklist. Access token refresh does NOT rotate the refresh token.
- **Pros:** Simpler implementation — no rotation logic or family tracking. Fewer DB writes (only on login, logout, and revocation). No race condition issues with concurrent requests. Straightforward revocation model.
- **Cons:** Stolen refresh token remains valid until expiry or manual revocation — no automatic theft detection. Blacklist grows over time (mitigated by TTL cleanup). Less secure than rotation against token theft.

### Option C: Token Versioning (per-user counter)
- Each user has a `tokenVersion` column. The version is included in the refresh token payload. On verification, the token's version is compared against the DB. Incrementing the version invalidates all existing refresh tokens for that user.
- **Pros:** Single DB column per user — minimal storage. O(1) lookup per refresh. Bulk revocation is trivial (increment version). No blacklist table or cleanup needed.
- **Cons:** All-or-nothing revocation — cannot revoke a single session/device without invalidating all. No theft detection. No per-device session management. Less granular than rotation or blacklist.

**Recommendation:** **Option A (Refresh Token Rotation)** — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.

**Decision:** A (Refresh Token Rotation)

---

## TD-04: Email Confirmation & Password Reset Tokens

**Context:** Two flows require tokens sent via email: account confirmation and password reset. The choice is between stateless JWT-based tokens (self-contained, verified by signature) and stateful random tokens stored in the database.

**Options:**

### Option A: JWT Signed Tokens (stateless)
- Generate a JWT with the user ID, purpose (confirm/reset), and expiration. Send as a URL parameter. Verify by checking signature and expiration — no DB lookup required.
- **Pros:** No database table needed for tokens. Self-contained — expiration is embedded. Simpler cleanup (tokens expire naturally). Less DB load.
- **Cons:** Cannot be revoked once issued (e.g., if user requests a second reset, the first token remains valid until expiry). Token appears in URL — JWTs are longer than random strings (~200+ chars). Payload is readable (base64) — must not contain sensitive data. If JWT secret is compromised, all tokens are compromised.

### Option B: Random Opaque Tokens in Database
- Generate a cryptographically random token (e.g., `crypto.randomBytes(32)`), hash it, store in a `tokens` table with user_id, type, expires_at, and used_at. Verify by looking up the hash in DB.
- **Pros:** Revocable — can invalidate previous tokens when a new one is requested. Shorter URLs (hex-encoded 32 bytes = 64 chars). Token is opaque — no data leakage. Per-token revocation and usage tracking (used_at). Independent of JWT secret.
- **Cons:** Requires a database table and cleanup job for expired tokens. DB lookup on every verification. Slightly more implementation work (table, hash storage, cleanup).

**Recommendation:** **Option B (Random Opaque Tokens in DB)** — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.

**Decision:** B (Random Opaque Tokens in Database)

---

## TD-05: Email Sending Infrastructure

**Context:** Phase 02 requires sending transactional emails: account confirmation and password recovery. The project needs an email sending solution compatible with NestJS. The architecture diagram mentions "Email Service (SMTP)" as a container.

**Options:**

### Option A: @nestjs-modules/mailer (Nodemailer wrapper)
- NestJS-native module built on Nodemailer. Supports SMTP, SES, and other Nodemailer transports. Integrates with template engines (Handlebars, Pug, EJS). Provides `MailerService` injectable via DI.
- **Pros:** NestJS-native DI integration (`MailerModule.forRoot()`). Built-in template engine support (Handlebars, EJS, etc.). Supports multiple transports. Active maintenance (~400K weekly downloads). Works with any SMTP server (MailHog/Mailpit for dev, real SMTP for prod).
- **Cons:** Adds a dependency layer on top of Nodemailer. Template engine adds another dependency (e.g., Handlebars). Configuration is more opinionated.

### Option B: Nodemailer directly
- Use `nodemailer` package directly, wrapped in a custom NestJS service. Full control over transport, templates, and sending logic.
- **Pros:** No wrapper overhead — direct Nodemailer API. Maximum flexibility. ~5M weekly downloads, most battle-tested Node.js email library. Zero NestJS-specific abstraction to learn.
- **Cons:** Must build NestJS integration manually (DI provider, config, module). Must handle templates manually (string interpolation or manual template engine setup). More boilerplate for something @nestjs-modules/mailer already solves.

### Option C: Resend (API service)
- Cloud email API with clean SDK. API-first approach — no SMTP configuration. Free tier: 3,000 emails/month.
- **Pros:** Best developer experience — clean API, React Email support. Managed deliverability and IP reputation. No SMTP server setup needed. Free tier sufficient for development and small-scale production.
- **Cons:** External service dependency — adds vendor lock-in. Requires internet access (no offline dev without mocking). Free tier limit may be constraining. Not SMTP-based — doesn't match the architecture diagram's "Email Service (SMTP)" container. API key management.

**Recommendation:** **Option A (@nestjs-modules/mailer)** — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.

**Decision:** A (@nestjs-modules/mailer)

---

## TD-06: Request Validation Library

**Context:** Phase 02 introduces the first HTTP endpoints with user input (registration, login, password reset). A runtime validation library is needed to validate DTOs — rejecting invalid payloads before they reach the service layer. NestJS supports multiple approaches through its `ValidationPipe` and custom pipes.

**Options:**

### Option A: class-validator + class-transformer
- Decorator-based validation directly on TypeScript DTO classes. NestJS's built-in `ValidationPipe` uses class-validator under the hood. Over 80 built-in decorators (`@IsEmail()`, `@MinLength()`, `@IsString()`, etc.) plus support for custom validators. class-transformer handles plain-to-instance conversion (`transform: true`).
- **Pros:** First-class NestJS integration — `ValidationPipe` works out of the box with zero custom pipe code. Decorators co-located with the DTO class serve as documentation. Extensive decorator library covers most validation needs. Official NestJS documentation uses this approach. Supports nested validation, groups, and conditional rules.
- **Cons:** Relies on `reflect-metadata` and experimental decorators — TypeScript runtime coupling. Two separate packages needed (class-validator + class-transformer). Validation rules are not composable as schemas — harder to reuse outside DTOs. No type inference from validation rules (types and validators can drift apart).

### Option B: nestjs-zod (Zod schemas)
- Schema-first approach: define a Zod schema, then generate a DTO class via `createZodDto()`. Uses `ZodValidationPipe` (global or per-route) for validation. TypeScript types are inferred directly from the schema — single source of truth for types and validation.
- **Pros:** Single source of truth — types and validation rules cannot drift. Functional, composable schemas. Growing ecosystem (~5M weekly downloads for Zod). Works well for shared validation (frontend + backend). No dependency on `reflect-metadata` or experimental decorators.
- **Cons:** Requires `nestjs-zod` wrapper package (lower adoption than class-validator in NestJS). Different mental model from standard NestJS patterns — developers must learn Zod's API alongside NestJS. `createZodDto()` adds an abstraction layer. Less NestJS-specific documentation and examples. OpenAPI integration requires additional setup.

**Recommendation:** **Option A (class-validator + class-transformer)** — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.

**Decision:** A (class-validator + class-transformer)

---

## TD-07: Error Response Standardization

**Context:** Phase 02 is the first phase introducing public HTTP endpoints. The error response format defined here becomes the contract for all subsequent phases. Consistent error responses are essential for frontend consumption and API usability. The choice affects how domain exceptions, validation errors, and framework errors are presented to clients.

**Options:**

### Option A: Custom Domain Exception Filter — `{ statusCode, error, message }`
- Create a `DomainException` base class with domain error codes (e.g., `EMAIL_ALREADY_EXISTS`). A custom `@Catch(DomainException)` exception filter maps these to `{ statusCode, error, message }`. A separate filter normalizes class-validator errors into the same shape. Framework `HttpException`s pass through NestJS's default handling.
- **Pros:** Domain error codes are explicit and typed — easy for clients to switch on `error` field. Clean separation between domain errors (business logic) and HTTP errors (framework). Error catalog is self-documenting and testable. Custom filters give full control over the response shape. The format is simple and lightweight.
- **Cons:** Two custom filters to maintain (domain + validation). Must keep error catalog in sync with exception classes. Framework errors (404, 500) still use NestJS's default format — slight inconsistency unless a catch-all filter is added.

### Option B: NestJS Default HttpException — `{ statusCode, message, error }`
- Use NestJS's built-in `HttpException` and subclasses (`ConflictException`, `UnauthorizedException`, etc.) directly. No custom exception filter needed — the built-in exception layer formats responses as `{ statusCode, message, error }` where `error` is the HTTP status name (e.g., "Conflict").
- **Pros:** Zero custom code — works out of the box. Consistent with NestJS conventions. Less code to maintain. All HTTP exceptions follow the same format automatically.
- **Cons:** The `error` field contains HTTP status names ("Conflict", "Unauthorized") — not machine-readable domain codes. Clients cannot distinguish between "wrong password" and "expired token" without parsing the `message` string. No typed error catalog. Harder to maintain consistent error documentation. Mixing domain semantics into HTTP exceptions pollutes the framework layer.

### Option C: RFC 9457 Problem Details — `{ type, title, status, detail, instance }`
- Implement the RFC 9457 (Problem Details for HTTP APIs) standard. Responses include a `type` URI for the error, `title` summary, `status` code, `detail` explanation, and `instance` URI. Requires a custom exception filter to format all errors in this shape.
- **Pros:** Industry standard (IETF RFC). Self-documenting via `type` URI. Extensible — custom fields are allowed. Supported by API tooling (OpenAPI, Swagger). Future-proof for complex API ecosystems.
- **Cons:** Overhead for a single-app project — `type` URIs need to be defined and maintained. More verbose response shape. NestJS has no built-in support — requires full custom implementation. Overkill for a project where the only consumer is a first-party Next.js frontend. Learning curve for developers unfamiliar with the RFC.

**Recommendation:** **Option A (Custom Domain Exception Filter)** — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.

**Decision:** A (Custom Domain Exception Filter)

---

## TD-08: Rate Limiting Strategy

**Context:** Auth endpoints (login, register, password reset) are prime targets for brute-force attacks. A rate limiting mechanism is needed to restrict the number of requests per IP within a time window. The project uses NestJS 11 with Express as the HTTP adapter.

**Options:**

### Option A: @nestjs/throttler
- Official NestJS rate limiting module. Provides `ThrottlerModule.forRoot()` configuration with `ttl` (ms) and `limit`. Uses a `ThrottlerGuard` that integrates with NestJS's guard system. Supports `@SkipThrottle()` and `@Throttle()` decorators for per-route overrides. In-memory storage by default, with pluggable stores for Redis/Memcached.
- **Pros:** Native NestJS module — DI integration, decorator-based overrides, guard lifecycle. Scoping via module imports (can restrict to specific modules). `@SkipThrottle()` decorator for exempting routes. Supports multiple named throttlers for different rate limits. Active maintenance by the NestJS team. v6 supports NestJS 11.
- **Cons:** In-memory storage by default — does not persist across restarts or scale across instances (acceptable for single-instance). Less granular than express-rate-limit (e.g., no built-in `ipv6Subnet` handling). Fewer external store adapters compared to express-rate-limit ecosystem.

### Option B: express-rate-limit
- Express middleware for rate limiting. Configured as a middleware function with `windowMs`, `limit`, and options for headers (standard `RateLimit-*` or legacy `X-RateLimit-*`). Applied via `app.use()` to specific paths or globally. Supports external stores (Redis, Memcached, MongoDB) for distributed deployments.
- **Pros:** Mature library (~8M weekly downloads). Built-in standard headers support (`RateLimit-*` per draft-8). `ipv6Subnet` handling for subnet-aware limiting. Large ecosystem of external stores. Simple middleware API.
- **Cons:** Express middleware — does not integrate with NestJS's guard/decorator system. Cannot use `@SkipThrottle()` or `@Throttle()` decorators — must apply middleware per path. Applied in `main.ts` or as NestJS middleware — outside the module/DI system. Harder to scope to specific modules. No native support for NestJS execution context (WebSocket, GraphQL).

**Recommendation:** **Option A (@nestjs/throttler)** — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.

**Decision:** A (@nestjs/throttler)

---

## TD-09: Refresh Token Format

**Context:** TD-03 defined the refresh token strategy (rotation with family-based theft detection), but not the token format. Since every refresh operation requires a DB lookup (for rotation and reuse detection), the format choice is about what information the token carries, not whether DB access can be skipped. Depends on TD-02 (auth approach) and TD-03 (refresh strategy).

**Options:**

### Option A: JWT (signed token with payload)
- Refresh token is a JWT signed with a dedicated secret/key, carrying `userId`, `tokenFamily`, `jti` (unique ID) in the payload. On refresh, the `jti` is looked up in the DB to validate rotation state. Expiration is embedded via `exp` claim.
- **Pros:** Consistent format with access token — same signing/verification infrastructure (`@nestjs/jwt`). Payload carries structured data useful for logging and debugging without a DB query. `jti` claim provides a standard unique identifier. Expiration is self-contained via `exp`.
- **Cons:** Payload is base64-readable — leaks `userId` and `tokenFamily` if intercepted (mitigated by HTTPS). Longer than a random string (~200+ chars). Signature verification is technically redundant since DB lookup is mandatory (TD-03).

### Option B: Opaque (random bytes)
- Refresh token is a cryptographically random string (`crypto.randomBytes(32)`, hex-encoded = 64 chars). Stored in DB and looked up by hash on each refresh.
- **Pros:** No data leakage — token is meaningless without DB. Short (64 chars hex). No signing infrastructure needed for refresh tokens.
- **Cons:** Cannot extract any information without a DB query — even basic logging requires a lookup. Different handling from access tokens — two token formats in the codebase. No standard claims (`exp`, `jti`) — expiration must be tracked exclusively in DB.

**Recommendation:** **Option B (Opaque)** — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.

**Decision:** A (JWT) — Consistency with the access token format is preferred. The team wants a single token infrastructure using `@nestjs/jwt` for both access and refresh tokens. Payload data (`userId`, `tokenFamily`) simplifies logging and debugging. Data leakage risk is acceptable given HTTPS enforcement.

---

## TD-10: Nickname Generation from Email Prefix

**Context:** On registration, a default nickname (channel handle) must be generated automatically from the user's email prefix (the part before `@`). This handle is used as the user's public identifier and must be URL-safe, unique, and reproducible even when the email prefix contains only non-ASCII or special characters.

> **Note:** This decision was made during implementation of SI-02 and documented retroactively. The chosen approach was implemented directly without a pre-implementation decision round.

**Options:**

### Option A: Strict allowlist — `[a-z0-9_]` only, empty fallback to `user_<random>`
- Lowercase the email prefix, strip all characters outside `[a-z0-9_]`, truncate to 46 characters (reserving 4 for the `_xxx` uniqueness suffix within the 50-char column limit). If the sanitized result is empty, generate `user_` + 8 random hex characters.
- **Pros:** Produces URL-safe, predictable handles. Handles the worst case (prefix is all special chars) with a well-formed fallback. Consistent character set regardless of locale or email provider.
- **Cons:** Strips hyphens (`-`), which are common in email addresses (e.g., `first-last@...`). May produce very short handles if the prefix is mostly non-ASCII.

### Option B: Broader allowlist — `[a-z0-9_-]` (include hyphen)
- Same as Option A but allows hyphens in the handle.
- **Pros:** Preserves hyphenated email prefixes (common pattern). Fewer characters stripped from real-world emails.
- **Cons:** Hyphens at the start/end of the handle require additional trimming logic. Some platforms disallow leading/trailing hyphens in usernames. Slightly more validation complexity.

### Option C: Transliteration before sanitization
- Transliterate non-ASCII characters to ASCII equivalents (e.g., `ñ → n`, `ü → u`) before applying the allowlist. Falls back to random if transliteration yields nothing.
- **Pros:** Preserves more of the original email prefix intent (especially for non-Latin scripts). Lower rate of fallback to random handles.
- **Cons:** Requires a transliteration library (e.g., `transliteration` or `any-ascii`). Transliteration output varies by locale — `ä` may map to `ae` or `a`. Adds a dependency for an edge case. Non-deterministic across library versions.

**Recommendation:** **Option A** — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.

**Decision:** A — `[a-z0-9_]` allowlist with `user_<8-char-random>` fallback when the prefix yields an empty string.

---

## Decisions Summary

| ID | Decision | Recommendation | Choice |
|----|----------|---------------|--------|
| TD-01 | Password Hashing Algorithm | Argon2id | B (Argon2id) |
| TD-02 | Auth Library Approach | @nestjs/passport + @nestjs/jwt | B (Custom guards with @nestjs/jwt only) |
| TD-03 | Refresh Token Strategy | Rotation (stored in DB) | A (Refresh Token Rotation) |
| TD-04 | Email Confirmation & Reset Tokens | Random opaque tokens in DB | B (Random Opaque Tokens in Database) |
| TD-05 | Email Sending Infrastructure | @nestjs-modules/mailer | A (@nestjs-modules/mailer) |
| TD-06 | Request Validation Library | class-validator + class-transformer | A (class-validator + class-transformer) |
| TD-07 | Error Response Standardization | Custom Domain Exception Filter | A (Custom Domain Exception Filter) |
| TD-08 | Rate Limiting Strategy | @nestjs/throttler | A (@nestjs/throttler) |
| TD-09 | Refresh Token Format | Opaque (random bytes) | A (JWT) |
| TD-10 | Nickname Generation from Email Prefix | `[a-z0-9_]` allowlist + random fallback | A (`[a-z0-9_]` + `user_<random>` fallback) |