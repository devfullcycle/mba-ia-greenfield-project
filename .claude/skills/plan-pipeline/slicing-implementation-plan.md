---
kind: implementation-plan
name: pipeline-phase-slicing
date: 2026-04-23
status: pending
---

# Plan — Enable Phase Slicing in the Plan Pipeline

## Context

The current pipeline enforces **1:1 cardinality** between a phase number `NN` and its `scope_type: phase` decisions doc (`research/SKILL.md:315`, `plan-pipeline/SKILL.md:77`). This prevents a common real-world pattern: delivering a single logical phase in multiple slices (e.g., Phase 02 = auth, sliced as backend → frontend → infra, each planned/validated/built/implemented independently).

The goal is to relax the 1:1 rule and allow **N phase-scope docs per `NN`**, each representing a slice, while preserving:
- `project-plan.md` neutrality (slicing is invisible at roadmap level).
- Backward compatibility with monolithic phases (1 slice is still valid).
- Coverage-gap detection at the phase level (no capability falls through the cracks).
- Explicit dependency modeling between slices (DAG, not total order).

## Design decisions (grilled, locked)

| # | Decision | Source |
|---|----------|--------|
| A | One logical phase in `project-plan.md`; N slice docs in `docs/decisions/`. | Q1 |
| 2.3 | Slug is the pipeline's primary key. Integer arg stays as shortcut; aborts when ≥2 slices exist for `NN`. | Q2 |
| 3.1 | New frontmatter field `covers_capabilities: [<bullet-verbatim>, ...]` on phase-scope docs. Omitted = "covers all phase capabilities". | Q3 |
| 4.3 | New frontmatter field `depends_on_slices: [<sibling-slug>, ...]` declares cross-slice DAG. Gate: sibling must have all TDs `decided` OR plan-build artifact on disk. | Q4 |
| 5.1 | One inventory per UI-bearing slice; `covers_capabilities` drives UI-scope detection. | Q5 |
| 6.3 | Cross-slice coverage gate: advisory in `plan-validate` of every slice; hard-error in `plan-build` of the last slice (detected via "all other siblings have built artifacts"). | Q6 |
| 7.2.b | `/research` accepts slug or prose → kebab literal + `AskUserQuestion` confirm. | Q7 |
| 8.1 | `project-plan.md` stays neutral; slicing discovery via frontmatter glob. | Q8 |
| 9.1 | `library-refs.md` strictly per-slice dir; cross-slice visibility only via `depends_on_slices`; ad-hoc multi-NN byte-copies to ALL slice dirs of each listed NN. | Q9 |

## Invariants preserved

- Monolithic phases (current repo state: `phase-01-backend-config`) keep working unchanged. A phase with exactly 1 phase-scope doc behaves identically to today.
- `/plan-context 1` still resolves via single-slice shortcut.
- All frontmatter additions are **optional** (omitted = current behavior).
- `sources_mtime` upstream-fingerprint contract extends to include sibling `library-refs.md` when `depends_on_slices` is non-empty.

## Step Implementations

### SI-01. Update `plan-pipeline/SKILL.md` — shared contract

**Rationale:** plan-pipeline is the canonical shared contract; every downstream skill references it. Changes land here first so subsequent SIs cite the already-updated spec.

**Technical actions:**

1. Rewrite **Mode detection** section. New rules:
   - **Integer arg `NN`** → phase mode shortcut. Resolves to the single phase-scope doc for `NN` if exactly one exists; aborts with list of slices if ≥2 exist; aborts with `"Run /research phase NN first"` if 0 exist.
   - **String arg `{slug}`** → unified slug lookup. Glob `docs/decisions/technical-decisions-{slug}.md`:
     - If exists with `scope_type: phase` → phase mode (slice); `NN` extracted from `related_phases[0]`.
     - If exists with `scope_type: ad-hoc` AND `docs/tasks/task-{slug}/` exists → task mode.
     - If doc does not exist → task mode bootstrap.
2. Rewrite **Slug discovery** section (lines 76–84). Allow ≥1 matches for the "list slices" path; keep 0-match abort. Define **canonical abort messages** (referenced by SI-04, SI-05, SI-08, SI-09):
   - **0-match:** `"Run /research phase NN first"`
   - **≥2-match (integer arg):** `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."`
   All downstream SIs MUST use these verbatim to ensure the same condition produces the same message across skills.
