---
name: plan-resolve
description: "Stage 3 of the plan pipeline (phase and task modes). Reads validation.md, asks the user via AskUserQuestion, and applies the answers to the decisions doc (filling **Decision:** fields, injecting superseded markers, or creating the decisions doc on-the-fly in task-sem-research), context.md (patching the Decisions Index), and validation.md (marking issues resolved). Dispatches Context7 for newly decided libraries and writes library-refs.md. In phase mode, aborts on MD-N with a /research instruction. In task mode, MD-N may be resolved inline by creating the decisions doc. Use after /plan-validate <arg> reports status: dirty. Triggers: 'plan-resolve NN', 'plan-resolve <slug>', 'resolve issues da fase NN', 'apply decisions to task <slug>'."
disable-model-invocation: true
---

# Plan Pipeline — Stage 3: Resolve

Close the open issues in `validation.md` by asking the user and materializing answers into the decisions doc + context.md + validation.md. Fetches fresh docs via Context7 for any library that was newly decided in this cycle and caches them in `library-refs.md`.

Read `plan-pipeline/SKILL.md` for shared conventions (mode detection, issue IDs, abort-with-command protocol, read strategy). This file references them without repeating.

## Input

One argument: **slice slug** `{slug}` (primary) OR phase number `NN` (integer shortcut) OR task slug `{slug}` (string, task mode). Mode detection per the unified slug lookup in `plan-pipeline/SKILL.md`:

