# Technical Decisions — Phase 02: Cadastro, Login e Gerenciamento de Conta

> **Phase:** 02 — Cadastro, Login e Gerenciamento de Conta
> **Status:** Finalized
> **Date:** 2026-04-02

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

## Decisions Summary

| ID | Decision | Recommendation | Choice |
|----|----------|---------------|--------|
| TD-01 | Password Hashing Algorithm | Argon2id | B (Argon2id) |
| TD-02 | Auth Library Approach | @nestjs/passport + @nestjs/jwt | B (Custom guards with @nestjs/jwt only) |
| TD-03 | Refresh Token Strategy | Rotation (stored in DB) | A (Refresh Token Rotation) |
| TD-04 | Email Confirmation & Reset Tokens | Random opaque tokens in DB | B (Random Opaque Tokens in Database) |
| TD-05 | Email Sending Infrastructure | @nestjs-modules/mailer | A (@nestjs-modules/mailer) |
