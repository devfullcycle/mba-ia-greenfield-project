---
name: plan-phase
description: "Generate a technical implementation plan for a project phase. Use whenever the user asks to plan, detail, or generate the technical plan for a phase — including variations like 'plan phase X', 'detail the phase', 'generate phase implementation', 'create the phase-XX.md', or any mention of creating the technical document for a project phase."
disable-model-invocation: true
---

# Plan Phase

Generate a technical implementation plan for a project phase. This document connects the general plan (what to deliver) with execution (code). It defines technical step implementations, implementation actions, dependencies, and acceptance criteria.

## Context — read before generating

1. **`docs/project-plan.md`** — general project plan. Contains the phase description, its capabilities, and deliverables. This is the primary source.
2. **`docs/decisions/`** — For previous phases: read only the **Decisions Summary** table at the end of each document — it is sufficient to detect conflicts without reading the full discussion. If the summary suggests a conflict with the current phase, read the full document of that phase to confirm before reporting. These choices are hard constraints; do not reopen them. For the current phase: if a decisions document exists, read it in full and use the user's choices. If it doesn't exist, the user must provide their technical decisions alongside the request.
3. **`docs/phases/`** — already planned phases. Read all of them to maintain consistency in format, naming, and level of detail.
4. **Testing conventions** — Identify the target subproject(s) from `docs/project-plan.md`. If a phase spans multiple subprojects, apply this step to each. If the target subproject has a testing guide skill (e.g., `testing-guide-{subproject}`), use the Skill tool to load it. Use it as the reference to identify which test layers (Unit, Integration, E2E) and which test files are required for each artifact created in each SI. This information populates the **Tests** section of each SI and informs the **Deliverables**. Other skills (best practices, ORM guides) are implementation concerns and should not be loaded during planning.

If the user has not provided technical decisions and no decisions document exists, ask before generating. Technical decisions are the user's responsibility, not the agent's. Examples: authentication strategy, specific libs, storage patterns, upload limits, accepted formats.

## Validation — run before generating

After reading all context sources, validate the inputs before producing any output. The goal is to catch problems that would lead to a flawed implementation plan. Check for:

**Inconsistencies across documents:**
- Capabilities in project-plan.md that contradict technical decisions (e.g., project plan says "email confirmation" but decisions say "no email service").
- Technical decisions that conflict with each other (e.g., "JWT stateless" but also "immediate token revocation").
- Decisions that conflict with choices made in previous phases.

**Ambiguities in the phase scope:**
- Capabilities described too vaguely to decompose into actionable step implementations (e.g., "handle authentication" — which flows exactly?).
- Unclear boundaries — is a capability part of this phase or the next?
- Missing edge cases that will surface during implementation (e.g., "user login" but no mention of what happens when email is unconfirmed).

**Missing decisions:**
- Capabilities that require a technical choice but have no corresponding decision (e.g., phase includes "upload large files" but no decision on chunked vs streaming vs resumable).
- Implicit assumptions that should be explicit (e.g., "rate limit on auth endpoints" but no defined values).
- Phase exposes HTTP endpoints in a subproject but no error response format has been decided for that subproject (in this phase or a previous one).

**Dependency gaps:**
- Phase depends on something from a previous phase that was not planned or delivered.
- Circular or missing dependencies between capabilities within the phase.

**If any issues are found:** stop and present them to the user before generating the plan. Group issues by type (inconsistency, ambiguity, missing decision, dependency gap). Be specific — quote the conflicting statements or point to the exact capability that is unclear. Wait for the user to resolve them. Once the user confirms resolutions (typically by updating `docs/decisions/` or the phase scope in `docs/project-plan.md`), re-read the affected sources and re-run the validation checks before generating the plan.

**If no issues are found:** proceed to generate the plan.

## Research during planning

When writing implementation actions, you may need to verify specific details about libs, APIs, or patterns referenced in the technical decisions. Use the Context7 MCP to fetch current documentation for any lib or framework mentioned in the decisions. This ensures implementation actions reference accurate APIs, method names, and configuration options — not outdated ones from training data.

