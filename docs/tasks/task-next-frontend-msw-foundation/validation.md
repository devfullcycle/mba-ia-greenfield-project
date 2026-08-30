---
kind: task
name: task-next-frontend-msw-foundation
status: clean
issue_count: 0
sources_mtime:
  docs/tasks/task-next-frontend-msw-foundation/context.md: "2026-05-13T20:07:54-03:00"
  docs/decisions/technical-decisions-next-frontend-msw-foundation.md: "2026-05-13T20:06:42-03:00"
issues:
  - id: OQ-1
    status: resolved
    summary: "TD-01 pending — Handler Module Organization & Phase Expansion Model"
    resolved_by: next-frontend-msw-foundation/TD-01
  - id: OQ-2
    status: resolved
    summary: "TD-02 pending — Node Test Handlers vs. Browser Dev Handlers (setupServer / setupWorker)"
    resolved_by: next-frontend-msw-foundation/TD-02
  - id: OQ-3
    status: resolved
    summary: "TD-03 pending — Response Builders / Factory Pattern (with or without faker-js)"
    resolved_by: next-frontend-msw-foundation/TD-03
  - id: OQ-4
    status: resolved
    summary: "TD-04 pending — How Each Phase's Tests Consume the Handler Set"
    resolved_by: next-frontend-msw-foundation/TD-04
---

# task-next-frontend-msw-foundation — Validation

## Findings

### Inconsistencies

_None._

### Ambiguities

_None._

### Missing Decisions

_None._

### Inherited Constraint Conflicts

_None._

### Unresolved Open Questions

_None._

### UI Coverage Gaps

_None._

_(UI Inventory is logic-only — `## UI Inventory` body matches the `_Frontend-runtime only —` token-anchor; Check 7 is suppressed by construction in this state.)_

## Resolved Issues

- **OQ-1** _(resolved_by next-frontend-msw-foundation/TD-01)_ — TD-01 decided: Option B (per-domain modules under `mocks/handlers/<domain>.ts` + barrel `mocks/handlers/index.ts`).
- **OQ-2** _(resolved_by next-frontend-msw-foundation/TD-02)_ — TD-02 decided: Option A (test-only `setupServer` at foundation; browser worker deferred until a real FE-offline-dev consumer exists).
- **OQ-3** _(resolved_by next-frontend-msw-foundation/TD-03)_ — TD-03 decided: Option D (hand-written deterministic defaults as the default + opt-in seeded faker scoped to bulk-collection builders only; `@faker-js/faker` installed only when the first bulk builder is authored — not at foundation).
- **OQ-4** _(resolved_by next-frontend-msw-foundation/TD-04)_ — TD-04 decided: Option A (universal handler set loaded into `setupServer` + per-test `server.use(...)` overrides + `onUnhandledRequest: "error"`).
