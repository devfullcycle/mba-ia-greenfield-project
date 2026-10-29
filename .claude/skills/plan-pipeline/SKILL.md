---
name: plan-pipeline
description: "Entry point and shared conventions for the plan pipeline (phase and task modes). Invoke directly when the user asks about planning without specifying a stage — this skill orients them to the pipeline stages (context → validate → resolve → build → specs [optional]). For actual work, use the stage skills: plan-context, plan-validate, plan-resolve, plan-build, plan-test-specs."
disable-model-invocation: true
---

# Plan Pipeline Overview

Planning is a pipeline of up to **five stages** that works for both project phases and ad-hoc tasks. Each stage is a separate skill with one responsibility and one artifact. Stages 1-4 (context → validate → resolve → build) are the canonical happy path; Stage 5 (`/plan-test-specs`) is optional and only fires when the build emitted spec placeholders. The stages share the conventions defined below — every stage skill references this document instead of repeating them.

```
/research [opcional em task mode]       → docs/decisions/technical-decisions-{slug}.md
/plan-context <NN | slug | "prose">     → docs/{phases|tasks}/{dir}/context.md
/plan-validate <NN | slug>              → docs/{phases|tasks}/{dir}/validation.md
/plan-resolve <NN | slug>               → edits decisions doc + context.md + validation.md + library-refs.md
/plan-validate <NN | slug>              → re-run until status: clean
/plan-build <NN | slug>                 → docs/{phases|tasks}/{dir}/{name}.md
/plan-test-specs <NN | slug>                 → <subproject>/specs/<scenario>.plan.md
```

When the user asks generically to "plan phase NN" or "plan this task", direct them to `/plan-context <arg>` first. Each stage aborts with an explicit next-command when a precondition is missing, so the pipeline self-guides once started.

**Alternative front-door — `/decide`.** When the user input is a free-text need rather than a structured pipeline argument (e.g., "quero mudar X", "tem decisão sobre Y?"), route them to `/decide "<need>"` instead. `/decide` triages against existing `docs/decisions/*.md`, then either applies an inline Revision OR directs the user back to `/research` (Supersede / Greenfield) or to specific pipeline stages via its impact report. The pipeline stages above are the right entry when the input is already shape-matched (phase NN, slice slug, task slug); `/decide` is the right entry when shape detection is the user's question.

**`/plan-build` append-mode.** When `/plan-build <scope>` is invoked and a plan file already exists in the scope dir, the skill defaults to **append-mode** (incremental delta processing — see `plan-build/SKILL.md` § "Phase C — Append-mode"). To force the legacy fresh-rebuild behavior, pass `--rebuild`. Append-mode requires `progress.md` to exist (created automatically on first build).

## Mode detection

Every stage skill detects the mode from the argument format. Phase slicing means ≥2 `scope_type: phase` decisions docs may exist for the same `NN`; the integer shortcut still works but now aborts when ambiguous, and **slug is the pipeline's primary key** (Decisão 2.3).

- **Integer arg `NN`** → **phase mode shortcut** — see "Slug discovery → Phase mode integer arg" below for the resolution algorithm.
- **String arg `{slug}`** → **unified slug lookup**. Resolve via `docs/decisions/technical-decisions-{slug}.md`:
  - Exists with `scope_type: phase` → **phase mode** (slice). Extract `NN` from `related_phases[0]`; target dir is `docs/phases/phase-NN-{slug}/`.
  - Exists with `scope_type: ad-hoc` AND `docs/tasks/task-{slug}/` exists → **task mode**.
  - Doc does not exist → **task mode bootstrap** (treat arg as slug if it matches `^[a-z0-9-]+$`; otherwise treat as prose and auto-derive a slug, kebab-case, max 40 chars, confirming with the user before creating `docs/tasks/task-{slug}/`).

**Canonical abort messages** (downstream skills MUST use these verbatim so the same condition produces the same message everywhere):

- **0-match (integer arg):** `"Run /research phase NN first"`
- **≥2-match (integer arg):** `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."`