**Dispatch Context7 lookups in parallel.** At the start of plan drafting, issue one tool call per library mentioned in the decisions document, all in a single message. For example, for an auth phase that chose argon2, @nestjs/jwt, @nestjs-modules/mailer, class-validator, and typeorm, send five `mcp__context7__query-docs` calls in parallel. Do NOT look up libraries one-by-one as you write each SI — batch them upfront and refer back to the results.

Use web search for broader questions: best practices, security recommendations, RFC details, or comparisons that go beyond a single lib's docs.

## Output structure

The plan follows a fixed structure. Each phase generates a single markdown file.

> **Reading the template below:** text rendered as `_(italic in parentheses)_` is author guidance about *when* to include the surrounding section or subsection. Do **not** copy these parentheticals into the generated phase document — apply them as conditions and include the block only when the condition holds.

```markdown
# Phase NN — [Phase Name]

## Objective

One sentence summarizing what this phase delivers.

---

## Step Implementations

### SI-NN.1 — [SI name]

**Description:** What this step implementation implements, in one or two sentences.

**Technical actions:**

- Concrete implementation action
- Concrete implementation action
- Concrete implementation action

**Tests:** _(omit if the SI creates no testable artifacts)_

| File | Layer | Verifies |
|------|-------|----------|
| file.spec.ts | Unit/Integration/E2E | what this file tests |

**Dependencies:** SI-NN.X (comma-separated if multiple, e.g., `SI-02.1, SI-02.3`) or None

**Acceptance criteria:**

- Verifiable criterion specific to this step implementation
- Verifiable criterion specific to this step implementation

---

(repeat for each step implementation)

## Technical Specifications

_(include only the subsections that apply to the phase — see applicability checklist below)_

### Data Model

#### [EntityName]

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | |
| field | type | constraints | |

**Relations:** EntityName → OtherEntity (many-to-one)
**Indexes:** (field_a, field_b) — unique

---

### API Contracts

#### METHOD /resource/path (SI-NN.X)

**Request headers:**
- Authorization: Bearer <access_token> (if authenticated)
- Content-Type: application/json

**Request body:**
- field: type, required/optional — constraints

**Response NNN:**
- field: type

**Response headers:** (if applicable)
- Header-Name: description

**Error responses:**
- 4XX ERROR_CODE: when this error occurs (for domain errors with codes from the Error Catalog)
- 400 validation error: when the request body fails schema validation (no domain code)

#### Validation Rules — [EntityName or endpoint] _(optional — only when validation rules are extensive)_

| Field | Rule | Error message |
|-------|------|---------------|
| field | rule description | message returned on violation |

---

### Authorization Matrix

| Endpoint | Public | Authenticated | Role |
|----------|--------|---------------|------|
| GET /resource | ✓ | | |
| POST /resource | | ✓ | |
| DELETE /resource/:id | | | OWNER or ADMIN |

---

### Error Catalog

**Error response format:** _(include only in the first phase that introduces HTTP endpoints in this subproject — later phases in the same subproject inherit this shape and do not redefine it)_
```
{ statusCode, error, message }
```
_The `error` field carries the domain error code from the Error Catalog (e.g., `"EMAIL_ALREADY_EXISTS"`). Adjust shape per subproject conventions._

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| ERROR_CODE | 4XX | Human-readable message | Which operation + which branch triggers it |

---

### Events/Messages

| Event | Payload | Publisher | Consumer | Delivery |
|-------|---------|-----------|----------|----------|
| event.name | { field: type } | ServiceName | WorkerName | fire-and-forget / ack-required |

---

## Dependency Map

(text tree showing implementation order — one node per SI, children are SIs that depend on the parent)

```
SI-NN.1 (no deps)
├── SI-NN.2
│   └── SI-NN.4
└── SI-NN.3
    └── SI-NN.5
