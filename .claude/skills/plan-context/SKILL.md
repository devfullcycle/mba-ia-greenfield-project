---
name: plan-context
description: "Stage 1 of the plan pipeline (phase and task modes). Consolidates project-plan.md (phase mode), decisions docs (phase-scope + ad-hoc tied to the phase, or the task's own + correlated docs), prior phases (or latest completed phase) and testing guide into a lean context.md. Use when the user asks to start planning a phase or task, generate the context, or run the first stage of the planning pipeline. Triggers: 'plan-context NN', 'plan-context <slug>', 'plan-context \"prose\"', 'gera o contexto da fase NN', 'inicia planejamento da task <slug>'."
disable-model-invocation: true
---

# Plan Pipeline — Stage 1: Context

Consolidate the planning inputs into a lean, indexed `context.md`. This stage is a **pure consolidator** — it reads sources via subagents, produces a short structured artifact, and nothing else. It does not detect inconsistencies (that is `plan-validate`'s job), does not ask the user questions beyond slug confirmation and correlated-decisions confirmation, does not edit decisions docs.

Read `plan-pipeline/SKILL.md` for shared conventions (mode detection, slug discovery, `sources_mtime`, abort-with-command protocol, subagent dispatch, frontmatter format, read strategy rules). This file references those conventions by name without repeating them.

## Input handling

Detect mode from the argument format using the **unified slug lookup** defined in `plan-pipeline/SKILL.md` (Mode detection + Slug discovery). Slug is the pipeline's primary key (Decisão 2.3); integer `NN` remains a shortcut.

**Integer arg `NN`** → phase mode shortcut. Per `plan-pipeline/SKILL.md` → Slug discovery → Phase mode integer arg `NN`:

- Resolve via atomic Grep set-arithmetic (`S_phase ∩ S_NN`) — see `plan-pipeline/SKILL.md` for the canonical primitive and PCRE pattern. No per-file frontmatter iteration.
- Exactly 1 match → resolve to that slice's slug; target dir `docs/phases/phase-NN-{slug}/`.
- 0 matches → abort with canonical message: `"Run /research phase NN first"`.
- ≥2 matches → abort with canonical message: `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."`

**String arg `{slug}`** → unified slug lookup. Resolve via `docs/decisions/technical-decisions-{slug}.md`:

- Exists with `scope_type: phase` → **phase mode (slice)**. Extract `NN` from `related_phases[0]`; target dir `docs/phases/phase-NN-{slug}/`. The slice's `covers_capabilities` and `depends_on_slices` frontmatter (per `plan-pipeline/SKILL.md` → Phase slicing) drive downstream behavior (Step 0, Step 0.5, Step 1, Step 6).
- Exists with `scope_type: ad-hoc` → **task mode**. The companion `docs/tasks/task-{slug}/` directory may or may not exist yet; either way Step 1's directory bootstrap (`mkdir -p` per Phase mode item 2 / Task mode item 2 below) materializes it before any write. This explicitly covers the orphan ad-hoc case (`related_phases: []`): a decisions doc authored by `/research` with no companion task dir is accepted as a task-mode scope and the dir is auto-created, so the user can drive the doc through the pipeline (`/plan-context {slug} → /plan-validate {slug} → /plan-resolve {slug}`) without first hand-creating the task dir.
- Doc does not exist → **task mode bootstrap**: if arg matches `^[a-z0-9-]+$` treat as slug; otherwise treat as prose, auto-derive slug via kebab-case. Apply slug-collision disambiguation (Decisão #22) via `AskUserQuestion` before creating `docs/tasks/task-{slug}/`.

**Phase mode scope_prose source** (computed in Step 0):

- If the slice's decisions doc has `covers_capabilities` populated → join those bullets.
- Else (monolithic fallback) → capability bullets from `project-plan.md` for phase `NN`.

**Task mode scope_prose source:** inline prose from user (or `scope_description` from the task's decisions doc if slug match found). See Step 0 for the full source order (including partial-context.md recovery on rerun).

## Input (summary)

One argument: the target phase number `NN` (integer, phase mode) OR a task slug / prose (string, task mode).

## Preflight — abort-fast checks

Before any heavy work, in order:

### Phase mode

1. **Slug resolution** (per `plan-pipeline/SKILL.md` unified lookup):
   - **Integer arg `NN`:** resolve via atomic Grep set-arithmetic (`S_phase ∩ S_NN`) per `plan-pipeline/SKILL.md` → Slug discovery → Phase mode integer arg `NN`. No per-file frontmatter iteration. On 0 matches abort with `"Run /research phase NN first"`; on ≥2 matches abort with `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."`; on 1 match record its slug.
   - **Slug arg:** read `docs/decisions/technical-decisions-{slug}.md` frontmatter; require `scope_type: phase`; extract `NN` from `related_phases[0]`.
   - Record slug and target directory `docs/phases/phase-NN-{slug}/`.

2. **Directory bootstrap**: ensure `docs/phases/phase-NN-{slug}/` exists (create it with `mkdir -p` if missing). Do not touch its contents yet.

3. **Testing guide availability (optional)**: for each subproject likely in scope (detected heuristically — for each affected subproject directory `<subproject>/`, look for the `testing-guide-{subproject}` Skill by name match), note whether the guide is available. Missing is not an abort; downstream stages handle it.

### Task mode

1. **Slug resolution + confirmation** (per `plan-pipeline/SKILL.md` task-mode slug discovery). Resolve slug via existing-match → auto-derive → confirm. Handle collision via `AskUserQuestion` before proceeding.

2. **Directory bootstrap**: ensure `docs/tasks/task-{slug}/` exists (create it with `mkdir -p` if missing). Do not touch its contents yet.

3. **Testing guide availability (optional)**: same heuristic as phase mode — if the task's scope prose mentions subproject directory identifiers, note whether the corresponding `testing-guide-{subproject}` Skill is available. Missing is not an abort.

## Procedure

### Step 0 — Pre-step: compute `scope_prose` before the parallel dispatch

`decisions-correlator` needs `scope_prose` as one of its inputs, and it runs in parallel with the other subagents. Compute it first:

- **Phase mode:** Step 0 performs up to 2 bounded reads:
  1. **Frontmatter of the slice's phase-scope decisions doc** (`docs/decisions/technical-decisions-{slug}.md`): check for `covers_capabilities`. If present → `scope_prose` = join those bullets (verbatim) into a single paragraph (bullet markers replaced by "; ").
  2. **`project-plan.md` phase bullets** — always read (bounded to the `### Fase NN` section): used for neighbors / deliverables / out-of-scope extraction by `plan-reader`, AND as the **monolithic fallback** for `scope_prose` when `covers_capabilities` is omitted from the slice's frontmatter.
  Both reads are bounded; main-thread context impact is negligible. `plan-reader` still runs in parallel for the full phase scope block (its output is the `## Phase NN — {title}` block, later restructured into context.md's `## Scope` section by Step 7); consumed after the parallel dispatch.
- **Task mode:** `scope_prose` = the user's inline prose (from the original input) OR, if slug discovery found an existing `docs/decisions/technical-decisions-{slug}.md`, the value of that doc's `scope_description` frontmatter field.

`scope_prose` is small — it is passed via the subagent prompt, not written to disk at this point.

### Step 0.5 — UI scope detection and inventory handling

Before the parallel dispatch, determine:

1. **UI scope detected?** Signals by mode:
   - **Phase mode:** UI signal fires when ANY bullet in the slice's `covers_capabilities` (or, as monolithic fallback when `covers_capabilities` is omitted, ANY phase bullet from `project-plan.md`) matches UI phrasing — `Tela`, `Página`, `Área`, `Login`, `UI` (case-insensitive substring). Note: UI detection now reads the slice's declared capabilities, NOT the phase-level `Affected subprojects:` (which is a neighbor-of-phase concept and doesn't discriminate between slices).
   - **Task mode:** scope prose mentions `Tela`, `tela`, `page`, `screen`, `componente`, `UI`, a route path (`/signup`, `/upload`, ...); OR an existing decisions doc for the task has TDs with `Scope: Frontend | Cross-layer`.
2. **If UI scope detected, does the inventory file exist?** Glob the mode-specific path:
   - Phase mode: `docs/inventories/screen-inventory-phase-NN-{slug}.md` (slug-exact existence check — the slice slug already resolved at preflight; ≥2 matches is structurally impossible under slug-exact lookup).
   - Task mode: `docs/tasks/task-{slug}/inventory.md` (existence check).
3. **If UI signal present AND inventory absent** → dispatch `AskUserQuestion` with 4 options:
   - **(a) Run /screen-inventory {arg} first** — behavior splits by mode to avoid deadlock:
     - **Phase mode:** clean abort with `"UI scope detected for phase NN but no inventory file found. Run /screen-inventory NN first, then rerun /plan-context NN."`. **No files written.** screen-inventory in phase mode reads scope from `project-plan.md` directly — no prior context.md needed.
     - **Task mode — bootstrap parcial:** write `docs/tasks/task-{slug}/context.md` containing only:
       ```yaml
       ---
       kind: task
       name: task-{slug}
       state: partial-awaiting-inventory
       sources_mtime: {}
       ---

       # task-{slug} — Context

       ## Scope

       {scope_prose verbatim}
       ```
       Create `docs/tasks/task-{slug}/` via `mkdir -p` first. Then abort with: `"Partial context.md written for task scope (state: partial-awaiting-inventory). Run /screen-inventory {slug} to create inventory, then rerun /plan-context {slug} to complete context.md with UI digest and all subagent-populated sections."`.
     - **Rationale (mode asymmetry):** phase mode does not need partial write because `project-plan.md` serves as scope source for screen-inventory. Task mode needs it because scope prose only exists in memory at this point; without partial write, deadlock (plan-context needs inventory; screen-inventory needs context.md's `## Scope`).
   - **(b) Proceed without inventory (UI↔API sync deferred)** — set internal flag `ui_deferred: true`. Continue without dispatching `inventory-digest-reader`. In Step 7 assembly, emit `## UI Inventory` with the single-line placeholder `_No screen inventory — UI↔API sync deferred. Run /screen-inventory {NN | slug} and then rerun /plan-context <arg> to activate UI checks._`. Context.md is written full (no `state: partial-awaiting-inventory` marker — deferred is a valid complete state). **Mode-agnostic:** same behavior in phase and task modes.
   - **(b') Logic-only — frontend-runtime architectural changes only (no new UI surface)** — set internal flag `ui_logic_only: true`. Continue without dispatching `inventory-digest-reader`. In Step 7 assembly, emit `## UI Inventory` with the logic-only placeholder body:
     ```
     _Frontend-runtime only — no screen inventory needed for this phase.
     Run /screen-inventory <arg> if a UI surface is added in a future revision._
     ```
     Context.md is written full (no `state: partial-awaiting-inventory` marker — logic-only is a valid complete state, parallel to deferred). **Use this when:** the phase only introduces FE-runtime architectural-transversal TDs (TanStack Query global setup, React Compiler, Suspense pattern, global cache strategy) and does NOT introduce any new screen. **Mode-agnostic:** same behavior in phase and task modes. **Token-anchor `_Frontend-runtime only —`** is mutually exclusive with the deferred placeholder's `_No screen inventory —` token by construction — `plan-build` Gate 9 inference disambiguates with two independent pattern tests.
   - **(c) Cancel** → abort `plan-context` with `"Cancelled by user. No files written."`. Clean exit. **Mode-agnostic.**
4. **If signal present AND inventory present** → dispatch normally; `inventory-digest-reader` is part of the parallel batch.
5. **If no UI signal** → skip UI handling entirely; no `## UI Inventory` section emitted at all in Step 7.

**Rerun semantics after partial write (task mode only):** when user reruns `/plan-context {slug}` after screen-inventory produced `inventory.md`, this stage detects `state: partial-awaiting-inventory` in the existing context.md frontmatter, treats it as a regular fresh run (overwrite completo), dispatches all subagents including `inventory-digest-reader`, and writes context.md full **without** the state marker. Marker absence signals a complete context.md.

**Promotion path — logic-only → ui-active.** Logic-only is NOT a one-way state. If the user later adds a UI surface to a previously-logic-only phase, the promotion path is: (1) run `/screen-inventory NN` (or `/screen-inventory <slug>`) — creates the inventory file from scratch; (2) rerun `/plan-context NN` (or `<slug>`) — regenerates context.md from scratch per this skill's idempotency invariant (see Hard rules), overwriting the logic-only placeholder with the populated UI digest and flipping `ui_in_scope` from `logic-only` to `true` by Gate 9 inference in the next `/plan-build`. This flip happens **by construction** of the skill's idempotency — no new code paths needed; doc here is purely informational so the reader knows the migration is supported.

**inventory-digest-reader dispatch invariant.** The agent `inventory-digest-reader` is **never** dispatched when the user picked option (b') logic-only. Step 1 dispatch list (below) gates it on `Step 0.5 determined UI scope present AND inventory file exists`; logic-only means user opted out of inventory → file is absent → dispatch is suppressed. The logic-only placeholder is emitted **directly by Step 7** assembly from the in-memory `ui_logic_only` flag, with no intermediation from the agent. This avoids ambiguity about which placeholder the agent would otherwise emit (the agent's legacy fallback when called with no file emits the deferred placeholder, which is the wrong text for logic-only).

**scope_prose recovery on rerun from partial (task mode only).** The Step 0 rule (`scope_prose = user inline prose OR decisions doc scope_description`) is extended with a **third source** for the rerun-from-partial case:

**Task mode scope_prose source order (updated):**
1. User inline prose from the original invocation arg (if provided).
2. `scope_description` field from `docs/decisions/technical-decisions-{slug}.md` frontmatter (if decisions doc exists).
3. **`## Scope` section of an existing partial context.md** — recovered via bounded `Grep -n '^## Scope$' docs/tasks/task-{slug}/context.md` + bounded read to the next `^## ` header (or EOF). **Fires only when**: context.md frontmatter has `state: partial-awaiting-inventory` AND sources (1) and (2) are both absent.

Order is (1) → (2) → (3); first available wins. Rationale: partial context.md's `## Scope` was written verbatim from the first run's captured scope_prose → recovering it on rerun is idempotent (same prose → same outputs modulo the newly-present inventory digest).

### Step 1 — Dispatch subagents in parallel

Issue all applicable subagent calls in a **single assistant message** with concurrent `Agent` tool uses.

**Phase mode — dispatch 5–6 subagents in parallel:**

- `subagent_type: plan-reader` (input: `NN`) — extracts phase scope + neighbors from `project-plan.md`.
- `subagent_type: decisions-reader` (input: `mode=phase`, `identifier={slug}`) — builds the TD index. Pass the slice slug resolved at Preflight (not the raw `NN`); the agent derives `NN` internally from the slice's `related_phases[0]`. The keep filter returns the phase-scope doc matching the slug plus all ad-hoc docs with `NN ∈ related_phases`.
- `subagent_type: decisions-detail-reader` (input: `mode=phase`, `identifier={slug}`) — extracts `**Recommendation:**` prose + `**Libraries:**` per decided TD of the current slice. Pass the slice slug (not `NN`); same rationale as decisions-reader above.
- `subagent_type: decisions-correlator` (input: `mode=phase`, `identifier={slug}`, `scope_prose`) — returns ranked shortlist of ad-hoc `related_phases: []` docs semantically relevant to this slice. Pass the slice slug (agent derives `NN` via `related_phases[0]`).
- `subagent_type: phases-reader` (input: `mode=phase`, `NN`, `slug`, `depends_on_slices=[...]`) — extracts Conventions to Match AND Inherited TD Details AND Inherited Deferred Capabilities (from prior phases). When `depends_on_slices` is non-empty, phases-reader additionally resolves sibling slice `context.md` + `library-refs.md` as inheritance sources (tagged `_(from slice {sibling-slug})_`), applying the maturity gate from `plan-pipeline/SKILL.md` (sibling skipped if any of its TDs is `pending` AND its plan-build artifact is absent).
- `subagent_type: inventory-digest-reader` (input: `mode=phase`, `NN`, `slug`) — **dispatched only when Step 0.5 determined UI scope present AND inventory file exists**. The agent uses slug-exact lookup at `docs/inventories/screen-inventory-phase-NN-{slug}.md` (no wildcard), so the slice `slug` is required alongside `NN`. Emits `## UI Inventory for Phase NN`.

**Task mode — dispatch up to 5 subagents in parallel:**

- `subagent_type: decisions-reader` (input: `mode=task`, `{slug}`) — only if `docs/decisions/technical-decisions-{slug}.md` exists; otherwise skip (the placeholder output is synthesized locally as `_No TDs._` in `## Decisions Index`).
- `subagent_type: decisions-detail-reader` (input: `mode=task`, `{slug}`) — only if the task's decisions doc exists; otherwise skip.
- `subagent_type: decisions-correlator` (input: `mode=task`, `{slug}`, `scope_prose`) — returns ranked shortlist across all decisions docs except the task's own.
- `subagent_type: phases-reader` (input: `mode=task`) — returns inheritance from the latest completed phase (or placeholder if none).
- `subagent_type: inventory-digest-reader` (input: `mode=task`, `{slug}`) — **dispatched only when Step 0.5 determined UI scope present AND `docs/tasks/task-{slug}/inventory.md` exists**. Emits `## UI Inventory for Task {slug}`.

`plan-reader` is **not** dispatched in task mode — project-plan.md is phase-exclusive.

### Step 2 — Consume subagent returns

Each subagent returns a compact structured block per its output contract. The main thread does not read the raw source files directly.

**`decisions-reader` and `decisions-detail-reader` Filter Trace verification (REQUIRED in both phase and task mode whenever either subagent was dispatched and returned a non-error response):**

Both subagents emit a mandatory `## Filter Trace` block listing every globbed `docs/decisions/*.md` candidate with a kept/dropped decision and reason (per their Output contract). The main thread MUST cross-check the trace against an independent glob to detect under-iteration (silent skipping of ad-hoc docs):

1. Run `Glob 'docs/decisions/technical-decisions-*.md'` from the main thread (metadata-only — no file reads). Let `T_caller` = result count, `set_caller` = the set of basenames.
2. Parse each agent's `## Filter Trace` block independently — for each agent extract `T_agent` from the preamble line `Globbed T={T} candidates...` and `set_agent` from the table's `File` column.
3. **Per-agent count/set check.** Run the verification separately against each dispatched agent. Verify `T_caller == T_agent` AND `set_caller == set_agent`. On mismatch, abort with an agent-named message: `"{agent-name} Filter Trace incomplete: caller globbed {T_caller} files but agent traced {T_agent}. Missing from trace: [{set_caller \\ set_agent}]. The subagent silently skipped candidates — re-dispatch {agent-name} with explicit per-file enumeration."` where `{agent-name}` is literally `decisions-reader` or `decisions-detail-reader` (whichever produced the failing trace). Run both checks even if the first one fails so the user sees all failures at once.
4. **Cross-agent consistency check.** Build `set_kept_R` for decisions-reader by collecting the `File` column values of trace rows where `Decision == kept`; `set_dropped_R` is the complement within `set_agent` for that agent. Build `set_kept_D` and `set_dropped_D` identically for decisions-detail-reader. The two readers' kept sets must agree (they apply the same filter). On divergence, abort with: `"decisions-reader and decisions-detail-reader disagree on which docs were kept: only-in-reader=[set_kept_R \\ set_kept_D], only-in-detail-reader=[set_kept_D \\ set_kept_R]. One or both under-iterated; re-dispatch both."` (Same logic applies if only one of the two was dispatched — the cross-agent check is skipped, only the per-agent count/set check runs.)

5. **`decisions-detail-reader` TD count match (FUNCTIONAL hard gate, runs only when decisions-detail-reader was dispatched).** First, derive `kept_files` from the agent's `## Filter Trace` table: collect the `File` column values of every row whose `Decision == kept`, then prepend `docs/decisions/` to each basename to get the full file paths. Then compute ground truth: `expected = sum over kept_files of: grep -cE '^\*\*Decision:\*\* [A-Z]' <kept_file>` (counts decided TDs only — pending TDs start with `_[pending]_`, excluded by the `[A-Z]` anchor). Compute actual: `actual = grep -cE '^### [a-z0-9-]+/TD-[0-9]+' <agent_output>`. On `actual != expected`, abort: `"decisions-detail-reader TD count mismatch: expected={expected} decided TDs across kept files, agent emitted {actual}. Re-dispatch decisions-detail-reader."` Superseded TDs (`<!-- status: superseded-by: ... -->` marker) are not yet present in this project; when the first one appears, extend `expected` to also subtract superseded count.

6. **Cosmetic detection (SOFT — warn to terminal, never abort).** Run only when decisions-detail-reader was dispatched.
   a. **Preamble.** Count chars before the first `## Decisions Detail for` line in agent output (`awk '/^## Decisions Detail for/{exit} {len+=length($0)+1} END{print len}'`). If `> 0`, emit to terminal: `"WARN [cosmetic]: decisions-detail-reader emitted {N} chars of preamble before the '## Decisions Detail for' heading."`
   b. **Option-X prefix retention.** Count Recommendation lines that retain the option marker (bolded OR plain): `prefix_kept = grep -cE '^\*\*Recommendation:\*\* (\*\*)?Option [A-Z]' <agent_output>`. Total Recommendation lines: `prefix_total = grep -cE '^\*\*Recommendation:\*\*' <agent_output>`. If `prefix_kept > 0`, emit: `"WARN [cosmetic]: {prefix_kept} of {prefix_total} Recommendation lines retain 'Option X' prefix (bolded `**Option X (Name)** —` or plain `Option X — `)."`

**Quality bar (FUNCTIONAL hard / COSMETIC soft).** Gates 1–5 are FUNCTIONAL hard gates (mismatch → abort + re-dispatch). Gate 6 is COSMETIC soft (warns to terminal, never aborts). Cosmetic drift doesn't corrupt downstream artifacts — `context.md` Step 7 copies only `### {slug}/TD-XX` blocks (preamble dropped), and `plan-build` B4 reads `**Recommendation:**` prose verbatim without semantic parsing. Promote gate 6 to hard only with empirical evidence that the drift became functional.

This verification is the **secondary defense layer**. The agents' primary defense is now structural — their Step 3 uses **atomic Grep calls** to compute the keep set from `S_adhoc ∩ S_NN`, eliminating per-file iteration (and therefore silent-skip) by construction. The Filter Trace + caller cross-check is a backstop guarding against future refactors that might reintroduce iteration, and an audit trail showing which files were considered.

**Verification scope.** Filter Trace verification applies ONLY to `decisions-reader` and `decisions-detail-reader`. Other dispatched subagents do not emit `## Filter Trace` by design — see each agent's hard rules for the asymmetry rationale.

**Skip this verification only when:** (a) the agent (decisions-reader or decisions-detail-reader) returned an ERROR line; OR (b) the agent was not dispatched (e.g., task mode where the task's decisions doc does not exist, so decisions-reader / decisions-detail-reader were skipped per Step 1); OR (c) the agent returned the task-sem-research zero-match placeholder (`_No decisions doc for task {slug} (task-sem-research)._` from decisions-reader, or `_No decided TDs (task has no decisions doc yet)._` from decisions-detail-reader) — these short-circuit responses don't carry a trace by contract.

**`inventory-digest-reader` handling:**
- Subagent returns `## UI Inventory for Phase NN` / `## UI Inventory for Task {slug}` block with `### UI ↔ Capability Join`, `### Server-connected Components`, `### Open Questions from Inventory`, optionally `### Inherited UI Components` (task mode).
- If subagent returns an ERROR line (e.g., inventory `Status: Pending`, or ≥2 matches in phase mode), abort: `"{verbatim error}. Run /screen-inventory <arg> to validate before running /plan-context <arg>."` (or the canonical consolidate-duplicates message for the multi-match case).
- If subagent returns the single-line placeholder `_No screen inventory — UI↔API sync deferred._` (because a race condition deleted the file between Step 0.5 detection and dispatch), treat it as if Step 0.5 had determined `ui_deferred: true` — cache the placeholder for Step 7.
- On successful return, cache the block in memory for assembly in Step 7.

### Step 3 — Handle subagent errors (phase mode only)

**If a subagent returns an ERROR line**, abort this stage with the error's content verbatim, suffixed by the appropriate next-command. Examples:

- `decisions-reader` or `decisions-detail-reader` returns `"ERROR: no phase-scope decisions doc for phase NN"` → abort: `"No phase-scope decisions doc for phase NN. Run /research phase NN first."`
- `plan-reader` returns `"ERROR: phase NN not found in docs/project-plan.md"` → abort: `"Phase NN is not defined in docs/project-plan.md. Add its scope to the plan before running /plan-context NN."`

In task mode, `decisions-reader` / `decisions-detail-reader` returning their task-specific "no doc" placeholders is NOT an error — it is the expected "task-sem-research" signal.

**Note (slicing model):** the prior "Multiple phase-scope decisions docs for phase NN" abort that used to live here is gone. Multi-match on integer `NN` is now handled upstream during slug resolution (Preflight → Phase mode → step 1) with the canonical message `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."` — by the time Step 3 runs, the slice slug is already resolved, so subagents cannot see a multi-match condition.

### Step 4 — Confirm correlated decisions

After `decisions-correlator` returns the ranked shortlist:

**Short-circuit:** if the correlator returned its empty-pool placeholder (`_No candidates in pool._`), SKIP the `AskUserQuestion` entirely. The correlator contributes nothing to `## Inherited Decisions Detail` and nothing to `sources_mtime`. This is especially important in phase mode: when a project has no ad-hoc `related_phases: []` decisions docs, the phase flow proceeds exactly as before — no new user prompt is added.

Otherwise, present the shortlist via `AskUserQuestion` (multiSelect):

> Found N potentially correlated decisions docs. Select which ones should feed `## Inherited Decisions Detail`:
> - [x] base-setup — TypeORM setup decides DB connection model (high)
> - [ ] http-error-format — Error shape unrelated (low)
> - ...

**Default selection:** all entries ranked `high`. The user can uncheck highs or add mediums/lows.

The confirmed set drives:

- `## Inherited Decisions Detail` — the correlator reads the bodies of confirmed docs (actually: the caller bounded-reads each confirmed doc's `## Decisions Detail`-equivalent content — since decisions docs themselves lack that section, bounded-read the decided TDs and synthesize the **`Recommendation` + optional `Renders in` + `Libraries` + optional `Revisions`** block per TD, same shape as `decisions-detail-reader` would produce). The `**Renders in:**` line is omitted when absent in the source TD (no `—` placeholder), matching `decisions-detail-reader`'s output contract — downstream `plan-build` A2 filter resolves default-by-inference. Without this extraction, TDs surfaced via the correlator would lose the marker in `## Inherited Decisions Detail` and the receiving phase's A2 filter would mis-classify them into the wrong subsection.
- `sources_mtime` — add one entry per confirmed file.

### Step 5 — Gather Testing Requirements (when applicable)

For each subproject in scope where a `testing-guide-*` skill exists, use the `Skill` tool to load that skill and read its "Feature Implementation Checklist" or equivalent section. Extract the artifact-type → required-layers table. Keep the read bounded — this is the primary structured read done by the main thread in this stage. The only other main-thread reads are the three narrowly-scoped bounded reads already documented: (1) the capability bullets from `docs/project-plan.md` in Step 0 (phase mode, to compute `scope_prose`), (2) the per-TD `**Recommendation:** + **Libraries:**` fields of each correlator-confirmed doc in Step 4 (to feed `## Inherited Decisions Detail`), and (3) the `## Scope` section of an existing partial context.md (frontmatter `state: partial-awaiting-inventory`) as the 3rd-source fallback for `scope_prose` on rerun-from-partial (task mode only, per Step 0 source order — single bounded grep + slice). One additional metadata-only operation is permitted: (4) `Glob 'docs/decisions/technical-decisions-*.md'` in Step 2 to verify decisions-reader / decisions-detail-reader Filter Trace coverage (no file body read — listing only). No other direct reads or globs are allowed.

If no testing guide exists for a subproject in scope, note it in the context.md as `_No testing guide available — layer requirements deferred to implementation._`.

### Step 6 — Record `sources_mtime`

For every file contributing to context.md, run `stat -c '%y' <file>` (or equivalent) to capture ISO-8601 mtimes. Sources include:

**Phase mode:**
- `docs/project-plan.md`.
- The phase-scope decisions doc (from slug discovery — always present).
- Every ad-hoc decisions doc with `NN ∈ related_phases` (from `decisions-reader` output).
- Each decisions doc **confirmed by the user via `decisions-correlator`** in step 4 (origin 3 — ad-hoc with `related_phases: []`).
- Every prior phase's `context.md` referenced by `phases-reader`.
- Testing guide skill file(s) consumed in step 5 (the `SKILL.md` path).
- The screen inventory file `docs/inventories/screen-inventory-phase-NN-{slug}.md` (slug-exact path; slug resolved at Preflight) — **only if `inventory-digest-reader` was dispatched** (UI scope detected AND inventory file present).
- **Sibling slice `library-refs.md`** for every entry in this slice's `depends_on_slices` — one record per `docs/phases/phase-NN-{sibling-slug}/library-refs.md` that exists (skip silently when file absent — sibling may not have been built yet, though the maturity gate in phases-reader typically catches this case first).

**Task mode:**
- The task's own decisions doc (`docs/decisions/technical-decisions-{slug}.md`) — only if it exists.
- Each decisions doc **confirmed by the user via `decisions-correlator`** in step 4.
- The latest completed phase's `context.md` referenced by `phases-reader` — only if `phases-reader` returned non-empty.
- Testing guide skill file(s) consumed in step 5.
- The task inventory `docs/tasks/task-{slug}/inventory.md` — only if `inventory-digest-reader` was dispatched.
- The latest completed phase's inventory file — only if `inventory-digest-reader` returned an `### Inherited UI Components` block (meaning it read that file).

**Never record the full `docs/decisions/` directory.** Only the docs the caller actually consumed (own + correlator-confirmed + phase-owned in phase mode) belong in `sources_mtime`.

**Progress files (`*.progress.md`) never enter `sources_mtime`** — they are transient state owned by `screen-inventory` and `implement`.

### Step 7 — Assemble `context.md` from subagent outputs + testing guide extract

Use the template in "Output format" below. Each section is populated by one subagent's return (or the testing-guide extract). No reinterpretation, no re-reading source files. Write the file.

**Transformations applied during assembly:**

- **`phases-reader` (Conventions block) → `## Inherited Conventions`**: phases-reader's `## Prior Phases (for Phase NN inheritance)` (phase mode) or `## Prior Phases (for Task inheritance)` (task mode) block contains per-phase `Conventions to Match` bullets. Flatten all those bullets into a single list under `## Inherited Conventions`, suffixing each bullet with `_(from phase MM)_`. In task mode this list is at most one phase's bullets (the latest completed). Inherited-constraint consistency (whether a current-scope TD conflicts with an inherited convention) is checked downstream by `plan-validate`; this stage does not verify.

- **`decisions-reader` → `## Decisions Index`**: (a) rename the subagent's top heading (any `## Decisions Index for ...` form — phase mode emits `## Decisions Index for Phase NN / slice {slug}`, task mode emits `## Decisions Index for Task {slug}`) to `## Decisions Index` (no scope suffix — scope is carried in the frontmatter); (b) rename the subagent's `## Source Files` heading to the italicized `_Source files:_` subsection sitting beneath the Decisions Index table; (c) the table itself is copied verbatim; (d) **STRIP the `## Filter Trace` block entirely** — it is a caller-side verification artifact (consumed in Step 2), NOT a context.md section, and must never appear in the written file. **Task-sem-research:** if the subagent returned the "no decisions doc" placeholder, emit `## Decisions Index\n\n_No TDs._` with no table and no `_Source files:_` subsection.

- **`decisions-detail-reader` → `## Decisions Detail`**: rename the subagent's top heading (any `## Decisions Detail for ...` form — phase mode emits `## Decisions Detail for Phase NN / slice {slug}`, task mode emits `## Decisions Detail for Task {slug}`) to `## Decisions Detail` (no scope suffix). Copy the `### {slug}/TD-XX` blocks verbatim. This section contains **current-scope TDs only** (phase-scope + ad-hoc tied to NN in phase mode; the task's own decided TDs in task mode). **STRIP the `## Filter Trace` block entirely** — same rationale as the `decisions-reader` transformation above (caller-side verification artifact, not a context.md section). **Task-sem-research:** emit `## Decisions Detail\n\n_No current-scope TDs._`.

- **`phases-reader` (Inherited TD Details block) + correlator-confirmed docs → `## Inherited Decisions Detail`**: the inherited block combines two sources:

  1. Phases-reader's `## Inherited TD Details for Phase NN` (phase mode) or `## Inherited TD Details for Task` (task mode) block.
  2. Per-doc TD blocks synthesized from each correlator-confirmed decisions doc (Recommendation + Libraries per decided TD, same shape as `decisions-detail-reader` output).

  Rename the combined output's heading to `## Inherited Decisions Detail`. Before emitting, apply **dedupe**:
  1. Build set `current_refs` = the set of `### {ref}` entries present in `## Decisions Detail`.
  2. Drop any `### {ref}` entry from the inherited block whose ref ∈ `current_refs`. Rationale: a TD already present in current-scope is redundant in inherited.
  3. **Inter-source dedupe:** if a TD appears in both `phases-reader` output AND a correlator-confirmed doc, keep only the phases-reader entry (its Recommendation was vetted by the owning phase). Correlator in phase mode has a disjoint pool (only origin 3), so in practice this collision only happens in task mode when the latest completed phase was also correlated by the user.

  If after dedupe the inherited block is empty, emit:
  ```
  ## Inherited Decisions Detail

  _No inherited TD details._
  ```

- **`plan-reader` → `## Scope` (phase mode)**: restructure (not verbatim). Specifically: (a) drop the subagent's top heading `## Phase NN — {title}` and synthesize a `**Phase name:** {title}` field inside context.md's `## Scope` section; (b) keep `**Capabilities**`, `**Out of scope:**`, `**Deliverables:**`, `**Affected subprojects:**`, `**Deferred subprojects:**`, `**Sequencing notes:**` as-is (bold-labeled fields); (c) rename the subagent's `## Neighbors` H2 to the bold-labeled field `**Neighbors (for boundary detection only):**` with the same bullet list beneath.

- **Scope in task mode**: `## Scope` body is the `scope_prose` string, verbatim. No `**Phase name:**`, no `**Capabilities**` bullets, no neighbors — just the prose.

- **`inventory-digest-reader` → `## UI Inventory`**: rename heading `## UI Inventory for Phase NN` / `## UI Inventory for Task {slug}` → `## UI Inventory`. **Preserve the `**Source:** \`{path}\``, `**Screens in scope:** N` preamble lines verbatim immediately under the renamed heading** (load-bearing: `plan-build` Step 9 staleness check greps for `**Source:** ` in context.md). Then copy `### UI ↔ Capability Join`, `### Server-connected Components`, and `### Open Questions from Inventory` sub-blocks verbatim. If task mode returned `### Inherited UI Components`, copy it too (no dedupe with current — it is a separate block).

- **If `ui_deferred: true` (from Step 0.5 option (b) OR inventory-digest-reader placeholder)**: emit `## UI Inventory\n\n_No screen inventory — UI↔API sync deferred. Run /screen-inventory {NN | slug} and then rerun /plan-context <arg> to activate UI checks._` No sub-blocks.

- **If `ui_logic_only: true` (from Step 0.5 option (b'))**: emit `## UI Inventory` followed by the logic-only placeholder body verbatim:
  ```
  ## UI Inventory

  _Frontend-runtime only — no screen inventory needed for this phase.
  Run /screen-inventory <arg> if a UI surface is added in a future revision._
  ```
  No sub-blocks. **Token-anchor `_Frontend-runtime only —`** is mutually exclusive with the deferred placeholder text by construction; downstream `plan-build` Gate 9 + `plan-validate` body inference disambiguate logic-only vs. deferred via two independent pattern tests.

- **If no UI scope detected (Step 0.5 branch 5)**: omit `## UI Inventory` section entirely — not emitted as empty, not emitted as placeholder.

- **`phases-reader` (Inherited Deferred block) → `## Inherited Deferred Capabilities`**: rename subagent's `## Inherited Deferred Capabilities for Phase NN` / `... for Task` heading to `## Inherited Deferred Capabilities`. Copy rows verbatim. If no prior phase has deferred entries, emit `## Inherited Deferred Capabilities\n\n_No inherited deferred capabilities._`. This section is informational-only; `plan-validate` does NOT fire issues based on unaddressed entries here.

**Section ordering in context.md is mandatory — applies to final context.md only** (partial context.md per Decisão #28 has only frontmatter + `## Scope`):

1. `# {name} — Context` (where `{name}` is `phase-NN-{slug}` or `task-{slug}`)
2. `## Scope`
3. `## Decisions Index`
4. `## Capability Coverage` — **phase mode only; omit entirely in task mode** (not rendered, not placeholder)
5. `## Decisions Detail` ← current-scope TDs
6. `## Inherited Decisions Detail` ← inherited TDs (IMMEDIATELY after `## Decisions Detail`)
7. `## Inherited Conventions`
8. `## Inherited Deferred Capabilities` — always emitted in final context.md (phase mode when prior phases exist; task mode when latest completed phase has deferred entries). Placeholder `_No inherited deferred capabilities._` when empty.
9. `## UI Inventory` — only when UI scope detected (present or explicitly deferred)
10. `## Non-UI / Deferred Capabilities` — always emitted in final context.md (placeholder `_None._` when empty)
11. `## Testing Requirements`

**Partial context.md shape (per Decisão #28):** frontmatter with `state: partial-awaiting-inventory` + `# {name} — Context` + `## Scope`. No other sections. Downstream aborts via state marker detection before trying to consume missing sections.

## Output format

```markdown
---
kind: phase | task
name: phase-NN-{slug} | task-{slug}
sources_mtime:
  docs/project-plan.md: "ISO-8601-timestamp"                    # phase mode only
  docs/decisions/technical-decisions-{slug}.md: "ISO-8601-timestamp"   # if exists
  # one line per ad-hoc decisions doc contributing via related_phases (phase mode)
  # one line per correlator-confirmed decisions doc (both modes)
  # one line per prior-phase context.md read via phases-reader
  # one line per testing-guide skill file read
---

# {name} — Context

## Scope

**Phase mode** — verbatim from plan-reader output:

**Phase name:** ...
**Capabilities** (literal, `docs/project-plan.md`):

- ...

**Out of scope:** ...
**Deliverables:** ...
**Affected subprojects:** ...
**Deferred subprojects:** ...
**Sequencing notes:** ...

**Neighbors (for boundary detection only):**

- **Phase {NN-1}:** ...
- **Phase {NN+1}:** ...

**Task mode** — `scope_prose` verbatim (no sub-fields):

> {the prose from inline input or scope_description}

## Decisions Index

_(from decisions-reader — one row per TD across phase-scope + ad-hoc docs)_

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| {slug}/TD-01 | phase | Backend | ... | pending | — | — |
| ...

_Source files:_

- {slug} — `docs/decisions/technical-decisions-{slug}.md` (scope_type: phase)
- ... (ad-hoc files)

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| <capability bullet verbatim> | {slug}/TD-01, {slug}/TD-03 |
| <capability bullet verbatim> | — _(no TD yet — plan-validate will flag as MD)_ |

_Build this table by cross-referencing the `Capability:` field of each TD (available to decisions-reader via bounded grep) with the capabilities from plan-reader. If a TD's Capability is `Transversal — covers: ...`, list it under every covered capability. If a capability has no TD, leave "—"._

## Decisions Detail

_(current-phase TDs only — from decisions-detail-reader)_

### {slug}/TD-01

**Recommendation:** {prose stripped of "Option X — " prefix}
**Libraries:** lib-a, lib-b

### {slug}/TD-02

**Recommendation:** {prose}
**Libraries:** —

## Inherited Decisions Detail

_(inherited TDs from prior phases — from phases-reader, dedupe applied)_

### prior-slug/TD-01

**Recommendation:** {prose}
**Libraries:** —

### prior-slug/TD-05

**Recommendation:** {prose}
**Libraries:** typeorm, pg

## Inherited Conventions

_(from phases-reader — compact list; sourced from prior phases in phase mode, from the latest completed phase in task mode)_

- <convention bullet, ≤150 chars> _(from phase MM)_
- ...

## Inherited Deferred Capabilities

_(from phases-reader — informational-only; plan-validate does NOT fire issues based on unaddressed entries)_

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| "Tela de histórico" | deferred | phase-03-my-videos | Escopo reduzido pra entrega inicial |

_(or `_No inherited deferred capabilities._` when empty)_

## UI Inventory

_(from inventory-digest-reader — present only when UI scope detected)_

**Source:** `docs/inventories/screen-inventory-phase-NN-{slug}.md` _(or `docs/tasks/task-{slug}/inventory.md` in task mode)_
**Screens in scope:** N

### UI ↔ Capability Join

| Screen | Route | Verb | Capability | Covering Component |
|--------|-------|------|------------|-------------------|
| ... | ... | ... | ... | ... |

### Server-connected Components

- `{ComponentName}` ({Screen}) — `Reuse?: {path | new}` _(per `screen-inventory/SKILL.md` Output Contract item 4: existing path, OR bare literal `new` for pure-DOM. The third form `<path> (new)` is normalized to bare `new` by `inventory-digest-reader` for Server-connected emissions — see that agent's Procedure step 5.)_
- ...

### Open Questions from Inventory

_(verbatim bullets from the inventory's `## Open questions` section; ingested by plan-validate as OQ-N)_

- ...

### Inherited UI Components

_(task mode only; omitted when empty)_

- `{ComponentName}` — `Reuse?: {path}` (from phase-MM-{slug}) _(only already-implemented components: real paths with no `(new)` suffix — `inventory-digest-reader` excludes the planned `<path> (new)` form from inheritance per its Procedure step 7.4)_

## Non-UI / Deferred Capabilities

_(always emitted in final context.md; placeholder `_None._` when empty. Omitted in partial context.md per Decisão #28. Read by plan-context/plan-build; write-append by plan-resolve.)_

| Capability | Status | Rationale | TD refs |
|-----------|--------|-----------|---------|
| (empty on first assembly — plan-resolve appends rows as user marks capabilities) |

## Testing Requirements

_(from testing-guide skill(s) loaded in step 4)_

### {subproject}

| Artifact type | Required layers |
|---------------|-----------------|
| ... | ... |

_(repeat per subproject in scope)_

### {deferred subproject, if any}

_Deferred subproject — testing requirements will be defined when the testing-guide skill is created._
```

## Hard rules

- **Do not detect issues.** Missing decisions, ambiguous capabilities, inherited conflicts — all of these are `plan-validate`'s domain. Context only indexes what exists. Never emit an "Open Questions" section.
- **Do not copy full TD bodies.** Only `**Recommendation:**` prose + `**Libraries:**` fields — sourced from `decisions-detail-reader` / `phases-reader` inherited block / correlator-confirmed docs — belong in `## Decisions Detail` / `## Inherited Decisions Detail`. `**Context:**`, `**Options:**`, `### Option X:` blocks, Pros/Cons stay on disk in the decisions doc.
- **Do not read decisions docs or prior phase docs directly** beyond the bounded-read per correlator-confirmed doc (TD headers + bodies limited to Recommendation + Libraries). Subagents own the full indexing reads. The main thread only dispatches them and consumes their output.
- **Do not ask the user questions** beyond (a) slug confirmation (task mode only), (b) slug-collision disambiguation (task mode only, per Decisão #22), (c) correlated-decisions confirmation (both modes, per step 4), and (d) **inventory-handling confirmation (both modes, per Step 0.5 — dispatched only when UI scope signal is present AND inventory file is absent; offers 4 options: (a) run /screen-inventory first, (b) deferred, (b') logic-only, (c) cancel)**. If something is missing (no phase-scope doc, no phase definition in project-plan.md), abort with the canonical next-command.
- **In task mode, never invent capability bullets.** `## Scope` is the prose verbatim. There is no capability gate; `## Capability Coverage` is not emitted.
- **In task mode, `## Capability Coverage` is omitted entirely** — not emitted as empty, not emitted as placeholder.
- **`sources_mtime` records (Decisão #21):**
  - **Phase mode:** `docs/project-plan.md` + the phase's own decisions doc (via `decisions-reader`) + every ad-hoc doc with `NN ∈ related_phases` + correlator-confirmed origin-3 docs + prior-phase context.md files + testing-guide skill file(s).
  - **Task mode:** the task's own decisions doc (if it exists) + correlator-confirmed docs + the latest completed phase's context.md (if any) + testing-guide skill file(s).
  The full `docs/decisions/` directory listing is never recorded.
- **Aborts replace writes.** If the stage aborts at any point, `context.md` is not created or modified. The user fixes the cited problem and retries. **Exception (Decisão #28, task mode only):** the Step 0.5 partial-write path intentionally writes a minimal `state: partial-awaiting-inventory` context.md (frontmatter + `## Scope` only) **before** aborting — the only legitimate write-before-abort in this stage. Rationale: screen-inventory in task mode reads `## Scope` from context.md to extract capability mapping; without partial write there would be a deadlock (plan-context needs inventory; screen-inventory needs context.md). Downstream stages detect the `state: partial-awaiting-inventory` marker in preflight and abort with a dedicated message pointing at `/screen-inventory {slug}`.
- **UI scope signals (Decisão #2).** Detection is automatic from the slice's `covers_capabilities` bullets (or phase bullets as monolithic fallback when `covers_capabilities` is omitted) in phase mode, or scope prose in task mode — UI phrasing matches `Tela`, `Página`, `Área`, `Login`, `UI` (case-insensitive substring). Explicit user override happens only when inventory is absent despite signals (Step 0.5 AskUserQuestion). Never silently skip — always honor the detection.
- **Inventory file is read-only to this stage.** Never write or edit `docs/inventories/*.md` or `docs/tasks/task-{slug}/inventory.md`. If validation (via `Status: Pending`) detects a pending inventory, abort; never force-regenerate.
- **`## UI Inventory` section is present-only when applicable.** Four states: omitted (no UI scope), deferred (single-line placeholder), logic-only (multi-line placeholder with `_Frontend-runtime only —` token-anchor), populated (full digest). Deferred and logic-only placeholders are mutually exclusive by token-anchor construction; downstream `plan-build` Gate 9 + `plan-validate` body inference disambiguate them via two independent pattern tests.
- **`## Non-UI / Deferred Capabilities` is always emitted in context.md regenerated post-integration.** Placeholder `_None._` or single-row empty table when no entries — ensures `plan-resolve` can always locate the section for append. **Legacy context.md (pre-integration) may lack the section** — downstream stages (`plan-resolve` / `plan-build` / `phases-reader`) treat absent section as empty (`_None._` semantics). Partial context.md (Decisão #28, `state: partial-awaiting-inventory`) omits it by design; `plan-resolve` never runs on partial context.md because state marker detection in `plan-validate` preflight aborts before the `status: clean` gate.
- **Idempotent.** Rerunning `/plan-context <arg>` overwrites `context.md` from scratch (no history preserved here — this is the root artifact; everything else depends on a fresh context). In the rerun-from-partial (task mode) case, the overwrite removes `state: partial-awaiting-inventory` from the frontmatter — the marker is ephemeral.

## Rerun semantics

Rerunning this stage is the only way to **regenerate** `context.md` end-to-end. Downstream stages may patch specific fields inside the file (per `plan-pipeline/SKILL.md` — "Other stages may read or patch it, but never recreate it from scratch"): `plan-resolve` in particular patches the `## Decisions Index` rows when TDs flip to `decided`/`superseded`, and refreshes the matching `sources_mtime` entries to honor the upstream-fingerprint contract (see `plan-resolve/SKILL.md` → `sources_mtime` invariant). Full regeneration — re-reading sources, rebuilding Scope / Capability Coverage / Inherited Conventions / Testing Requirements — happens only via `/plan-context NN`.

If `sources_mtime` in an existing `context.md` is stale relative to a source resolve did NOT edit (e.g., the user manually touched `docs/project-plan.md`, or a new ad-hoc decisions doc was added via `/research`), downstream stages abort and tell the user to rerun this stage. When this stage runs again, it silently overwrites the prior `context.md`. `validation.md` from a previous run becomes stale (its own staleness-check detects this) and must also be regenerated by `/plan-validate`.