Phase and task modes share every artifact shape (`context.md`, `validation.md`, `library-refs.md`, `{name}.md`, `progress.md`), differing only in sources of input, one section (`## Capability Coverage` — phase-only), and a few validate checks. Only `plan-context` in task mode may bootstrap the `docs/tasks/task-{slug}/` directory; all later stages assume it already exists.

## Stage responsibilities (one-line each)

- **plan-context** — consolidates sources (project-plan, decisions docs tied to the phase, prior phases, testing guide) into a lean `context.md`. Pure consolidator; **does not detect issues**; aborts on hard violations (missing/duplicate phase-scope doc).
- **plan-validate** — reads `context.md` + the decisions doc, regenerates `validation.md` with issues by category and a `status: clean|dirty` verdict.
- **plan-resolve** — reads `validation.md`, asks the user (batched), applies decisions to the decisions doc + patches `context.md` + marks issues resolved. Writes `library-refs.md` when a new library is decided.
- **plan-build** — reads `context.md` (lean) and `library-refs.md`, emits the final `phase-NN-{slug}.md` artifact. Hard-blocks when validation.md is not `clean`.
- **plan-test-specs** — *(optional, post-build)* reads the plan artifact, derives `<subproject>/specs/<scenario>.plan.md` files for screen-wiring / controller-wiring / cross-layer SIs (in Microsoft spec-driven format). Frontend specs are consumed by `/implement` Step 3a (which loads the `playwright-cli` Skill for Playwright pattern reference, then LLM-authors the `.spec.ts`); backend specs guide LLM-authoring of E2E tests using the backend subproject's testing conventions (no external Skill load at 3a — the `testing-guide-{subproject}` Skill loaded earlier at Step 2 informs what-to-test and best practices per artifact). Skippable when the plan is legacy (no `test_specs_aware: true` frontmatter) or has no SI carrying `**Test Specs:**` field.

## Stage 5 — Test Specs (optional)

Stage 5 is **opt-in** and runs only when the plan satisfies all three triggers:

1. The plan file already exists in the scope dir (Stages 1-4 ran).
2. The plan frontmatter declares `test_specs_aware: true` (modern build — emitted by `plan-build/phase-a.md` post-migration).
3. At least one SI carries a `**Test Specs:**` field (i.e. the plan has screen-wiring / controller-wiring / cross-layer SIs that warrant external scenario authoring).

When any trigger fails the skill exits with an actionable message — see `plan-test-specs/SKILL.md` § "Preflight" for the full decision table. Backend-pure phases without server-connected UI legitimately skip this stage; legacy plans (built before this migration) skip it indefinitely without forcing migration.

`/plan-test-specs` is also the **canonical re-stamp pass** after `/plan-build` append-mode (Phase C). C5 refreshes `sources_mtime` on the plan, which makes `mtime(plan) > Last sync(spec)` for every PRESERVED scenario; running `/plan-test-specs` re-stamps `Last sync` per scenario so `/implement`'s preflight does not falsely abort STALE. See `plan-test-specs/SKILL.md` § "Lifecycle states" for details.

## Directory layout

```
docs/
├── project-plan.md                          # source for phase capabilities
├── decisions/
│   └── technical-decisions-{slug}.md        # owned by research; mutated by resolve
├── inventories/
│   ├── screen-inventory-phase-NN-{slug}.md           # owned by screen-inventory; read-only to plan-*
│   └── screen-inventory-phase-NN-{slug}.progress.md  # owned by screen-inventory
├── phases/
│   ├── phase-NN-{slug-a}/                  # slice A of phase NN (≥1 per NN; slicing model)
│   │   ├── context.md                       # owned by plan-context
│   │   ├── validation.md                    # owned by plan-validate
│   │   ├── library-refs.md                  # owned by plan-resolve (optional)
│   │   ├── progress.md                      # owned by implement (optional)
│   │   └── phase-NN-{slug-a}.md             # owned by plan-build
│   └── phase-NN-{slug-b}/                  # additional slices (optional — monolithic phases have 1)
└── tasks/
    └── task-{slug}/
        ├── context.md                       # owned by plan-context
        ├── validation.md                    # owned by plan-validate
        ├── library-refs.md                  # owned by plan-resolve (optional)
        ├── inventory.md                     # owned by screen-inventory (optional); read-only to plan-*
        ├── inventory.progress.md            # owned by screen-inventory (optional)
        ├── progress.md                      # owned by implement (optional)
        └── task-{slug}.md                   # owned by plan-build
```

