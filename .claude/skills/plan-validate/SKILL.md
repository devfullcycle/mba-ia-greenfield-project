---
name: plan-validate
description: "Stage 2 of the plan pipeline (phase and task modes). Reads context.md (which embeds `## Decisions Detail` and `## Inherited Decisions Detail` with Recommendation + Libraries per TD), detects inconsistencies, ambiguities, missing decisions, dependency gaps (phase mode), and inherited-constraint conflicts. Produces or regenerates validation.md with a status: clean|dirty verdict. Use after /plan-context <arg> and after each /plan-resolve <arg> cycle. Triggers: 'plan-validate NN', 'plan-validate <slug>', 'valida a fase NN', 'run validation stage'."
disable-model-invocation: true
---

# Plan Pipeline — Stage 2: Validate

Inspect context.md for coherence issues. Emit a fresh `validation.md` with per-section issue IDs and a `status: clean|dirty` verdict. Preserve the history of resolved issues across reruns.

Read `plan-pipeline/SKILL.md` for shared conventions (mode detection, issue IDs, `sources_mtime`, staleness abort, frontmatter format, read strategy). This file references them without repeating.

## Input

One argument: the target phase number `NN` (integer, phase mode) OR a task slug `{slug}` (kebab-case string, task mode). Mode detection per `plan-pipeline/SKILL.md`.

## Preflight — abort-fast checks

1. **Mode detection + identifier resolution** per `plan-pipeline/SKILL.md`. Phase mode resolves `{slug}` via phase-scope decisions-doc slug discovery; task mode expects `docs/tasks/task-{slug}/` to already exist. If task mode is detected but the dir does not exist, abort: `"docs/tasks/task-{slug}/ not found. Run /plan-context {slug} first."`

2. **Slug discovery (phase mode only)**. Per `plan-pipeline/SKILL.md` canonical abort messages:
   - On 0 matches: `"Run /research phase NN first"`.
   - On ≥2 matches with integer arg: `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."`
   - Slug-primary: when a slice slug is passed directly, lookup resolves the single matching phase-scope doc; only 0-match aborts apply.

3. **context.md existence**. If `docs/{phases|tasks}/{dir}/context.md` does not exist, abort: `"context.md not found for {phase NN | task {slug}}. Run /plan-context <arg> first."`

