---
kind: phase
name: phase-02-auth-frontend
status: clean
issue_count: 0
sources_mtime:
  docs/phases/phase-02-auth-frontend/context.md: "2026-05-14T11:17:59-03:00"
  docs/decisions/technical-decisions-phase-02-auth-frontend.md: "2026-05-14T11:03:30-03:00"
  docs/project-plan.md: "2026-05-12T13:48:56-03:00"
  docs/decisions/technical-decisions-phase-02-auth.md: "2026-05-12T14:01:41-03:00"
issues:
  - id: MD-1
    status: resolved
    summary: "No Cross-layer/Repo-wide TD covers FE↔BE contract-sync strategy (Decisão #29)"
    resolved_by: openapi-docs-nestjs/TD-02
  - id: OQ-1
    status: resolved
    summary: "phase-02-auth-frontend/TD-01 pending — Authentication Orchestration Approach"
    resolved_by: phase-02-auth-frontend/TD-01
  - id: OQ-2
    status: resolved
    summary: "phase-02-auth-frontend/TD-02 pending — Session Cookie Strategy"
    resolved_by: phase-02-auth-frontend/TD-02
  - id: OQ-3
    status: resolved
    summary: "phase-02-auth-frontend/TD-03 pending — Token Refresh Orchestration"
    resolved_by: phase-02-auth-frontend/TD-03
  - id: OQ-4
    status: resolved
    summary: "phase-02-auth-frontend/TD-04 pending — Form Library and Client-Side Validation"
    resolved_by: phase-02-auth-frontend/TD-04
  - id: OQ-5
    status: resolved
    summary: "phase-02-auth-frontend/TD-05 pending — Mutation Submission Pathway"
    resolved_by: phase-02-auth-frontend/TD-05
  - id: OQ-6
    status: resolved
    summary: "phase-02-auth-frontend/TD-06 pending — Session State Propagation to Client Components"
    resolved_by: phase-02-auth-frontend/TD-06
  - id: OQ-7
    status: resolved
    summary: "phase-02-auth-frontend/TD-07 pending — Email-Link Landing Pattern"
    resolved_by: phase-02-auth-frontend/TD-07
  - id: OQ-8
    status: resolved
    summary: "Inventory — Confirmação de conta has no UI (de-scoped 2026-05-14); TD-07 needs the screen to close end-to-end flow"
    resolved_by: deferred_capability
  - id: OQ-9
    status: resolved
    summary: "Inventory — Logout has no UI inventoried this phase; depends on authenticated chrome (Phase 04?)"
    resolved_by: deferred_capability
  - id: OQ-10
    status: resolved
    summary: "Inventory — Reset-password destination screen missing from Figma; recuperação only partially covered"
    resolved_by: deferred_capability
  - id: OQ-11
    status: resolved
    summary: "Inventory — Terms/Privacy links on signup point to out-of-scope routes; decide rendering strategy"
    resolved_by: clarification
  - id: OQ-12
    status: resolved
    summary: "Inventory — No form-level error/feedback variants in Figma for signup/login; decide infer-vs-redesign"
    resolved_by: clarification
  - id: OQ-13
    status: resolved
    summary: "Inventory — Forgot-password AuthFooter link says 'Sign up'; UX usually 'Sign in' — confirm with designer"
    resolved_by: clarification
  - id: OQ-14
    status: resolved
    summary: "Inventory — Forgot-password success-state variant missing in Figma"
    resolved_by: clarification
  - id: OQ-15
    status: resolved
    summary: "Inventory — Planned-not-existing components for B2.6 SI synthesis; confirm scope (materialize vs defer)"
    resolved_by: clarification
  - id: UIG-1
    status: resolved
    summary: "Capability 'Telas de cadastro, login, confirmação de conta e recuperação de senha' covered by TD-01/TD-04 but no verb matches the umbrella bullet literally in inventory"
    resolved_by: deferred_capability
advisories:
  - id: MC-cross-1
    status: open
    summary: "Phase 02 capability 'Serviço de envio de e-mails transacionais' not claimed by any slice's covers_capabilities"
  - id: MC-cross-2
    status: open
    summary: "Phase 02 capability 'Cadastro de usuário com e-mail e senha' not claimed by any slice's covers_capabilities"
  - id: MC-cross-3
    status: open
    summary: "Phase 02 capability 'Criação automática do canal do usuário a partir do prefixo do e-mail' not claimed by any slice's covers_capabilities"
  - id: MC-cross-4
    status: open
    summary: "Phase 02 capability 'Confirmação de conta via e-mail com link de ativação' not claimed by any slice's covers_capabilities"
  - id: MC-cross-5
    status: open
    summary: "Phase 02 capability 'Login e controle de sessão do usuário' not claimed by any slice's covers_capabilities"
  - id: MC-cross-6
    status: open
    summary: "Phase 02 capability 'Logout' not claimed by any slice's covers_capabilities"
  - id: MC-cross-7
    status: open
    summary: "Phase 02 capability 'Recuperação de senha: solicitação via e-mail → link com token → redefinição' not claimed by any slice's covers_capabilities"
  - id: MC-cross-8
    status: open
    summary: "Phase 02 capability 'Telas de cadastro, login, confirmação de conta e recuperação de senha' not claimed by any slice's covers_capabilities"