Every artifact is **owned by exactly one stage**. Other stages may read or patch it (e.g., resolve patches context.md), but never recreate it from scratch.

## Shared convention — Slug discovery

Every stage skill needs the slug for its artifacts. Under the slicing model, **≥1 `scope_type: phase` docs may exist per `NN`** (one per slice). Discovery is **automatic** and mode-dependent:

### Phase mode integer arg `NN`

**Use atomic Grep set-arithmetic** — no per-file frontmatter iteration. Tool semantics make set computation complete by construction (Grep cannot silently skip files; it processes the entire input atomically). This is the canonical primitive used across `decisions-reader`, `decisions-detail-reader`, `plan-validate` Check 8, and `plan-build` Gate 9.5 — all of which reference back to this section.

1. `Grep -l '^scope_type: phase$' docs/decisions/technical-decisions-*.md` with `output_mode: files_with_matches` → set `S_phase` (every phase-scope decisions doc on disk).
2. `Grep -l '^related_phases:\s*\[(?:[^\]]*[,\s])?{NN}(?=[,\s\]])' docs/decisions/technical-decisions-*.md` with `output_mode: files_with_matches` (line-anchored ripgrep regex; **no `multiline` flag needed** — `^` matches line start in line-by-line mode by default; `{NN}` is the literal integer; trailing lookahead `(?=[,\s\]])` avoids consuming the closing `]`, correctly matching `[NN]` / `[..., NN]` / middle positions and rejecting `[12]` / `[21]` / `[]` for NN=2 — see `decisions-reader.md` for the test verification table). Result: set `S_NN`.
3. **Match set = `S_phase ∩ S_NN`** (intersection: phase-scope docs whose `related_phases` contains NN).
4. Match resolution:
   - **Exactly one match** → extract slug from filename `technical-decisions-{slug}.md`; target directory `docs/phases/phase-NN-{slug}/`.
   - **Zero matches** → abort with canonical message: `"Run /research phase NN first"`.
   - **Two or more matches** → abort with canonical message: `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."` (where `<list>` is the comma-separated slugs of the matching docs).

### Phase mode — slug arg (primary)

1. Read `docs/decisions/technical-decisions-{slug}.md` frontmatter.
2. Require `scope_type: phase` and a single integer in `related_phases`.
3. Extract `NN` from `related_phases[0]`; target directory `docs/phases/phase-NN-{slug}/`.

### Task mode (slug or prose)

