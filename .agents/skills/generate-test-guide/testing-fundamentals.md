# Testing Fundamentals — Universal Principles

These are technology-agnostic testing principles. The `/generate-test-guide` skill reads this file as a foundation and combines it with project-specific analysis to produce a concrete testing rule.

---

## The Criteria

### Worth testing

- **Business logic with branching** — conditionals, state machines, permission checks, domain rules
- **Security boundaries** — auth, authorization, rate limiting, input sanitization, xss, csrf, sql injection, etc.
- **Data integrity** — transformations, serialization, migrations, calculations where wrong output = corrupt data
- **Error handling** — what happens when external services fail, database is down, user is unauthorized
- **Critical user flows** — auth, payment, upload, core CRUD that users depend on
- **Race conditions** — concurrent operations, optimistic locking, queue processing
- **Boundary/edge cases** — null, empty, max values, off-by-one, overflow conditions
- **External integrations** — webhooks, unexpected API responses, timeouts, contract mismatches
- **System boundary contracts** — queries to external systems, data mappings, unique constraints, message formats, HTTP client requests to external APIs. Even without branching logic, a wrong query or broken mapping is a real bug that only integration tests catch.
- **Configured dependency contracts** — when you configure a library or framework module (JWT secret/expiration, cache TTL, throttle limits, queue options), that configuration is a contract your system depends on. The library's own tests verify its internal mechanics — they cannot verify that YOUR configuration is correct. Use real instances with test config instead of mocking. A mocked `JwtService.sign()` returning `'fake-token'` never catches a wrong secret, a bad expiration, or a malformed payload.
- **Module/DI configuration** — module files wire dependencies, configure framework integrations, and declare exports. A missing import, a wrong configuration value, or a forgotten export causes real runtime failures. Test that modules compile correctly and that their configured dependencies resolve with the expected behavior.

### NOT worth testing

- **Framework behavior** — Trust what the framework guarantees: rendering, routing, request handling, ORM persistence, loading states. **Exception:** any operation that encodes assumptions about the external system's structure is NOT framework behavior — it's a system boundary contract.
- **Validation passthrough** — One test per endpoint proving the validator is wired is enough. Exception: security or business-critical validation rules.
- **Mirror tests** — When the assertion copies the return value of the implementation.
- **Duplicate coverage across layers** — Each test must catch a bug no other test catches. **Critical clarification:** E2E tests do NOT make service integration tests redundant.
- **Wiring tests** — Tests that only verify a side-effect call was made with the right arguments. **Exception:** module compilation tests are NOT wiring tests.
- **Static structure assertions (unit layer)** — Field existence, field types, initial state values.
- **Output shape without behavior** — Tests that verify static output without exercising any logic.
- **Variant repetition without branching** — Multiple tests exercising the same code path with different inputs.
- **Single-path utilities (unit layer only)** — Functions with no conditionals, no error handling, no edge cases. Exception: system boundary contracts.

---

## Mock Health

- **Mock across architecturally significant boundaries, not within.** Mocking internal
  collaborators couples tests to implementation details.
- The litmus test: can you describe what **observable behavior** this test validates
  without referencing mock interactions? If not, you're testing wiring, not behavior.
- When a test needs many mocks to set up, rewrite it as an integration test or split
  the unit under test into smaller, more focused units.

---

## Each Layer Has a Purpose

Each layer answers a different question. Assign tests to the layer whose question they answer — never duplicate a question across layers.

**Unit tests** answer: *is the logic correct?*
Prove isolated logic works — branching, calculations, domain rules, permission checks.

**What to mock in unit tests:**
- **Owned services** (services you wrote): mock them — they have their own tests.
- **Configured framework dependencies** (libraries you configure): use real instances with test config.
- **Side-effect dependencies** (email, SMS): mock — irreversible external effects.
- **Slow pure functions** (e.g., bcrypt): do NOT mock unless genuinely prohibitive. Use lower cost parameters.

**Integration tests** answer: *is the contract with external systems correct?*
Prove that a service interacts correctly with external systems — databases, HTTP clients, message queues, email, caches.

