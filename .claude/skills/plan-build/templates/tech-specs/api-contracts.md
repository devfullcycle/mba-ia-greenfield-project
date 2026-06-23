# Tech Spec subsection — API Contracts

Applies when HTTP endpoints are exposed. Each endpoint becomes a `#### {METHOD} {/path} (SI-NN.X)` heading carrying the SI cross-ref, followed by the request/response/error skeleton below. Endpoints are separated by a horizontal rule (`---`).

`### API Contracts` may carry a **backend tier** (Scope-driven, per `phase-a.md` § A2) and/or a **BFF tier** (join-driven, per § A2's "`### API Contracts` — BFF tier" rule). Both tiers share the **same per-endpoint skeleton** of bold field labels: `**Request headers:**`, `**Request body:**`, `**Request query parameters:**`, `**Response {code}:**`, `**Error responses:**`. The shared-skeleton guarantee is **prefix-stable, not byte-exact**: the BFF tier **qualifies its response/error labels** as `**Response {code} (FE-facing):**` and `**Error responses (FE-facing):**` (the `(FE-facing)` qualifier flags that the shape is the BFF projection, not the upstream shape). Consumers — Phase B (B4 — "controller/route SIs reference API Contracts request/response shapes verbatim") and the `### UI ↔ API Traceability Matrix` — therefore anchor on the **label prefixes** (`**Request headers:`, `**Request body:`, `**Request query parameters:`, `**Response `, `**Error responses`), which match both tiers, **not** on exact strings. The BFF tier additionally layers two BFF-only fields on top of that skeleton — `**forwards-to:**` and `**Set-Cookie / session side-effect:**` — and tags every line with a provenance marker.

When validation rules exist and are broad enough to warrant a dedicated subsection, append them as `#### Validation Rules` **nested at the end of `### API Contracts`** (never as a sibling H3). Narrow validation rules may alternatively live inline under each endpoint's `**Request body:**` field bullets as `— {constraint}`.

## Backend tier (Scope-driven)

Emitted for TDs with `Scope: Backend | Cross-layer` (per `phase-a.md` § A2). One `#### {METHOD} {/path} (SI-NN.X)` block per endpoint.

````markdown
### API Contracts

#### POST /auth/register (SI-NN.X)

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

#### GET /auth/confirm-email (SI-NN.X)

**Request query parameters:**
- token: string, required — the raw token from the confirmation email

**Response 204:** No content.

**Error responses:**
- 401 INVALID_TOKEN: when the token is not found or already used
- 400 validation error: when `token` query parameter is missing or empty

---

#### Validation Rules — {scope label}

- `email`: required, valid email format
- `password`: required, min 8, max 128 characters
````

## BFF tier (frontend-exposed contract)

Emitted when the § A2 "`### API Contracts` — BFF tier" trigger fires (`ui_in_scope: true` + ≥1 server-connected component in the UI ↔ Capability Join + the in-context subproject CLAUDE.md documents a Backend-for-Frontend / proxy tier). Renders **inside the same `### API Contracts` heading**, after the backend tier (or as the only tier when the slice has no `Scope: Backend | Cross-layer` TD). One `#### {METHOD} {fe-facing path} (SI-NN.X)` block per server-connected endpoint in the UI join.

The BFF tier uses the **same skeleton as the backend tier** plus three BFF-only fields (`**forwards-to:**`, `**Set-Cookie / session side-effect:**`, and per-line provenance tags). The request body is referenced by its **derived upstream alias** — NOT re-spelled field-level — to avoid duplicating the upstream contract (that field-level detail lives once in the project contract source; re-spelling it here is the drift surface this tier exists to remove).

> **Builder note (do NOT transcribe into artifact):** every line in a BFF-tier block carries one of exactly three provenance tags — nothing here is unsourced.

````markdown
### API Contracts

> _BFF tier — frontend-exposed contract. The browser calls the FE-facing route; the route proxies the upstream per the project's documented BFF architecture._

#### POST /api/auth/signup (SI-NN.X)

**forwards-to:** `POST /auth/register` *(derived: project contract source)*

**Request headers:**
- Content-Type: application/json *(derived: project contract source)*

**Request body:** `RegisterDto` *(derived: project contract source — fields per the project contract source; not re-spelled here to avoid duplication)*

**Response 201 (FE-facing):** `{ id, email }` — pass-through *(derived: project contract source; reshape: none)*

**Error responses (FE-facing):**
- 409 EMAIL_ALREADY_EXISTS: pass-through *(derived: project contract source)*
- 400 validation error: pass-through *(derived: project contract source)*

---

#### POST /api/auth/login (SI-NN.X)

**forwards-to:** `POST /auth/login` *(derived: project contract source)*

**Request headers:**
- Content-Type: application/json *(derived: project contract source)*

**Request body:** `LoginDto` *(derived: project contract source — fields per source; not re-spelled to avoid duplication)*

**Response 200 (FE-facing):** body OMITS `access_token` / `refresh_token` *(reshape per phase-02-auth-frontend/TD-02)*

**Set-Cookie / session side-effect:** sets the encrypted iron-session cookie carrying access + refresh + minimal user fingerprint *(per phase-02-auth-frontend/TD-02)*

**Error responses (FE-facing):**
- 401 INVALID_CREDENTIALS: pass-through *(derived: project contract source)*
- 403 EMAIL_NOT_CONFIRMED: pass-through *(derived: project contract source)*
- 400 validation error: pass-through *(derived: project contract source)*

---
````

### Provenance tags — the only three forms

| Tag | Meaning | Source | CCR |
|-----|---------|--------|-----|
| `*(derived: project contract source)*` | Read FROM the project's contract source-of-truth at authoring time | The contract chain documented in the in-context subproject CLAUDE.md / `## Inherited Conventions` (e.g., a generated OpenAPI / typed-client chain). **This skill never names the concrete artifact** — it is project-specific and lives in CLAUDE.md. | Reconciled |
| `*(per {slug}/TD-NN)*` | A frontend projection decision (response reshape, token custody / Set-Cookie, error-passthrough policy, a BFF-added request header) | The cited TD's `**Recommendation:**` in `## Decisions Detail` / `## Inherited Decisions Detail` (already in memory). No upstream counterpart. | Skipped |
| `_undetermined — {one-line reason}_` | Neither derivable nor TD-backed | Explicit placeholder — **never invent a value** | Skipped |

### Field-derivation rules (mandatory)

- **`forwards-to`, `**Request headers:**` (standard), `**Request body:**` alias, `**Response {code}:**` shape, `**Error responses:**`, upstream status codes** — **derive from the project's contract source-of-truth as documented in the in-context subproject CLAUDE.md** (read at A1) or `## Inherited Conventions`. **Never transcribe the upstream path/shape from the screen inventory, SI prose, or capability text** — that is the transcription-drift failure mode this tier exists to prevent. Tag every such line `*(derived: project contract source)*`. If the subproject CLAUDE.md documents no contract source-of-truth in context, emit the line as `_undetermined — no contract source-of-truth documented in subproject CLAUDE.md_` (do not guess the upstream path or shape).
- **`**Request body:**` is referenced by alias, not re-spelled.** Emit the derived upstream DTO/alias name (e.g., `` `LoginDto` ``) followed by the derived tag and the parenthetical "fields per source; not re-spelled to avoid duplication". Field-level constraints live in the project contract source and (for the UX mirror) in `### UI Contracts → Client-side validation mirror` — never duplicated here. (The **backend tier** DOES spell fields, because it is the owner/source of that contract; the BFF tier is a consumer/projection and references it.)
- **`**Response {code} (FE-facing):**` and `**Set-Cookie / session side-effect:**`** — the FE-facing response reshape and any cookie/credential side-effect are NOT in the upstream contract; they are frontend BFF decisions. Source them from the cited TD's Recommendation prose (the `Scope: Frontend` BFF/session/orchestration TDs already in `## Decisions Detail`). Tag `*(per {slug}/TD-NN)*`. Omit the `**Set-Cookie / session side-effect:**` line entirely when the endpoint has none. If a needed projection is governed by no TD, emit `_undetermined — no TD governs this projection_` — never invent.
- **A BFF-added request header** (one the browser sends that the upstream contract does not define — e.g., a CSRF token the BFF requires) is a projection decision: list it under `**Request headers:**` tagged `*(per {slug}/TD-NN)*`. Standard headers derivable from the contract source (e.g., `Content-Type`) are tagged `*(derived: project contract source)*`.
- **`#### {METHOD} {fe-facing path} (SI-NN.X)`** — the heading carries the FE-facing route the browser calls (from the UI ↔ Capability Join's server-connected component endpoint, already in memory) plus the owning SI cross-ref. The `**forwards-to:**` is its derived upstream counterpart per the first rule.
- **One block per server-connected endpoint** in the UI ↔ Capability Join. Endpoints that appear in multiple screens collapse to one block (the contract is defined once; UI Contracts references it).
- **Verbatim invariant** still applies (F2 protection, `phase-a.md` § A4): identifiers in `*(derived:...)*` lines are byte-verbatim from the contract source; identifiers in `*(per TD)*` lines are byte-verbatim from the TD prose. No casing/pluralization/reordering.

This BFF tier is the single source-of-truth for the FE↔BFF contract; `### UI Contracts` Server-connected components and the `### UI ↔ API Traceability Matrix` **reference** it (via `(§API Contracts → BFF tier)`) rather than re-stating request/response/status — zero duplication. CCR (per `phase-a.md` § A2's "CCR over the `### API Contracts` BFF tier" note) reconciles only the `*(derived: project contract source)*` lines and skips `*(per TD)*` / `_undetermined_`.
