---
name: streamtube-manual-validation
description: "Manually validate every real endpoint of a StreamTube phase against a running environment — audits the actual code (controllers, DTOs, guards, entities) to build a real endpoint inventory, runs reproducible commands for success and error cases, and checks side effects in PostgreSQL, Mailpit, MinIO, Redis, and the video worker as applicable to the phase. Use when the user asks to manually test, validate, or exercise a phase's endpoints for real — e.g. 'valida manualmente os endpoints da fase 02', 'testa o fluxo de upload na fase 03 de verdade', 'confirma que o worker processa o vídeo'. Produces docs/phases/phase-NN-validation.md. Never invents endpoints that don't exist in the code."
disable-model-invocation: true
---

# StreamTube Manual Validation

Prove the phase works by actually calling it, not by reading the code and assuming. Automated tests (covered by `streamtube-quality-gate`) run in a controlled, mocked-where-convenient environment; this skill runs against the real Docker Compose stack the way a human tester would, and records exactly what happened.

**Hard constraint: only real endpoints.** Every endpoint in the inventory and every command in the validation document must trace back to an actual controller route in the code. Do not add endpoints "because they'd make sense" or because a doc mentions them but the code doesn't have them yet.

## Step 1 — Build the real endpoint inventory

Audit the code directly — do not trust prior documentation, changelogs, or memory of a previous phase, since those can drift from what's actually implemented:

- Controllers (`*.controller.ts` or equivalent) for the affected subproject — every route, HTTP method, guard/decorator (auth requirements, public markers, rate limits).
- DTOs — exact field names, types, and validation constraints, so request payloads in the validation document match what the code actually accepts.
- Guards and interceptors that affect request handling.
- Entities — exact column names (via `\d <table>` against the real database, not just the entity source — migrations can drift from entity decorators in ways worth catching here).
- Existing e2e/integration tests for the affected controllers — they already encode expected status codes and error shapes; use them as a cross-check, not a substitute for calling the real endpoint yourself.

For a large controller surface, delegate this audit to the Explore agent (or a general-purpose research agent) rather than reading every file inline — but review its findings before trusting them; an agent's summary describes what it read, not a guarantee of completeness.

## Step 2 — Build reproducible commands

For each endpoint, prepare a command using `curl` or `Invoke-RestMethod`/`Invoke-WebRequest` (whichever the environment's shell actually supports reliably — on Windows PowerShell 5.1, prefer `curl` via the Bash tool if `Invoke-WebRequest`/`Invoke-RestMethod` behave inconsistently with error status codes) using the **exact** payload shape from the DTO. Include:

- The full request (method, URL, headers including `Authorization: Bearer <token>` where required, body).
- What status code and body are expected, per the code (not per assumption).

Chain commands where the phase has a real functional flow (e.g. register → confirm → login → use token) — capture tokens/IDs from one response and feed them into the next command, the way a real client would.

## Step 3 — Validate success and error paths

For every endpoint, exercise:

- The success path with a valid payload/state.
- At least one relevant error path — the one most likely to be wrong (auth failure, validation failure, domain conflict, not-found, rate limit) — chosen based on what the endpoint actually branches on, not a generic "try garbage input."

Don't stop at the first error case if the endpoint has multiple meaningfully different failure branches (e.g. an auth endpoint with both "wrong password" and "email not confirmed" — both 401/403 but different codes) — cover the ones that exercise distinct code paths.

## Step 4 — Verify side effects per external system, as applicable to the phase

Not every phase touches every system — only check what the phase actually uses:

- **PostgreSQL** — query the affected tables after each meaningful action (`docker compose exec db psql -U streamtube -d streamtube -c "..."`). Confirm column names with `\d <table>` before writing queries that assume a shape — don't guess column names from the entity file alone.
- **Mailpit** — for any endpoint that triggers an email, use the Mailpit HTTP API (`GET /api/v1/messages`, `GET /api/v1/message/<id>`) to confirm the email arrived and extract real tokens/links from its body rather than reading them from application logs — this proves the actual delivery path, not just that the service was called.
- **MinIO** (or equivalent object storage, once introduced — e.g. Phase 03 video/thumbnail uploads) — confirm objects actually land in the expected bucket/key after an upload, and that they're retrievable. Use the MinIO client (`mc`) or its HTTP API/console if available in the compose stack.
- **Redis** (once introduced — e.g. a job queue backing video processing) — confirm expected keys/queues are populated and drained as expected, not just that the enqueue call returned success.
- **Video worker** (once introduced) — confirm a submitted job is actually picked up and processed: check worker logs, and confirm the expected end state (processed file present, DB status updated) rather than just that a job was enqueued.

If a system doesn't apply to this phase, say so explicitly in the document rather than omitting the section silently — an omitted section reads as "forgotten," an explicit "N/A for this phase" reads as "checked, not applicable."

## Output structure

Save to `docs/phases/phase-NN-validation.md`:

```markdown
# Fase XX — [Nome] — Validação Manual

> **Data:** YYYY-MM-DD
> **Ambiente:** docker compose (containers e versões relevantes, se pertinente)

## 1. Inventário de endpoints reais

(table: method, route, auth, body, query, expected success status, expected error statuses — sourced from Step 1)

## 2. Resultado por endpoint

(per endpoint: command executed, actual status/response, DB effect observed, Mailpit/MinIO/Redis/worker effect observed if applicable, success case ✅/❌, error case(s) ✅/❌)

## 3. Fluxo funcional completo

(if the phase has a multi-step user flow, the full chained sequence with evidence at each step — DB state, external system state)

## 4. Efeitos em sistemas externos

PostgreSQL: ... | Mailpit: ... | MinIO: ... | Redis: ... | Worker: ...
(explicit "N/A nesta fase" where not applicable)

## 5. Divergências encontradas

(anything the real behavior didn't match: code vs. docs, code vs. plan's acceptance criteria — report, don't silently "fix" scope creep into this skill)
```

## Global rules

- Never invent an endpoint, field, or status code not present in the actual code.
- Never modify production code from this skill — if validation reveals a bug, report it; fixing it is `streamtube-increment-implementation`'s job (or a new increment, if the phase's increments are already done).
- Never use real email addresses — Mailpit only.
- Never run `docker compose down -v` or delete volumes to "reset" test data without explicit authorization — use targeted DELETE/TRUNCATE via psql if the environment needs cleaning, and say so.
- Never commit.
- Use paths relative to the repository root.
- Record every command executed and its actual output (or a faithful excerpt) — this document is the evidence trail `streamtube-phase-orchestrator` uses to compute the phase's final verdict alongside the quality gate.
