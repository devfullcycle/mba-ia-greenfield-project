# Tech Spec subsection — UI ↔ API Traceability Matrix

Emitted only when `ui_in_scope: true`. Flat table joining Verb | Component | Screen | Endpoint | TD ref.

**Skipped when `ui_in_scope ∈ {false, deferred, logic-only}`** — the matrix is a UI ↔ API join, and:
- `false` → no UI exists, nothing to join.
- `deferred` → user opted out of inventory; no verbs available to join.
- `logic-only` → user opted into FE-runtime architectural changes only, no per-screen UI; the join domain is empty by construction. (FE-runtime TDs render in `### Frontend Runtime`, not in this matrix — see `phase-a.md` § A2.)

## Template

> **Builder note (do NOT transcribe into artifact):** this subsection is emitted only when `ui_in_scope: true`. Skipped for `false`, `deferred`, and `logic-only` per the rules above.

````markdown
### UI ↔ API Traceability Matrix

| Verb | Component | Screen | Endpoint (from API Contracts) | TD ref |
|------|-----------|--------|-------------------------------|--------|
| Criar conta de usuário | SignupForm | /signup | POST /auth/signup | {slug}/TD-03 |
| Disparar upload de vídeo novo | UploadButton | /upload | POST /videos | {slug}/TD-07 |

_Capabilities marked in `## Non-UI / Deferred Capabilities` are excluded from this matrix._
````

## Building the UI ↔ API Traceability Matrix

Join `## UI Inventory → UI ↔ Capability Join` (already in memory from context.md) with the API Contracts section (just written in the same run). If a verb has no matching endpoint, emit the matrix row with `Endpoint: —` and a footnote `_(deferred per ## Non-UI / Deferred Capabilities)_`. Normally this would have been UIG-N in validate, but it can happen when the user chose `deferred` in resolve (and deferred capabilities were excluded from the check).