- **Integer `NN`** → phase mode shortcut. Resolves to the single phase-scope decisions doc for `NN` if exactly one exists; aborts with the canonical messages when 0 or ≥2 exist (see plan-pipeline/SKILL.md's canonical abort messages — `"Run /research phase NN first"` for 0, `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."` for ≥2).
- **String `{slug}`** → unified slug lookup against `docs/decisions/technical-decisions-{slug}.md`. Phase-scope match → phase mode (slice); ad-hoc match with `docs/tasks/task-{slug}/` present → task mode.

## Preflight — abort-fast checks

1. **Mode detection + target-dir resolution.** Phase mode resolves `{slug}` via phase-scope decisions-doc discovery; task mode reads `docs/tasks/task-{slug}/`. If the expected dir does not exist, abort with the standard "run /plan-context first" message.

2. **validation.md existence**. If absent, abort: `"validation.md not found for {phase NN | task {slug}}. Run /plan-validate <arg> first."`

3. **validation.md status gate** — bounded Read of the frontmatter only:
   - `status: clean` → check the **library-cache carve-out** before aborting:
     - If `docs/phases/phase-NN-{slug}/library-refs.md` (or `docs/tasks/task-{slug}/library-refs.md`) is **absent** AND the scope's decisions doc has at least one **decided** TD with a non-empty `**Libraries:**` entry (bounded grep `^\*\*Libraries:\*\* ` on the decisions doc, filtering out values that match `^\*\*Libraries:\*\* [—\-]?\s*$`) → proceed in **library-cache-only mode**: skip Step 1–4 (no open issues to resolve, no frontmatter flips, no context.md rewrites) AND execute only Step 5's library cache materialization (WebFetch + write `library-refs.md` + cross-scope byte-copy for ad-hoc libs). Write-back: (a) `validation.md` — `status` unchanged (remains `clean`); only the `sources_mtime` frontmatter is refreshed to add the new `library-refs.md` entry. (b) `context.md` — also add/refresh the `library-refs.md` entry in its `sources_mtime` frontmatter (`stat -c '%y'` the new file and write the ISO-8601 timestamp). Both refreshes are mandatory; skipping context.md's refresh leaves the next `/plan-build` or `/plan-validate` run seeing `library-refs.md` as newer than context.md's recorded mtime and aborting with a spurious staleness error. Rationale: enables first-time cache materialization for a slice that was validated clean before any resolve run, and especially for slices whose siblings need the cache (see `plan-build/SKILL.md` Gate 7 sibling check).
     - Otherwise → abort: `"validation.md is already clean — nothing to resolve. Run /plan-build <arg> to generate the plan."`
   - `status: dirty` → proceed (full resolve path).

4. **validation.md staleness check** — (reuse the frontmatter from step 3). For every key in `sources_mtime`, `stat` the source and compare. If any source has drifted newer → abort: `"validation.md is stale relative to {source}. Run /plan-validate <arg> to reconfirm status before resolving."`

## Scope of writes

This stage is the **only** writer of:

- **`docs/decisions/technical-decisions-{slug}.md`** — fills `**Decision:**` fields; injects `<!-- status: superseded-by: {slug}/TD-NN -->` markers. **Task mode only:** may also *create* this file on-the-fly when the task-sem-research case surfaces `MD-N` issues (see Input handling → "task-sem-research inline create" below).
- **`docs/{phases|tasks}/{dir}/context.md`** — patches the `Decisions Index` row for each newly decided or superseded TD AND refreshes the matching `sources_mtime` frontmatter entries for every decisions doc edited in this run.
- **`docs/{phases|tasks}/{dir}/validation.md`** — moves issues from open to resolved (frontmatter `status`, body section).
- **`docs/{phases|tasks}/{dir}/library-refs.md`** — creates or updates when a new library is decided; its `sources_mtime` entries must be fresh from `stat`, not guessed.

It **never** touches project-plan.md or prior phase artifacts. Supersede markers (`<!-- status: superseded-by: {slug}/TD-NN -->`) and `**Revisions:**` blocks may be injected into **any** decisions doc (phase-scope or ad-hoc) when the inferred action requires it — see "Per-issue action classification" below. The marker syntax and position (immediately after the TD heading) are identical in both doc types; the `**Revisions:**` block syntax and position (after `**Libraries:**`, before `---`) follow `research/SKILL.md` § "Revisions block".

## Input handling — task-sem-research inline create (task mode)

In task mode, the decisions doc may not exist yet (task created without `/research`). When `plan-validate` emitted `MD-N` issues requiring a decision, resolve can create the decisions doc on-the-fly:

1. On the **first `MD-N` resolved**, check whether `docs/decisions/technical-decisions-{slug}.md` exists.
2. If it does NOT exist:
   2a. Dispatch `AskUserQuestion` to determine `related_phases`:
       > Is this task related to a specific phase?
       > - No, standalone task (default → `related_phases: []`)
       > - Yes, phase NN (if yes, a follow-up question asks for NN → `related_phases: [NN]`)
   2b. Create the decisions doc with frontmatter:
       ```yaml
       ---
       scope_type: ad-hoc
       related_phases: []          # or [NN] from 2a
       status: decided              # TDs born here are already decided
       date: <today ISO>
       scope_description: "{task ## Scope prose}"
       ---
       ```
3. Append the TD to the body in the same format `research/SKILL.md` uses (`## TD-N: <name>`, `**Scope:**`, `**Trigger:**` when `related_phases: []` OR `**Capability:**` when `related_phases: [NN]`, `**Context:**`, `**Options:**`, `**Recommendation:**`), with **`**Decision:**` already filled** (the user's answer from `AskUserQuestion`). **Never write `_[pending]_`** in a TD born here — the decision is made at creation time.
4. Update `sources_mtime` in context.md / validation.md to include the newly-created decisions doc (per `stat`).
5. Subsequent `MD-N` resolutions in the same run append to the same file. `related_phases` stays unchanged — step 2a's `AskUserQuestion` only runs once, on first creation.

If the user chooses to abort rather than resolve inline (e.g., to run `/research` first), no file is created; validation.md stays dirty and the stage emits:
`"Aborted MD-N resolution on request. Run /research {slug}, then /plan-context {slug}, then /plan-validate {slug}, then /plan-resolve {slug} to continue."`

## Procedure

### Step 1 — Inventory open issues

Read `validation.md` in full (it is bounded by design). Collect every issue with `status: open`, grouped by category. Record each issue's ID, summary, and the `Explicit choice:` clause (which is the action a resolution must take).

### Step 2 — Handle `MD-N` issues (mode-dependent)

**Phase mode — abort-fast.** Missing Decisions cannot be resolved by this stage in phase mode — they require research (options, pros/cons, recommendations). For every `MD-N` in the open set:

- Emit: `"Issue MD-N requires a new technical decision (<topic>). Run /research <topic> with related_phases=[NN], then /plan-context NN to reaggregate, then /plan-validate NN to reconfirm, then /plan-resolve NN to continue."`

If at least one `MD-N` is present in phase mode, abort after listing them — do not proceed to `AskUserQuestion` for the other categories. The user must add the TDs first; re-entering the cycle brings them back here with a cleaner queue.

**Task mode — inline resolution allowed.** Task mode MD-N issues may be resolved inline via the "task-sem-research inline create" flow above. For each `MD-N`:

1. Build a 2-4-option `AskUserQuestion` for the decision, labeling options with short names and optionally a brief description of each. If the issue's `Explicit choice:` clause lists options verbatim, use them.
2. On the first accepted answer, run the "task-sem-research inline create" procedure (create decisions doc if missing, set `related_phases` once).
3. Append a TD to the doc with the chosen option filled into `**Decision:**`.
4. Add a `**Libraries:**` line if the chosen option implies specific libraries.
5. If the user chooses "defer — run /research first" for any `MD-N`, abort with the /research instruction (same shape as phase mode's abort) and do NOT create the decisions doc for the deferred issue.

After task-mode `MD-N` handling (inline-resolved or deferred), proceed to Step 2.5 for UIG-N, then Step 3 for remaining categories.

### Step 2.5 — Handle `UIG-N` issues

For each open `UIG-N`:

1. Build `AskUserQuestion` with a multi-choice question — option labels encode both the decision AND a pre-defined rationale bucket (since `AskUserQuestion` is choice-based and does NOT support free-form text input):
   - **(a) Run /screen-inventory extension run** (add verb to inventory) → `answers[UIG-X] = {choice: 'extension_run'}`.
   - **(b) Non-UI — backend service only** (no UI surface required) → `answers[UIG-X] = {choice: 'non_ui', rationale: 'backend_service'}`.
   - **(c) Non-UI — admin/internal only** (user-facing UI not part of this phase) → `answers[UIG-X] = {choice: 'non_ui', rationale: 'admin_only'}`.
   - **(d) Non-UI — other (I'll add details manually to context.md)** → `answers[UIG-X] = {choice: 'non_ui', rationale: 'other'}`; resolve writes `Rationale: _[manual — edit context.md to add details]_` and user edits after the run finishes.
   - **(e) Defer UI to next phase** → `answers[UIG-X] = {choice: 'deferred', rationale: 'deferred_to_next_phase'}`.
2. The `rationale` string is written verbatim into the `Rationale` column of `## Non-UI / Deferred Capabilities` when Step 4 applies the edit. For the "other" case, the placeholder invites manual follow-up; `plan-validate` does not re-raise the UIG-N because the issue is marked resolved in validation.md regardless of rationale quality.
3. Continue with other categories. Apply UIG-N edits in Step 4 after all answers collected.

**If any UIG-N answer is `extension_run`, the abort is emitted in place of Step 6's next-command, AFTER Step 4 has applied all other edits** (distinct ordering from phase-mode MD-N abort, which fires at Step 2 before any edits). Abort message:
`"UIG-N resolution requires running /screen-inventory {NN | slug} (extension run) to add verb for capability '{cap}'. After that, run /plan-context <arg>, /plan-validate <arg>, /plan-resolve <arg>. Other non-UIG-N resolutions from this run have been applied and persisted."`

Unlike phase-mode MD-N, resolve DOES apply edits from all other resolutions before aborting:
- All non-UIG-N categories (IC-N, AMB-N, DG-N, ICC-N, OQ-N) — their edits are applied in Step 4.
- **Other UIG-N issues in the same run** that chose (b)/(c)/(d)/(e) — their edits are also applied (rows appended to `## Non-UI / Deferred Capabilities` in Step 4).
- **Only the specific UIG-N with `extension_run` choice is left unresolved** — its resolution requires running `/screen-inventory` externally.

Rationale: there's no dependency between non-UI resolutions and the extension run; letting the other edits land lets the user make incremental progress before the next `/screen-inventory` cycle.

### Step 3 — Build question batches for remaining categories

Remaining categories to resolve: `IC-N`, `AMB-N`, `DG-N`, `ICC-N`, `OQ-N`.

For each open issue, construct a question with:

- **Header**: the issue ID (e.g., `AMB-2`).
- **Body**: the issue's summary + the `Explicit choice:` text from validation.md.
- **Options**: derived from the issue text when explicit (e.g., two options listed in the `Explicit choice:` clause). If not explicit, include at minimum: (a) a concrete resolution the stage can apply via edits; (b) "defer — keep issue open" when the answer is genuinely external.

**Two-pass resolve** (per `plan-pipeline/SKILL.md` soft preference):

- **Pass 1 — Collect all answers.** Call `AskUserQuestion` in batches of up to 4 questions per call, sequentially until all open non-MD issues are asked. Collect every answer into an in-memory mapping `answers[issue_id] = {choice, target_td (if applicable), notes}`. Do not perform any Edit between `AskUserQuestion` calls.
- **Pass 2 — Apply edits.** After all answers are in, translate them into edit tuples and apply (see Step 4).

### Step 4 — Apply edits in a deterministic order

For each answered issue, determine the edit kind:

- **Fill pending TD** — the user chose Option X for a `TD-YY` that was `_[pending]_`. Edit the decisions doc: replace `_[pending]_` under TD-YY with the chosen option letter or short name. If the chosen option implies specific libraries (mentioned in the option's prose description or surfaced explicitly in the `AskUserQuestion` choice label), append a `**Libraries:**` line to the TD block right after the `**Decision:**` line, listing them comma-separated. The `research/SKILL.md` template does not structure libraries inside `### Option X:` blocks — the library list is a fresh field resolve adds when materializing the decision.

- **Supersede an existing TD** — the user chose an option that contradicts a previously decided TD-YY. Insert `<!-- status: superseded-by: {slug}/TD-ZZ -->` on the line immediately after `### TD-YY:` in the decisions doc. The superseding TD-ZZ must already exist (it was created by a prior /research cycle); if not, the issue should have been classified as MD and aborted earlier. The marker may be injected into **either** phase-scope or ad-hoc decisions docs (no doc-type restriction).

- **Append revision to TD-YY** — the user's answer points to a previously decided TD-YY where the chosen Option letter is the **same** as the existing decision (so it's not a Supersede), AND the issue (`IC-N` typically) indicates a parameter/prose-level drift between the TD and current reality. Append a new entry to the `**Revisions:**` block of TD-YY in the decisions doc:
  - **Locate position.** Within TD-YY's range (`### TD-YY:` to next `### TD-` or `---`), find the `**Libraries:**` line. The Revisions block goes after it; if `**Revisions:**` already exists below `**Libraries:**`, append a new bullet at the end of the existing block. If absent, insert a new block.
  - **Format the new entry.** `- {today's date YYYY-MM-DD via Bash 'date +%F'} — {one-liner derived from the issue's title} . Rationale: {bucket selected by the user via AskUserQuestion}.` Date is automatic (no user input). One-liner and rationale come from pre-defined option labels in the AskUserQuestion (`AskUserQuestion is choice-based and does NOT support free-form text input` — see line 100). To support the rationale field with no free-form text, the question MUST encode at least 2 short rationale buckets as option labels (e.g., `"Param updated to match new lib version"`, `"Param tightened by new policy"`, `"Path moved to follow ownership convention"`); the chosen label IS the rationale text.
  - **Trigger detection.** During Pass 1, when an `AskUserQuestion` for an `IC-N` issue references a `target_td` whose `**Decision:**` is non-pending and the option offered matches the existing letter, surface `Append revision` as one of the answer options (alongside `Supersede` and `Reaffirm with no change`). The user picks; classification follows.
  - The block may be appended to **either** phase-scope or ad-hoc decisions docs (no doc-type restriction; mirrors Supersede).

- **Clarify without editing a TD** — the answer resolves an ambiguity (`AMB`) or dependency gap (`DG`) without a TD change (e.g., the user says "yes, this is in scope for Phase 02" and no decisions-doc field needs to flip). Record the clarification in `## Resolved Issues` of `validation.md` with a short note; no decisions-doc edit.

- **Record non-UI / deferred capability** — the user chose (b), (c), (d), or (e) for a `UIG-N`. Edit `context.md`'s `## Non-UI / Deferred Capabilities` section:
  - Locate the section via `Grep -n '^## Non-UI / Deferred Capabilities$' context.md`.
  - **Case A — section present (post-integration context.md).** Read the bounded range `[S..E-1]` where `E` is the next `^## ` header.
    - If the body is `_None._` or an empty-table placeholder, replace with a table header + one row.
    - Otherwise, append a new row.
  - **Case B — section absent (legacy context.md pre-integration, grep returns zero matches).** Create the section fresh. Locate the insertion point via `Grep -n '^## ' context.md`:
    - Preferred insertion: immediately after `## UI Inventory` section (if present — find its end via the next `^## ` after the `## UI Inventory` start line).
    - Fallback insertion: immediately after `## Inherited Conventions` section.
    - Last resort: immediately before `## Testing Requirements` (this matches the canonical ordering in `plan-context/SKILL.md`).
    - Emit the full section: `## Non-UI / Deferred Capabilities` heading, blank line, the 4-column table header, and the single new row.
  - Row content:
    | {capability quote} | {non-ui | deferred} | {user rationale} | {covering TD refs from Decisions Index} |
  - For option (d) "Non-UI — other" the Rationale cell is `_[manual — edit context.md to add details]_`.
  - `sources_mtime` refresh NOT needed (context.md entries don't have mtime tracking for internal sections).

  Record the issue resolution in validation.md:
  - `resolved_by: non_ui_capability` (choices b/c/d) OR `resolved_by: deferred_capability` (choice e).
  - Append bullet to `## Resolved Issues` with `UIG-X — {capability} marked {non-ui | deferred}. Rationale: {text}.`

- **Mark TD as `Renders in: frontend-runtime` + flip UI Inventory to logic-only** — the user chose option **(d)** for an `IC-N` Scope-Subsection orphan check (per `plan-validate/SKILL.md` § Check 1 → Scope-Subsection orphan). The TD has `Scope: Frontend` and the receiving phase has no active UI surface; the user opts to re-classify the TD as FE-runtime architectural-transversal. **M3 produces 4 chained edits — all mandatory for the fix to be end-to-end functional. Skipping any of the four leaves the pipeline in an inconsistent state (decisions doc ahead of context.md, or context.md placeholders mismatched with subsequent A2 filter):**

  - **Edit 1 — Inject (or replace) `**Renders in:** frontend-runtime` marker in the decisions doc.** Bounded-edit anchored on the TD's `**Decision:** {letter}` line. Three sub-cases (idempotency-driven):
    - **Marker absent** (default case) → `Edit` with `old_string: '**Decision:** {letter}\n\n'` (or `'**Decision:** {letter}\n**Libraries:** ...'` when Libraries follows directly), `new_string: '**Decision:** {letter}\n**Renders in:** frontend-runtime\n\n'` (insert the marker line immediately after Decision, preserving the exact subsequent whitespace). When `**Libraries:**` is present right after Decision, anchor on `**Decision:** {letter}\n**Libraries:**` and insert the marker line between them — this preserves the canonical source ordering `Recommendation → Decision → Renders in → Libraries → Revisions → ---` documented in `research/SKILL.md` § "Renders in marker".
    - **Marker present as `**Renders in:** ui-contracts`** (explicit author choice that needs flipping) → `Edit` with `old_string: '**Renders in:** ui-contracts'`, `new_string: '**Renders in:** frontend-runtime'`. Critical: do NOT insert a duplicate line; the absence-case anchor would produce two `**Renders in:**` lines in the same TD, producing undefined behavior in `decisions-detail-reader`'s extraction.
    - **Marker already present as `**Renders in:** frontend-runtime`** (no-op case) → skip Edit 1 entirely; emit a one-line log to the user `"Marker already set on {slug}/TD-NN; proceeding with downstream edits (UI Inventory flip + context.md propagation)."`. Steps Edit 2-4 still run because context.md may be stale even when the source TD is correct (e.g., user edited the doc manually but did not re-run /plan-context).

  - **Edit 2 — Rewrite `## UI Inventory` body to the logic-only placeholder in context.md.** Bounded `Grep -n '^## UI Inventory$' context.md` → bounded read of `[S+1 .. E-1]` where E is the next `^## ` header. Edit substitutes the current body (any of: empty, deferred placeholder `_No screen inventory — UI↔API sync deferred…_`, or absent — in the absent case, insert the section at the canonical position per `plan-context/SKILL.md` Step 7 ordering rules) with the logic-only placeholder verbatim:
    ```
    _Frontend-runtime only — no screen inventory needed for this phase.
    Run /screen-inventory <arg> if a UI surface is added in a future revision._
    ```
    The token-anchor `_Frontend-runtime only —` is the load-bearing literal that downstream `plan-build` Gate 9 + `plan-validate` body inference grep for. Do NOT paraphrase.

  - **Edit 3 — Propagate marker to context.md `## Decisions Detail` + `## Decisions Index`.** **CRITICAL** — without this propagation, A2 filter on the next `/plan-build` reads stale context.md and ignores the freshly-injected marker, producing a no-op fix.
    - **`## Decisions Detail` rewrite** — re-dispatch `decisions-detail-reader` (with `mode={mode}`, `identifier={slug}`) and rewrite the section in context.md via the existing mechanism documented in Step 5 below (Grep range, bounded Read, Edit substituting content). The agent's output contract emits `**Renders in:** frontend-runtime` in the per-TD block when the source TD has the marker — so the rewrite naturally picks up Edit 1's injection. **Marker injection/change is part of the trigger set documented at Step 5 below** (alongside `pending → decided`, `decided → superseded`, `**Revisions:**` appended, and the task-mode `inline-create` case); the Step 5 enumeration is canonical — do NOT maintain a parallel count here.
    - **`## Decisions Index` row patch** — bounded `Grep -n '^| {slug}/TD-NN |' context.md` → Read the row → `Edit` with `old_string` (the current row, with `Renders in: —` in the 8th column when the column is rendered) → `new_string` (same row with `Renders in: frontend-runtime` in the 8th column). When the table is the legacy 7-column form (no `Renders in` column rendered because every TD's value was `—` before this edit), the patch must instead **regenerate the table header + all rows from the post-edit `decisions-reader` output** — adding the marker forces the column into existence. Easiest implementation: re-dispatch `decisions-reader` and rewrite the entire `## Decisions Index` table from its output (same mechanism as Step 5 below). **Marker injection/change is part of the trigger set documented at Step 4 step 5 below** (alongside the status-changed cases AND the task-mode `inline-create` case); the Step 4 step 5 enumeration is canonical — do NOT maintain a parallel count here.

  - **Edit 4 — Refresh `sources_mtime`** — apply the standard sources_mtime invariant (Hard rules) after Edit 1 mutated the decisions doc. Run `stat -c '%y' <decisions-doc>` and update the matching `context.md` frontmatter entry. (Edits 2 and 3 mutate context.md itself; staleness invariants on context.md are governed by the `/plan-validate` re-run, not by sources_mtime self-tracking.)

  Record the issue resolution in validation.md:
  - `resolved_by: marker_frontend_runtime` (the choice (d) bucket).
  - Append bullet to `## Resolved Issues` with `IC-X — TD {slug}/TD-NN re-classified as Renders in: frontend-runtime; UI Inventory body flipped to logic-only placeholder. Decisions Detail + Decisions Index row patched in context.md.`

  **Multi-marker M3 coalescing.** When validation.md has ≥2 IC-N orphan-checks resolved with (d) in the same `/plan-resolve` run, the 4 edits coalesce naturally via existing mechanisms — no special batching code needed:
  - **Edit 1** (per-TD): applied once per affected TD. Each is bounded-anchored on its own TD heading; no interference.
  - **Edit 2** (UI Inventory body rewrite): idempotent. The first M3 writes the placeholder; subsequent M3s detect the body already matches the logic-only placeholder and skip the Edit silently (defensive bounded grep `_Frontend-runtime only —` BEFORE attempting the Edit; if matched, the Edit is a no-op).
  - **Edit 3a** (Decisions Detail rewrite via re-dispatch): single dispatch at the end of the resolve batch covers all markers injected — `decisions-detail-reader` re-extracts every current-scope TD, so the regenerated section reflects all M3 edits at once.
  - **Edit 3b** (Decisions Index row patch): per-TD when the table already has the `Renders in` column rendered (8-column form). When the table is in legacy 7-column form, a single rewrite (regenerating the entire table) covers all rows — performed once at end of batch, after all per-TD Edits 1 are applied.
  - **Edit 4** (sources_mtime refresh): single refresh at end of batch (existing invariant).

  Result: M3 N-times does NOT duplicate heavy writes. Per-TD writes are limited to marker injection (Edit 1) and (in 8-column-table case) Decisions Index row patch (Edit 3b).

**Edit order within the decisions doc:**

1. Locate each affected TD with `Grep -n '^### TD-' <file>` (one grep, full list of positions — cheap).
2. For each edit, compute the bounded line range of the target TD (header line through the line before the next `### TD-` or EOF).
3. Read that bounded range, compose the Edit's `old_string` from it (exact whitespace/punctuation preserved), and apply.
4. Repeat for each affected TD. Never Read the full decisions doc.

**After all decisions-doc edits:**

5. Patch `context.md`'s `## Decisions Index`:
   - For each TD whose status changed (pending → decided, or decided → superseded, **or had a `**Renders in:**` marker injected/changed this run via the M3 (d) edit kind above**, or had a `**Revisions:**` block appended this run, **or was created on-the-fly via the task-mode `inline-create` case** — a brand-new TD whose row must be appended to the table): find the table row via `Grep -n '^| {slug}/TD-YY |' context.md`, Read that line only, Edit `old_string` → `new_string` with updated Status / Decision / Libraries / Renders in cells. For the `inline-create` case, no existing row matches the grep — append a new row to the end of the `## Decisions Index` table (or regenerate the entire table from a fresh `decisions-reader` dispatch when the new TD's marker forces the table from 7-column to 8-column form, per the M3 edit kind documentation above). The `inline-create` trigger keeps the Decisions Index row patch in lock-step with the Decisions Detail rewrite at Step 5 below — without it, task-mode `inline-create` would silently produce a `## Decisions Detail` entry with no matching `## Decisions Index` row. For revised TDs the Status/Decision/Libraries columns may be unchanged; the row update is still needed to refresh the **Revisions annotation row** (the `└─ Last revision: …` row introduced by `decisions-reader` per `decisions-reader.md` § Section 1). For marker-injected TDs the `Renders in` cell value flips from `—` (or `ui-contracts`) to `frontend-runtime`; if the table was previously rendered in 7-column form (every TD's value was `—`), the patch must regenerate the full table from a fresh `decisions-reader` dispatch to add the 8th column header, per the M3 edit kind documentation above.

6. Refresh `context.md`'s `sources_mtime` frontmatter (**sources_mtime invariant — see Hard rules**):
   - For every decisions doc this run edited (the phase-scope doc plus each ad-hoc doc whose TDs had their `**Decision:**` filled or superseded-by marker injected), run `stat -c '%y' <file>` to capture its current ISO-8601 mtime.
   - Edit the matching `docs/decisions/technical-decisions-{slug}.md: "..."` line inside `context.md`'s frontmatter to the new value. Do NOT touch entries for docs that were not edited this run (their recorded mtime still matches reality).
   - Rationale: resolve mutated the decisions doc, which is a source tracked by `context.md`. Leaving `sources_mtime` pointing to the pre-edit mtime would cause `/plan-validate NN` to detect drift and abort on its next run, forcing a gratuitous `/plan-context NN` cycle.

7. Patch `validation.md`:
   - In frontmatter `issues:`, flip each resolved issue's `status: open` to `status: resolved` and append `resolved_by: {slug}/TD-XX` (or `resolved_by: clarification` for Clarify-without-TD cases).
   - Recompute `issue_count` in the frontmatter to match the number of remaining `status: open` entries after all flips are applied. Write the new value even if it reaches 0. This keeps the frontmatter coherent between resolve runs and next validate.
   - In the body, remove the resolved issue's bullet from its Findings subsection and append a new bullet to `## Resolved Issues` with the same ID + summary + `resolved_by`.
   - Leave `status: dirty` / `status: clean` unchanged — `plan-validate` is the single source for that verdict; do not set `clean` here. The user reruns `/plan-validate NN` and validate decides. (Decoupling `status` from `issue_count` is intentional: `issue_count` is a raw counter; `status` is a verdict that also depends on whether re-running the checks would surface new issues, which only validate can determine.)

### Step 4.5 — Run /plan-resolve custom rules

After Step 4's deterministic edits have been applied (decisions doc, context.md `Decisions Index`, validation.md status flips, optional Non-UI / Deferred Capabilities row appends) and **before** Step 5's Context7 batch, dispatch any custom rules in `docs/rules/plan-resolve/`:

1. `Glob docs/rules/plan-resolve/*.md`. If empty → skip Step 4.5; proceed to Step 5.
2. For each file in alphabetic order:
   a. Bounded-read frontmatter. If `status: disabled`, skip silently.
   b. Full Read + follow body. Rules run sequentially — edits made by an earlier rule are visible to later rules in the same dispatch. Bodies that depend on inter-rule ordering MUST document it.
   c. The body has access to: the current `<slug>` (resolve target); all decisions docs in `docs/decisions/*.md` (read/write — same authority Step 4 has); `context.md`, `validation.md`, `library-refs.md` of the resolve target; the disk (Bash, Read, Grep, Glob, Edit).
   d. **Side-effect rules are the norm here.** Most rules edit decisions docs / context.md / library-refs.md directly. Idempotency is the rule's responsibility (each write must be guarded with a "is this already applied?" check). Rule bodies emit no IC; they may append text to a per-rule output buffer that Step 6 concatenates into the next-command summary.

3. If a rule modifies any file tracked by `sources_mtime`, the host's "sources_mtime invariant" (Hard rules) applies — refresh the matching entries via `stat` before Step 6.

After all rules processed, proceed to Step 5 (Context7 fetch + library-refs sync). Step 5's `decisions-reader` / `decisions-detail-reader` dispatch sees post-rule state, so any new TDs created in Step 4.5 are captured. Filter-trace verification (gates 1-4 of Step 5) catches any under-iteration.

### Step 5 — Context7 fetch and library-refs sync

**Dispatch `decisions-reader` + `decisions-detail-reader` post-edit.** After step 4's edits have been applied, issue **two parallel `Agent` calls** in a single assistant message, both passing the mode and identifier:

- `decisions-reader` (input: `mode`, `identifier`) — captures the current post-edit inventory of decided TDs, their libraries, and the `related_phases` list of every source doc (feeds the library target set computation below).
- `decisions-detail-reader` (input: `mode`, `identifier`) — produces a fresh `## Decisions Detail for Phase NN / slice {slug}` (phase mode) / `## Decisions Detail for Task {slug}` (task mode) block reflecting the post-edit state of every current-scope TD (feeds the context.md rewrite sub-procedure below).

Keep both outputs in memory for the rest of step 5.

**Filter Trace verification (REQUIRED, mirrors plan-context Step 2).** Both subagents emit a mandatory `## Filter Trace` block per their Output contracts. Even though the post-edit dispatch happens within the same pipeline run as plan-context's earlier dispatch (so no new ad-hoc docs SHOULD have appeared in between), the silent under-iteration bug is invocation-local — every dispatch of these readers must verify its own trace. Run the same three-part check used by plan-context Step 2:

1. `Glob 'docs/decisions/technical-decisions-*.md'` from the main thread (metadata-only). Let `T_caller` and `set_caller` = the result count and basename set.
2. **Per-agent count/set check.** For each of the two dispatched agents, parse its `## Filter Trace` preamble (`Globbed T={T} candidates...`) and table (`File` column → `set_agent`). Verify `T_caller == T_agent` AND `set_caller == set_agent`. On mismatch, abort with: `"{agent-name} Filter Trace incomplete: caller globbed {T_caller} files but agent traced {T_agent}. Missing from trace: [{set_caller \\ set_agent}]. The subagent silently skipped candidates — re-dispatch {agent-name} with explicit per-file enumeration."` where `{agent-name}` is the literal `decisions-reader` or `decisions-detail-reader`. Run both checks before aborting so the user sees all failures.
3. **Cross-agent consistency check.** Build `set_kept_R` for decisions-reader by collecting `File` column values where `Decision == kept`; build `set_kept_D` identically for decisions-detail-reader. The two readers MUST agree on the kept set. On divergence, abort with: `"decisions-reader and decisions-detail-reader disagree on which docs were kept: only-in-reader=[set_kept_R \\ set_kept_D], only-in-detail-reader=[set_kept_D \\ set_kept_R]. One or both under-iterated; re-dispatch both."`

4. **`decisions-detail-reader` TD count match (FUNCTIONAL hard gate).** Derive `kept_files` from the agent's `## Filter Trace` table: collect `File` column values where `Decision == kept`, prefix with `docs/decisions/`. Compute `expected = sum over kept_files of: grep -cE '^\*\*Decision:\*\* [A-Z]' <kept_file>` and `actual = grep -cE '^### [a-z0-9-]+/TD-[0-9]+' <agent_output>`. On `actual != expected`, abort: `"decisions-detail-reader TD count mismatch: expected={expected} decided TDs across kept files, agent emitted {actual}. Re-dispatch decisions-detail-reader."`

5. **Cosmetic detection (SOFT — warn to terminal, never abort).**
   a. **Preamble.** Count chars before the first `## Decisions Detail for` line (`awk '/^## Decisions Detail for/{exit} {len+=length($0)+1} END{print len}'`). If `> 0`: `"WARN [cosmetic]: decisions-detail-reader emitted {N} chars of preamble before the heading."`
   b. **Option-X prefix retention (bolded OR plain).** `prefix_kept = grep -cE '^\*\*Recommendation:\*\* (\*\*)?Option [A-Z]' <agent_output>`; `prefix_total = grep -cE '^\*\*Recommendation:\*\*' <agent_output>`. If `prefix_kept > 0`: `"WARN [cosmetic]: {prefix_kept} of {prefix_total} Recommendation lines retain 'Option X' prefix."`

**Quality bar (FUNCTIONAL hard / COSMETIC soft).** Mirrors plan-context Step 2. Gates 1–4 are hard (abort + re-dispatch on mismatch); gate 5 is soft (warn only). See plan-context Step 2 for the rationale; do not promote gate 5 to hard without the same empirical evidence.

**Verification scope.** Like in plan-context Step 2, this verification applies ONLY to `decisions-reader` and `decisions-detail-reader` — they are the only agents dispatched here that emit `## Filter Trace`. Skip this verification only when an agent returned an ERROR line OR was not dispatched OR returned the task-sem-research zero-match placeholder (`_No decisions doc for task {slug} (task-sem-research)._` or `_No decided TDs (task has no decisions doc yet)._`). Without this verification, plan-resolve's subsequent `## Decisions Detail` rewrite and library target-set computation could silently miss ad-hoc TDs whose libraries should have been resolved.

**Rewrite `## Decisions Detail` in context.md.** Triggered whenever any TD's status changed in this run (pending → decided, or decided → superseded, **or had a `**Renders in:**` marker injected/changed via the M3 (d) edit kind in Step 4 above**, or had a `**Revisions:**` block appended), including the inline-create case in task mode (a brand-new TD was written). The section must reflect the current set of decided current-scope TDs, their `**Renders in:**` markers (when present), and the latest Revisions blocks — `decisions-detail-reader` now emits per-TD in the `Recommendation → Renders in (when present) → Libraries → Revisions` order per its updated output contract. In task mode, if the decisions doc was just created on-the-fly, `decisions-detail-reader` returns the single TD block; the rewrite creates `## Decisions Detail` (where previously it was the `_No current-scope TDs._` placeholder). **Marker-injection-only triggers** (TD's status was already `decided` and only the `Renders in` value flipped) ARE in the trigger set — without this extension, M3 (d) edits to context.md would not propagate to `## Decisions Detail`, leaving A2 filter on the next `/plan-build` reading stale data and mis-classifying the TD into the wrong subsection.

1. Use the `decisions-detail-reader` output already captured in the batch dispatch above. It returns a `## Decisions Detail for Phase NN / slice {slug}` (phase mode) or `## Decisions Detail for Task {slug}` (task mode) block reflecting the post-edit state. Superseded and still-pending TDs are naturally absent (the subagent skips them).
2. Locate the range of `## Decisions Detail` in context.md:
   - `Grep -n '^## Decisions Detail$' <context.md>` → start line S (the `$` anchor avoids matching `## Inherited Decisions Detail`).
   - `Grep -n '^## ' <context.md>` → find the next H2 after S → end line E-1.
3. `Edit` context.md: `old_string` is the current content of range [S..E-1] (bounded Read first, then compose the Edit); `new_string` is the subagent's output with the heading renamed from `## Decisions Detail for Phase NN / slice {slug}` (or `## Decisions Detail for Task {slug}`) to the canonical `## Decisions Detail` (no suffix).
4. **Do NOT touch `## Inherited Decisions Detail`.** That section is owned by `plan-context` (populated via phases-reader) and only regenerates on full context.md regeneration. Resolve does not dispatch phases-reader.
5. If `## Decisions Detail` does not exist in context.md (old format pre-dating this feature), skip silently — the next `/plan-context NN` run will regenerate context.md with both sections present.

**Build the target library set.** Instead of limiting to "libs decided this run", compute the full set of libraries that should be cached for the current scope (phase or task):

1. From the decisions-reader output above, enumerate every TD whose `Libraries` column is non-`—` and whose `Status` is `decided` (ignore `pending` and `superseded-by ...`). Split each Libraries cell on `,` and trim each lib name; a cell with `argon2, bcrypt` produces two entries (`argon2`, `bcrypt`). Scoped package names like `@nestjs/jwt` are single entries (no comma inside names). Collect every lib name into a flat set.
2. Read the current target dir's `library-refs.md` (i.e., `{target_dir}/library-refs.md`, where `{target_dir}` is `docs/phases/phase-NN-{slug}/` in phase mode or `docs/tasks/task-{slug}/` in task mode) if it exists (bounded — top of file); collect the keys of `libs:` in its frontmatter.
3. **Target set = libraries in (1) NOT already in (2).** This covers both "just filled in this resolve run" and "decided in a prior run but library-refs.md is missing the entry (e.g., file was deleted, or decided cross-scope in a sibling pipeline)".

**If the target set is empty, skip to step 6.**

**Otherwise, for every library in the target set:**

1. Resolve library ID via `mcp__context7__resolve-library-id` (one call per library).
2. Fetch docs via `mcp__context7__query-docs` — issue all fetches for the batch **in parallel** in a single assistant message.
3. If `library-refs.md` does not exist, create it with the frontmatter template below.
4. For each library, write (or rewrite) a `### {library-name}` section with the distilled docs excerpt relevant to the current scope's usage (the user's TDs tell you which surfaces matter — focus on those).
5. Update frontmatter: add/merge `libs: {"{name}": {"version": "...", "context7_id": "...", "fetched_at": "ISO-8601"}}`. For `sources_mtime`: run `stat -c '%y' <decisions-doc>` on every decisions doc that introduces a new lib and record the real mtime — do not guess or reuse the timestamp captured by `context.md`. Also refresh the entry for any decisions doc this run **edited** (even if it did not introduce a new lib), per the **sources_mtime invariant** (see Hard rules).
6. **Cross-scope propagation for ad-hoc libs.** If any library in this batch came from an ad-hoc decisions doc whose `related_phases` includes phases OTHER than the current target's scope (e.g., `related_phases: [1, 2]` when resolving phase 2; or `related_phases: [1]` when resolving a task whose inline-create set it to phase 1 — the task itself is not listed in `related_phases`, which is an int-list of phases), after writing the current target dir's `library-refs.md`, byte-copy it to each listed phase's slice directories. Per the phase slicing model, a given `MM` may correspond to ≥1 slice dirs:

   ```
   For each `MM` in the ad-hoc's `related_phases`:
     Glob docs/phases/phase-MM-*/library-refs.md (expect ≥0 matches — zero matches = skip silently, ≥1 = byte-copy to each)
     byte-copy the current target's library-refs.md to each match.
   ```

   This is a mechanical refactor from point-resolution to glob-resolution; behavior for monolithic phases (exactly 1 slice dir per `MM`) is byte-identical to the previous single-target copy. The frontmatter is scope-agnostic (see template below) so the copy is safe across all slice dirs. If a target phase has no slice dir on disk yet, the glob returns zero matches and the propagation skips silently — each slice's resolve (when it runs) will backfill the cache from the decisions-reader output via the self-healing target-set computation above. In task mode the task's own `library-refs.md` already lives under `docs/tasks/task-{slug}/` — the propagation is one-directional (task → slice dirs of phases listed in `related_phases`) and task dirs are never written to by phase-mode resolves.

**Network-failure policy:** If a Context7 call fails, abort this stage with: `"Context7 fetch failed for library <X>. Retry /plan-resolve NN when connectivity is restored — the decisions-doc edits from this run are already applied and will not be redone."` This is a known trade-off of running Context7 inside resolve: decisions-doc mutations happen before the network call, so a rerun is always safe (it re-detects that the decision is already filled and only retries the Context7 fetch + library-refs write).

**library-refs.md frontmatter template:**

```yaml
---
libs:
  "@nestjs/jwt":
    version: "^11.0.0"
    context7_id: "/nestjs/nest"
    fetched_at: "ISO-8601-timestamp"
sources_mtime:
  docs/decisions/technical-decisions-{slug}.md: "ISO-8601-timestamp"
  # one entry per decisions doc (phase-scope + ad-hoc) that contributed a lib
---
```

Note: `library-refs.md` is a library-docs cache, not a phase-identity artifact. It deliberately does NOT carry `phase:` / `name:` frontmatter fields. That keeps the file byte-copyable across phase directories in step 6 below without identity drift.

### Step 6 — Emit next-command

After all edits (and Context7 if applicable), emit the standard line:

```
Resolved N issues. Run /plan-validate NN to reconfirm status before building.
```

If Step 4.5 dispatched any rules that contributed output to the per-rule buffer (per Step 4.5 step d), concatenate each rule's contribution as additional paragraphs after the standard line, in dispatch order. Each rule's contribution stands on its own (rule bodies do NOT prepend the "Resolved N issues" count).

Do not infer or compute `clean` status here — per shared convention, only `plan-validate` decides that.

## Hard rules

- **Phase mode — never create new TDs.** `MD-N` aborts with a /research instruction; never invent TDs to close an MD in phase mode.
- **Task mode — may create TDs on-the-fly** to resolve `MD-N`, but only via the "task-sem-research inline create" procedure. TDs born this way are written with `**Decision:**` already filled (never `_[pending]_`). `plan-resolve` never touches `## Capability Coverage` in task mode (the section does not exist).
- **Never skip `AskUserQuestion`** for IC/AMB/DG/ICC/OQ. Even when the answer seems obvious, surface to the user — this stage's contract is "user decides, agent transcribes".
- **Two-pass order is mandatory.** Collect all answers before any Edit. Partial-state failures (Context7 down, Edit conflict) are easier to recover when decisions-doc edits are batched.
- **Bounded reads only.** Never Read the full decisions doc — always grep for TD header positions first, then Read the target range. Same for context.md and validation.md (their frontmatter first, then the relevant section).
- **No writes to project-plan.md.** If a resolution would require editing project-plan (e.g., a capability reword), emit instead: `"Issue <ID> requires editing docs/project-plan.md. Make the edit and rerun /plan-context NN + /plan-validate NN + /plan-resolve NN."` — abort for that issue specifically.
- **Superseded marker ownership.** Injecting `<!-- status: superseded-by: ... -->` is exclusive to this stage. `research/SKILL.md` documents the convention but does not write the marker; `plan-validate` / `plan-build` read it but do not write it. Markers may be injected into either phase-scope or ad-hoc decisions docs (no scope restriction).
- **Revisions block ownership.** Appending `**Revisions:**` block entries is shared between this stage (when an `IC-N` answer triggers the `Append revision to TD-YY` classification) and the `/decide` skill (front-door for ad-hoc parameter changes). `research/SKILL.md` documents the format; `decisions-reader` and `decisions-detail-reader` surface it. `plan-validate` / `plan-build` read but do not write. Manual editor edits are also permitted — the format is human-friendly and append-only by convention.
- **`sources_mtime` invariant.** Any artifact this stage writes to that records `sources_mtime` for a doc this stage also edited MUST have that entry refreshed (via `stat`) before the stage emits its next-command. Concretely: after editing `technical-decisions-{slug}.md` (or any ad-hoc decisions doc), the matching entries inside `context.md`'s and `library-refs.md`'s frontmatter must be updated to the post-edit mtime. Leaving them stale violates the upstream-fingerprint contract and forces gratuitous `/plan-context NN` reruns downstream. `validation.md`'s `sources_mtime` is exempt (validate rewrites it wholesale on next run). **Phase slicing extension:** when the current slice's phase-scope decisions doc has a non-empty `depends_on_slices` frontmatter field, both the slice's `context.md` and its `library-refs.md` record `sources_mtime` entries for each sibling slice's `library-refs.md` (keyed by the sibling's full path). Resolve does not edit sibling `library-refs.md` files directly, but if a sibling was the target of a cross-scope propagation copy in step 6, the sibling mtime must be refreshed here too.
- **Never edit inventory files.** `plan-resolve` is read-only for `docs/inventories/screen-inventory-*.md` and `docs/tasks/task-{slug}/inventory.md`. Any change to inventory requires running `/screen-inventory` extension run. Intentional asymmetry with task-sem-research inline create (decisions docs are text-only; inventories require Figma MCP infrastructure).
- **UIG-N option (a) — extension run — always aborts.** Even when other UIG-N instances in the same run chose (b) / (c) / (d) / (e), option (a) triggers the abort-with-command at Step 3 end. The `/screen-inventory` extension run is the only path to materialize a new verb.
- **`## UI Inventory` in context.md is not touched by this stage.** Only `## Non-UI / Deferred Capabilities` is appended. Rationale: inventory digest reflects the state of the inventory file; since we don't edit the inventory, we don't invalidate its digest.

## Recovery from a partial run

If this stage aborts mid-run (Context7 failure, unexpected edit conflict), the state is:

- All decisions-doc edits up to the abort point are persisted.
- validation.md's `issues:` frontmatter is partially updated — only issues whose edits completed are marked `resolved`.
- Rerunning `/plan-resolve NN` will re-inventory open issues and continue from where it stopped; already-resolved issues are not re-asked.

If the state is inconsistent (e.g., decisions doc has a `**Decision:** B` but validation.md still lists the issue as open), rerunning `/plan-validate NN` first is the canonical recovery — validate will re-detect or drop the stale issue based on the current truth.
