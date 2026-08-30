# Template: Screen SI blocks (when `ui_in_scope: true`)

Read by Phase B step B4 when emitting per-screen SIs (one X.0 drift audit + one Xa visual shell + one Xb logic/wiring per screen, with conditional skip of Xb below). Do NOT read this file when `ui_in_scope` is `false` or `deferred`.

**Per-screen SI count is 3 by default** (audit + Xa + Xb), reduced to 2 (audit + Xa) when Decisão #33 conditional skip applies. The audit-SI (`SI-NN.X.0`) is mandatory for every visual shell — its purpose is to surface DS-component drift to the user before SI-Xa applies any DS file edits. The audit-SI emits to `frontend-drift-report.md` (sibling of the plan doc); SI-Xa reads that report and applies decisions mechanically. Schema reference: `.claude/skills/plan-build/references/frontend-drift-report-schema.md`.

**Conditional skip of SI-Xb (Decisão #33).** Check 4 criteria from the screen's UI Contract:

1. `**Server-connected components:**` is empty list (`[]` or `_None._`).
2. `**Auth requirement:**` is `Anonymous`.
3. `**Error Catalog → UX mapping:**` is empty or `_None._`.
4. `**Rendering strategy:**` is framework default OR TD explicitly states "passive page" / "static".

When ALL 4 hold → skip SI-Xb entirely. Examples: landing page, 404/500 pages, terms-of-service page. SI-Xa alone delivers the screen. Dependency Map does not reference any backend SI for that screen.

**Xa-only screens — `**Test Specs:**` exclusion.** Pure-presentational screens (Xa-only after the conditional skip above) do NOT receive `**Test Specs:**` field — neither in Xa nor in any synthetic Xb. Xa has no server-connected behavior to E2E. Xb is skipped. SI-Xa for Xa-only screens emits `**Tests:** _(empty — pure presentational, smoke-gated by build/compile)_` (the second Common case in `phase-b.md` § "Tests format invariant", per Decisão #33 conditional skip). This differs from the WITH-Xb-sibling Common case used by the SI-Xa template at `## SI-Xa` below. `/plan-test-specs` ignores SI-Xa entirely (HAS_TEST_SPECS=0 in the discriminator → skip case in `plan-test-specs/SKILL.md` § "Stage 1 step 3"). This is the canonical exclusion for landing/404/static screens.

## SI-X.0 (Drift audit — ALWAYS emitted for UI screens; precedes SI-Xa)

The audit-SI runs **before** SI-Xa for the same screen. It performs value-level diff between the screen's Reused DS list and the Figma design demand, classifies each component per the 4-value status enum, and writes a per-screen section to `frontend-drift-report.md`. The audit makes drift decisions visible to the user; SI-Xa later applies them mechanically without re-judging.

**No code edits in this SI.** The audit's deliverable is the report. AC is enforced via scoped `git diff --name-only HEAD -- <target-subproject>` (must be empty at SI end). The plan folder lives outside the target subproject by construction, so the audit-SI's own write to `frontend-drift-report.md` is excluded from the scoped check.

````markdown
### SI-NN.X.0 — Drift audit: {screen name}

**Figma:** {URL}
**UI Contract:** see `## Technical Specifications` → `### UI Contracts` → `#### Screen: {name}`

**Technical actions:**

1. **Drift audit** — invoke `figma:figma-implement-design` (narrow handoff per Decisão #31) with:
   - Figma URL: {URL}
   - Reused DS components: [{list}]
   - Server-connected component names (no endpoints/auth/errors): [{names}]
   - Target paths (read-only context for audit; no writes here): `app/{route}/page.tsx` + `components/{feature}/{component}.tsx`

   For each component in the Reused DS list, perform value-level diff against the file on disk and classify per the 4-value status enum (`alinhado` / `drift menor` / `drift relevante` / `componente ausente`). Compose Decision per default policy (see `.claude/skills/plan-build/references/frontend-drift-report-schema.md` § Default decisions per status). Read prior sections of `frontend-drift-report.md` to build `prior_decisions`; populate `Prior` column with CONFLICT detection (executed by `/implement` per its SKILL.md cross-screen consultation algorithm). Write a `## Screen: {slug} — audited at SI-NN.X.0 ({YYYY-MM-DD})` section to `frontend-drift-report.md` (append on first run, overwrite-in-place on re-run). **No code edits — verifiable via `git diff` at SI end.**

**Dependencies:** none _(or: bootstrap SI ids when B2.6 Step 5 wires them)_

**Tests:** _(empty — audit-only; the report is the deliverable)_

**Acceptance criteria:**

- `frontend-drift-report.md` exists in the plan folder; section `## Screen: {slug}` exists with the current run's date in heading (appended on first run, overwritten in place on re-run per schema § Section ownership and update discipline).
- Every component in the Reused DS list has exactly one row in the table.
- Every row has a Decision column populated:
  - `alinhado` → `skip`
  - `drift menor` → `auto-Edit "<specifics>"` or `exception "<reason>"`
  - `drift relevante` → `auto-Edit "<specifics>"`, `exception "<reason>"`, or `CONFLICT: <one-liner>; <verb> "<specifics>"` (CONFLICT only when `prior_decisions` diverges; on CONFLICT rows `<verb>` is `auto-Edit` (default) or `exception` (override) — `create` and `skip` are categorically incompatible with `drift relevante`)
  - `componente ausente` → `create`
- Every `exception` decision carries a one-liner justification.
- `git diff --name-only HEAD -- <target-subproject>` after the SI is empty (no code touched in target subproject; the report file lives outside `<target-subproject>` and is excluded from the scoped check by construction).

---
````

## SI-Xa (Visual shell — ALWAYS emitted for UI screens; depends on SI-X.0)

The Xa template gains a new `**Drift Report:**` field that points at the audit-SI's report section, and the Technical actions list expands from 1 action (figma plugin invocation) to ≤2 actions (apply drift decisions + figma plugin invocation). The constraint relaxation from "1 Technical action only" → "≤2 Technical actions" is intentional per the audit-SI design.

````markdown
### SI-NN.Xa — Tela de {screen name} (visual shell)

**Route:** {route}
**Figma:** {URL}
**UI Contract:** see `## Technical Specifications` → `### UI Contracts` → `#### Screen: {name}`
**Drift Report:** see `frontend-drift-report.md` → `## Screen: {slug}`

**Technical actions:**

1. **Apply drift decisions** — read the Drift Report section for this screen. For each row, parse the Decision column and apply per the verb body:
   - `auto-Edit "<specifics>"` → apply `Edit` on the named DS file with the documented specifics
   - `create` → create the file (icons via Figma asset; components per spec)
   - `exception` / `skip` → no-op
   - `CONFLICT: <one-liner>; <verb> "<specifics>"` → strip the `CONFLICT: <one-liner>;` prefix (informational only) and apply the verb body per the rules above (`<verb>` is `auto-Edit` or `exception` on CONFLICT rows; `create`/`skip` cannot appear here per schema § Decision)

   No drift detection or auto-judgment in this step. The audit-SI did the analysis; this step is mechanical application.

2. **Visual shell generation** — invoke `figma:figma-implement-design` (narrow handoff per Decisão #31) with:
   - Figma URL: {URL}
   - Reused DS components: [{list}] _(now reflecting any DS edits from action 1)_
   - Server-connected component names (no endpoints/auth/errors): [{names}]
   - Target paths: `app/{route}/page.tsx` + `components/{feature}/{component}.tsx`

**Dependencies:** SI-NN.X.0 _(audit-SI; mandatory; bootstrap SI ids appended by B2.6 Step 5 when applicable — e.g., `SI-NN.X.0 + SI-NN.0.1, SI-NN.0.2`)_

**Tests:** _(empty — shell smoke-gated by build AC; Unit tests live in SI-Xb; E2E in /plan-test-specs spec)_

**Acceptance criteria:**

- All target paths exist, export expected components, and compile per `<frontend-subproject>` build command.
- Rendering matches Figma node fidelity within tolerance of DS component set.
- No runtime imports beyond Reused DS list (stays visually scoped).

---
````

### Conditional swap of `**Tests:**` reason for Xa-only screens (Decisão #33)

The SI-Xa template above hardcodes the WITH-Xb-sibling empty form (the common case). When Decisão #33 triggers (the screen has no SI-Xb sibling — pure presentational per the 4-criteria check at the top of this file), `/plan-build` must emit SI-Xa with the alternate empty form instead:

```markdown
**Tests:** _(empty — pure presentational, smoke-gated by build/compile)_
```

This swap rule is template-author guidance for `/plan-build`; it lives outside the template fence so it does NOT leak into emitted SI blocks. The two empty forms are documented as Common cases #1 and #2 in `phase-b.md` § "Tests format invariant".

## SI-Xb (Lógica & wiring — emitted UNLESS pure presentational per Decisão #33)

The Xb header MUST include `**Test Specs:** _pending /plan-test-specs_` between the heading and the `**UI Contract:**` line. This placeholder is the cross-skill signal: `/plan-test-specs` reads it to know which Xb still lacks a spec, and `/implement` preflight reads it and aborts with "Run /plan-test-specs <slug> first." until /plan-test-specs has authored the file. After `/plan-test-specs` runs, the placeholder is rewritten in place to `**Test Specs:** see \`<spec-path>\`` (single-subproject form). Cross-layer SIs use a different template (the generic `Template: SI block` from `phase-b.md`) — Xb is always single-subproject by construction.

````markdown
### SI-NN.Xb — Tela de {screen name} (lógica & wiring)

**Test Specs:** _pending /plan-test-specs_
**UI Contract:** see `## Technical Specifications` → `### UI Contracts` → `#### Screen: {name}`

**Technical actions:** (emitted based on which UI Contract fields are populated; ≤5 actions total)

1. **Route guard application** — per UI Contract `**Auth requirement:**` ({value}):
   - If Anonymous: wrap route in redirect-if-authenticated guard (per auth-flow TD convention).
   - If Authenticated: wrap route in require-authenticated guard; redirect unauthenticated to /login with returnTo.
   - If Authenticated+Owner: additionally verify the authenticated user is the owner of the resource; 403 otherwise.

2. **Rendering strategy application** — per UI Contract `**Rendering strategy:**` ({value}):
   - If Client Component: mark component with `"use client"` directive; form state local.
   - If Server Component (RSC): no `"use client"`; data fetching server-side.
   - If Server Action: implement as form action, no intermediate API call from client.
   - If UNDECIDED (placeholder present): implementer chooses + documents inline comment referencing TD that should be created.

3. **Endpoint wiring** — per UI Contract `**Server-connected components:**` endpoint references + shared-types strategy from Decisão #29 TD:
   - Import types from shared source (codegen output / shared schema package / handwritten-manual).
   - Wire fetch/axios/client call to referenced endpoint with typed request/response.
   - Handle response per component rendering logic.

4. **Error mapping** — per UI Contract `**Error Catalog → UX mapping:**` table:
   - For each errorCode in the mapping, implement the UX treatment exactly as specified.
   - Generic fallback for uncovered errors.

5. **Client-side validation mirror** — per UI Contract `**Client-side validation mirror:**` bullets:
   - Apply each validation rule pre-submit (HTML5 attributes OR framework-specific form library).
   - Show inline field errors matching BE Validation Rules verbatim.
   - Disable submit button when form is invalid.

**Dependencies:**

- `SI-NN.Xa` (visual shell must exist before wiring).
- Backend SIs: `SI-NN.{Y}` — each backend SI that delivers an endpoint referenced in this screen's UI Contract.
- Shared-types SI (if separate): `SI-NN.{Z}` — TD from Decisão #29 materialized as codegen output / schema package.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `components/{feature}/{form-or-client-component}.tsx` | Unit per testing-guide-{subproject} § "Client Components" — submit happy path, Error Catalog UX mapping per row, client-side validation pre-submit | `{test-file}` |

E2E for the page (auth guard redirects, page-level routing, full user flows) is authored externally by `/plan-test-specs` in the spec file referenced by `**Test Specs:**` above and consumed JIT by `/implement` Step 3. /plan-build does NOT emit E2E rows here. Page-level Unit testing is excluded by `testing-guide-{subproject}` artifact rule "Pages → E2E only" (technical constraint: pages render in Node, not jsdom).

**Acceptance criteria:**

- Form submission hits the mapped endpoint with typed payload; response maps to UX treatment per Error Catalog table.
- Route guard redirects correctly for all principal types enumerated in Authorization Matrix.
- Client-side validation matches BE Validation Rules 1:1 (no divergence).

---
````

### Populated form (post `/plan-test-specs`) — example

After `/plan-test-specs` authors the spec, the placeholder is replaced in place:

```markdown
### SI-NN.Xb — Tela de {screen name} (lógica & wiring)

**Test Specs:** see `<frontend-subproject>/specs/<feature>.plan.md`
**UI Contract:** see `## Technical Specifications` → `### UI Contracts` → `#### Screen: {name}`
```

Where `<frontend-subproject>` is the frontend subproject directory (resolved from the plan's `affected_subprojects:` field; if the role-to-directory mapping is ambiguous, ask the user via `AskUserQuestion` — do not guess) and `<feature>` is kebab-cased from the screen name.

Cross-layer SIs (raros; emitted via `phase-b.md` § `Template: SI block`, NOT via this template) use a comma-separated form: `**Test Specs:** see \`<frontend-subproject>/specs/<feature>.plan.md\`, \`<backend-subproject>/specs/<feature>.plan.md\``. See `phase-b.md` § "Conditional emit of `**Test Specs:**` field" for the cross-layer documentation — this template only covers screen Xa/Xb.