3. Rewrite **Decisions docs scope model** (lines 215–218):
   ```
   Decisions docs with `scope_type: phase` MAY exist in multiples per NN (slices).
   Each must have exactly one integer in `related_phases`. When building context for
   phase NN + slice `{slug}`, include:
   - The phase-scope doc `{slug}`.
   - Every `scope_type: ad-hoc` doc whose `related_phases` contains NN.
   - Sibling phase-scope docs listed in this slice's `depends_on_slices` (via inheritance).
   ```
4. Add new section **"Phase slicing"** documenting:
   - `covers_capabilities` frontmatter (source of UI-scope detection per slice).
   - `depends_on_slices` frontmatter (DAG + maturity gate: sibling must have all TDs `decided` OR plan-build artifact present).
   - Phase-level advisory/hard-gate split (pointer to plan-validate + plan-build).
5. Update **directory layout block** (lines 44–54) to show multiple slice dirs per `NN` as legitimate.
6. Update **line 175** (task-mode inheritance description). Current: `"Task mode: the latest completed phase only (gated by progress.md Status: completed)"`. Replace with: `"Task mode: the latest completed phase (NN where every phase-NN-*/progress.md reports Status: completed). Sliced phases count as completed only when ALL slices are done."`
7. Update **line 181** (inventory inheritance). Current: `"Task mode additionally consumes the latest completed phase's inventory"`. Replace with: `"Task mode additionally consumes inventories from ALL UI-bearing slices of the latest completed phase (aggregated + deduped by component name)."`
8. Update **issue catalog (line 129)** to add two new issue IDs introduced by SI-04:
   - `| Missing Capability (cross-slice) | MC-cross-N | Phase capability not covered by any slice's covers_capabilities. Phase mode only, fires only when ≥2 phase-scope docs per NN. Advisory in plan-validate (does not flip status to dirty); hard-error in plan-build on last slice. |`
   - `| Capability Consistency | CC-N | A covers_capabilities entry does not match any bullet in project-plan.md verbatim. Phase mode only (slicing). Hard-error — flips status to dirty. Surfaced early (before cross-slice advisory) to catch typos and stale bullets. |`

**Expected file:** `.claude/skills/plan-pipeline/SKILL.md`

**Tests:** n/a (documentation). Validation: grep for residual phrases `"exactly one match"`, `"research/SKILL.md enforces 1:1 cardinality"`, and `"Multiple phase-scope decisions docs"` (abort message); should appear zero times after edit.

---

### SI-02. Update `research/SKILL.md` — frontmatter schema + prose-to-slug

**Rationale:** research owns the decisions doc frontmatter contract. Slicing adds two optional fields and relaxes the 1:1.

**Technical actions:**

1. Remove the 1:1 enforcement (line 315). Replace with:
   ```
   Multiple `scope_type: phase` docs per phase number ARE allowed (slicing model).
   Each slice must have a distinct slug and exactly one integer in `related_phases`.
   Coverage gaps across slices are detected downstream by plan-validate (advisory)
   and plan-build (hard gate on the last slice).
   ```
2. Document new frontmatter fields:
   - `covers_capabilities: [<bullet verbatim from project-plan.md>, ...]` — optional; omitted = "this slice covers all capabilities of its phase".
   - `depends_on_slices: [<sibling-slug>, ...]` — optional; omitted/`[]` = no sibling dependency.
3. Prose input handling already exists in research (line 11–22) — no change. The (7.2.b) pattern applies to *other* skills that need slug-primary adoption (plan-context, implement, screen-inventory).
4. **Capability gate must narrow to slice's `covers_capabilities` when set.** research/SKILL.md:111 currently enforces `"A TD only belongs in the document if it traces back to at least one literal capability bullet of a target phase in project-plan.md"`. Under slicing, a slice doc owns a SUBSET of the phase's bullets. Update the gate:
   - If the doc being written has `covers_capabilities` populated → the TD's `**Capability:**` field must cite a bullet ∈ the slice's `covers_capabilities` (NOT any bullet of the phase).
   - If `covers_capabilities` is omitted (monolithic phase) → the current gate applies unchanged (any phase bullet).
   - `Transversal — covers: ...` still allowed but all listed bullets must belong to the slice when `covers_capabilities` is set.
   - Rationale: prevents TDs from "leaking" into the wrong slice. A TD whose capability belongs to auth-backend's ownership cannot be accepted in `/research auth-frontend`.