---

# phase-02-auth-frontend — Validation

## Findings

### Inconsistencies

_None._ All 7 current-scope TDs are `Scope: Frontend`; `## UI Inventory` is populated (3 screens), so the Scope-Subsection orphan check does not fire. Every capability cited by an inventory verb (`Cadastro…`, `Login…`, `Recuperação de senha…`) is present in scope.

### Ambiguities

_None._ Each capability maps to one or more decided, detailed TDs; scope is decomposable into SIs.

### Missing Decisions

_None._ The Decisão #29 FE↔BE contract-sync strategy remains covered (MD-1, resolved). The two phase-level bullets without a covering TD ("Serviço de envio de e-mails transacionais", "Criação automática do canal…") are owned by the sibling backend slice `phase-02-auth`, not by this frontend slice — surfaced as cross-slice advisories below, not as MD against this slice.

### Dependency Gaps

_None._ The FE foundation prerequisites (env/Zod, MSW, OpenAPI typing) are inherited from phase 01 and present in `## Inherited Decisions Detail`.

### Inherited Constraint Conflicts

_None._ TD-01 (BFF cookie session) / TD-04 (react-hook-form + zod) / TD-05 (Route Handler) align with the inherited strict-BFF (`next-frontend-config-base/TD-03`), Zod-first (`next-frontend-config-base/TD-01`), and MSW (`next-frontend-msw-foundation/TD-01..04`) conventions.

### Unresolved Open Questions

_None._ All 7 phase TDs are `decided` (no pending). All 8 `### Open Questions from Inventory` bullets map to already-resolved OQ-8..15 and are dropped from the open set per the merge rule.

### UI Coverage Gaps

_None._ Capabilities without an inventory verb (`Confirmação de conta…`, `Logout`, the reset-password destination of `Recuperação de senha…`, and the umbrella `Telas de cadastro, login, confirmação de conta e recuperação de senha`) are all already recorded in `## Non-UI / Deferred Capabilities` (Status: deferred) — UIG condition 3 fails for each.

### Capability Consistency (slicing, phase mode only)

_None._ Phase 02 has 2 phase-scope slices (`phase-02-auth`, `phase-02-auth-frontend`). Neither slice declares a `covers_capabilities:` field in its frontmatter, so there are no entries to verify verbatim against `project-plan.md`. CC-N is suppressed by the absence of entries; cross-slice aggregation moves to the MC-cross-N advisories below.

## Cross-slice Advisories

Phase 02 has 2 phase-scope decisions docs (slices) — `phase-02-auth` (backend) and `phase-02-auth-frontend` (frontend, decided). Neither declares `covers_capabilities:`, so the aggregated `covered` set is empty and all 8 phase-02 capability bullets from `project-plan.md` appear as uncovered advisories. These are **informational only** — they do NOT flip `status` to `dirty` and do NOT block `/plan-build`. The hard-gate equivalent runs in `/plan-build` Gate 9.5 on the last slice to build.

- **MC-cross-1** — Phase 02 capability "Serviço de envio de e-mails transacionais" is not claimed by any slice's `covers_capabilities`. Explicit choice: (a) claim in `phase-02-auth/covers_capabilities` (backend slice — `phase-02-auth/TD-05` @nestjs-modules/mailer); (b) leave unclaimed if monolithic-fallback is acceptable.
- **MC-cross-2** — Phase 02 capability "Cadastro de usuário com e-mail e senha" is not claimed by any slice's `covers_capabilities`. Explicit choice: (a) claim in `phase-02-auth-frontend/covers_capabilities` (and/or `phase-02-auth` if the backend signup endpoint is in scope); (b) leave unclaimed.
- **MC-cross-3** — Phase 02 capability "Criação automática do canal do usuário a partir do prefixo do e-mail" is not claimed by any slice's `covers_capabilities`. Explicit choice: (a) claim in `phase-02-auth/covers_capabilities` (backend — `phase-02-auth/TD-10` nickname allowlist); (b) leave unclaimed.
- **MC-cross-4** — Phase 02 capability "Confirmação de conta via e-mail com link de ativação" is not claimed by any slice's `covers_capabilities`. Explicit choice: (a) claim in both slices (FE for landing, BE for token consumption); (b) leave unclaimed.
- **MC-cross-5** — Phase 02 capability "Login e controle de sessão do usuário" is not claimed by any slice's `covers_capabilities`. Explicit choice: (a) claim in both slices; (b) leave unclaimed.
- **MC-cross-6** — Phase 02 capability "Logout" is not claimed by any slice's `covers_capabilities`. Explicit choice: (a) claim in `phase-02-auth-frontend` (per OQ-9, FE side is partially deferred to Phase 04 chrome); (b) leave unclaimed.
- **MC-cross-7** — Phase 02 capability "Recuperação de senha: solicitação via e-mail → link com token → redefinição" is not claimed by any slice's `covers_capabilities`. Explicit choice: (a) claim in both slices; (b) leave unclaimed.
- **MC-cross-8** — Phase 02 capability "Telas de cadastro, login, confirmação de conta e recuperação de senha" is not claimed by any slice's `covers_capabilities`. Explicit choice: (a) claim in `phase-02-auth-frontend/covers_capabilities` (FE-exclusive); (b) leave unclaimed.