```

## Deliverables

- [ ] Verifiable deliverable
- [ ] Verifiable deliverable
- [ ] All SI tests pass (`<test command for subproject>`)
- [ ] E2E tests pass (`<e2e test command, if applicable>`)
- [ ] Type/compilation check passes (`<type-check command for subproject>`)
- [ ] Project builds successfully (`<build command for subproject>`)
```

## How to decompose the phase into Step Implementations

Each capability listed in the phase from project-plan.md becomes one or more technical step implementations. The decomposition follows these rules:

- **One step implementation = one cohesive unit of work.** If two capabilities share the same module/service and don't make sense separately, group them. If a capability is too large, break it down.
- **Numbering follows the phase.** Phase 02 → SI-02.1, SI-02.2, etc.
- **Dependencies are between step implementations of the same phase.** Dependencies with other phases are already in project-plan.md and don't need to be repeated.
- **Size constraint.** An SI that is too large leads to quality degradation during implementation. Use these heuristics to keep SIs small:
    - Maximum 5 technical actions per SI.
    - Maximum 5 test files per SI.
    - If an SI installs dependencies AND configures modules AND creates entities AND implements business logic — it is doing too much. Separate infrastructure (install, configure) from behavior (implement, test).
    - When in doubt, prefer more smaller SIs over fewer larger ones. The execution skill handles dependencies between them.

## How to write Technical Actions

Technical actions are the heart of the document — they guide implementation. Follow these guidelines:

- Use action verbs in the infinitive: create, configure, implement, add, enable.
- Be specific enough that another agent can implement without ambiguity. "Set up rate limiting" is vague. "Install and configure rate-limiting middleware with a 10-requests-per-minute window on auth endpoints" is actionable.
- Include names of libs, modules, patterns, and relevant configurations. The plan must reflect the user's technical decisions.
- Do not include code. The plan describes what to do, not how to code it. Referencing lib APIs, method names, and configuration options by name in prose is expected.
- When introducing new dependencies, list the package name with a version range compatible with the project's existing framework version. Example: `Install @nestjs/jwt@^11.0.0, @nestjs/typeorm@^11.0.0 (NestJS 11 compatible)`. This prevents peer dependency conflicts during implementation.

## How to write the Tests section

Each SI that creates testable artifacts has a **Tests** section (table format) listing the test files to be created, their layer, and what they verify. The layer and coverage requirements come from the testing guide's Feature Implementation Checklist — do not reinvent them here.

### Process