5. Update the slug-collision handling (line 336) with **discriminated paths**:
   - **Collision with a phase-scope doc of the same NN** (slicing case) → `AskUserQuestion` with two options: (a) edit existing slice; (b) create new slice (user provides distinct slug).
   - **Collision with any other doc** (ad-hoc, or phase-scope of a different NN) → keep the current auto-suffix behavior unchanged. Preserves UX for non-slicing users.

**Expected file:** `.claude/skills/research/SKILL.md`

**Tests:** n/a.

---

### SI-03. Update `plan-context/SKILL.md` — unified slug lookup + UI detection from covers_capabilities

**Rationale:** plan-context is the first consumer of the new contract. Mode detection becomes slug-primary; UI-scope detection moves from `Affected subprojects` (phase-level) to `covers_capabilities` (slice-level).

**Technical actions:**

1. Rewrite **Input handling / Mode detection** section to use the plan-pipeline unified lookup (SI-01 step 1).
2. In **Step 0 (compute scope_prose)**:
   - Phase mode: `scope_prose` = join of bullets from `covers_capabilities` of the slice if present, else the full bullets of the phase from `project-plan.md` (monolithic fallback).
   - **Bounded-read topology changes:** Step 0 now performs up to 2 bounded reads in phase mode — (a) frontmatter of the slice's phase-scope decisions doc (to check for `covers_capabilities`); (b) `project-plan.md` phase bullets (always, for neighbors/deliverables/out-of-scope and as fallback for scope_prose if `covers_capabilities` omitted). Both are bounded, so main-thread context impact is negligible.
   - Monolithic (no `covers_capabilities` frontmatter field) → falls back to project-plan.md bullets — behavior identical to today.
   - plan-reader still runs for neighbors/deliverables/affected-subprojects extraction (subagent dispatch unchanged).
3. In **Step 0.5 (UI scope detection)**:
   - Phase mode: UI signal = any bullet in `covers_capabilities` (or phase bullets, fallback) matches UI phrasing (`Tela`, `Página`, `Área`, `Login`, `UI`) OR explicit frontmatter `ui_scope: true` (future extension point; ignore if absent).
4. In **Step 1 (dispatch subagents)**, add `phases-reader` expanded scope: subagent now accepts `depends_on_slices` and resolves sibling slice context.md + library-refs.md as inheritance source.
5. Update `sources_mtime` recording (Step 6) to include sibling slice `library-refs.md` for every entry in `depends_on_slices`.
6. Remove the "Multiple phase-scope decisions docs" abort error text from Step 3.

**Expected file:** `.claude/skills/plan-context/SKILL.md`

**Tests:** Run `/plan-context auth-frontend` on this repo after all SIs complete; expect `context.md` written under `docs/phases/phase-02-auth-frontend/` inheriting from `auth-backend`.

---

### SI-04. Update `plan-validate/SKILL.md` — advisory cross-slice MC-cross-N + CC-N hard-error

**Rationale:** per (6.3), the early-visibility half of the coverage gate lives here.

**Technical actions:**

1. **New issue ID `CC-N` (Capability Consistency) — hard-error.** Before running cross-slice aggregation, verify every entry of every slice's `covers_capabilities` frontmatter matches a bullet in `project-plan.md` verbatim. For each mismatch:
   - Fire `CC-N`: `"Slice {slug} declares covers_capabilities entry '{entry}' that does not match any bullet in project-plan.md's phase-NN capabilities. Explicit choice: (a) fix the typo / update the entry to match; (b) add the capability to project-plan.md if genuinely missing."`
   - Hard-error (flips `status` to `dirty`); advisory aggregation (step 2 below) does not run until CC-N is resolved.
   - Also register `CC-N` in the issue catalog updated by SI-01.
   - **Location in plan-validate/SKILL.md:** prepend to the new Section 6 (created by step 2 below) as a pre-check sub-step that runs BEFORE MC-cross-N aggregation. Rationale: both checks belong to the same "cross-slice coverage" concern — keeping them in one section avoids a Section 7 that readers would confuse with the existing Section 5. If only CC-N fires (no uncovered capabilities after typos fixed), Section 6's advisory aggregation runs on the next `/plan-validate` invocation.