4. **context.md frontmatter kind check**. Bounded-read the frontmatter. **Parse the full frontmatter into memory** — capture all standard fields (`kind`, `name`, `sources_mtime`) AND any transient-state markers (`state:` per `plan-pipeline/SKILL.md`'s Artifact frontmatter format). Infer `kind` per the rules in `plan-pipeline/SKILL.md` (rule 1 → `kind:`; rule 2 → `name:` prefix `task-`; rule 3/4 → `name:` prefix `phase-`). Must match the detected input mode. If mismatch, abort: `"context.md is a {inferred} artifact but you ran plan-validate in {detected} mode. Check the argument and retry."`. Keep the parsed frontmatter in memory — Step 4.5 and Step 5 reuse it without re-reading.

4.5. **Partial context.md detection (Decisão #28, task mode only).** From the frontmatter just read in step 4, if `state: partial-awaiting-inventory` is present, abort immediately: `"context.md for task {slug} is partial (state: partial-awaiting-inventory — plan-context wrote minimum scope-only context for screen-inventory to read). Run /screen-inventory {slug} to create inventory, then rerun /plan-context {slug} to complete context.md."` This check runs before any body read of context.md — do not try to validate a partial artifact.

5. **context.md staleness** (shared convention). For each key in context.md's `sources_mtime`, `stat` the source and compare. If any source is newer than recorded → abort: `"context.md is stale relative to {source}. Run /plan-context <arg> to regenerate, then retry /plan-validate <arg>."`

6. **Prior validation.md** (optional). If `validation.md` already exists, read its frontmatter to recover the `issues:` list. The markdown body will be fully regenerated; the frontmatter preserves the audit trail.

## Scope of reads

Per shared convention, this stage reads **only** `context.md`. It does not re-read project-plan.md, prior phase docs, decisions docs, or testing-guide skills — those were consolidated into context.md by stage 1.

> **Load-bearing invariant — DO NOT extend this stage to cover specs / SIs.** plan-validate has NO knowledge of `**Test Specs:**` fields, `test_specs_aware: true` frontmatter, `<subproject>/specs/*.plan.md` files, or any `/plan-test-specs` machinery. Spec-related gates live exclusively in `/plan-test-specs` (delta report — Stage 5) and `/implement` preflight (MISSING / STALE / PENDING TEST SPECS aborts). Extending plan-validate to cover specs would create asymmetric responsibility between Stage 2 (validate) and Stage 5 (specs) — plan-validate would have to read artefacts não-existentes na sua timeline (specs só existem após Stages 3-5 rodarem). This invariant is documented in `docs/plan-spec-driven-test-skill.md` § "NO CHANGE — `.claude/skills/plan-validate/SKILL.md`" and was a deliberate decision of the 2026-05-02 grill session (Q10).

- **context.md** — Read in full. Contains all TD information needed for the coherence checks: `## Decisions Index`, `## Decisions Detail` (current-scope TDs), `## Inherited Decisions Detail` (inherited TDs), `## Inherited Conventions`, `## Inherited Deferred Capabilities` (informational-only), `## Testing Requirements`, **plus `## Capability Coverage` in phase mode only** (omitted entirely in task mode), **plus `## UI Inventory` (present-only when UI scope detected)** and **`## Non-UI / Deferred Capabilities` (always emitted in context.md regenerated post-integration — empty or populated; omitted in partial context.md per Decisão #28, which aborts this stage anyway via preflight state marker detection). **Legacy context.md pre-integration may lack `## Non-UI / Deferred Capabilities`** — treated as empty by this stage; absence never fires a false issue.

## Procedure

1. **Read context.md.** You are about to regenerate validation.md — having context.md fully in memory is the budget for this stage.

2. **Run the coherence checks** (below) AND any custom validation rules in `docs/rules/plan-validate/` (see `## Custom validation rules` further down). Each check is a focused pass; all checks AND all rules run before emitting the artifact. Built-in check IDs (`IC-N`, `AMB-N`, `MD-N`, `DG-N`, `ICC-N`, `OQ-N`, `UIG-N`, `CC-N`, `MC-cross-N`) and custom rule IDs (prefix declared in each rule body, e.g., `CSF-N`, `CXE-N`, …) all accumulate into the same `issues:` / `advisories:` lists; Step 3 (Merge with prior issue state) processes them uniformly. Accumulate findings into the applicable categories for the current mode:

   **Phase mode checks (8 categories; Check 8 is cross-slice and runs only when ≥2 phase-scope docs exist for NN):**
   - **Inconsistencies (`IC-N`)** — contradictions between sources.
   - **Ambiguities (`AMB-N`)** — scope described too vaguely to decompose into SIs.
   - **Missing Decisions (`MD-N`)** — a capability needs a strategic choice but no TD exists (both sub-types: "uncovered bullet" and "decision without TD"; plus the shared-types contract sync sub-type per Decisão #29).
   - **Dependency Gaps (`DG-N`)** — the phase depends on something from a prior phase that was not planned or delivered.
   - **Inherited Constraint Conflicts (`ICC-N`)** — a current-phase decision conflicts with an inherited TD.
   - **Unresolved Open Questions (`OQ-N`)** — pending TDs and open questions carried forward; extended to ingest `### Open Questions from Inventory` verbatim when UI scope is present.
   - **UI Coverage Gaps (`UIG-N`)** — capability has TD coverage but no verb in the inventory covering it (fires only when `## UI Inventory` is populated).
   - **Cross-slice Coverage (`CC-N` hard-error + `MC-cross-N` advisory)** — slicing-only; fires only when `count(phase-scope docs for NN) ≥ 2`. See Check 8. CC-N flips `status` to `dirty`; MC-cross-N is advisory (tracked under `advisories:` and does NOT flip status).

   Additionally in phase mode: **Capability coverage gate** — every bullet in `## Capability Coverage` must map to ≥1 TD. Uncovered bullets emit as `MD-N`.

   **Task mode checks (6 categories):**
   - **Inconsistencies (`IC-N`)** — same semantics, applied to the prose `## Scope` and TDs in `## Decisions Index` / `## Decisions Detail`.
   - **Ambiguities (`AMB-N`)** — same semantics, applied to the prose `## Scope` instead of capability bullets.
   - **Missing Decisions (`MD-N`)** — only "decision required by scope that no TD resolves". The "uncovered bullet" sub-type does NOT apply (tasks have no capability bullets). The shared-types contract sync sub-type is **phase mode only** (Decisão #29 not fired in task mode).
   - **Inherited Constraint Conflicts (`ICC-N`)** — same semantics.
   - **Unresolved Open Questions (`OQ-N`)** — same semantics; extended to ingest inventory Open Questions.
   - **UI Coverage Gaps (`UIG-N`)** — same semantics as phase mode (tasks can also have UI scope).

   **DG-N is never emitted in task mode.** Tasks have no phase-dependency lineage.

   **Task-mode advisory (Decisão #12):** if `MD-N` count `≥ 2` at the end of the checks, emit at the top of validation.md's `## Findings` section:
   ```
   _Advisory: N missing decisions detected. Consider running `/research {slug}` to batch-decide these open choices._
   ```
   This advisory is informational — it does NOT affect `status: clean|dirty`.

3. **Merge with prior issue state.** For each issue currently being emitted:
   - If an issue with the same `(category, summary)` tuple already existed in the prior `issues:` frontmatter with `status: resolved`, drop it — it has been addressed already.
   - Otherwise, assign it a fresh ID within its category (lowest unused `N`).
   - Preserve the prior `issues:` entries with `status: resolved` in the new frontmatter, and render them under `## Resolved Issues` in the body.

4. **Compute verdict.**
   - `status: clean` iff every issue in the frontmatter `issues:` list has `status: resolved`. The advisory (task mode, `MD-N ≥ 2`) does NOT block `clean` — verdicted status follows the resolved-issue list only.
   - Otherwise `status: dirty`.

5. **Fast path (task mode only, Decisão #13).** On the FIRST validate run for a task slug — i.e., no prior `validation.md` exists — validate returns `status: clean` if ALL of the following hold:
   - No decisions doc exists for the task slug (`docs/decisions/technical-decisions-{slug}.md` is absent), AND
   - No `IC-N` raised, AND
   - No `AMB-N` raised (the prose `## Scope` was specific enough that Check 2 flagged nothing), AND
   - No `MD-N` raised (no decision required that lacks a covering TD), AND
   - No `ICC-N` raised from correlated inherited TDs, AND
   - No `OQ-N` raised, AND
   - No `UIG-N` raised.

   If any check raises an issue OR a decisions doc exists, fast path does not apply — normal verdict computation runs. Fast path only affects the verdict; it does not change how checks are executed.

6. **Write `validation.md`** using the template below. Record `sources_mtime` for `context.md` and every decisions doc listed in context.md's `_Source files:_` subsection (or empty in task-sem-research). **If Check 8 ran (phase mode, ≥2 slices)**, additionally record `docs/project-plan.md` and every **sibling** phase-scope decisions doc (the other slices of NN, excluding self — self is already recorded via the standard `_Source files:_` path above) whose `covers_capabilities` was read by 8.a/8.b. Check 8 reads those files directly, so their mtimes must be tracked to surface staleness on subsequent reruns. Only new-to-Step-6 files (project-plan.md + siblings) require explicit addition here.

## Coherence checks

### Check 1 — Inconsistencies (`IC-N`)

Compare the scope against the TDs listed in `## Decisions Index`:

> **Note (decisions history model):** an `IC-N` does NOT always require a Supersede or new TD. When the user resolves the issue in `/plan-resolve` and the chosen option matches the existing decided letter (parameter/prose drift only), the resolution is classified as **Append revision** and `/plan-resolve` appends a `**Revisions:**` block to the existing TD instead of flipping its `Decision:` field. See `plan-resolve/SKILL.md` § "Per-issue action classification" → "Append revision to TD-YY". `/decide` is the alternative front-door for the same primitive when the user starts from a free-text need rather than from a validation issue. Validate's job here is unchanged — emit the IC-N; resolve decides the primitive.


- **Phase mode:** compare each capability bullet from `## Scope` against decided TDs. (Legacy context.md may use `## Phase Scope` — accept either heading during transition; the canonical heading is `## Scope`.)
- **Task mode:** compare the prose `## Scope` paragraph against decided TDs semantically.

Flag:

- Scope requires behavior X while a decided TD says "no X" (e.g., scope "email confirmation" while TDs decided "no mail service").
- Two decided TDs whose choices imply mutually exclusive runtime behavior.
- **Phase mode only:** a current-phase TD whose `Capability:` field cites a bullet not present in `## Scope` capabilities.

**UI ↔ Scope inconsistency (when `## UI Inventory` is populated):**

- If a verb in `## UI Inventory → UI ↔ Capability Join` cites a capability that is NOT present in the current phase/task scope:
  - **Phase mode:** capability string doesn't match any bullet in `## Capability Coverage` (verbatim or as a `Transversal — covers:` entry).
  - **Task mode:** capability string doesn't match any substring derivable from `## Scope` prose.
  Emit IC-N. Message is slicing-aware in phase mode:
  - **Phase mode, slice has `covers_capabilities` populated (sliced phase)** — 3 choices: `"Verb '{verb}' in inventory cites capability '{cap}' not present in current phase scope. Explicit choice: (a) update inventory to remove stale verb via /screen-inventory extension run; (b) claim the capability in this slice's covers_capabilities frontmatter (if the bullet already exists in project-plan.md but another slice owns it — transfer ownership); (c) add new capability to project-plan.md + include in this slice's covers_capabilities."`
  - **Phase mode, monolithic (no `covers_capabilities`)** — 2 choices: `"Verb '{verb}' in inventory cites capability '{cap}' not present in current phase scope. Explicit choice: (a) update inventory to remove stale verb via /screen-inventory extension run; (b) add capability to current scope (edit project-plan.md, then rerun /plan-context)."`
  - **Task mode** — 2 choices: `"Verb '{verb}' in inventory cites capability '{cap}' not present in current task scope. Explicit choice: (a) update inventory to remove stale verb via /screen-inventory extension run; (b) add capability to current scope (edit task prose, then rerun /plan-context)."`
- Rationale: catches drift where inventory was built against a different phase's scope (e.g., inventory from phase 02 reused for phase 03 without updating capability references).

**Scope-Subsection orphan (prevents TD from being silently lost in final artifact):**

- If `## Decisions Index` has any TD with `Scope: Frontend` (not `Cross-layer`, not `Backend`, not `Repo-wide`) AND `## UI Inventory` is absent or has the **deferred placeholder** (`ui_in_scope: false` or `ui_in_scope: deferred`):
  - Emit IC-N: `"TD {slug}/TD-NN has Scope: Frontend but phase/task has no active UI scope (UI Inventory absent or deferred). The TD would be orphaned in the final artifact (filtered out of backend subsections per Decisão #17; UI Contracts subsection not emitted). Explicit choice: (a) change TD Scope to 'Cross-layer' if the decision informs backend contracts as well; (b) add active UI scope (ensure /screen-inventory runs and user doesn't pick 'defer' option); (c) remove the TD if it's out of scope for this phase/task; (d) mark TD as Renders in: frontend-runtime + flip UI Inventory to logic-only via /plan-resolve (use when the TD is FE-runtime architectural-transversal — TanStack Query global, React Compiler, Suspense pattern — and the phase has no UI surface)."`
- Rationale: without this check, Frontend TD in backend-only phase is filtered from Data Model/API Contracts (Scope mismatch) AND UI Contracts does not exist to render it → TD silently orphaned.
- **Does NOT fire for `Scope: Cross-layer`** — Cross-layer TDs legitimately appear in backend subsections even without UI, via API Contracts that may expose a contract prepared for future UI.
- **Does NOT fire when `ui_in_scope: logic-only` AND the TD's effective `Renders in:` resolves to `frontend-runtime`** — the logic-only placeholder (token-anchor `_Frontend-runtime only —`) is a valid UI-scope state that explicitly hosts FE-runtime architectural TDs in the dedicated `### Frontend Runtime` subsection. When the TD has `Renders in: frontend-runtime` (explicit) OR no marker (default-by-inference for `logic-only` resolves to `frontend-runtime`), it renders correctly — NOT orphaned. **However, the check DOES fire** when `ui_in_scope: logic-only` AND the TD has `Renders in: ui-contracts` (explicit) — the UI Contracts subsection is NOT emitted in logic-only, so the TD is orphaned. The IC-N choice (d) on the orphan-check then offers to flip the marker to `frontend-runtime` (which `/plan-resolve` M3 (d) executes).
- **Detection helper:** the orphan check's "absent or deferred" branch is identified by bounded grep against `## UI Inventory`'s body — if the body matches the `_Frontend-runtime only —` token-anchor, treat as logic-only; if body matches `_No screen inventory —` token-anchor, treat as deferred and fire; if section is absent entirely, treat as `ui_in_scope: false` and fire. The two token-anchors are mutually exclusive by construction (per `plan-context/SKILL.md` Step 0.5). For the logic-only case, the check additionally bounded-greps the TD's `**Renders in:**` field within its line range in the source decisions doc to determine whether the marker is `ui-contracts` (fire — orphaned), `frontend-runtime` (skip — renders in Frontend Runtime), or absent (skip — default-by-inference for logic-only resolves to frontend-runtime).

### Check 2 — Ambiguities (`AMB-N`)

- **Phase mode — for each capability bullet:** is the wording specific enough to decompose into concrete SIs? Vague scope phrases (`"handle X"`, `"manage Y"`) without listed flows/edges are ambiguities. Is there exactly one way the capability crosses the boundary between this phase and a neighbor, or could it plausibly fall on either side? Does the capability imply edge cases not addressed anywhere?

- **Task mode — applied to the prose `## Scope`:** is the prose specific enough that `/plan-build` can derive Step Implementations from it? A one-line prose like "add tests" is ambiguous; "add integration tests that run in parallel against an isolated Postgres per worker, covering the users module" is specific. The test: if a reasonable implementer would have to ask the user "which X?" to proceed, emit an `AMB-N`.

### Check 3 — Missing Decisions (`MD-N`)

**Phase mode — both sub-types apply:**

- **Uncovered bullet:** for each capability, is there ≥1 TD in `## Decisions Index` whose `Capability:` matches (either literally or as a `Transversal — covers:` entry)? If not, emit an `MD-N` citing the uncovered bullet.
- **Decision without TD:** if a capability genuinely requires a strategic choice (lib, strategy, storage, limit) and no TD exists — even when a bullet maps to some TD, a separate strategic choice may be undiscovered — emit an `MD-N`.
- Also flag: the phase exposes HTTP endpoints in a subproject but no prior or current TD defines the error response format for that subproject (the first phase with HTTP in a subproject must define it).

**Task mode — only "decision without TD":**

- If the prose `## Scope` implies a strategic choice (lib, strategy, storage, limit) that no current-scope TD resolves and no inherited TD covers, emit an `MD-N`.
- There is no "uncovered bullet" sub-type (no bullets to cover).

**Both modes:** distinguish "missing TD" from "TD pending decision" — a pending TD goes to `OQ-N`, not `MD-N`.

**UI evidence extension (when `## UI Inventory` is populated):**

- If a verb in `## UI Inventory → UI ↔ Capability Join` references a capability with no covering TD, emit `MD-N` normally but include in the summary: `"(UI-originated — verb '{verb}' in inventory requires this decision)"`. Same category, richer evidence.

**Shared-types contract sync strategy (phase mode only — Decisão #29):**

Fires when **all** of the following hold:

1. `ui_in_scope ∈ {true, logic-only}` (populated `## UI Inventory` OR logic-only placeholder; NOT deferred/absent). **Note: `ui_in_scope: logic-only` DOES fire #29** — logic-only means FE-runtime architectural TDs exist (e.g., TanStack Query setup) that may consume API contracts; contract-sync strategy is still load-bearing because without it FE consumes the wrong shape and runtime drift is inevitable.
2. Mode is **phase mode** (task mode skips this check — tasks assume contract strategy was decided in a prior phase).
3. No TD (current-scope OR inherited) with `Scope: Cross-layer | Repo-wide` covers contract-sync strategy.

**Keyword heuristic (tech-agnostic)** applied to TWO context.md sources per TD:
- (a) **Topic column** of `## Decisions Index` table (value derived from TD heading `## TD-NN: [Decision name]` by decisions-reader during plan-context assembly; there is NO `**Topic:**` literal field in the TD itself per `research/SKILL.md:230`).
- (b) **`**Recommendation:**` prose** of `## Decisions Detail` (current-scope) AND `## Inherited Decisions Detail` (inherited).

Keywords (case-insensitive): `contract | shape | schema | sync | shared types | codegen | type generation | DTO | OpenAPI | protobuf | swagger | grpc | interface-sharing`.

A TD matches the heuristic if any keyword appears in its Decisions Index Topic cell OR first 500 chars of its Recommendation prose. Count matches across both `## Decisions Detail` and `## Inherited Decisions Detail`. If zero matches AND Scope filter (Cross-layer / Repo-wide) confirms → fire `MD-N`:

`"MD-N — Phase NN has UI scope active but no TD decides FE↔BE contract-sync strategy (shared types / codegen / OpenAPI / or explicit manual). Without this decision, FE and BE independently transcribe shapes from API Contracts prose → runtime drift inevitable. Explicit choice: run /research {slug} to add a TD with Scope: Cross-layer or Repo-wide covering contract sync. Valid decisions include: (a) OpenAPI spec generated from backend + codegen consumer; (b) shared schema package (Zod/TypeBox/Pydantic/Kotlin data class/Go struct tags); (c) gRPC .proto with multi-lang codegen; (d) explicit 'manual transcription only — drift accepted as documented risk'. Pipeline does not prescribe which; only enforces the decision exists."`

Inherited TD suppression: if phase 01 (or any prior phase) already has a matching TD (via inherited block), current phase inherits and the check does NOT fire. One decision per project, not per phase.

**Never fires when:**
- Phase is UI-less or non-FE (`ui_in_scope: false`) — no FE exists to sync with.
- Phase inventory was deferred (`ui_in_scope: deferred`) — user opted out; contract strategy discussion moves to the phase that un-defers.
- Task mode — tasks inherit strategy from phase lineage; never raise new sync decisions.
- A matching TD exists in current OR inherited scope.

**Always fires (when conditions 2-3 hold) for:** `ui_in_scope: logic-only` — see condition 1 above. Logic-only is NOT in the never-fires list because FE-runtime architectural TDs (TanStack Query, React Compiler, etc.) consume API contracts even without a UI surface; sync is load-bearing in logic-only too. This is intentionally divergent from Check 7 UIG-N (which DOES skip logic-only because UI coverage is semantically impossible without verbs) — Decisão #29 is about API contract consumption, not UI coverage, and FE consumption happens in both `true` and `logic-only` states.

### Check 4 — Dependency Gaps (`DG-N`) — phase mode only

- Check `## Inherited Conventions` against the phase's capabilities. If a capability implies a prerequisite that would be delivered by a prior phase (e.g., "send email" requires a configured mailer module from a prior phase) but no prior-phase TD / deliverable covers it, flag.
- Check within-phase: if one capability depends on another but the ordering is not implied or documented, flag.

**DG-N is never emitted in task mode.**

### Check 5 — Inherited Constraint Conflicts (`ICC-N`)

- For every decided current-scope TD in `## Decisions Index` (phase mode: `Source: phase` or ad-hoc tied to NN; task mode: the task's own TDs from `## Decisions Detail`), check whether it contradicts any inherited convention in `## Inherited Conventions` or inherited TD in `## Inherited Decisions Detail`. Flag contradictions.

### Check 6 — Unresolved Open Questions (`OQ-N`)

- For each TD with `Status: pending` in `## Decisions Index`, emit an `OQ-N` referencing it: `"TD-XX pending — <topic>. Resolution: fill the **Decision:** field of TD-XX in <decisions doc>, then re-run /plan-validate <arg>."`
- Also emit `OQ-N` for any open questions the prior `validation.md` had that are not yet resolved (carry IDs forward).

**Inventory open questions (when `## UI Inventory` is populated):**

- Read `### Open Questions from Inventory` sub-block inside `## UI Inventory` (already in context.md via inventory-digest-reader). Each bullet becomes an OQ-N with summary verbatim and resolution hint: `"Resolution: resolve via /plan-resolve <arg>, which will present AskUserQuestion for this item."`. Distinct from OQ-N emitted from pending TDs.
- **Invariant preserved:** zero reads of the inventory file — `inventory-digest-reader` pre-processed the block into the digest in `context.md`.

### Check 7 — UI Coverage Gap (`UIG-N`)

**Fires only when `## UI Inventory` is present with populated digest** (not the deferred placeholder, not the logic-only placeholder, not absent). Skip entirely when UI is absent, deferred, **or logic-only** (UIG-N is semantically impossible in logic-only — there are no verbs to cover by construction).

For each capability in scope:

- **Phase mode**: walk `## Capability Coverage` (rows) and cross-check `## UI Inventory → UI ↔ Capability Join`.
- **Task mode**: walk capabilities implied by `## Scope` prose (using the same bijection logic as AMB-N) and cross-check against `## UI Inventory → UI ↔ Capability Join`.

**Emit `UIG-N` when ALL hold:**

1. Capability is covered by ≥1 decided TD in `## Decisions Index` AND
2. Capability has no matching verb in `## UI Inventory → UI ↔ Capability Join` AND
3. Capability is NOT already marked in `## Non-UI / Deferred Capabilities` (Status `non-ui` or `deferred`).

Resolution hint in the issue text:
`"UIG-N — Capability '{cap quote}' has TD coverage ({slug}/TD-XX) but no verb in the screen inventory. Explicit choice surfaced by /plan-resolve: (a) add verb via /screen-inventory extension run; (b) mark as Non-UI (backend-service / admin-only / other rationale variants in resolve); (c) defer UI to next phase."`

**Never fires when:**

- `## UI Inventory` is absent (no UI scope) → UIG-N is not a concept.
- `## UI Inventory` has deferred placeholder → user opted out explicitly.
- `## UI Inventory` has logic-only placeholder → user opted out explicitly (no UI surface in this phase; FE-runtime architectural changes only — `Renders in: frontend-runtime` TDs render in `### Frontend Runtime`, not per-screen). **Intentionally divergent from Decisão #29 (Check 3 shared-types contract sync), which DOES fire for `ui_in_scope: logic-only`.** The asymmetry is load-bearing: UIG-N is about UI verb coverage (semantically impossible without verbs by construction), while #29 is about API contract consumption (FE-runtime architectural TDs consume API shapes even without a UI surface, so contract sync is still required). Do NOT "fix" Check 7 to mirror #29 — the divergence is intentional. See Decisão #29 "Always fires" block above for the reciprocal cross-reference.
- Capability already in `## Non-UI / Deferred Capabilities` → already resolved in a prior resolve cycle.

### Check 8 — Cross-slice Coverage (`CC-N` hard-error + `MC-cross-N` advisory) — phase mode only

**Slicing-only check. Suppressed when the phase has exactly 1 slice.**

**Compute the slice set via atomic Grep set-arithmetic** (same primitive used by `decisions-reader` step 3 — no per-file iteration; tool semantics make iteration complete by construction):

1. `Grep -l '^scope_type: phase$' docs/decisions/technical-decisions-*.md` with `output_mode: files_with_matches` → set `S_phase` (every phase-scope decisions doc on disk).
2. `Grep -l '^related_phases:\s*\[(?:[^\]]*[,\s])?{NN}(?=[,\s\]])' docs/decisions/technical-decisions-*.md` with `output_mode: files_with_matches` (line-anchored ripgrep regex; **no `multiline` flag needed**; `{NN}` is the literal integer; trailing lookahead avoids consuming the closing `]`, correctly matching `[NN]` / `[..., NN]` / middle positions and rejecting `[12]` / `[21]` / `[]` for NN=2 — see `decisions-reader.md` test verification table). Result: set `S_NN`.
3. **Slice set = `S_phase ∩ S_NN`** (intersection: phase-scope docs whose `related_phases` contains NN). Let `count = |slice set|`.

For each slice in the slice set, derive its slug from the filename (`technical-decisions-{slug}.md`).

This avoids the silent-skip failure mode that affected the prior per-file iteration design — Grep cannot "skip" a file because it processes the entire input atomically. **Per-file Read in this step is allowed only AFTER the slice set is computed**, exclusively to read each kept slice's `covers_capabilities:` frontmatter (legitimate content read on a known-kept set, not a filter operation).

- **If `count == 1`** (monolithic phase, or first-slice bootstrap before siblings exist) → skip Check 8 entirely. No aggregation, no CC-N, no MC-cross-N. Cross-slice gap is not a meaningful concept by construction.
- **If `count ≥ 2`** → run the two sub-steps below.

**Step 8.a — CC-N pre-check (Capability Consistency, hard-error).**

For every slice doc in the slice set computed above (self + siblings — guaranteed complete by Grep set-arithmetic), read its `covers_capabilities:` frontmatter list. For each entry, verify it matches a bullet in `project-plan.md`'s phase-NN capabilities **verbatim (bullet text only, stripping the leading `- ` markdown list marker)**. Extract the phase's bullets via bounded grep against the actual heading format: `Grep -n '^### Fase {NN_zero_padded} — ' docs/project-plan.md` → start line S; `Grep -n '^### Fase \|^## ' docs/project-plan.md` → next H2/H3 after S → end line E-1; bounded-Read S..E-1 and collect lines matching `^- ` (drop the `- ` prefix to get the bare bullet text for comparison). **`{NN_zero_padded}` is NN formatted as a 2-digit zero-padded string** (e.g., phase 2 → `02`, phase 10 → `10`). Single-digit NN MUST be padded; otherwise the grep silently matches nothing, CC-N falsely reports every entry as missing, and MC-cross-N extraction silently produces an empty `expected` set (all capabilities incorrectly "uncovered" OR all checks trivially pass depending on downstream logic).

For each mismatch, fire `CC-N`:

`"Slice {slug} declares covers_capabilities entry '{entry}' that does not match any bullet in project-plan.md's phase-NN capabilities. Explicit choice: (a) fix the typo / update the entry to match; (b) add the capability to project-plan.md if genuinely missing."`

CC-N is a **hard-error** — it flips `status` to `dirty` and is tracked under `issues:` (not `advisories:`). If any CC-N fires, **Step 8.b does not run** in this invocation — typos must be fixed first so aggregation operates on trustworthy entries. Step 8.b runs on the next `/plan-validate` invocation after CC-N is resolved.

**Step 8.b — MC-cross-N advisory (aggregated cross-slice coverage).**

Runs only when Step 8.a produced zero CC-N findings.

- Aggregate `covers_capabilities` across self + all sibling slices into a single set `covered`.
- Read phase-NN capability bullets from `project-plan.md` using the same bounded-grep extraction documented in 8.a (match `^### Fase {NN_zero_padded} — ` as start anchor; collect `^- ` lines from the section, stripping the `- ` prefix); let `expected` = that set.
- For each bullet in `expected \ covered`, emit `MC-cross-N`:

`"MC-cross-N — Phase NN capability '{bullet}' is not claimed by any slice's covers_capabilities. Explicit choice: (a) add the bullet to one existing slice's covers_capabilities; (b) create a new slice via /research for the uncovered bullet; (c) remove the bullet from project-plan.md if genuinely obsolete."`

MC-cross-N is **advisory** — it is tracked under the `advisories:` frontmatter array (NOT `issues:`) and does **NOT** flip `status` from `clean` to `dirty`. Advisories also do NOT block `/plan-build`; only hard-error issues do. The hard-gate equivalent runs in `/plan-build` on the last slice (see `plan-build/SKILL.md`).

**Rationale for the split:** CC-N catches typos and stale bullets early, before the advisory aggregation can produce misleading "uncovered" output derived from mistyped entries. MC-cross-N is advisory in validate because partial coverage is a legitimate intermediate state while slices are being authored; the final coverage gate is enforced as a hard error only when the last slice attempts to build.

## Custom validation rules

After Checks 1-8 finish accumulating built-in findings, dispatch any custom rules in `docs/rules/plan-validate/`:

1. `Glob docs/rules/plan-validate/*.md`. If empty → skip this section; proceed to Procedure step 3.
2. For each file in alphabetic order:
   a. Bounded-read frontmatter (the top YAML block). If `status: disabled`, skip silently.
   b. Full Read + follow body. The body declares its own IC prefix, severity, output destination, and reads `{target_dir}/suppressions.md` itself.
   c. Issue IDs use the prefix declared in the body (e.g., `CSF-N`, `CXE-N`); numbering follows `lowest-unused-N` per prefix, merged with built-in IDs by Procedure step 3.

After all rule files processed, accumulation is complete. Built-in and rule-emitted IDs are processed uniformly by Procedure step 3.

**Active Suppressions section** — when ≥1 rule honored a suppression entry from `{target_dir}/suppressions.md`, render those IDs in `## Active Suppressions` of `validation.md` (one bullet each: `**{ID}** — suppressed. Reason: "{first 80 chars}…"`). Render `_None._` when no suppressions active. Omit the section entirely when no rule ran (empty `docs/rules/plan-validate/` directory).

**Output format extension.** The `## Output format` block below shows `issues:` and `advisories:` arrays — those arrays now also hold rule-emitted IDs (with their own prefixes). No frontmatter shape change is needed; the prefix space is shared.

## Output format

```markdown
---
kind: phase | task
name: phase-NN-{slug} | task-{slug}
status: clean | dirty
issue_count: {number of open issues in this revision}
sources_mtime:
  docs/{phases|tasks}/{dir}/context.md: "ISO-8601-timestamp"
  docs/decisions/technical-decisions-{slug}.md: "ISO-8601-timestamp"   # if exists
  # one per decisions doc listed in context.md's _Source files:_ subsection
issues:
  - id: AMB-1
    status: open
    summary: "<≤80-char headline>"
  - id: MD-1
    status: resolved
    summary: "<≤80-char headline>"
    resolved_by: {slug}/TD-11
  # ...
advisories:              # phase mode only, slicing only; omit or [] when not applicable
  - id: MC-cross-1
    status: open
    summary: "<≤80-char headline>"
  # advisories do NOT flip status to dirty; they are informational cross-slice signals
---

# {name} — Validation

## Findings

### Inconsistencies

_(one bullet per open IC-N issue; include the issue ID at the start of each bullet; or "_None._" if the section is empty)_

- **IC-1** — <what the inconsistency is, quoting the two conflicting statements>. Explicit choice: <what must be decided / edited / where>.

### Ambiguities

- **AMB-1** — <what is ambiguous>. Explicit choice: <what must be clarified / where>.

### Missing Decisions

- **MD-1** — <which capability requires the decision>. Explicit choice: <run /research to add a TD covering X>.

### Dependency Gaps

- **DG-1** — <what prerequisite is missing>. Explicit choice: <what must be added to which prior phase or current-phase TD>.

### Inherited Constraint Conflicts

- **ICC-1** — <which current-phase TD conflicts with which inherited TD>. Explicit choice: <revise which TD / surface for user>.

### Unresolved Open Questions

- **OQ-1** — <TD-XX pending / user-surfaced question>. Resolution: <canonical next-command>.

### UI Coverage Gaps

_(one bullet per open UIG-N issue; `_None._` if empty or UI not in scope)_

- **UIG-1** — <capability quote and inventory coverage gap>. Explicit choice surfaced by /plan-resolve: (a) extension run, (b) mark as Non-UI (sub-rationales in resolve), (c) defer.

### Custom rule findings

_(one bullet per open IC emitted by a rule in `docs/rules/plan-validate/` — IDs prefixed per the rule body's emission contract, e.g., `CSF-N`, `CXE-N`, `CFD-N`, `CBC-N`, or any future plugin's prefix; rendered only when ≥1 such rule emitted findings; render `_None._` when rules ran but emitted nothing; omit the section entirely when no rule was loaded)_

- **CSF-1** — <one-line summary from the rule body>. <Resolution hint from the rule body>.
- **CXE-1** — ...

### Capability Consistency (slicing, phase mode only)

_(one bullet per open `CC-N`; hard-error — flips status to dirty. Omit this section entirely when the phase has a single slice or when `count(phase-scope docs for NN) == 1`. Render `_None._` if the section applies but no CC-N was emitted.)_

- **CC-1** — <slice slug + offending `covers_capabilities` entry>. Explicit choice: (a) fix typo to match project-plan.md verbatim; (b) add bullet to project-plan.md if genuinely missing.

## Cross-slice Advisories

_(phase mode, slicing only — emitted only when `count(phase-scope docs for NN) ≥ 2`. One bullet per open `MC-cross-N`. Advisories do NOT flip status; `_None._` is legitimate output when all capabilities are covered across siblings. Omit this section entirely in task mode or when the phase has a single slice.)_

- **MC-cross-1** — <phase NN capability bullet uncovered by any slice>. Explicit choice: (a) claim in an existing slice's covers_capabilities; (b) create a new slice via /research; (c) remove from project-plan.md if obsolete.

## Active Suppressions

_(rendered only when ≥1 rule in `docs/rules/plan-validate/` honored a suppression entry from `{target_dir}/suppressions.md`. Each bullet documents one honored suppression. Render `_None._` when rules ran but no markers were active. Omit the section entirely when no rule was loaded.)_

- **{issue_class}-N** — suppressed. Reason: "{first 80 chars}…"

## Resolved Issues

_(preserved from prior revisions — do not remove entries from this section once written; they are audit trail)_

- **MD-1** _(resolved_by {slug}/TD-11)_ — <summary>.
- ...
```

If any category has no open issues, still include the heading and render `_None._` beneath. If `## Resolved Issues` is empty (first run), render `_No issues resolved yet._`.

## Hard rules

- **Do not edit decisions docs or context.md.** This stage is read-only on upstream artifacts. Writes go only to `validation.md`.
- **Do not ask the user questions.** If information is needed to classify an issue, phrase the issue as a question under the appropriate category — `plan-resolve` will surface it to the user.
- **Do not invent issues** to fill categories. Empty categories are normal and healthy.
- **Always preserve resolved issues** in the frontmatter and the `## Resolved Issues` section — never re-number, never drop. Audit trail is load-bearing.
- **No decisions-doc reads.** This stage reads only context.md. The preflight staleness check ensures context.md reflects the current state of all source docs.
- **No staleness auto-regeneration.** If context.md is stale, abort — do not dispatch subagents.
- **Task mode — `MD-N` narrowed.** Only "decision required by scope that no TD resolves" fires. No "uncovered bullet" sub-type applies (there are no capability bullets in task-mode scope).
- **Task mode — `DG-N` never fires.** The dependency-gap concept belongs to phase lineage, which does not apply to tasks.
- **Task mode — the `MD-N ≥ 2` advisory is informational only.** It does NOT block `status: clean` when all other checks pass. Fast path + advisory are independent: fast path triggers only when `MD-N` is zero; advisory triggers when `MD-N ≥ 2`.
- **UIG-N fires only when `## UI Inventory` is populated.** Skip entirely when inventory absent or deferred. Never fabricate UIG-N for phases without UI scope.
- **Zero inventory-file reads.** All UI information needed for validate (join table, server-connected components, open questions) is pre-processed into `## UI Inventory` by `inventory-digest-reader`. Invariant "validate reads only context.md" preserved.
- **Do not classify UIG-N as a subcategory of MD-N or DG-N.** Distinct category with distinct resolution paths (per the principle that each category maps to distinct resolution semantics).
- **Advisories never flip `status`.** `MC-cross-N` is tracked under the `advisories:` frontmatter array and rendered under `## Cross-slice Advisories`; it is informational and does NOT block `plan-build`. Only hard-error issues (including `CC-N`) flip `status` to `dirty`.
- **Check 8 is suppressed for monolithic phases.** When `count(phase-scope docs for NN) == 1` — the common case for today's pipeline — skip Check 8 entirely. No `CC-N` and no `MC-cross-N` are emitted, and the `## Cross-slice Advisories` / `## Capability Consistency` sections are omitted from the body. Prevents advisory spam during first-slice bootstrap.
- **`## Inherited Deferred Capabilities` does NOT fire issues.** Validate reads the section for context (it may influence how capabilities are interpreted in the current phase) but never emits issues when entries are not addressed — user is explicit owner of cross-phase UI flow via `project-plan.md` edits.

## Rerun semantics

Rerunning after `plan-resolve` is the canonical flow. The new run:

- Drops open issues that the prior `issues:` frontmatter marked `resolved` via `resolve`.
- Re-runs all 7 checks (phase mode) / 6 checks (task mode) against the now-updated context.md.
- May find new issues introduced by the resolution (e.g., a newly decided TD conflicts with an inherited constraint).
- Updates `status` accordingly — only reaches `clean` when every check is empty.
