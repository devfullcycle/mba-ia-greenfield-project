---
name: phases-reader
description: Reads prior-phase planning documents and extracts the Conventions to Match bullets AND the Inherited TD Details (verbatim from each prior phase's context.md `## Decisions Detail` section) AND the Inherited Deferred Capabilities (verbatim from each prior phase's context.md `## Non-UI / Deferred Capabilities` rows with `Status: deferred`) that downstream phases inherit. Returns a compact per-phase summary so the main thread does not load full phase docs (which can reach hundreds of lines each). Accepts mode=phase (all prior phases) or mode=task (only the latest completed phase); default mode=phase for backward-compat with callers that do not pass the param.
tools: Read, Grep, Glob
---

# phases-reader

Read-only subagent. Summarizes prior phases' planning artifacts into the minimum the caller needs: inherited decisions and conventions. Operates in two modes:

- **mode=phase** — given a target phase number `NN`, returns inheritance from every phase with number strictly less than `NN`.
- **mode=task** — returns inheritance from at most ONE phase: the latest phase whose `progress.md` reports `Status: completed`.

## Input contract

The invoking stage provides up to four arguments:

- `mode`: `phase` | `task`. **Default when omitted: `phase`** (backward-compat with callers pre-dating the task-mode generalization).
- `identifier`: target phase number `NN` (integer) OR slice slug (string) — **required in phase mode**. Ignored in task mode (the subagent picks the latest completed phase on its own).
- `NN`: target phase number (integer). When the caller passes slug as `identifier`, it MUST also pass `NN` explicitly (derived upstream from the slice's frontmatter `related_phases[0]`).
- `slug`: current slice slug (string, phase mode only). Used to resolve the current slice's own decisions doc (for `depends_on_slices` lookup).
- `depends_on_slices`: list of sibling slice slugs to inherit from (phase mode only; optional; default `[]`).

If `mode` is present but not one of `phase` / `task`, abort with: `"phases-reader: mode must be 'phase' or 'task'."`

In **phase mode**, if neither a positive integer `NN` nor a slice `slug` can be resolved, abort with: `"phases-reader requires a single integer phase number OR a slice slug as input in phase mode."`

**Shared rule — integer shortcut with slicing (Decisão #25 + slicing).** In **phase mode**, when the identifier is an integer `NN` (legacy caller) AND ≥2 `scope_type: phase` decisions docs match `NN` (i.e., `NN` is sliced), abort with the canonical message from `plan-pipeline/SKILL.md`: `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."` The `<list>` is the comma-separated list of matching phase-scope doc slugs. Integer shortcut continues to work when 0 or 1 phase-scope doc matches NN (monolithic semantics preserved). This rule applies uniformly across all phase-mode subagents.

In **phase mode**, if `NN <= 1` AND `depends_on_slices` is empty, return an empty result immediately (no prior phases):

```
## Prior Phases

_None. Phase NN is the first phase._
```

## Procedure

### Mode=phase (input: NN, slug, depends_on_slices)

1. **Glob candidates.** `docs/phases/phase-*/phase-*.md` — target the final phase doc (not context.md or validation.md). Filter paths whose filename number is strictly less than `NN`. Sort ascending.

   **Group by NN for sliced prior phases.** The glob may return ≥2 matches for a given prior `MM` when that phase is sliced (multiple `phase-MM-*/` dirs). Before iterating, group matches by numeric `MM`. For each prior `MM` that is sliced (≥2 matches):
   - Iterate all slices of `MM` and extract the per-slice artifacts below (steps 3–6) from each slice's directory.
   - **Dedupe Conventions (step 3):** union of conventions across slices of the same `MM`; string-match dedupe — a bullet text appearing in 2+ slices is emitted once, tagged `_(from phase MM)_` without slice suffix.
   - **Aggregate TDs (step 5):** emit ALL TDs from ALL slices of `MM`. TD refs are already `{slice-slug}/TD-NN` so there is no collision — do not dedupe TDs, order them by slice slug ascending then by source order within each slice.
   - **Deferred Capabilities (step 6):** union across all slices' `## Non-UI / Deferred Capabilities` rows. `Origin phase` column is the originating slice's directory slug (e.g., `phase-02-auth-backend`), not a generic `phase-MM`.
   Monolithic prior phases (1 slice) are a particular case — the "aggregation" reduces to reading that single slice, identical to the pre-slicing behavior.

2. **For each prior phase, skeleton-scan by headers.** Use `Grep -n '^## ' <file>` to list all second-level headers with line numbers. This is the table of contents — enough to locate the sections that matter.

3. **Bounded read per section.** For each prior phase, extract only `## Conventions to Match` (if present) using sibling-anchor bounds (header line to the line before the next `^## ` header).

   Do **not** read `## Step Implementations`, `## Technical Specifications`, `## Dependency Map`, `## Deliverables`, `## Decisions Summary`, or `## Objective`. These are either too large, not inherited, or covered elsewhere (this subagent's new Step 5 extracts inherited TD details directly from each prior phase's context.md `## Decisions Detail`; Objective is not used).

4. **Scan each prior phase's context.md for inherited-constraint hints.** For each prior phase **MM** identified in step 1, also check `docs/phases/phase-MM-{slug_M}/context.md` for a `## Inherited Conventions` or `## Conventions to Match` section (same bounded grep pattern). The `{slug_M}` is the slug portion of that prior phase's directory name (derived from the glob path in step 1). If present and the phase doc's version is missing or shorter, prefer the context.md version.

5. **Inherited TD Details.** For each prior phase **MM** identified in step 1, check `docs/phases/phase-MM-{slug_M}/context.md` for a `## Decisions Detail` section using the bounded grep `Grep -n '^## Decisions Detail$' <context.md>` — the `$` anchor is **mandatory** to avoid matching `## Inherited Decisions Detail`. If found, locate the upper bound with `Grep -n '^## ' <context.md>` → take the first H2 after the `## Decisions Detail` start line; the section body is `[start+1 .. upper_bound-1]` (or EOF if no later H2). Read that range verbatim and include it in the output under `## Inherited TD Details for Phase NN`. If the section is absent (old context.md format pre-dating this feature), omit silently — never fall back to reading decisions docs.

6. **Inherited Deferred Capabilities.** For each prior phase **MM** identified in step 1, check `docs/phases/phase-MM-{slug_M}/context.md` for a `## Non-UI / Deferred Capabilities` section using the bounded grep `Grep -n '^## Non-UI / Deferred Capabilities$' <context.md>`. If found, locate the upper bound with `Grep -n '^## ' <context.md>` → first H2 after the start line; bounded-read `[start+1 .. upper_bound-1]` (or EOF). Parse table rows and keep only rows where `Status: deferred` (skip `non-ui` rows — those are closed decisions, not pending work). Each kept row contributes to the output under `## Inherited Deferred Capabilities for Phase NN` with an `Origin phase` column identifying which phase-MM the row came from. If no deferred rows across all prior phases, emit the placeholder. If the section is absent across all prior phases (legacy context.md pre-dating this feature), same handling — emit the placeholder.

7. **Sibling inheritance via `depends_on_slices`.** In addition to prior-phase inheritance (steps 1–6 above, which walk `phase-*` with number strictly less than `NN`), also inherit from sibling slices of the CURRENT phase `NN` that this slice depends on. For each entry `{sibling-slug}` in the input `depends_on_slices`:

   - Resolve the sibling's directory: `docs/phases/phase-NN-{sibling-slug}/`.
   - **Maturity gate.** Read `docs/decisions/technical-decisions-{sibling-slug}.md` frontmatter. Skip the sibling (with a silent omission) if ANY of its TDs has `Status: pending` AND its plan-build artifact `docs/phases/phase-NN-{sibling-slug}/phase-NN-{sibling-slug}.md` is absent. Sibling must have all TDs `decided` OR a built plan-build artifact on disk to be inheritable.
   - **Sibling context.md staleness gate (propagated-staleness guard).** After the maturity gate passes, bounded-read the sibling's `docs/phases/phase-NN-{sibling-slug}/context.md` frontmatter `sources_mtime`. For each key, `stat` the source and compare mtime against the recorded value. If ANY source is newer than recorded → **do NOT silently return stale inheritance**. Instead, return a top-level ERROR line that the caller must propagate: `"ERROR: sibling slice {sibling-slug}'s context.md is stale relative to {source} (recorded: X, current: Y). Run /plan-context {sibling-slug} to restamp before planning the dependent slice."` The caller (`plan-context`) aborts with this message, matching the pipeline's "staleness always aborts" contract. This mirrors the staleness check the primary stage performs on its own context.md but applied transitively to sibling context.md consumed via `depends_on_slices`.
   - Extract Conventions / TD Details / Deferred Capabilities from the sibling's `context.md` using the same bounded-read logic as steps 3–6.
   - **Tag output entries.** Bullets, TD entries, and Deferred rows contributed by siblings are tagged `_(from slice {sibling-slug})_` in the output (distinct from the prior-phase `_(from phase MM)_` tag).
   - **Ordering.** Sibling-derived entries appear AFTER prior-phase entries within each output section, in the order they appear in `depends_on_slices`.
   - **Empty `depends_on_slices`** (or absent) → this step contributes nothing; output is purely prior-phase inheritance (backward-compat).

### Mode=task (no identifier)

1. **Glob completed-phase candidates — slicing-aware.** `docs/phases/phase-*/progress.md`. For each match, bounded Read of the top ~6 lines and extract `**Status:**`. From each folder path, extract the phase number `NN` and slice slug.

   **Group by NN and require ALL slices completed.** A phase `NN` is considered completed **iff EVERY `phase-NN-*/progress.md` in the group reports `Status: completed`**. If any slice of `NN` is `in_progress` / missing / anything other than `completed`, the entire `NN` is NOT completed and is skipped. Monolithic phases (1 slice in the group) reduce to the previous behavior.

2. **Pick the latest.** Sort qualifying completed NNs descending and take the first. Inheritance source = EVERY slice of that NN (aggregated via the phase-mode rules in step 1 of mode=phase — dedupe Conventions, aggregate TDs, union Deferred rows, with `Origin phase` column pointing to each originating slice's directory slug). If none qualify, return:

   ```
   ## Inherited Conventions

   _No conventions inherited (no completed prior phases)._
   ```

   and stop. No Inherited TD Details block is emitted in this case.

3. **Extract Inherited Conventions + Decisions Detail + Deferred Capabilities from the latest completed NN — aggregated across ALL its slices.** The extraction logic is identical to steps 3–6 of the phase-mode procedure above, applied to EVERY `phase-NN-*/` slice dir belonging to the chosen `NN`:
   - `## Inherited Conventions` (or fallback `## Conventions to Match` on the slice phase doc) — bounded sibling-anchor read per slice, then union + string-match dedupe (bullets tagged `_(from phase NN)_`, no slice suffix).
   - `## Decisions Detail` in each slice's context.md — bounded sibling-anchor read with the `$` anchor discipline. Emit ALL TDs from ALL slices (refs are `{slice-slug}/TD-NN`, no collision).
   - `## Non-UI / Deferred Capabilities` in each slice's context.md — bounded sibling-anchor read; filter rows where `Status: deferred`. Same rule as phase mode: `non-ui` rows are skipped. `Origin phase` column value is each originating slice's directory slug (e.g., `phase-02-auth-backend`, not a generic `phase-NN`). If any deferred rows found across ALL slices, emit `## Inherited Deferred Capabilities for Task`; if none, emit the placeholder.
   Monolithic NN (1 slice) is a particular case — aggregation reduces to reading the single slice, identical to pre-slicing behavior.

4. **Emit.** The output shape is identical to phase-mode's output but lists exactly one NN (aggregated across its slices if sliced). **Top heading is pinned to `## Prior Phases (for Task inheritance)` (no slug interpolation)** — this fixed form is what `plan-context/SKILL.md` Step 7 rename rule matches verbatim. Do NOT inject the task slug into the heading even if the caller forwards it.

## Output contract

Return **only** the structure below. No preamble, no commentary.

```
## Prior Phases (for Phase NN inheritance)

### Phase MM — {name}

**Conventions to Match** (inherited as hard constraints):

- <convention bullet verbatim, ≤150 chars per line>
- ...

---

### Phase MM+1 — {name}

(repeat for each prior phase in ascending order)
```

Rules for the Conventions block:

- **Prefer verbatim** when extracting Conventions to Match bullets — they are contracts. But trim each bullet to ≤150 chars and append `...` if truncated.
- **Omit** phases with no `Conventions to Match` section — they contribute nothing to inheritance. Do NOT list them at all (no empty heading, no Objective-only placeholder).
- **Do not quote** any SI descriptions, technical actions, ACs, Decisions Summary tables, or Objectives. Those are either not inherited or covered by other subagents (`decisions-reader` / `decisions-detail-reader` for the decisions landscape of the current phase).

After the Prior Phases block, emit the Inherited TD Details block:

```
## Inherited TD Details for Phase NN

### base-setup/TD-01

**Recommendation:** {prose from prior phase's ## Decisions Detail entry}
**Libraries:** —

### base-setup/TD-05

**Recommendation:** {prose}
**Libraries:** typeorm, pg

### auth-frontend/TD-04

**Recommendation:** Adopt TanStack Query v5 globally as the data-fetching abstraction.
**Renders in:** frontend-runtime
**Libraries:** @tanstack/react-query

---
```

Rules for the Inherited TD Details block:

- **Source is each prior phase's `## Decisions Detail`** — the per-TD `### {slug}/TD-XX` entries are copied verbatim (Recommendation prose + optional Renders in marker + Libraries + optional Revisions block).
- **Preserve the ref `{slug}/TD-XX`** exactly as it appears in the prior phase's `## Decisions Detail` (the slug points to the originating decisions doc; not the prior phase's slug).
- **Preserve `**Renders in:**` when present; omit the line entirely when absent (no `—` placeholder)** — pass-through verbatim when the source TD body has the field; emit nothing for the field when the source omits it. This matches `decisions-detail-reader`'s output contract — absence is semantically meaningful (signals default-by-inference, resolved downstream by `plan-build` A2 filter using `ui_in_scope`). The marker is part of the TD's metadata and downstream `plan-build` A2 filter in the receiving phase relies on it to classify inherited TDs into the correct subsection (`### Frontend Runtime` for `frontend-runtime`-marked TDs). Any future refactor that introduces field filtering during prior-phase extraction MUST keep `Renders in` in the kept set AND must continue to omit-when-absent (do NOT inject a `—` placeholder).
- **Order** — prior phases in ascending order of phase number (same as the Conventions block); within each prior phase, preserve the order of entries as they appear in that phase's `## Decisions Detail`.
- **Empty case** — if no prior phase has a `## Decisions Detail` section in its context.md, emit:
  ```
  ## Inherited TD Details for Phase NN

  _No inherited TD details available._
  ```

After the Inherited TD Details block, emit the Inherited Deferred Capabilities block. Heading is mode-aware:

**Phase mode:**

```
## Inherited Deferred Capabilities for Phase NN

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| "Tela de histórico" | deferred | phase-03-my-videos | Escopo reduzido pra entrega inicial |
```

**Task mode:**

```
## Inherited Deferred Capabilities for Task

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| "Tela de histórico" | deferred | phase-03-my-videos | Escopo reduzido pra entrega inicial |
```

Rules for the Inherited Deferred Capabilities block:

- **Source is each prior phase's `## Non-UI / Deferred Capabilities` table** — only rows where `Status: deferred` are copied; `non-ui` rows are skipped.
- **Add `Origin phase` column** — value is the prior phase's directory slug (e.g., `phase-03-my-videos`). The source section's own table does not have this column; this agent inserts it during extraction.
- **Order** — prior phases in ascending order of phase number; within each prior phase, preserve row order from the source table.
- **Empty case** — if no prior phase has deferred rows (or the section is absent across all prior phases, including legacy context.md pre-dating this feature), emit:
  ```
  ## Inherited Deferred Capabilities for Phase NN

  _No inherited deferred capabilities._
  ```
- **Task mode heading** — in task mode the heading is `## Inherited Deferred Capabilities for Task` (the Origin phase column still points to the single latest completed phase).

## Hard rules

- **No `## Filter Trace` block (intentional asymmetry with `decisions-reader` / `decisions-detail-reader`).** This agent's iteration domain is `docs/phases/` (not `docs/decisions/`), and its iteration logic is inherently complete: it processes every globbed `phase-MM-*` directory (or `phase-MM-*/progress.md` group). There is no "filename-slug match → early exit after one file" anti-pattern here. The silent-skip bug that motivated Filter Trace in the decisions readers does not have a structural analog in phases-reader, so Filter Trace would be cargo-cult.
- Never read the full phase doc. Every Read is bounded.
- Never produce output that mixes content from multiple phases into a single bullet. One phase per subsection.
- If a prior phase's final artifact does not exist (only context.md/validation.md present), check that phase's `context.md` for a `## Inherited Conventions` or `## Conventions to Match` section per step 4. If neither the phase doc nor the context.md has inheritable conventions, omit the phase from the output entirely (same rule as phases with no conventions). The caller (plan-context) detects phase-build gaps through other signals — this subagent stays silent on them.
- **Never extract `## Inherited Decisions Detail`** from a prior phase's context.md. The `^## Decisions Detail$` anchor in step 5 guarantees this. Rationale: a prior phase's `## Inherited Decisions Detail` contains TDs from even-earlier phases, which this loop will already pick up when it processes those earlier phases directly. Matching both sections would produce duplicate entries when Phase N inherits from Phase M which inherits from Phase L.
- **In task mode, return at most ONE NN's worth of inheritance** (the latest completed NN). The chosen NN may be sliced — in which case ALL its slices contribute (aggregated + deduped per phase-mode rules). Rationale: tasks consume convention-style guidance, not full phase lineage; loading all phases would inflate task context.md for marginal value.
- **In task mode, completion is gated by `progress.md` `Status: completed` across ALL slices of the NN.** A phase `NN` is completed iff every `phase-NN-*/progress.md` reports `Status: completed`. A sliced NN where any slice is `in_progress` / absent / not `completed` is NOT considered completed and is skipped. Monolithic NN (1 slice) reduces to the single-progress-file check. If none qualify, the empty placeholder is emitted.
- **Skip `non-ui` rows in Inherited Deferred Capabilities.** Only `Status: deferred` entries are inheritable — `non-ui` capabilities are closed (explicitly backend-only in the owning phase), not pending work for future phases.
- **Deferred is informational-only downstream.** The subagent emits the Inherited Deferred Capabilities section but does NOT assert that current phase must address entries. `plan-validate` never fires issues based on unaddressed inherited deferrals; user controls via `project-plan.md` edits.
- No prose preamble, no closing summary, no "Done.".