2. Add a new **Section 6 — Cross-slice coverage advisory** (after current Section 5):
   - Glob sibling phase-scope docs for `NN` (same filter as slug discovery, minus current slug).
   - Aggregate `covers_capabilities` from self + siblings.
   - Compare to `project-plan.md` phase capabilities.
   - For each uncovered capability, emit `MC-cross-N` as **advisory** (does not flip `status` from `clean` to `dirty`; lives in a new `advisories:` frontmatter array).
3. Add `advisories:` top-level key in the `validation.md` frontmatter schema, parallel to `issues:`.
4. Document that advisories do NOT block `plan-build`; only hard-error issues do.
5. Mode detection passes slug-primary (SI-01).
6. **Suppress MC-cross-N advisory when the phase has only 1 slice.** Gate the Section 6 logic: if `count(phase-scope docs for NN) == 1` → skip aggregation entirely (monolithic; no cross-slice gap is possible by construction). Addresses the advisory-spam risk listed in "Risks & open questions".

7. **Update IC-N message (line 116)** to expose slicing-aware resolution paths. Current says `"(b) add capability to current scope (edit project-plan.md for phase mode...)"`. Replace phase-mode alternatives with 3 choices when the slice has `covers_capabilities` populated: `"(a) update inventory to remove stale verb via /screen-inventory extension run; (b) claim the capability in this slice's covers_capabilities frontmatter (if the bullet already exists in project-plan.md but another slice owns it — transfer ownership); (c) add new capability to project-plan.md + include in this slice's covers_capabilities."`. For monolithic phases (no `covers_capabilities`), keep the current 2-choice message — the "transfer ownership" branch is slicing-specific.

**Expected file:** `.claude/skills/plan-validate/SKILL.md`

---

### SI-05. Update `plan-build/SKILL.md` — hard gate on last slice + cross-slice library resolution

**Rationale:** per (6.3), the hard-gate half. Plus library resolution now aggregates `depends_on_slices`.

**Technical actions:**

1. Add a new **Gate 9.5 — Last-slice coverage gate**:
   - Glob sibling phase-scope docs for `NN`.
   - Check each has a built artifact at `docs/phases/phase-NN-{sibling}/phase-NN-{sibling}.md`.
   - If this slice is the last without an artifact → aggregate `covers_capabilities` from all siblings + self, compare to `project-plan.md`.
   - If any capability uncovered → hard abort: `"Phase NN has uncovered capabilities: <list>. Update covers_capabilities in at least one sibling's phase-scope doc, or add new slices via /research, before building the last slice."`
   - If capabilities are all covered OR this is not the last slice → proceed.
2. Update **library-refs aggregation** (around Gate 8 / Phase A1): when reading `library-refs.md` of the current slice, also read each sibling listed in `depends_on_slices`. Merge keys (current slice wins on collision).
3. Mode detection slug-primary.
4. **Update Gate 2 abort message (plan-build/SKILL.md:28)** for integer-arg resolution. Current: `"abort on 0 or ≥2"`. New: `"On 0 → 'Run /research phase NN first'. On ≥2 → 'Phase NN has multiple slices: <list>. Pass an explicit slice slug.'"`. Aligns with SI-01 shared rule.

**Expected file:** `.claude/skills/plan-build/SKILL.md`

---

### SI-06. Update `plan-resolve/SKILL.md` — byte-copy propagation across slices

**Rationale:** per (9.1), ad-hoc with `related_phases: [2]` now multiplies copy targets by the number of existing slice dirs per listed NN.

**Technical actions:**

1. Rewrite **Cross-scope propagation for ad-hoc libs** (line 215). The current language `phase-MM-{slug_M}/library-refs.md` implies point-resolution of a unique slug per `MM` (1:1 baggage). Replace with explicit glob — monolithic cases resolve to a single match, identical to current behavior:
   ```
   For each `MM` in the ad-hoc's `related_phases`:
     Glob docs/phases/phase-MM-*/library-refs.md (expect ≥0 matches — zero matches = skip silently, ≥1 = byte-copy to each)
     byte-copy the current target's library-refs.md to each match.
   ```
   This is a mechanical refactor from point-resolution to glob-resolution; behavior for monolithic phases (1 slice) is byte-identical.
