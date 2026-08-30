# Template: Frontend Runtime SI blocks

Read by Phase B step B4 when emitting SIs derived from a `### Frontend Runtime → ####` subsection. One TD subsection produces ≥1 plain SI: 1 Setup SI + N Migration SIs (one per Migração table row in the subsection) + 1 optional Verification SI (when Verificação requires testing not already covered by Setup/Migration ACs).

Do NOT read this file when no TD in scope has `Renders in: frontend-runtime` (explicit OR default-by-inference per `phase-a.md` § A2).

**Plain `SI-NN.X` shape (no letter suffix, no dotted suffix).** Discriminator vs backend SIs is the subsection cited in Technical actions, not the naming. The conditional-skip rule for SI-Xb (Decisão #33) does NOT apply — Frontend Runtime SIs are always plain SIs by construction.

## SI-NN.X (Setup — ALWAYS emitted, exactly ONE per TD subsection)

````markdown
### SI-NN.X — {Pattern name from #### {td-slug}/TD-NN topic} (Setup)

**Frontend Runtime spec:** see `## Technical Specifications` → `### Frontend Runtime` → `#### {td-slug}/TD-NN — {topic}`

**Technical actions:** (≤5 actions; usually 1-2 — install lib + provider wrap)

1. Install/configure the library (per `**Libraries:**` in `{td-slug}/TD-NN`) — record the version pin in the relevant frontend subproject's dependency manifest (resolved from `**Affected subprojects:**` in `## Scope`; for JS/TS stacks this is `package.json`).
2. Implement the **Setup snippet** byte-verbatim from `### Frontend Runtime → #### {td-slug}/TD-NN → Setup` into the target entry-point file of the frontend subproject (location varies by framework: e.g., `app/providers.tsx` for Next.js App Router, `src/main.tsx` for Vite/React, `src/main.ts` for Vue, `src/routes/+layout.svelte` for SvelteKit). The snippet contains the F2-load-bearing canonical shape only (per `frontend-runtime.md → ## Snippet Scope`); extend it with the derivable boilerplate (imports, framework-standard wrappers, helper functions named in prose) without violating F2 — F2 covers the byte-verbatim portion of the snippet, not the boilerplate around it.
3. {Optional 3rd action — register provider wrapper in `app/layout.tsx` if not already present, OR configure runtime hooks per the TD's Pattern field}.

**Dependencies:** —

**Tests:** _(empty — Setup SI; smoke-gated by AC; behavior tests live in Migration + Verification SIs)_

**Acceptance criteria:**

- Library installed at the version pin recorded in the frontend subproject's dependency manifest.
- Setup snippet's F2-load-bearing content (per `frontend-runtime.md → ## Snippet Scope` INCLUDE list) present at the target entry-point file, byte-verbatim from the Frontend Runtime spec. Derivable boilerplate around it (imports, wrappers, helper functions named in prose) implemented per implementer's standard practice.
- Application boots without runtime error related to the new pattern.

---
````

## SI-NN.X' (Migration — ONE per Migração table row in the TD subsection)

````markdown
### SI-NN.X' — {Migration target file from Migração table} → {Pattern name}

**Frontend Runtime spec:** see `## Technical Specifications` → `### Frontend Runtime` → `#### {td-slug}/TD-NN — {topic}` → Migração row for `{file}`

**Technical actions:** (≤5 actions per file)

1. Read `{file}` → identify the current behavior pattern (per Migração row "Current behavior" cell).
2. Refactor `{file}` to apply the new pattern (per Migração row "Required change" cell). Field-name verbatim invariant (F2 protection) applies to any field/endpoint/lib name copied from the spec.
3. {Optional 3rd action — update related test files when the refactor changes test surface}.

**Dependencies:** SI-NN.X (Setup of the same pattern — Setup must land before any file migrates to the pattern, otherwise runtime error at import).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `{file}` | Unit / Integration per testing-guide-{subproject} — assert the new pattern is exercised (e.g., `useQuery` hook invoked when component renders, instead of `useEffect`); pre-existing user-visible behavior tests must still pass after refactor | `{test-file}` |

**Acceptance criteria:**

- `{file}` no longer contains the legacy pattern (per Migração row "Current behavior" — grep-verifiable).
- `{file}` uses the new pattern (per Migração row "Required change" — grep-verifiable).
- All pre-existing tests for `{file}` still pass.
- New tests asserting the new pattern adoption pass.

---
````

## SI-NN.X'' (Verification — OPTIONAL; emit only when Verificação requires test surface beyond Setup/Migration ACs)

````markdown
### SI-NN.X'' — {Pattern name} (Verification)

**Frontend Runtime spec:** see `## Technical Specifications` → `### Frontend Runtime` → `#### {td-slug}/TD-NN — {topic}` → Verificação

**Technical actions:** (≤5 actions)

1. Add the integration / E2E tests listed in the Verificação field that aren't already covered by individual Migration SI ACs.
2. {Optional 2nd action — add the regression guard tests when the Verificação field calls them out explicitly}.
3. {Optional 3rd action — wire CI hook if the new pattern requires a build-time check}.

**Dependencies:** SI-NN.X (Setup) AND SI-NN.X1', SI-NN.X2', ..., SI-NN.XK' (every Migration SI of the same pattern). Listed in `Dependencies:` line as: `SI-NN.<setup-X>, SI-NN.<migration-1>, ..., SI-NN.<migration-K>`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `{pattern-name}` (verification surface) | Integration / E2E per testing-guide-{subproject} — assertions enumerated in Verificação field of the spec; this SI IS the test surface (Technical actions add the test files listed here) | `{test-file}` |
| `{regression-guard-target}` (when Verificação calls one out) | Regression guard per testing-guide-{subproject} | `{test-file}` |

**Acceptance criteria:**

- Verificação tests listed in the spec are present and passing.
- Regression guards (when called out) are wired to the test runner.

---
````

## Dependency contract (canonical)

Every Frontend Runtime SI declares dependencies per this contract (no other shape is valid):

- **Setup SI:** `Dependencies: —` (entry point of the subsection; no prereq).
- **Migration SI:** `Dependencies: SI-NN.<setup-X>` (depends ONLY on the Setup SI of the same pattern).
- **Verification SI** (when emitted): `Dependencies: SI-NN.<setup-X>, SI-NN.<migration-1>, ..., SI-NN.<migration-K>` (depends on Setup + every Migration of the same pattern).

**Cross-section dependency** (Frontend Runtime SI ↔ backend SI in the same monolithic phase): when a Migration SI's refactor changes the fetcher of an endpoint whose contract is being decided in `### API Contracts` of the SAME phase, declare additionally a backend SI dependency:

- `Dependencies: SI-NN.<setup-X>, SI-NN.<backend-endpoint-Y>` (Setup + the backend SI that materializes the endpoint).

In **sliced phases** (FE and BE in distinct slices), the cross-slice dependency is captured at the slice level via `depends_on_slices` in the slice's frontmatter — no SI-level declaration needed; B5 Dependency Map renders both cases through the same `Dependencies:` line parsing mechanism (line 162 of `phase-b.md`).

## Build rules

- **Order within the phase:** Setup of a pattern ALWAYS precedes its Migrations. Migrations of the same pattern run in any order. Verification (when emitted) runs last for that pattern.
- **One SI per Migração row** — never bundle multiple files into one Migration SI (overflow risk + atomicity loss).
- **Empty Migração table** (greenfield Setup-only adoption) → emit only the Setup SI; no Migration SIs; no Verification SI (covered by Setup ACs).
- **Multiple Frontend Runtime TDs in the same phase** — each gets its own Setup (+ Migrations + Verification) sequence. Numbering proceeds linearly: SI-NN.X (Setup of TD-A), SI-NN.X+1 (Migration of TD-A row 1), ..., SI-NN.Y (Setup of TD-B), SI-NN.Y+1 (Migration of TD-B row 1), ...