**E2E tests** answer: *is the HTTP contract correct?*
Prove the full request-to-response chain — HTTP status codes, input validation wiring, access control behavior, response body format, and authentication flows.

```
Unit        → is the logic correct?                    mock owned services; use real configured libs; mock slow/side-effect deps
Integration → is the external system contract correct? real or fake system, no HTTP layer
E2E         → is the HTTP contract correct?            real or fake systems, real HTTP stack
```

> **Terminology note:** What this document calls "E2E" corresponds to what many industry
> sources call "HTTP integration tests" — tests that use the real HTTP stack (e.g., supertest,
> TestClient) to exercise the full request-to-response chain. True multi-service or
> browser-based end-to-end tests are a separate concern not covered by this layer.

| Layer | Write when | Skip when |
|-------|------------|-----------|
| **Unit** | Functions with conditionals, calculations, domain rules, state machines | No branching; any external system access (use integration instead) |
| **Integration** | Any service that crosses a system boundary — DB, HTTP client, queue, email, cache | Logic already covered by unit; HTTP contract concerns (use E2E instead) |
| **E2E** | HTTP status codes, input validation, access control, auth flows, response format | Business logic already in unit; external system contract already in integration |

---

## Real vs Fake in Integration Tests

| External system | Strategy | Why |
|----------------|----------|-----|
| **Database** | Real (test DB in Docker) | Fast to spin up, fully controllable, no rate limits |
| **Message queue** | Real (broker in Docker) | Controllable and the contract matters |
| **Cache (Redis)** | Real (in Docker) | Caching behavior depends on real TTL and eviction |
| **Email (SMTP)** | Fake (in-memory) | Real SMTP is slow, unreliable, has side effects |
| **External HTTP API** | Fake (fake HTTP server) | Rate limits, costs, network flakiness |
| **Payment gateway** | Fake (sandbox or mock) | Never hit real payment APIs in tests |
| **File storage** | Fake (in-memory or local emulator) | Avoid network calls and costs |

**Decision rule:** if you can run it locally with Docker in under 5 seconds and it has no external cost or flakiness risk → use real. Otherwise → use a fake that captures observable behavior.

---

## Layer Assignment Table

| Code | Unit | Integration | E2E |
|------|------|-------------|-----|
| Service with branching logic | ✅ test the branches (mock owned services; use real configured libs) | ✅ test external system contract (only if it also crosses a system boundary) | — |
| Service with no branching, accesses DB | ❌ no unit test | ✅ real DB | — |
| Service that sends email | ❌ no unit test | ✅ fake SMTP | — |
| Service that calls external HTTP API | ❌ no unit test | ✅ fake HTTP server | — |
| Service that publishes to queue | ❌ no unit test | ✅ real broker in Docker | — |
| Service using configured framework lib (JWT, cache, throttle) | ✅ use real lib with test config | — | — |
| Module configuration (DI wiring, exports, configured imports) | ✅ compile module, verify DI resolves | — | — |
| HTTP handler / controller | ❌ skip (wiring test) | — | ✅ status codes, validation, access control |
| Middleware / access control | — | — | ✅ rejected/accepted requests |
| Pure utility function with branching | ✅ | — | — |

> **Exception — complex middleware:** Middleware with complex internal logic (multi-step
> authentication, stateful rate limiting, request transformation pipelines) may also warrant
> integration tests with the real auth/rate-limiting stack, in addition to E2E tests.

---

## Principles

- Read the actual test code — don't judge by name alone
- Apply the criteria consistently — if a test matches NOT worth testing and doesn't match Worth testing, remove it
- Respect project conventions (test configs, directory structure)
- The test pyramid is a guideline, not a law — if logic lives in API handlers, integration tests may matter more than unit tests
- **A unit test that mocks a dependency does not test the dependency.** If Service A mocks Service B in its unit tests, those tests say nothing about whether Service B works correctly against the real system. Service B must have its own integration tests. The chain is: unit test proves the caller's logic is correct → integration test proves the callee's external system contract is correct. Both are required; neither substitutes the other.
