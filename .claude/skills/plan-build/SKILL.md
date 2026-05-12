---
name: plan-build
description: "Stage 4 of the plan pipeline (phase and task modes). Runs abort-fast preflight checks (mode detection, context.md + validation.md present and fresh, status clean, library-refs.md present if required, resume detection) and writes the final phase-NN-{slug}.md or task-{slug}.md artifact directly from the main thread. The procedure is split across companion files: phase-a.md (scaffold + Technical Specifications + pause), phase-b.md (Step Implementations + Dependency Map + Deliverables), phase-c.md (append-mode for incremental delta builds). The pause between Phase A and Phase B creates a natural review checkpoint. Use as the final stage after validation.md reports clean. Triggers: 'plan-build NN', 'plan-build <slug>', 'build the phase NN', 'build task <slug>'."
disable-model-invocation: true
---

# Plan Pipeline — Stage 4: Build (orchestrator)

This file is the **dispatcher**. It runs preflight gates, decides which phase to execute, and hands off to a companion file:

- `phase-a.md` — scaffold + Technical Specifications + A5 pause.
- `phase-b.md` — SIs + Dependency Map + Deliverables (after A5 "Continue now", or as resume target).
- `phase-c.md` — append-mode (incremental delta builds when a fully-completed artifact exists).
- `templates/screen-si.md` — Screen SI Xa/Xb templates (read on demand from Phase B when `ui_in_scope: true`).
- `templates/tech-specs/*.md` — per-subsection Tech Specs templates (read on demand from Phase A4).

This skill is **main-writes**: the main thread reads `context.md`, decomposes scope into Step Implementations, expands Technical Specifications, and writes the final artifact via incremental `Edit` calls. The runtime is **2-phase + append**, with a pause point between Technical Specifications and Step Implementations — the format of the final file is **unchanged** (`## Step Implementations` precedes `## Technical Specifications` per the canonical artifact shape; sentinelas preserve section order during the split).

Read `plan-pipeline/SKILL.md` for shared conventions (mode detection, slug discovery, `sources_mtime` staleness, `status: clean|dirty` gate, frontmatter format).

---

## Input

One argument: phase number `NN` (integer, phase mode) OR task slug `{slug}` (string, task mode). Optional flag: `--rebuild` (forces fresh Phase A even when the artifact is already built — bypasses Phase C).

Mode detection follows `plan-pipeline/SKILL.md`:

- **Phase mode** (integer `NN`): resolve slug via phase-scope decisions-doc filter. On 0 matches abort with `"Run /research phase NN first"`. On ≥2 matches abort with `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."` (list = slugs of all matched phase-scope docs). On exactly 1 match, proceed. Compute `{target_dir}` = `docs/phases/phase-NN-{slug}/`. Compute `{target_path}` = `docs/phases/phase-NN-{slug}/phase-NN-{slug}.md`.
- **Phase mode (slice slug)** (string matching a `scope_type: phase` doc): identifier IS the slice slug; `NN` is extracted from the doc's `related_phases[0]`. Same `{target_dir}` / `{target_path}` computation follows. Mode detection rules are defined in `plan-pipeline/SKILL.md`.
- **Task mode** (string `{slug}`): expect `docs/tasks/task-{slug}/` to exist; abort if missing: `"docs/tasks/task-{slug}/ not found. Run /plan-context {slug} first."`. Compute `{target_path}` = `docs/tasks/task-{slug}/task-{slug}.md`.

---

## Preflight — abort-fast checks

Run in order. Every check is O(1) or bounded; no full reads of `context.md`, `library-refs.md`, or decisions docs happen here. Any failed gate aborts immediately with an actionable next-command, never falls through.

### Gate 1 — Mode detection + slug discovery

Per `plan-pipeline/SKILL.md`. Output is `mode`, `identifier` (NN or slug), `slug`, `{target_dir}`, `{target_path}`.

### Gate 2 — context.md existence

Check `{target_dir}/context.md`. Abort with `"context.md not found for {phase NN | task {slug}}. Run /plan-context <arg> first."` if missing.

### Gate 3 — context.md frontmatter kind match