2. Update **`sources_mtime` invariant** (line 255) to note that, when `depends_on_slices` is non-empty on a slice, the slice's `context.md` and `library-refs.md` both record sibling `library-refs.md` mtimes.
3. Mode detection slug-primary.

**Expected file:** `.claude/skills/plan-resolve/SKILL.md`

---

### SI-07. Update `implement/SKILL.md` — slug-primary disambiguation

**Rationale:** `implement/SKILL.md` already handles multi-match via the existing fallback on line 23 (`"if multiple match, ask the user which one"`). `/implement 2` on a phase with 2 slices ALREADY triggers the user-prompt fallback today. No behavior change required; only documentation clarification.

**Technical actions:**

1. Keep integer-arg glob + multi-match fallback as-is.
2. Add a note under Mode detection: multi-match IS the expected path when the target phase has multiple slices (per plan-pipeline slicing model); the fallback is promoted from "edge case" to "first-class path".
3. Optionally (non-blocking): accept slice slug directly as the string-arg path in phase mode — `/implement auth-frontend` resolves to `docs/phases/phase-02-auth-frontend/phase-02-auth-frontend.md` by globbing `docs/phases/phase-*-{slug}/`. Aligns with slug-primary but not required for slicing to work.
4. Progress file path: `docs/phases/phase-NN-{slice-slug}/progress.md` — already correct, no change.

**Risk: minimal.** The existing fallback is the slicing path.

**Expected file:** `.claude/skills/implement/SKILL.md`

---

### SI-08. Update `screen-inventory/SKILL.md` — slug-primary + covers_capabilities as UI source

**Rationale:** per (5.1), inventory is per UI-bearing slice; UI-scope detection reads `covers_capabilities`.

**Technical actions:**

1. Rewrite **Input handling** for phase mode: accept slug (primary); integer shortcut works **iff exactly 1 UI-bearing slice exists for NN** (monolithic fullstack phase, or sliced phase where only one slice has UI bullets in its `covers_capabilities`). If ≥2 UI-bearing slices exist for NN → abort listing them, ask user to pass explicit slug.
2. Rewrite **Context collection** step for phase mode: read `covers_capabilities` of the slice from its phase-scope doc; fall back to `project-plan.md` phase bullets if omitted.
3. Inventory file name: `docs/inventories/screen-inventory-phase-NN-{slice-slug}.md` — already correct (the `{slug}` is slice slug post-change).
4. Abort-fast: if slice has no UI signal in `covers_capabilities`, refuse to run (`"Slice {slug} declares no UI capabilities — use /screen-inventory on a UI-bearing slice or add UI bullets to covers_capabilities"`).

**Expected file:** `.claude/skills/screen-inventory/SKILL.md`

---

### SI-09. Update subagents — slug as input, phases-reader cross-slice expansion

**Rationale:** subagents are the ground-truth implementation of skill behavior. Contract updates above mean nothing if agents still operate on NN.

**Technical actions (one per agent, parallel-independent):**