1. **List the artifacts** created in the SI (entities, services, modules, controllers, middleware, DTOs, and any other artifact types defined by the subproject's testing guide).
2. **For each artifact**, consult the testing guide to determine which test layers are required. If the subproject has no testing guide, insert a `[DECIDE: testing layers for <artifact> — unit only | unit + integration | unit + integration + e2e]` marker (see drafting marker convention) and continue; do not invent layer requirements.
3. **Write one row per test file** with: file name, layer, and what the test verifies (brief — not full test names).

### Format

| File | Layer | Verifies |
|------|-------|----------|
| file.spec.ts | Unit/Integration/E2E | what this file tests |

E2E tests are listed per endpoint group (one row per e2e spec file — typically the set of endpoints sharing a controller/feature), not per individual endpoint. If the SI creates no testable artifacts, the Tests section may be omitted.

## How to write Acceptance Criteria

Acceptance criteria live inside each step implementation — they describe how to verify that specific SI is done by observing system behavior from the outside. They answer: "How do I confirm this SI works without reading the source code?"

Implementation details (which library, which algorithm, which ORM method) belong in Technical actions. Which test files verify the criteria belongs in the Tests section. ACs focus only on externally observable behavior.

### Template formulas

Use these sentence patterns. Replace the bracketed placeholders with specifics from the SI's technical actions and API contracts.

**HTTP endpoint behavior** (most common — one per endpoint per relevant scenario):

    [METHOD] [/path] with [input description] returns [HTTP status] with [expected body or error code]

Example: `POST /auth/register with an already-registered email returns 409 with EMAIL_ALREADY_EXISTS`

**Database/persistence behavior** (constraint enforcement, atomicity, data integrity):

    [operation description] — [expected persistence outcome or constraint violation]

Example: `Creating a user with channel is atomic — if channel creation fails, no user row is persisted`

**Side-effect behavior** (email sent, event published, job enqueued):

    [trigger action] causes [observable side effect] containing [key payload element]

Example: `Registering a new user causes a confirmation email to be delivered containing a confirmation link with a token`

**Security behavior** (data not leaked, timing-safe, tokens invalidated):

    [action that probes for information] returns [response that reveals nothing or enforces the boundary]

Example: `POST /auth/login with a non-existent email returns 401 with INVALID_CREDENTIALS — same error as wrong password, not revealing email existence`

### Step-by-step: deriving ACs from an SI

1. **Start with the happy path.** Read the SI's technical actions end-to-end. Write one AC describing the successful outcome an external observer would see (HTTP response, email received, record created).
2. **Walk each branching point.** For every conditional in the technical actions (uniqueness check, permission check, token validation, confirmation status), write one AC for the failure branch. Use the error code from the Error Catalog.
3. **Check for side effects.** If the SI sends an email, publishes an event, or enqueues a job, write one AC for each side effect. Describe what is observable — not the internal mechanism.
4. **Check for security boundaries.** If the SI handles credentials, tokens, or user-identifying data, write one AC ensuring the system does not leak information.
5. **Trim redundancy.** If an AC duplicates what another SI already covers (e.g., global validation behavior tested once in the infrastructure SI), remove it. Each AC must verify something unique to this SI.

### Few-shot examples

**Example 1 — HTTP endpoint (registration)**

BAD: `User registration works and creates an account`
GOOD: `POST /auth/register with valid email and password returns 201 with { id, email, name }; a channel is automatically created with handle derived from the email prefix`
WHY: Specifies method, path, input, status code, response shape, and observable side effect — verifiable without reading code.

**Example 2 — Security (login)**

BAD: `Login fails when credentials are wrong`
GOOD: `POST /auth/login with a non-existent email returns 401 with INVALID_CREDENTIALS — same error code and status as a wrong password, so email existence is not revealed`
WHY: Makes the security requirement explicit and verifiable: an observer can confirm both cases return the same error.

**Example 3 — Side effect (email confirmation)**

BAD: `Confirmation email is sent after registration`
GOOD: `Registering a new user causes a confirmation email to be delivered to the registered address, containing the user's name and a confirmation link with the token`
WHY: Specifies observable outcome (email delivered), recipient, and key content — verifiable by inspecting the test mailbox.

**Example 4 — Persistence (token reuse detection)**

BAD: `Refresh token rotation handles theft`
GOOD: `POST /auth/refresh with an already-used refresh token returns 401 with TOKEN_REUSE_DETECTED and all refresh tokens in the same rotation family are revoked`
WHY: Describes exact trigger, response, and persistence consequence — all observable without reading source.

### Validation checklist

Before finalizing, verify each criterion passes:

1. **Observable?** Can I verify this by calling an endpoint, checking a mailbox, or querying a database — without reading source code?
2. **Specific?** Does it name the HTTP method, path, status code, error code, or observable outcome?
3. **Scoped?** Does it belong to exactly this SI?
4. **Non-redundant?** Is it not already covered by another AC in this or a different SI?
5. **Behavioral, not implementation?** Does it describe what the system does — not how it does it internally?
6. **Distinct from Technical actions?** Implementation choices belong in Technical actions. ACs describe the externally visible result.
7. **Distinct from Tests?** ACs do not reference test layers or test files — that mapping lives in the Tests section.

### Boundary rules

| Concern | Where it goes | Example |
|---------|---------------|---------|
| What the system does externally | **Acceptance criteria** | `POST /auth/login with valid credentials returns 200 with { access_token, refresh_token }` |
| How to build it internally | **Technical actions** | `Hash password using argon2.hash(); verify with argon2.verify()` |
| Which test files verify it | **Tests section** | `auth.e2e-spec.ts \| E2E \| login 200, 401, 403` |

### How many ACs per SI

- **Minimum: 1** — happy path AC.
- **Typical: 3–7** — One happy path + error branches + side effects + security boundaries.
- **Soft cap: 10** — When an SI exceeds 10 ACs, split the SI unless the extra criteria are genuinely inseparable.

### Edge cases

- **Infrastructure SIs** (no dedicated endpoint of their own — behavior is exercised through any request they intercept, such as framework-level middleware, error handlers, or request interceptors): ACs describe the observable effect on requests that pass through. Example: `A request with an invalid body returns 400 with validation error messages`.
- **Side-effect SIs** (email, queue, event): ACs describe the observable effect on the external system and mention the verification tool if needed.
- **Pure persistence SIs** (entity creation, migration): ACs describe schema or constraint behavior. Example: `Inserting a duplicate email fails with a unique constraint violation`.

## How to draft the plan file

Write the plan file incrementally, not in a single large write. This bounds each tool call, makes review easier, and avoids hitting output size limits.

**Recommended order:**

1. **Before creating the file**, dispatch Context7 lookups in parallel for every library mentioned in the decisions document (see `## Research during planning` above). **Then create the file** with the header, Objective, and a placeholder `## Step Implementations` heading (single `Write` call).
2. **Append SIs one at a time** — use `Edit` to insert each SI (Description, Technical actions, Tests, Dependencies, Acceptance criteria) after the last SI. Finalize each SI's acceptance criteria using the AC validation checklist (see `### Validation checklist` under "How to write Acceptance Criteria") before moving on.
3. **Append Technical Specifications** after all SIs are written — one subsection at a time (Data Model → API Contracts → Authorization Matrix → Error Catalog → Events/Messages). Include only applicable subsections.
4. **Append Dependency Map and Deliverables** last.

**Why incremental:** a single `Write` call with the full plan can exceed practical output limits when the phase has many SIs, extensive API contracts, or a large error catalog. Incremental writes also let you capture ambiguities as inline markers without breaking the drafting flow (see marker convention below).

**Handling unresolved ambiguities during drafting:** If you reach a point where a decision is missing and was not caught during Validation, insert an inline marker `[DECIDE: option A | option B — brief context]` in the draft and continue. When the draft is complete, present all markers to the user via `AskUserQuestion` (one question per marker). `AskUserQuestion` accepts up to 4 questions per call, so if there are ≤4 markers use a single call; if there are more, issue sequential calls of up to 4 questions each until all markers are resolved. Apply the answers with targeted `Edit` calls. This avoids breaking the drafting flow with mid-stream questions.

## How to write Technical Specifications

Not every phase needs all specification sections. Use this checklist to decide which to include:

- Phase introduces or alters database entities → **Data Model**
- Phase exposes HTTP endpoints → **API Contracts** + **Validation Rules** (inline in API Contracts if concise; separate section if extensive)
- Phase has behavior that depends on authentication or roles → **Authorization Matrix**
- Phase introduces one or more domain-specific error scenarios → **Error Catalog** (even a single domain error warrants a catalog entry so it can be referenced by code from ACs and API Contracts; the first phase to introduce HTTP endpoints in a subproject must also define the error response format here)
- Phase involves queues or asynchronous processing → **Events/Messages**

If none of these apply (e.g., a pure infrastructure phase), omit the Technical Specifications section entirely.

### Data Model

Specify for each new or modified entity:
- All columns with name, type, and constraints (PK, unique, nullable, default, generated). Use the **Notes** column for remarks that don't fit the other columns (e.g., computed values, special behavior, format examples); leave it blank when nothing extra needs to be said.
- Relations with other entities (one-to-many, many-to-one, many-to-many) and which side owns the foreign key.
- Indexes needed for query performance or uniqueness enforcement.
- Do not specify ORM decorators or migration code — describe the intended schema.

### API Contracts

Specify for each endpoint:
- HTTP method and route.
- Request body fields with type, required/optional, and validation constraints (min/max length, format, allowed values).
- Response body fields with type for each relevant status code.
- Response headers when meaningful (e.g., Set-Cookie, Location).
- Error responses: HTTP status code, error code from the Error Catalog (when applicable), and when it occurs.
- Reference the step implementation that implements the endpoint (e.g., SI-02.1).

When validation rules are simple (2-3 constraints per field), describe them inline in the request body. When extensive, group them in a separate **Validation Rules** subsection per endpoint or per entity.

### Authorization Matrix

A table mapping every endpoint of the phase to its access requirement:
- **Public:** no authentication needed.
- **Authenticated:** requires a valid token/session.
- **Role:** requires a specific role (specify which).

### Error Catalog

List every domain-specific error the phase introduces. Each entry has:

- **Code** — application-level identifier in `SCREAMING_SNAKE_CASE` (e.g., `EMAIL_ALREADY_EXISTS`, `TOKEN_REUSE_DETECTED`). Globally unique within the subproject that owns the HTTP API (no two error codes emitted by the same API may collide). Stable — does not change once defined.
- **HTTP** — the HTTP status code returned with this error.
- **Message** — human-readable message returned in the response body's `message` field.
- **Trigger** — the specific operation and branch that causes this error (e.g., "POST /auth/register when email exists in users table").

**Error codes are referenced from Acceptance criteria and API Contracts** — an AC like `POST /auth/register with duplicate email returns 409 with EMAIL_ALREADY_EXISTS` refers to a code defined here.

**Error response format:** Define the shape once per subproject that exposes an HTTP API, in the first phase that introduces HTTP endpoints in that subproject. Later phases in the same subproject inherit it and do not redefine — they only add new rows to the catalog.

**What to include:**
- Domain-specific errors (business rules, state violations): `EMAIL_ALREADY_EXISTS`, `EMAIL_ALREADY_CONFIRMED`.
- Authentication/authorization errors with phase-specific semantics: `INVALID_CREDENTIALS`, `EMAIL_NOT_CONFIRMED`, `TOKEN_REUSE_DETECTED`.

**What NOT to include:**
- Generic framework errors: 500 Internal Server Error, 404 for unmatched routes.
- Generic validation errors (400 from the framework's validation layer on malformed bodies) — these are uniform across endpoints and do not need a domain code. Reference them in API Contracts as "400 validation error" without a code.

**Example (fully filled):**

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| EMAIL_ALREADY_EXISTS | 409 | Email is already registered | POST /auth/register with an email that exists in users table |
| INVALID_CREDENTIALS | 401 | Invalid email or password | POST /auth/login with unknown email OR wrong password (same code for both — do not reveal which) |
| EMAIL_NOT_CONFIRMED | 403 | Email not confirmed | POST /auth/login with user where is_confirmed = false |

### Events/Messages

For each event or message:
- Event name (e.g., `video.uploaded`, `email.confirmation.requested`).
- Payload fields with types.
- Who publishes the event (service name).
- Who consumes it (worker, service, or external system).
- Whether it is fire-and-forget or requires acknowledgment.

## Rules

- Format and level of detail must be consistent with already planned phases in `docs/phases/`.
- Do not repeat information already in `docs/project-plan.md` (overview, stack, project characteristics).
- If the phase depends on others, assume everything from previous phases is already implemented and functional.
- Every step implementation must have an explicit **Dependencies** field (its value may be "None").
- Every step implementation must have at least one acceptance criterion.
- Deliverables must be a checklist (with `- [ ]`), not prose.
- Include only the Technical Specification sections that apply to the phase based on the applicability checklist. Omit sections that are not relevant.
- SIs that introduce new dependencies must list packages with compatible version ranges in their Technical actions.
- When a phase spans multiple subprojects, repeat the test/type-check/build deliverables per subproject, each with its own command (e.g., `All SI tests pass in nestjs-project (<command>)` and `All SI tests pass in nextjs-project (<command>)`).

## Output

Save to: `docs/phases/phase-NN-[name-slug].md`

Example: `docs/phases/phase-02-auth.md`