1a. If arg matches the slug pattern `^[a-z0-9-]+$` AND `docs/decisions/technical-decisions-{arg}.md` exists with `scope_type: ad-hoc` → use that slug.
1b. If arg matches the slug pattern AND `docs/tasks/task-{arg}/` exists → use that slug.
1c. Otherwise, treat arg as prose; auto-derive slug via kebab-case, max 40 chars (strip stop words, lowercase, replace non-alphanumeric with `-`, collapse repeated dashes, trim).
1d. **Slug-collision disambiguation (Decisão #22).** If the auto-derived slug (or a slug passed literally) collides with an existing `docs/tasks/task-{slug}/` or `docs/decisions/technical-decisions-{slug}.md` whose scope does not obviously match the input, dispatch `AskUserQuestion` presenting two options: (a) reuse the existing slug; (b) create a new differentiated slug (ask the user to supply it). Resolve the collision before proceeding — no subagent dispatch and no filesystem writes happen before the user confirms.
1e. Confirm the chosen slug with the user via a simple `AskUserQuestion` before creating `docs/tasks/task-{slug}/`.
2. Target directory: `docs/tasks/task-{slug}/`.
3. Decisions doc may or may not exist (research is optional in task mode).

## Shared convention — Staleness via `sources_mtime`

Every artifact (`context.md`, `validation.md`, `library-refs.md`) carries a `sources_mtime:` dict in its frontmatter listing every upstream file it was built from, with the source's mtime at build time.

**Before any stage reads a prior artifact, it checks `sources_mtime`:**

- For each key, `stat` the file and compare mtime against the recorded value.
- If **any** source has a newer mtime than recorded → abort with:
  `"{artifact} is stale relative to {source} (recorded: X, current: Y). Run /plan-context NN to regenerate context before proceeding."`

**Never auto-regenerate.** Staleness always aborts with an explicit next-command. This keeps every regeneration user-triggered and predictable — the user's original pain was silent re-reads; this rule prevents them.

Populate `sources_mtime` by running `stat -c '%y' <file>` (or `ls -l --time=full`) when building each artifact and recording ISO-8601 timestamps.

## Shared convention — `status: clean|dirty` gate

`validation.md` frontmatter carries `status: clean | dirty`:

- `clean` — every issue in `issues:` has `status: resolved`; `## Findings` sections are empty.
- `dirty` — at least one issue is open.

`plan-build` hard-blocks on `status != clean` with:
`"validation.md has N open issues. Run /plan-resolve NN, then /plan-validate NN, then retry build."`

## Shared convention — Issue IDs

`validation.md` issues use per-section stable IDs:

| Section | ID prefix | Meaning |
|---------|-----------|---------|
| Inconsistencies | `IC-N` | Contradictions between documents |
| Ambiguities | `AMB-N` | Capability or scope described too vaguely |
| Missing Decisions | `MD-N` | Decision required but no TD exists |
| Dependency Gaps | `DG-N` | Missing prerequisite from prior phase (phase mode only) |
| Inherited Constraint Conflicts | `ICC-N` | Current-phase decision conflicts with inherited TD |
| Unresolved Open Questions | `OQ-N` | Questions surfaced by research or earlier work |
| UI Coverage Gaps | `UIG-N` | Capability has TD coverage but no covering verb in screen inventory (fires only when `## UI Inventory` is populated) |
| Missing Capability (cross-slice) | `MC-cross-N` | Phase capability not covered by any slice's `covers_capabilities`. Phase mode only, fires only when ≥2 phase-scope docs per NN. Advisory in plan-validate (does not flip status to dirty); hard-error in plan-build on last slice. |
| Capability Consistency | `CC-N` | A `covers_capabilities` entry does not match any bullet in `project-plan.md` verbatim. Phase mode only (slicing). Hard-error — flips status to dirty. Surfaced early (before cross-slice advisory) to catch typos and stale bullets. |

IDs are sequential within their section, never reused. Resolved issues keep their ID and move to `## Resolved Issues` at the end of `validation.md` with `resolved_by:` pointing to the TD (or action) that closed them.

Frontmatter mirrors this:

```yaml
status: dirty
issue_count: 1          # number of issues with status: open
issues:
  - id: AMB-1
    status: open
    summary: "<≤80-char headline>"
  - id: MD-1
    status: resolved
    summary: "<≤80-char headline>"
    resolved_by: auth/TD-11
```

## Shared convention — Abort-with-command protocol

When a stage cannot proceed, it **aborts with an explicit command the user can copy-paste**. Always of the form:

```
{one-sentence explanation of what's missing/wrong}. Run {command} {args} first.
```

Never guess, never auto-recover, never partially proceed. The pipeline is deterministic and observable — every state transition is a command, every failure points to the next one.

## Shared convention — Subagent delegation

Heavy reads (project-plan, globbing all decisions docs, scanning prior phases) are delegated to subagents in `.claude/agents/`:

- `decisions-reader` — globs and filters decisions docs; returns a structured TD index.
  - Phase mode: filter by `NN ∈ related_phases`.
  - Task mode: filter by filename match on the task's own decisions doc (if it exists).
- `decisions-detail-reader` — extracts `**Recommendation**` prose + `**Libraries**` for each decided TD; output is embedded in context.md's `## Decisions Detail` section. Same mode-aware filter as `decisions-reader`.
- `decisions-correlator` — (new) semantic filter across decisions docs by candidate pool.
  - Phase mode pool: `scope_type: ad-hoc` with `related_phases: []` (origin 3 — standalone and task research that would otherwise be invisible to phase mode).
  - Task mode pool: every decisions doc EXCEPT the task's own.
  Returns a ranked shortlist; the caller confirms inclusion via `AskUserQuestion`.
- `phases-reader` — reads prior phases; returns Conventions to Match AND Inherited TD Details AND **Inherited Deferred Capabilities** (extracted from each prior phase's context.md `## Non-UI / Deferred Capabilities` rows where `Status: deferred`).
  - Phase mode: all prior phases (NN-1, NN-2, …).
  - Task mode: the latest completed phase (NN where every `phase-NN-*/progress.md` reports `Status: completed`). Sliced phases count as completed only when ALL slices are done.
- `plan-reader` — extracts target phase + neighbors from project-plan.md. **Only dispatched in phase mode** (project-plan.md is phase-exclusive).
- `inventory-digest-reader` — reads the screen inventory file and returns a compact digest for embedding in context.md's `## UI Inventory` section (includes `### UI ↔ Capability Join`, `### Server-connected Components`, `### Open Questions from Inventory` verbatim).
  - Phase mode: slug-exact lookup at `docs/inventories/screen-inventory-phase-NN-{slug}.md` (no wildcard). Caller must pass `slug` alongside `NN`.
  - Task mode: reads `docs/tasks/task-{slug}/inventory.md`.
  - Dispatched **conditionally** — only when the inventory file exists. Absence is handled by the caller via fallback placeholder (not an error).
  - Task mode additionally consumes inventories from ALL UI-bearing slices of the latest completed phase (aggregated + deduped by component name) and emits `### Inherited UI Components` for cross-phase DS reuse.

Dispatch them **in parallel** via the `Agent` tool with `subagent_type: <name>`. Each subagent returns a compact structured response (table or YAML-like) — the main thread consolidates without loading the raw source files.

**Subagent default mode=phase (Decisão #25).** `phases-reader`, `decisions-reader`, `decisions-detail-reader`, `inventory-digest-reader` treat the absence of `mode` as `mode=phase`. Callers that never pass `mode` (legacy pre-rename dispatches, or any caller exercising phase behavior) continue to work unchanged. Task mode requires the caller to pass `mode=task` explicitly.

**When to use subagents vs direct reads:**

- Subagent — a file is large (>100 lines) OR multiple similar files need filtering OR the main thread only needs a distilled summary.
- Direct Read — a file is small enough to fit in a single bounded Read AND the main thread needs its structure (e.g., you are about to Edit it — Read is a prerequisite). `context.md` exception: read in full per stage despite size — single read beats scattered TD reads.

## Shared convention — Read strategy rules

Every stage skill applies these mandatory rules to keep the main context window small:

1. **Frontmatter-first filtering** — when globbing `docs/decisions/*.md` or `docs/phases/*/`, read only the frontmatter (top `---` block, typically ≤15 lines) first. Decide relevance from frontmatter fields (`scope_type`, `related_phases`, `status`) before reading any body content.

2. **Bounded grep via sibling-anchor** — to extract a section (a TD block, an SI block, a named subsection), use `Grep -n` to locate both the target header AND the next sibling header of the same level, then `Read` the exact line range. Never use `-A N` blindly — it over-fetches or under-fetches.

   Example: to read TD-05 from a decisions doc, grep `^### TD-0[56]` with `-n`; take the two line numbers; Read from the first to the second minus one.

3. **Structured return contracts for subagents** — every subagent prompt ends with a strict output contract: "Return ONLY a markdown table with columns X/Y/Z. No prose. No quotes longer than one line from source. Max N rows." Forces the subagent to distill, not relay.

4. **Build SI-by-SI no-lookback** — `plan-build` writes one SI at a time. After a SI is Edited into the phase file, it is not re-Read. To reference prior SIs (e.g., to build the Dependency Map), grep their headers only.

5. **Abort-fast in O(1) before heavy reads** — every stage's first actions are cheap checks: does the prerequisite artifact exist? Is slug discovery unambiguous? Are `sources_mtime` keys present and valid? Any failure aborts immediately, before dispatching subagents or reading decisions docs.

**Soft preferences (not hard rules):**

- **Resolve in two passes** — collect all `AskUserQuestion` answers first (computing `(file, old_string, new_string)` tuples in memory), then apply all Edits. Avoids partial-state failures.
- **Read budget per skill** — each stage SKILL.md is expected to complete its work within a small number of main-thread Reads (typically 1-3). Exceeding suggests the decomposition is leaking.

## Shared convention — Decisions docs scope model

Decisions docs with `scope_type: phase` MAY exist in multiples per NN (slices). Each must have a distinct slug and exactly one integer in `related_phases`. When building context for phase NN + slice `{slug}`, include:

- The phase-scope doc `{slug}` (discovered via slug resolution).
- Every `scope_type: ad-hoc` doc whose `related_phases` contains NN.
- Sibling phase-scope docs listed in this slice's `depends_on_slices` (via inheritance — see Phase slicing section).

Both phase-scope and ad-hoc docs contribute TDs to the `Decisions Index` in `context.md`. TD references use the form `{slug}/TD-NN` — the slug part disambiguates across source docs (phase-scope slices AND ad-hoc docs).

**Term — `task-sem-research`** (used across `plan-context`, `plan-validate`, `plan-resolve`, `plan-build`): a task created via `/plan-context {slug}` (or higher-level entry) **without** a prior `/research` dispatch — so `docs/decisions/technical-decisions-{slug}.md` does not exist. The pipeline detects this via the absence of the file and emits placeholder sections (e.g., `## Decisions Index` empty, `## Decisions Detail` placeholder); `plan-resolve` may resolve it inline by creating the decisions doc on the fly when the user answers an `MD-N` issue. This is a recognized branch, not an error.

## Shared convention — Phase slicing

A single logical phase in `project-plan.md` MAY be realized as multiple **slices**, each with its own phase-scope decisions doc, planning artifacts, and build output. Monolithic phases (1 slice) remain a first-class case: a phase with exactly 1 phase-scope doc behaves identically to the pre-slicing pipeline.

### Slice frontmatter fields (owned by `research/SKILL.md`)

Two optional fields on `scope_type: phase` docs drive slicing:

- **`covers_capabilities: [<bullet verbatim from project-plan.md>, ...]`** — declares which of the phase's capability bullets this slice owns. Omitted = "this slice covers all capabilities of its phase" (monolithic semantics).
- **`depends_on_slices: [<sibling-slug>, ...]`** — declares a cross-slice dependency DAG within the same NN. Omitted or `[]` = no sibling dependency.

### Maturity gate for `depends_on_slices`

When a slice `S` depends on sibling `T`, pipeline stages that inherit from `T` require `T` to be **mature**: either every TD in `T`'s decisions doc has `status: decided` OR `T`'s plan-build artifact is already on disk. Stages skip immature siblings and surface a warning (no abort) — the user decides whether to defer planning `S` until `T` stabilizes.

### Sibling-restamp sequencing (slicing migration)

When a previously-built sibling `T`'s decisions doc frontmatter is mutated (e.g., adding `covers_capabilities` during slicing migration), `T`'s `context.md` / `validation.md` / phase artifact all carry `sources_mtime` entries that become stale. **Restamp `T` BEFORE planning any dependent slice `S`**: run `/plan-context T` to refresh `T`'s `context.md` with the new mtime. Skipping this step causes `S`'s first `/plan-context S` to record a fresh stamp for `T`'s `context.md` that is then immediately invalidated when `T` is later restamped, forcing a redundant rerun of `/plan-context S`. The pipeline self-corrects (staleness detection works), but the extra rerun is avoidable by restamping siblings first.

### Phase-level coverage gate (advisory/hard split)

Across all slices of `NN`, the union of `covers_capabilities` MUST cover every bullet of the phase in `project-plan.md`. Enforcement is split:

- **`plan-validate`** — advisory (`MC-cross-N`) surfaced early on every slice; suppressed when NN has only 1 slice (monolithic — no gap by construction).
- **`plan-build`** — hard gate on the **last slice** (the slice whose build would complete all siblings). Aborts if any capability is uncovered.

See `plan-validate/SKILL.md` Check 8 (advisory) and `plan-build/SKILL.md` Gate 9.5 (hard) for the detailed algorithm.

### Sources of UI-scope detection per slice

`screen-inventory/SKILL.md` and `plan-context/SKILL.md` Step 0.5 read `covers_capabilities` (or fall back to phase bullets when omitted) to decide if a slice has UI scope. This replaces the prior phase-level `Affected subprojects` heuristic — UI-bearing status is now a per-slice concept.

## Shared convention — Artifact frontmatter format

Every **planning artifact** uses YAML frontmatter. The **authoritative shape for new outputs** is:

```yaml
kind: phase | task         # authoritative when present
name: phase-NN-{slug} | task-{slug}
sources_mtime:
  path/to/source.md: ISO-8601-timestamp
state: <transient-state-marker>   # OPTIONAL — present only while artifact is in a named transient state (see below)
```

**Reading rule — skills MUST accept BOTH legacy and new shapes (evaluated in order):**

1. `kind:` present → authoritative. `phase:` (if also present) is informative only.
2. `kind:` absent + `name:` starts with `task-` → infer `kind: task` (name prefix wins over a contradictory legacy `phase:` field, per Decisão #29).
3. `kind:` absent + `phase:` present + `name:` starts with `phase-` → infer `kind: phase`, `NN = phase`.
4. `kind:` absent + `phase:` absent + `name:` starts with `phase-` → infer `kind: phase`, parse `NN` from name.
5. Otherwise (including `name:` missing or malformed) → abort: `"Planning artifact has malformed frontmatter — needs either `kind:` + `name:` (new format) or `phase:` + `name:` (legacy)."`

**Writing rule — new outputs:**

- Always emit `kind:` + `name:`.
- **Never emit `phase:` integer** in new outputs, even in phase mode. `kind: phase` + `name: phase-NN-{slug}` carries all the information.
- Legacy artifacts pre-dating this rename keep their `phase:` integer until they are naturally regenerated (e.g., `/plan-context` rerun overwrites the file with the new shape).

**Optional `state:` field (transient-state marker) — cross-cutting convention:**

`state:` is an **ephemeral** field present in an artifact only while it is in a named transient state. Its presence in an artifact's frontmatter triggers downstream preflight checks to abort with a state-specific actionable message. When the state resolves, the field is removed on the next write. Never include `state:` in the frontmatter of a fully-valid final artifact — the field's absence is the canonical signal that the artifact is complete.

Registered values:

| Value | Owner (writes) | Readers (preflight aborts) | Meaning | Clearance |
|-------|----------------|----------------------------|---------|-----------|
| `partial-awaiting-inventory` | `plan-context` Step 0.5 option (a), task mode only | `plan-validate` Step 4.5, `plan-build` Step 3.5 | context.md was written with `## Scope` only so `screen-inventory` can read scope prose; pipeline awaiting `/screen-inventory {slug}` + `/plan-context {slug}` rerun to fully populate | Removed automatically when `/plan-context` rerun overwrites context.md end-to-end |

Parsing obligation for readers is documented in each stage's SKILL.md (the preflight step that resolves `kind:` also captures `state:` in the same bounded-frontmatter read). The preflight position of the state-marker check sits immediately after the `kind:` resolution step and before any body read, so partial artifacts are detected early with a dedicated actionable message (not masked by later "section missing" aborts).

_Stage-specific marker: `test_specs_aware: true` is emitted by `plan-build/phase-a.md` and read by `/plan-test-specs` + `/implement` preflight. It is NOT cross-cutting — it does not trigger aborts in any upstream stage and is therefore not registered in the table above. Documented at the owner site (`plan-build/phase-a.md` § "Frontmatter emission rules") rather than here._

Stage-specific fields (`status`, `issue_count`, `issues`, `libs`, …) are documented in each stage's SKILL.md. Never write content to a planning artifact without frontmatter.

Planning artifacts:

- **Phase mode (in `docs/phases/phase-NN-{slug}/`):** `context.md`, `validation.md`, `phase-NN-{slug}.md`.
- **Task mode (in `docs/tasks/task-{slug}/`):** `context.md`, `validation.md`, `task-{slug}.md`.

Both follow the minimum frontmatter shape above.

**Decisions docs** (in `docs/decisions/`) are managed by `research` and follow their own frontmatter schema — `scope_type`, `related_phases`, `status`, `date`, `scope_description` — documented in `research/SKILL.md`. They are not subject to the `kind:` / `name:` minimum above; their identity is carried by the filename slug and the `related_phases` array. This shape is **unchanged** by the task-mode generalization — `scope_type: ad-hoc` with `related_phases: []` already covered task-mode research natively (Decisão #18).

**Exception — `library-refs.md`.** This is a scope-agnostic library-docs cache owned by `plan-resolve`, not a planning artifact. It deliberately omits `kind:` / `name:` / `phase:` from its frontmatter (carrying only `libs:` + `sources_mtime:`) so the same file can be byte-copied across phase or task directories when an ad-hoc decisions doc with multiple `related_phases` introduces a shared library. Consumers of `library-refs.md` (only `plan-build`) treat it as content addressable by directory location, not by self-declared identity.

**Exception — `inventory.md` / `screen-inventory-phase-NN-*.md`.** These are owned by `screen-inventory`, not by `plan-*` stages. They carry their own frontmatter schema (`Status: Pending | Validated`, `Date`, `Screens in scope: N`) documented inside `screen-inventory/SKILL.md`. Treated as external source files from the pipeline's perspective — the `inventory-digest-reader` subagent wraps reads; no `plan-*` stage writes them.

## Conventions inherited from existing phase docs

The format of the final planning artifact — `phase-NN-{slug}.md` or `task-{slug}.md` — (Step Implementations, Technical Specifications, Dependency Map, Deliverables) is established by `docs/phases/phase-01-base-setup/phase-01-base-setup.md`. `plan-build` replicates this format regardless of mode. Cross-phase conventions (Portuguese prose + English identifiers, per-TD traceability via inline backticked refs, SI template structure, etc.) propagate through `context.md`'s `## Inherited Conventions` section: `phases-reader` extracts them from prior phases (reading each phase's `context.md`, with a fallback to a `## Conventions to Match` section in the phase doc for legacy phases that still carry one), and `plan-context` flattens them into the current phase's (or task's) `## Inherited Conventions`. Final artifacts never emit a conventions section themselves — inheritance flows through `context.md`.

When UI is in scope, the same format contract for the final artifact applies: `UI Contracts` and `UI ↔ API Traceability Matrix` subsections in Technical Specifications follow the templates under `.claude/skills/plan-build/templates/tech-specs/` (`ui-contracts.md`, `traceability-matrix.md`). Cross-phase UI conventions (component naming, reuse patterns, routing conventions) propagate through `context.md`'s `## Inherited Conventions` section like any other convention — `phases-reader` extracts them as-is.

## What lives here vs. in stage skills

- **Here (`plan-pipeline/SKILL.md`):** shared conventions referenced by all stages. Topology, directory layout, slug discovery, staleness, gating, issue IDs, read strategy, subagent dispatch, frontmatter contract.
- **In each stage skill:** responsibility of that stage, exact inputs/outputs, ordering of its internal steps, its own abort conditions, output format details.

Stage skills reference this document with phrases like *"per Slug discovery in plan-pipeline/SKILL.md"* — they do not repeat the rule.