**Shared rule for all phase-mode agents (applies to items 1–5 below; Decisão #25 legacy behavior + slicing):** when identifier is an integer `NN` (legacy caller) AND mode=phase AND `scope_type: phase` docs matching NN are ≥2 → the agent aborts with the canonical message from SI-01: `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."` (capital P, no "as identifier" suffix — `<list>` is the comma-separated matching slugs). Integer shortcut continues to work when 0 or 1 phase-scope doc matches NN (monolithic semantics preserved).

1. `phases-reader`:
   - Accept `mode=phase, NN={N}, slug={slug}, depends_on_slices=[...]`.
   - **Phase-mode inheritance aggregation for sliced prior phases.** Step 1's glob `docs/phases/phase-*/phase-*.md` may return multiple matches per prior NN (one per slice). Before iterating, **group matches by NN**. For each prior NN that is sliced (≥2 matches):
     - Iterate all slices of NN.
     - **Dedupe Conventions:** union of conventions across slices; string-match dedupe (same bullet text appearing in 2+ slices emits once, tagged `_(from phase NN)_` without slice suffix).
     - **Aggregate TDs:** emit all TDs from all slices. Refs are already `{slice-slug}/TD-NN` so no collision.
     - **Deferred Capabilities:** union across slices' `## Non-UI / Deferred Capabilities`.
   - **Task-mode "latest completed phase" redefinition.** Currently: "latest phase whose progress.md reports Status: completed". With slicing, a phase NN is **completed iff EVERY phase-NN-*/progress.md reports `Status: completed`**. Monolithic (1 slice) is a particular case. Rewrite step 1 of mode=task:
     - Glob `docs/phases/phase-*/progress.md`.
     - Group by NN (extracted from folder name).
     - For each NN, check that all progress.md files in the group report `Status: completed`; otherwise the NN is NOT completed.
     - Sort qualifying NNs descending; take the first.
     - Inheritance source = every slice of that NN (aggregated via phase-mode rules above).
   - **Sibling inheritance via `depends_on_slices` (phase mode).** Additional to prior-phase glob: read sibling slices listed in current slice's `depends_on_slices`. Tag with `_(from slice {sibling-slug})_` in output. Apply maturity gate: skip sibling if any of its TDs is `pending` AND its plan-build artifact is absent.

2. `decisions-reader` — **rewrite keep filter** (not just "remove abort"). New input contract: identifier is always the slug (integer NN legacy path still works but goes through slug resolution upstream). Phase-mode keep filter:
   ```
   Keep if (scope_type: phase AND filename-slug == identifier)
   OR     (scope_type: ad-hoc AND NN ∈ related_phases)  ← NN derived from the slug's frontmatter related_phases[0]
   ```
   Monolithic case: filename-slug == identifier matches the single phase-scope doc (identical to current behavior). Sliced case: only the identified slice's doc matches. Ad-hoc branch unchanged — still catches all NN-linked ad-hoc docs.

3. `decisions-detail-reader`:
   - Same keep-filter rewrite as decisions-reader.

4. `decisions-correlator`:
   - **Accept `slug` as identifier** in phase mode (was: `NN` integer). Derive `NN` via `Read` of the slice's own decisions-doc frontmatter → `related_phases[0]`.
   - Pool filter (`ad-hoc AND related_phases: []` in phase mode; "all except task's own" in task mode) is unchanged.
   - Output label: `## Correlated for Phase NN / slice {slug}` (was: `## Correlated for Phase NN`).
   - **This IS a file edit** — include `decisions-correlator.md` in SI-09 Expected files list.
5. `inventory-digest-reader`:
   - **Phase mode:** accept `slug` (primary); lookup `docs/inventories/screen-inventory-phase-NN-{slug}.md` exactly (no wildcard). If file absent → placeholder `_No screen inventory — UI↔API sync deferred._`.
   - **Task mode step 7 (inherited UI components) aggregation:** the existing step expects exactly one inventory for the latest completed phase. With slicing, a completed NN has ≥1 UI-bearing slices — potentially multiple inventories. Rewrite:
     - Glob `docs/inventories/screen-inventory-phase-MM-*.md` for the latest completed NN=MM (per phases-reader's redefined completion rule).
     - Iterate ALL matches (0..N). For each, bounded-scan Component inventory rows where `Reuse?` has a real path.
     - Collect `(component_name, reuse_path, source_slice_slug)` tuples across all slice inventories.
     - Dedupe by component_name (first match wins; earlier slice wins ties).
     - Filter by `component_name ∉ task_covered_components`.
     - Emit `### Inherited UI Components` with source tagging `from slice {slug}` instead of `from phase-NN`.

**Expected files:** `.claude/agents/phases-reader.md`, `.claude/agents/decisions-reader.md`, `.claude/agents/decisions-detail-reader.md`, `.claude/agents/decisions-correlator.md`, `.claude/agents/inventory-digest-reader.md` (5 agents; plan-reader is the only one unchanged).

---

### SI-10. Migrate current repo state

**Rationale:** the repo already has `phase-02-auth-backend/` on disk as a "completed" phase dir, and `technical-decisions-auth-backend.md` + `technical-decisions-auth-frontend.md` both with `scope_type: phase, related_phases: [2]`. Post-SI-01..09, the pipeline accepts this state, but the docs need to be annotated for slicing.

**Technical actions:**

0. **Rename inventory file to match slice slug.** Current repo has `docs/inventories/screen-inventory-phase-02-cadastro-login-conta.md` (slug `cadastro-login-conta` doesn't match any phase-scope doc — legacy from pre-split naming). Rename to `docs/inventories/screen-inventory-phase-02-auth-frontend.md` (only `auth-frontend` has UI scope; `auth-backend` is purely backend per screen-inventory skip criteria). Also rename the `.progress.md` sibling. This is pre-existing drift, not caused by the plan, but surfaces now because SI-08 changes phase-mode lookup from wildcard glob to slug-exact.

1. Add `covers_capabilities` to `technical-decisions-auth-backend.md` frontmatter:
   ```yaml
   covers_capabilities:
     - "Serviço de envio de e-mails transacionais"
     - "Cadastro de usuário com e-mail e senha"
     - "Criação automática do canal do usuário a partir do prefixo do e-mail"
     - "Confirmação de conta via e-mail com link de ativação"
   ```
   (exact bullets to be confirmed by user — list drafted from current plan; actual ownership split is a user decision).
2. Add `covers_capabilities` + `depends_on_slices: [auth-backend]` to `technical-decisions-auth-frontend.md`:
   ```yaml
   covers_capabilities:
     - "Login e controle de sessão do usuário"
     - "Logout"
     - "Recuperação de senha: solicitação via e-mail → link com token → redefinição"
   depends_on_slices:
     - auth-backend
   ```
3. User confirmation required before editing (ownership split is policy, not mechanics).

**Expected files:** `docs/decisions/technical-decisions-auth-backend.md`, `docs/decisions/technical-decisions-auth-frontend.md`.

---

### SI-10.5. Restamp sources_mtime for already-built slices after migration

**Rationale:** SI-10 mutates the frontmatter of `technical-decisions-auth-backend.md` to add `covers_capabilities`. This bumps the decisions doc's mtime. But `phase-02-auth-backend/context.md` / `validation.md` / `phase-02-auth-backend.md` all recorded the previous mtime in their `sources_mtime`. Next `/plan-*` invocation on auth-backend would abort with "stale sources_mtime, rerun /plan-context".

**Technical actions:**

1. After SI-10 completes, immediately run `/plan-context auth-backend`.
2. Expect context.md overwrite with refreshed `sources_mtime`. Because auth-backend is already built and decisions are all `decided`, the regeneration is a no-op semantically — only mtime fields shift.
3. Do NOT rerun plan-validate / plan-build for auth-backend. The built artifact remains valid; only context.md's mtime stamps needed refresh.
4. Repeat for any other phase-scope doc touched by migration (only auth-frontend if it also gains new frontmatter, but it's pending anyway so rerun is expected).

**Pass criteria:** grep `auth-backend` mtime in `docs/phases/phase-02-auth-backend/context.md` frontmatter; must equal `stat` of `technical-decisions-auth-backend.md` post-SI-10.

---

### SI-11. End-to-end smoke test on this repo

**Rationale:** exercises the full pipeline against the slicing model with real artifacts.

**Technical actions:**

1. `/plan-context auth-frontend` — expect `docs/phases/phase-02-auth-frontend/context.md` written with:
   - `## Inherited Decisions Detail` containing `auth-backend/TD-*` entries (via `depends_on_slices`).
   - `## UI Inventory` populated from `screen-inventory-phase-02-auth-frontend.md` (after SI-10 step 0 renames it from the legacy `cadastro-login-conta` filename).
   - `## Capability Coverage` listing only auth-frontend's declared capabilities.
2. `/plan-validate auth-frontend` — expect `validation.md` with:
   - `advisories: []` (auth-backend + auth-frontend cover all Phase 02 capabilities in the proposed split).
   - `issues:` populated from whichever TDs are still pending.
3. `/plan-build auth-frontend` — expect the artifact `docs/phases/phase-02-auth-frontend/phase-02-auth-frontend.md` with library-refs pulled from `auth-backend/library-refs.md` where inherited TDs cite libs.

**Pass criteria:** all three steps complete without aborts; generated artifacts match the shape documented in each skill.

---

## Dependency Map

```
SI-01 (plan-pipeline — shared contract) ─┬─► SI-02 (research)
                                         ├─► SI-03 (plan-context)
                                         ├─► SI-04 (plan-validate)
                                         ├─► SI-05 (plan-build)
                                         ├─► SI-06 (plan-resolve)
                                         ├─► SI-07 (implement)
                                         └─► SI-08 (screen-inventory)

SI-02..08 ────► SI-09 (subagents update — parallel-independent between agents; SI-02 feeds frontmatter schema agents must read)

SI-09 ────► SI-10 (repo migration — data-only, needs pipeline to accept new fields)

SI-10 ────► SI-10.5 (restamp sources_mtime after frontmatter mutation)

SI-10.5 ────► SI-11 (smoke test — needs migrated repo state + refreshed mtimes + working pipeline)
```

SIs 02 through 08 are parallel-independent after SI-01 lands. SIs 09 agent edits are parallel-independent with each other.

## Deliverables

- 8 updated `SKILL.md` files under `.claude/skills/`.
- 5 updated agent definitions under `.claude/agents/` (phases-reader, decisions-reader, decisions-detail-reader, decisions-correlator, inventory-digest-reader; plan-reader unchanged).
- 2 decisions docs annotated with `covers_capabilities` + `depends_on_slices` (user-confirmed split).
- 1 end-to-end smoke test run producing `docs/phases/phase-02-auth-frontend/{context,validation,phase-02-auth-frontend}.md`.
- This plan doc remains in-repo as a decision record.

## Risks & open questions

- **Advisory spam during bootstrap** — **RESOLVED in SI-04 step 5.** When user runs `/plan-validate` on the FIRST slice of a new phase (no siblings yet), cross-slice aggregation would list every phase capability as uncovered. SI-04 step 5 gates Section 6 to skip entirely when `count(phase-scope docs for NN) == 1` (monolithic semantics — no gap is possible by construction).
- **`depends_on_slices` cycle detection.** Two slices can't mutually depend on each other. Not covered in the grilling; recommend adding a preflight cycle check in `plan-context` Step 0.5 (abort if cycle detected).
- **Inventory file naming collision** — **RESOLVED in SI-10 step 0** (rename chosen over fallback — consistency wins). Today the inventory for phase 02 is `screen-inventory-phase-02-cadastro-login-conta.md` (uses the project-plan.md title as slug). Post-slicing, the naming convention is `screen-inventory-phase-02-{slice-slug}.md`. SI-10 step 0 renames `cadastro-login-conta` → `auth-frontend` (+ `.progress.md` sibling) at migration time.
- **Cross-layer TD ordering constraint in slice DAG.** A Cross-layer TD decided late (in a downstream slice) may logically impact earlier slices that are already built. Example: auth-backend built + status: completed → user plans auth-frontend → decides Cross-layer TD about contract format → should have changed auth-backend's API but auth-backend is frozen. Not covered by any current SI. Mitigation candidates: (a) plan-validate advisory when Cross-layer TD is created in a slice whose `depends_on_slices` has built predecessors; (b) treat as user responsibility (document in plan-pipeline). Recommendation: defer to a follow-up SI — the current plan does not block on this, but users should be aware.
- **Migration breaks phase-02-auth-backend's completed state** — **RESOLVED in SI-10.5.** Adding `covers_capabilities` to auth-backend's frontmatter mutates `sources_mtime` for downstream artifacts. Since auth-backend is already built, the next `/plan-*` on that slice would see a stale mtime mismatch. SI-10.5 restamps via `/plan-context auth-backend` rerun immediately after SI-10 — regenerates context.md with fresh mtimes without re-building.

## Execution guidance

Do NOT execute SI-10 (repo migration) until SI-01..09 are merged and the updated pipeline has been smoke-tested on a throwaway scope first. The current `phase-02-auth-backend/` state is a finished artifact; touching its decisions doc frontmatter before the pipeline understands the new fields risks corrupting downstream mtime records.

Recommended execution order:
1. SI-01 (plan-pipeline).
2. SI-02..08 in parallel (skills).
3. SI-09 agent edits in parallel.
4. User approval checkpoint.
5. SI-10 migration (user confirms capability split).
6. SI-11 smoke test.