## Resolved Issues

- **MD-1** _(resolved_by openapi-docs-nestjs/TD-02)_ — Decisão #29 contract-sync strategy. `openapi-docs-nestjs/TD-02` ("OpenAPI Spec Artifact Strategy", Scope: Cross-layer) is in `## Inherited Decisions Detail` via correlator-confirm and satisfies the keyword-heuristic + Scope filter. Companion `next-frontend-openapi-typing/TD-01..TD-05` (FE consumption — openapi-typescript, openapi-fetch, committed sync, CI freshness check, `lib/api/contracts.ts`) close the chain.
- **OQ-1** _(resolved_by phase-02-auth-frontend/TD-01)_ — Decision **A (Custom BFF cookie-based session — `next/headers` + small helper)**.
- **OQ-2** _(resolved_by phase-02-auth-frontend/TD-02)_ — Decision **B (`iron-session` encrypted container)** carrying access + refresh + minimal user fingerprint. Libraries: `iron-session`.
- **OQ-3** _(resolved_by phase-02-auth-frontend/TD-03)_ — Decision **A (Transparent BFF refresh on upstream 401 w/ per-request single-flight)**.
- **OQ-4** _(resolved_by phase-02-auth-frontend/TD-04)_ — Decision **A (`react-hook-form` + `@hookform/resolvers/zod`)**. Libraries: `react-hook-form`, `@hookform/resolvers`.
- **OQ-5** _(resolved_by phase-02-auth-frontend/TD-05)_ — Decision **A (Route Handler POST + client `fetch`)**.
- **OQ-6** _(resolved_by phase-02-auth-frontend/TD-06)_ — Decision **A (Server-rendered session + React Context Provider in RSC layout)**.
- **OQ-7** _(resolved_by phase-02-auth-frontend/TD-07)_ — Decision **A (RSC processes token server-side; Client form below for reset's input step)**.
- **OQ-8** _(resolved_by deferred_capability)_ — "Confirmação de conta via e-mail com link de ativação" marked deferred. Row in `## Non-UI / Deferred Capabilities`.
- **OQ-9** _(resolved_by deferred_capability)_ — "Logout" UI marked deferred (button lives in authenticated chrome / Phase 04). Phase 02 ships `POST /api/auth/logout` route. Row in `## Non-UI / Deferred Capabilities`.
- **OQ-10** _(resolved_by deferred_capability)_ — "Recuperação de senha (destination screen)" marked deferred. Row in `## Non-UI / Deferred Capabilities`.
- **OQ-11** _(resolved_by clarification)_ — Signup Terms/Privacy links rendered as inert placeholders until `/terms` and `/privacy` routes exist.
- **OQ-12** _(resolved_by clarification)_ — Form-level error/loading states inferred in implementation using shadcn `FormMessage` + `<Alert>` + `<Button>` with `form.formState.isSubmitting`.
- **OQ-13** _(resolved_by clarification)_ — Forgot-password footer link implemented as "Sign in — back to login" pointing to `/login`, overriding Figma's "Sign up" label.
- **OQ-14** _(resolved_by clarification)_ — Forgot-password success state inferred as an inline success card swapping the form within the same shadcn `Card`. Gated by `form.formState.isSubmitSuccessful`.
- **OQ-15** _(resolved_by clarification)_ — All 9 planned-but-not-existing components materialized this phase via `phase-b.md` § B2.6 (bootstrap SI synthesis).
- **UIG-1** _(resolved_by deferred_capability)_ — Capability "Telas de cadastro, login, confirmação de conta e recuperação de senha" marked **deferred** in `## Non-UI / Deferred Capabilities`. Rationale (user-provided verbatim): "a tela de confirmação da conta não será implementada nesta fase corrente, será adiada" — the umbrella bullet's full coverage requires the confirmação and reset-password destination screens, both already in Non-UI/Deferred rows above; the 3 ship-this-phase telas (signup, login, forgot-password) remain covered by their own inventory verbs. The umbrella bullet itself is deferred to the phase that lands the two missing screens.