Bounded Read of the top `---` block. **Parse the full frontmatter into memory** — capture all standard fields (`kind`, `name`, `sources_mtime`) AND any transient-state markers (`state:` per `plan-pipeline/SKILL.md`'s Artifact frontmatter format). Infer `kind` per the reading rules in `plan-pipeline/SKILL.md` (rules 1–4). The inferred kind must match the detected input mode. Mismatch aborts with: `"context.md is a {inferred} artifact but you ran plan-build in {detected} mode."` Legacy phase artifacts with `phase:` integer and no `kind:` are accepted as phase mode via the `name:` prefix rules. Keep the parsed frontmatter in memory — downstream gates and Phase A/B/C reuse it without re-reading.

### Gate 3.5 — Partial context.md detection (Decisão #28, task mode only)

Reuse the frontmatter already parsed in Gate 3. If `state: partial-awaiting-inventory` is present → abort: `"context.md for task {slug} is partial (state: partial-awaiting-inventory — plan-context wrote minimum scope-only context for screen-inventory to read). Run /screen-inventory {slug} to create inventory, then rerun /plan-context {slug} to complete context.md before building."`. **No additional reads** — reuses Gate 3's parsed frontmatter.

### Gate 4 — validation.md existence

Check `{target_dir}/validation.md`. Abort with `"validation.md not found for {phase NN | task {slug}}. Run /plan-validate <arg> first."` if missing.

### Gate 5 — validation.md freshness

Bounded Read of the top `---` frontmatter block only. For every key in `sources_mtime`, `stat` and compare. Drift aborts: `"validation.md is stale relative to {source}. Run /plan-validate <arg> to reconfirm status before building."`

### Gate 6 — Status gate

From the validation.md frontmatter in memory:

- `status != clean` → abort: `"validation.md has {issue_count} open issues. Run /plan-resolve <arg>, then /plan-validate <arg>, then retry /plan-build <arg>."`
- `status: clean` → proceed.

### Gate 7 — library-refs requirement (targeted grep)

Run:

`Grep -nP '^\|.*\| decided \|.*\| [^—]' {target_dir}/context.md`

Interpret:
- **Zero matches** → `library_refs_required: false`.
- **≥1 match** AND `{target_dir}/library-refs.md` missing → abort: `"Libraries are decided in context.md's Decisions Index but {target_dir}/library-refs.md is missing. Run /plan-resolve <arg> to refresh the library cache before building."`
- **≥1 match** AND `library-refs.md` exists → `library_refs_required: true`.

The per-library coverage check happens later (Phase B step B2.5); this gate only guarantees the file exists when required.

**Cross-slice library-refs (slicing only).** When the current slice's phase-scope decisions doc declares `depends_on_slices: [<sibling-slug>, ...]`, library-refs lives at `docs/phases/phase-NN-{sibling}/library-refs.md`. For each sibling listed in `depends_on_slices`, check existence of `docs/phases/phase-NN-{sibling}/library-refs.md` AND check whether the sibling's phase-scope decisions doc has any **decided TD with non-empty `**Libraries:**`**. Concrete grep: `Grep -nP '^\*\*Libraries:\*\* (?![—\-]\s*$).+$' docs/decisions/technical-decisions-{sibling}.md` — a match line indicates a Libraries entry whose value is not `—`, not `-`, and not empty/whitespace. If there is ≥1 match, the sibling has decided TDs with non-empty Libraries.

- If sibling has **decided TDs with libraries** AND its `library-refs.md` is absent → **hard abort**: `"Sibling slice {sibling-slug} has decided TDs citing libraries but no library-refs.md at docs/phases/phase-NN-{sibling}/library-refs.md. Run /plan-resolve {sibling-slug} to materialize its library cache, then retry /plan-build {slug}."` This prevents a silent B4-step-3 dead-end where the current slice inherits a TD that cites a lib but the lib doc can't be found in any cache.
- If sibling has **no decided TDs with libraries** (all TDs pending, superseded, or cite no libraries) → missing `library-refs.md` is expected and NOT an abort. Proceed; the sibling contributes no library entries to aggregation.
- If sibling's `library-refs.md` exists → record its path in memory for Phase A1 / B4 step 3 aggregation.

### Gate 8 — Decisions Detail sections presence

Bounded grep on context.md:

`Grep -n '^## Decisions Detail$' {target_dir}/context.md`

Interpret:
- **Zero matches** → context.md is malformed or legacy. Abort: `"context.md for {phase NN | task {slug}} is in old format (no ## Decisions Detail section). Run /plan-context <arg> to regenerate it, then retry /plan-build <arg>."`
- **≥1 match** → proceed.

Note: this check does not verify `## Inherited Decisions Detail` because it may legitimately be empty (Phase 1 with no prior phases, or task mode with no inherited phase + no correlator-confirmed docs).

### Gate 9 — Inventory staleness check (when applicable)

Bounded grep on context.md:

`Grep -n '^## UI Inventory$' {target_dir}/context.md`

Interpret (the four pattern tests below are mutually exclusive by token-anchor construction; order of evaluation does not matter):

- **Zero matches** → no UI scope; `ui_in_scope: false`. Skip the rest of this gate.
- **≥1 match** — bounded read of the section body, then test the body content against two independent pattern tests:
  - **Body matches `_No screen inventory —[^_]*deferred[^_]*_`** → `ui_in_scope: deferred`; skip the staleness check (deferred state is legitimate).
  - **Body matches `_Frontend-runtime only —[^_]*_`** → `ui_in_scope: logic-only`; skip the staleness check (logic-only state is legitimate, parallel to deferred — user opted out of inventory because the phase only introduces FE-runtime architectural-transversal TDs and no UI surface). The token-anchor `_Frontend-runtime only —` is mutually exclusive with the deferred placeholder's `_No screen inventory —` token by construction (per `plan-context/SKILL.md` Step 0.5).
  - **Body has populated digest** (neither placeholder matched) → `ui_in_scope: true`. Extract the `**Source:** \`{path}\`` line via bounded read; `stat` that path; compare against `sources_mtime` entry in context.md frontmatter for the same key. If inventory file mtime is newer → abort: `"Screen inventory at {path} has been updated since context.md was generated. Run /plan-context <arg> to regenerate."`.

After this gate, `ui_in_scope` is one of `true | false | deferred | logic-only` and is held in memory through every phase.

### Gate 9.5 — Last-slice coverage gate (phase mode, slicing only)

Runs only in phase mode and only when the current phase has ≥2 `scope_type: phase` docs for `NN` (monolithic phases skip this gate entirely — no cross-slice gap is possible by construction).

Procedure:

1. Compute the slice set via atomic Grep set-arithmetic (`S_phase ∩ S_NN` per `plan-pipeline/SKILL.md` → Slug discovery → Phase mode integer arg). Subtract the current slug to get **siblings** = `(S_phase ∩ S_NN) \ {current-slug}`. No per-file iteration — Grep returns sets atomically.
2. For each sibling, check that a built artifact exists at `docs/phases/phase-NN-{sibling}/phase-NN-{sibling}.md`.
3. If at least one sibling has no built artifact → this slice is NOT the last; skip the coverage aggregation and proceed to Gate 10.
4. If every sibling has a built artifact → this slice IS the last. Bounded-read `covers_capabilities` frontmatter from self + every sibling; union the values; compare the union against the phase's capability bullets in `project-plan.md`. Extract the phase's bullets via bounded grep/read against the actual heading format used in `project-plan.md`: `Grep -n '^### Fase {NN_zero_padded} — ' docs/project-plan.md` → start line S; `Grep -n '^### Fase \|^## ' docs/project-plan.md` → next H2/H3 after S → end line E-1; Read S..E-1 and extract bullets matching `^- `. **`{NN_zero_padded}` is NN formatted as a 2-digit zero-padded string** (e.g., phase 2 → `02`, phase 10 → `10`). Single-digit NN MUST be padded; otherwise the grep silently matches nothing and the coverage gate trivially passes. (Plan-reader subagent dispatch is NOT allowed here — `/plan-build` default path forbids Agent dispatch per Hard rules.)
5. If any capability is uncovered by the union → hard abort: `"Phase NN has uncovered capabilities: <list>. Update covers_capabilities in at least one sibling's phase-scope doc, or add new slices via /research, before building the last slice."`
6. If the union covers every capability → proceed to Gate 10.

This gate is the hard-error counterpart of `plan-validate`'s Check 8 `MC-cross-N` advisory (per plan-pipeline slicing model — Phase-level coverage gate section).

### Gate 10 — Resume detection

Run a single grep covering both required sentinelas:

`Grep -nE '^<!-- (SIs will be written in Phase B|phase-a-complete) -->$' {target_path}`

The two sentinela strings are the **canonical literals** referenced from every phase file. Phase A (`phase-a.md` § A3) writes them; Phase A4.6 adds `<!-- phase-a-complete -->` (Phase A4.5 may inject `<!-- {rule-id}-pending -->` — canonical: `<!-- ccr-pending -->` — before A4.6 runs, when any rule from `docs/rules/plan-build/` aborts); Phase B (`phase-b.md` § B4-B6) consumes them. Any change to these literals must update Gate 10 AND every phase file together (validator flags inconsistency).

Resume to Phase B **only when both lines match**:
- `<!-- SIs will be written in Phase B -->` — confirms Phase B has not started writing SIs (B4 replaces this on the first SI).
- `<!-- phase-a-complete -->` — confirms Phase A finished cleanly (A4.6 writes this as A's last action, after A4.5's custom-rule dispatch passes without aborts). If Phase A errored mid-A4 OR a rule from `docs/rules/plan-build/` aborted in A4.5, this line is absent → not a valid resume state.

Branches:

- `{target_path}` does not exist → fresh Phase A (case 1).
- Both sentinelas present → skip Phase A; proceed to Phase B (resume case 2; Edit existing file, replacing sentinelas).
- Only `<!-- SIs will be written in Phase B -->` present (no `<!-- phase-a-complete -->`) → Phase A errored mid-A4 last run, OR a rule from `docs/rules/plan-build/` aborted with a `<!-- {rule-id}-pending -->` sentinel injected — partial Tech Specs are not trustworthy in either case (case 3); fresh Phase A (Write overwrites the half-built file, including any abort sentinel from the previous run; A4.5 then re-runs all rules against the freshly-rendered Tech Specs).
- Only `<!-- phase-a-complete -->` present (no SIs sentinela) → Phase B started and replaced the SIs sentinela (case 4); the file is mid-build but Phase B partially advanced. Fresh Phase A (Write overwrites).
- Neither sentinela present → file is a completed prior artifact (case 5); route to **Append-mode** (Phase C) by default, OR fresh Phase A when the user passed the `--rebuild` flag.

No `AskUserQuestion`, no parsing of frontmatter, no extra staleness check (staleness of `context.md` is covered by Gates 1–9 via `validation.md`).

---

## Phase dispatch

After Gate 10 determines the routing branch, Read the corresponding companion file before executing its procedure. The harness loads only `SKILL.md` at invocation; companion files are loaded on-demand at dispatch.

| Gate 10 outcome | Read | Then execute |
|---|---|---|
| Fresh Phase A (case 1) | `.claude/skills/plan-build/phase-a.md` | Phase A procedure (A1-A5) |
| Resume Phase B (case 2) | `.claude/skills/plan-build/phase-b.md` | Phase B procedure (B1-B7) |
| Fresh Phase A (cases 3-4 — partial-artifact recovery) | `.claude/skills/plan-build/phase-a.md` | Phase A procedure (Write overwrites the half-built file) |
| Append-mode (case 5, default) | `.claude/skills/plan-build/phase-c.md` | Phase C procedure (C1-C7) |
| Fresh Phase A (case 5 with `--rebuild`) | `.claude/skills/plan-build/phase-a.md` | Phase A procedure as fresh build |

**Same-session A→B continuation.** When the user picks "Continue now" at the A5 pause, Read `.claude/skills/plan-build/phase-b.md` before executing B1. The companion file is not auto-loaded by the harness — every cross-file procedure step requires an explicit Read. Phase B's B1 step is a no-op in this same-session continuation path (working memory from Phase A carries over).

---

## Output contract

Each phase file emits one of these terminal messages. The literal templates live here so every phase emits the same shape.

### Phase A pause (user picked "Stop here")

```
PHASE A DONE. Wrote scaffold + Technical Specifications ({comma-separated subsection names, or "none"}) for {phase NN | task {slug}}. Sentinelas in place: <!-- phase-a-complete --> + <!-- SIs will be written in Phase B --> + Dep Map / Deliverables. Next: rerun /plan-build {identifier} when ready (Gate 10 will detect both required sentinelas and skip straight to Phase B).
```

### Successful completion (Phase B7 or Phase C7)

Phase B7:

```
DONE. Wrote {N} SIs ({SI-NN.1, SI-NN.2, ...}). Technical Specifications: {comma-separated subsection names, or "none"}. Dependency Map + Deliverables written. Next: run /implement {identifier} to execute the plan SI-by-SI.
```

**Modern-mode hint (B7) — emit conditionally.** When the plan frontmatter declares `test_specs_aware: true` AND at least one SI carries a `**Test Specs:** _pending` placeholder, replace the legacy "Next:" line with a `/plan-test-specs` hint emitted before the `/implement` invocation:

```
DONE. Wrote {N} SIs ({SI-NN.1, SI-NN.2, ...}). Technical Specifications: {...}. Dependency Map + Deliverables written. Next: run /plan-test-specs {identifier} to author spec files for screen-wiring/controller/cross-layer SIs (look for `**Test Specs:** _pending /plan-test-specs_` placeholders), then /implement {identifier}.
```

Without this hint a fresh build of a modern phase routes the user straight to `/implement`, which then aborts with "PENDING TEST SPECS: Run /plan-test-specs <slug> first." — unnecessary round-trip. Modern phases backend-pure (zero placeholders) should NOT receive the hint — it would point at a `/plan-test-specs` invocation that no-ops. Detection algorithm (compound):

```bash
TEST_SPECS_AWARE=$(awk '/^---$/{f=!f;next} f' "$PLAN" | grep -c "^test_specs_aware: true$" || echo 0)
PENDING=$(grep -c "^\*\*Test Specs:\*\* _pending" "$PLAN" || echo 0)
# Emit modern hint só quando modern AND placeholders exist
[ "$TEST_SPECS_AWARE" -gt 0 ] && [ "$PENDING" -gt 0 ] && emit_modern_hint || emit_legacy_hint
```

Modern plan SEM placeholders (fase backend pura) cai no fallback legacy "Next: run /implement" — evita o no-op `/plan-test-specs`. Plans em modo legacy (frontmatter sem `test_specs_aware: true`) também caem no fallback, mantendo a shape original byte-by-byte.

Phase C7 (append-mode):

```
DONE (append-mode). Processed {N} delta events: {summary list — Edit cirúrgica on SI-X.Y / Append amendment SI-N.M / Append new behavior SI-N.M / Annotate superseded SI-X.Y}. sources_mtime refreshed; progress.md updated for new SIs. Next: run /implement <new-SI> to execute the appended work (only when amendment / new-behavior SIs were created).
```

**Modern-mode hint (C7) — emit conditionally.** When the plan declares `test_specs_aware: true` AND **either** new placeholders exist (PENDING > 0) **or** any spec already lives in `<subproject>/specs/` (EXISTING_SPECS > 0), replace the legacy "Next:" line with a `/plan-test-specs` hint:

```
DONE (append-mode). Processed {N} delta events: ... sources_mtime refreshed; progress.md updated for new SIs. Next: run /plan-test-specs <slug> to re-stamp Last sync of PRESERVED specs and author specs for any new screen-wiring/controller/cross-layer SIs, then /implement <new-SI>.
```

C7 extends the B7 algorithm with `EXISTING_SPECS` because Phase C5 refreshes `sources_mtime` on the plan — that bumps the plan's mtime above every PRESERVED spec's `Last sync`, so even when no new placeholder was appended, existing specs need a re-stamp pass to satisfy `/implement`'s preflight (otherwise it falsely aborts STALE). Detection algorithm (compound):

```bash
TEST_SPECS_AWARE=$(awk '/^---$/{f=!f;next} f' "$PLAN" | grep -c "^test_specs_aware: true$" || echo 0)
PENDING=$(grep -c "^\*\*Test Specs:\*\* _pending" "$PLAN" || echo 0)
# Scan every subproject's `specs/` directory at once via path glob — works for any subproject layout
# (specs live at `<subproject>/specs/*.plan.md` by convention; see plan-test-specs/SKILL.md § "Resolve spec path(s)")
EXISTING_SPECS=$(find . -path '*/specs/*.plan.md' -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | wc -l)
# Emit C7 modern hint quando modern AND (novos placeholders OU specs existentes)
[ "$TEST_SPECS_AWARE" -gt 0 ] && { [ "$PENDING" -gt 0 ] || [ "$EXISTING_SPECS" -gt 0 ]; } && emit_modern_hint || emit_legacy_hint
```

In legacy mode OR modern without placeholders AND without existing specs, the hint is omitted — output keeps its original shape byte-by-byte. Hard rules below are unchanged: `test_specs_aware` is owned by `phase-a.md` (frontmatter emission rule), not by dispatch logic of this SKILL.md.

### Failure at any step

```
FAILED at {step-label}. Written so far: {state — "none" | "scaffold + Technical Specifications" | list of SIs already appended}. Error: {one-sentence reason}. Next: {canonical next-command — default "rerun /plan-build <arg> to redo from scratch"; substitute a specific stage command when the failure is due to an upstream precondition that must be fixed first (e.g., missing library in library-refs.md → "run /plan-resolve <arg> to backfill the library cache before retrying /plan-build <arg>")}.
```

Valid step-labels: `input-parse`, `step-1-decompose`, `step-1-coverage`, `step-2-scaffold`, `step-3-si-{N}`, `step-4-specs`, `step-4-{rule-id}` (per-rule label emitted by custom rules that abort at A4.5; `{rule-id}` is declared in the rule body and matches the IC prefix lowercased), `step-5-depmap`, `step-5-deliverables`. Phase C aborts use natural-language messages (the matrix in phase-c.md § "When append-mode runs", the empty-deltas abort in C1, and the user-cancel from C3) rather than the structured `FAILED at` format — they are not internal procedural errors but user-facing decisions.

No prose preamble. No closing summary. No "Done." line beyond the structured report.

---

## Hard rules

These invariants apply across every phase. They are listed here (and only here) so any future cross-cutting change has a single place to land. The phase files reference this section by name.

- **Never write the full file in a single Write call.** Incremental (scaffold → Tech Specs subsections via Edit → SI-by-SI Edits → Dep Map Edit → Deliverables Edit) is mandatory — it respects output size limits and the SI-by-SI no-lookback rule.
- **No decisions-doc reads (TDs in memory from context.md).** All TD detail is in context.md's `## Decisions Detail` (current-scope) and `## Inherited Decisions Detail` (inherited). Any reference to a TD in Technical actions uses the Recommendation prose already in memory from whichever of A1 or B1 ran.
- **Never re-read context.md within a phase by default.** Read once at A1 in Phase A. In Phase B, B1(a) reads context.md only on new-session resume (same-session continuation skips B1 entirely — the content is in the message log). Re-reads are the on-demand fallback documented at the end of Phase B § B1 — fire only when working memory recall fails.
- **Phase B Technical actions must align with Phase A Tech Specs.** Tech Specs become available to Phase B either through the message log (same-session continuation, from the A4 Edit arguments) or through B1(b) (new-session resume, bounded read of `## Technical Specifications` from `{target_path}`). Either way, B2 and B4 consume those normalized specs (Data Model field names, API Contracts shapes, Authorization Matrix rows, Error Catalog codes, UI Contracts per screen). Do not re-derive these from raw TD prose in Phase B — the only canonical surface is what Phase A wrote.
- **Never re-read already-written SIs.** After Edit appends an SI block to the file, do not Read it back. Grep headers only if a cross-ref is needed (`Grep -n '^### SI-' {target_path}`).
- **Do not invent TDs or conventions.** Every citation must be sourced from context.md — `## Decisions Index`, `## Decisions Detail`, `## Inherited Decisions Detail`, or `## Inherited Conventions`.
- **Do not emit prose outside the template.** The artifact has a fixed shape; no meta-commentary, no "Notes for the implementer" sections beyond what the template provides.
- **No Agent dispatch in /plan-build default path.** Reads of context.md, library-refs.md, and inventory bounded sections happen directly from the main thread. The skill may call `Skill` (e.g., `context7` MCP tool) or `AskUserQuestion` (the A5 pause, Phase C diff preview) — both are main-thread tool calls, not subagent dispatches.
- **Aborts replace writes (per Gate 10).** Gate 10 requires both `<!-- SIs will be written in Phase B -->` AND `<!-- phase-a-complete -->` to enter the resume branch. The 5 abort outcomes:
  - Abort before A3 → no file exists. Next `/plan-build <arg>` runs fresh Phase A.
  - Abort mid-A4 OR mid-A4.5 (some Tech Specs subsections written, optionally a `<!-- {rule-id}-pending -->` sentinel from a `docs/rules/plan-build/` rule abort, A4.6 didn't run, phase-a-complete absent) → next run sees only the SIs sentinela; routes to fresh Phase A; Write in A3 overwrites the half-built file (including any custom-rule sentinel). Partial Tech Specs are discarded — never read by Phase B; A4.5 re-runs all rules against the freshly-rendered Tech Specs.
  - Abort exactly between A4.6 and A5 (both required sentinelas present, A5 pause never dispatched) → next run treats it as the canonical resume state and proceeds to Phase B. Equivalent to user picking "Stop here" in A5.
  - Abort mid-Phase B between B4 SI Edits (SIs sentinela already replaced, phase-a-complete still present) → next run sees only phase-a-complete; routes to fresh Phase A; Write overwrites.
  - Abort after B7 success (all sentinelas removed) → next run sees neither; routes to **Phase C (append-mode)** by default (or fresh Phase A under `--rebuild`).
  In all cases the user does not need to `rm` anything; just rerun.
- **Inventory file reads are bounded per-screen.** Never Read the full inventory file; always grep for screen section boundaries first (Phase A § A4 step c).
- **`ui_in_scope: deferred` state.** UI Contracts and UI ↔ API Traceability Matrix subsections are NOT emitted when `ui_in_scope == deferred`. The artifact is valid without them — deferred UI is an explicit user decision documented in `## Non-UI / Deferred Capabilities`. Phase B's `templates/screen-si.md` is also not read in this state.
- **TD Scope filter from A2 is mandatory in A4.** TDs with `Scope: Repo-wide` are never rendered in any runtime subsection (Phase A § A2).
- **Sentinela canonical source.** The literal forms `<!-- SIs will be written in Phase B -->`, `<!-- phase-a-complete -->`, and `<!-- {rule-id}-pending -->` (canonical: `<!-- ccr-pending -->`; future abort-capable rules in `docs/rules/plan-build/` declare their own unique `{rule-id}` in their body) are defined in Gate 10 above. Phase A writes them; Phase B consumes the first two; Gate 10 reads any `<!-- *-pending -->` generically. Never paraphrase. Validator flags drift between Gate 10 and any phase file's Edit anchors or rule MD body.

### Append-mode hard rules (Phase C)

These extend the rules above with append-mode-specific invariants:

- **Never renumber existing SIs.** New SIs always extend the numbering forward; existing SI numbers are immutable.
- **Never modify executed SIs (status `completed` in progress.md).** Always append a new amendment SI instead.
- **Diff preview is mandatory.** No Edit fires without C3 confirmation (the AskUserQuestion summarizing all proposed changes). The fail-safe is "user said cancelar".
- **`sources_mtime` refresh is mandatory** (Phase C § C5). Skipping it makes the next run replay the same deltas.
- **`progress.md` must exist for append.** Ausência aborta com mensagem explícita — see Phase C § "When append-mode runs" matrix.
- **`--rebuild` flag is the escape hatch.** When the user wants legacy overwrite behavior, the flag bypasses Phase C entirely and falls back to fresh Phase A (Rerun semantics case 5 override).

---

## Rerun semantics

Cases (Gate 10 dispatches):

1. **`/plan-build NN` with no existing artifact** → fresh Phase A (Write scaffold + Tech Specs + sentinelas + phase-a-complete), pause at A5.
2. **`/plan-build NN` with both required sentinelas present** (`<!-- SIs will be written in Phase B -->` AND `<!-- phase-a-complete -->`) → Gate 10 skips Phase A, enters Phase B directly (resume case). B1 reloads context.md and bounded-reads Tech Specs.
3. **`/plan-build NN` with only the SIs sentinela** (no phase-a-complete) → Phase A errored mid-A4 in a prior run, OR a rule from `docs/rules/plan-build/` aborted in A4.5 with a `<!-- {rule-id}-pending -->` sentinel injected. Partial Tech Specs (and any custom-rule abort sentinel) are not trustworthy. Fresh Phase A overwrites.
4. **`/plan-build NN` with only phase-a-complete** (no SIs sentinela) → Phase B started and replaced the SIs sentinela in a prior run, then errored. Fresh Phase A overwrites.
5. **`/plan-build NN` with a fully-completed artifact (no sentinelas)** → **route to Append-mode** (Phase C) by default. To force a fresh full rebuild instead, pass the explicit `--rebuild` flag (`/plan-build NN --rebuild`) and the dispatcher falls back to fresh Phase A (the legacy "idempotent overwrite" semantics).

The skill keeps no state across runs; every invocation starts from the preflight gates. Stability across reruns comes from the upstream artifacts (context.md, library-refs.md, decisions docs) being stable — not from the final artifact itself.
