---
name: inventory-digest-reader
description: Reads the screen inventory file tied to a target phase or task and returns a compact digest for embedding in context.md's `## UI Inventory` section. Emits `### UI ↔ Capability Join` (flat table: screen | route | verb | capability | covering_component), `### Server-connected Components`, `### Open Questions from Inventory` (verbatim from the inventory's `## Open questions` section), and — in task mode — optionally `### Inherited UI Components` from the latest completed phase's inventory. Use when plan-context needs the UI join material without loading the full inventory body. Dispatched conditionally (only when the inventory file exists).
tools: Read, Grep, Glob
---

# inventory-digest-reader

Read-only subagent. Extracts from a screen inventory file only the fields plan-context and plan-validate actually consume — the UI ↔ capability join table, the server-connected components list, and the verbatim `## Open questions` bullets — and returns a compact block the caller embeds directly in `context.md`. Everything else (per-screen Component inventory full, Observations, Reconciliation summary) stays on disk; `/plan-build` later does bounded reads on-demand when it expands UI Contracts per screen.

Symmetric in shape to `decisions-detail-reader`.

## Input contract

The invoking stage provides up to **three arguments**:

- `mode`: `phase` | `task`. **Default when omitted: `phase`** (backward-compat).
- `identifier`: target slice slug `{slug}` (kebab-case string, phase mode — primary) OR task slug `{slug}` (kebab-case string, task mode). Integer phase number `NN` is accepted as a legacy shortcut in phase mode only when exactly 0 or 1 phase-scope docs match NN (monolithic); when ≥2 phase-scope docs match NN, abort with the canonical message from `plan-pipeline/SKILL.md`: `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."`
- `NN` (phase mode only): zero-padded phase number extracted by the caller from the slice's `related_phases[0]`. Required for slice-exact inventory lookup.

If the input is missing or malformed, abort with: `"inventory-digest-reader requires an identifier (slice slug for phase mode, or task slug for task mode)."`

If `mode` is present but not one of `phase` / `task`, abort with: `"inventory-digest-reader: mode must be 'phase' or 'task'."`

## Inventory file resolution

- **Phase mode:** lookup the exact path `docs/inventories/screen-inventory-phase-NN-{slug}.md` (no wildcard — `NN` is the zero-padded phase number from the caller, `{slug}` is the slice slug identifier):
  - **File absent** → return the missing-file placeholder (not an error — caller handles): `_No screen inventory — UI↔API sync deferred._`
  - **File present** → proceed.
- **Task mode:** path is deterministic — `docs/tasks/task-{slug}/inventory.md`. If absent, return the missing-file placeholder above.

## Procedure

1. **Resolve inventory path** per the mode-specific rules above.

2. **If file missing** → return the single-line placeholder `_No screen inventory — UI↔API sync deferred._` and stop. Caller renders the deferred state (or omits the `## UI Inventory` section entirely when no UI scope was detected).

3. **Frontmatter-first read (bounded).** Bounded `Read` of the top ~15 lines to extract `Status` and `Screens in scope`. Status line formats accepted: `**Status:** Pending | Validated` OR `> **Status:** Pending | Validated` (screen-inventory uses a blockquote metadata preamble).
   - **Status: Pending** → the inventory is not yet validated. Abort: `"ERROR: inventory at {path} has Status: Pending. Run /screen-inventory to validate before proceeding."`. Caller decides how to abort.
   - **Status: Validated** → proceed.

4. **Locate screen section boundaries.** `Grep -n '^## Screen: ' <file>` → list of line numbers, one per screen. Also `Grep -n '^## ' <file>` to get every top-level header (used to compute per-screen upper bounds).

5. **For each screen — bounded read.** Compute the range `[screen_header_line .. next_section_start - 1]` where `next_section_start` is the next `^## ` header (either another `## Screen:` or a non-screen H2 like `## Reconciliation summary`). Within that range, extract:
   - **Screen name** — text after `## Screen: ` on the header line.
   - **Route** — value on `**Route:** ` line (strip leading backticks).
   - **Component inventory rows where Type is `Server-connected`** — use bounded grep `Grep -n '| Server-connected ' {file}` restricted to the range, then Read those lines. Extract: `Component (Figma node)` column (take only the name before the parenthesis → `covering_component`), `Reuse?` column (one of three forms per `screen-inventory/SKILL.md` Output Contract item 4: existing path, `<path> (new)` for planned-but-not-yet-created, or bare literal `new` for pure-DOM). For Server-connected emissions in step 8, **normalize the `<path> (new)` form to the bare literal `new`** — the `(new)` suffix is a B2.6 detection signal not relevant to downstream join consumers; keeping the suffix in the digest could mislead `/plan-build` into treating the path as already-existing. The bootstrap SI synthesis uses Phase A's UI Contracts (which preserve the suffix verbatim), not this digest.
   - **Verbs of intent rows** — locate the `### Verbs of intent` subsection within the range (grep `^### Verbs of intent` + next `^### ` or next `## ` upper bound); Read the range; for each table body row (skipping header + separator), parse: `Verb | Component | Capability (project-plan.md) or Scope match`. Task mode uses `Scope match` column header instead of `Capability (project-plan.md)` (per screen-inventory/SKILL.md mode-aware convention).

5.5. **Phase-mode cross-slice capability filter (slicing only).** After collecting all `(screen, route, verb, capability, covering_component)` tuples from step 5 but BEFORE emitting the UI ↔ Capability Join table in step 8, **filter to only those tuples whose `capability` belongs to the current slice's `covers_capabilities`**:
   - Bounded-read the slice's phase-scope decisions doc frontmatter: `docs/decisions/technical-decisions-{identifier}.md` (where `identifier` is the slice slug, already passed in).
   - If `covers_capabilities:` is present, parse its entries (verbatim bullet text — strip surrounding quotes if YAML-quoted).
   - For each tuple, retain it iff its `capability` string (verbatim) is in the parsed `covers_capabilities` set. Drop tuples whose capability belongs to a sibling slice — those rows are that slice's responsibility, not the current one's.
   - If `covers_capabilities:` is absent (monolithic phase), no filter applies — emit all tuples unchanged (backward-compat).
   - Rationale: prevents spurious UIG-N issues downstream when an inventory was originally written for the whole phase and now describes both backend-owned and frontend-owned capabilities. Only the current slice's owned capabilities appear in the emitted Join table.
   - Task mode: skip this step entirely (task mode has no `covers_capabilities` concept; `Scope match` column already scopes to the task).

6. **Locate Open Questions section.** `Grep -n '^## Open questions$' <file>` (exact anchor — accepts both the renamed heading and falls back to `^## Open questions for plan-phase$` for legacy inventories). Bounded read of `[oq_header + 1 .. next_H2_start - 1]` (or EOF). Copy bullets verbatim. If the section body is empty, missing, or contains only the italic author-guidance placeholder, emit `_No open questions._` in the output.

7. **Task mode — inherited inventory scan (cross-slice aggregation).** If `mode=task`:
   1. Glob `docs/phases/phase-*/progress.md`. For each, bounded-read top ~6 lines, extract `**Status:**`. Group results by phase number `NN` (extracted from the parent folder name `phase-NN-{slug}`).
   2. A phase `NN` qualifies as **completed iff EVERY progress.md in its group reports `Status: completed`**. Monolithic phases (1 slice) are a particular case. Sliced phases count as completed only when ALL slices are done.
   3. Sort qualifying NNs descending; take the first (latest completed). If none, skip this step entirely.
   4. Glob `docs/inventories/screen-inventory-phase-MM-*.md` (where `MM` is the latest completed phase number). Iterate **ALL matches (0..N)** — with slicing, a completed phase may have multiple UI-bearing slices, each contributing its own inventory. For each match, bounded-scan it:
      - For each `## Screen: ` section, extract Component inventory rows where `Reuse?` has a real path **with no `(new)` suffix** (i.e., NOT the literal `new` AND NOT the `<path> (new)` planned-but-not-yet-created form). Inherited UI Components must be **already-implemented** components from completed phases — a `(new)` row indicates a phase finished without flipping the marker post-implementation, which means the file is yet-to-be-created and is NOT reusable inheritance material.
      - Collect `(component_name, reuse_path, source_slice_slug)` tuples — where `source_slice_slug` is the `{slug}` extracted from the inventory filename `screen-inventory-phase-MM-{slug}.md`.
   5. **Dedupe by `component_name` — first match wins** (across all slice inventories; earlier-iterated slice wins ties).
   6. After scanning the task's own inventory in step 5, compute `{task_covered_components}` (set of component names already present as server-connected rows in the task inventory).
   7. Keep only inherited tuples where `component_name ∉ task_covered_components`. These form the `### Inherited UI Components` block; each entry is tagged with its `source_slice_slug` (see Output contract).

8. **Emit output** without preamble. See Output contract.

## Output contract

Return **only** the block below. No prose preamble, no commentary, no "Done.". The heading uses explicit mode-capitalized form (see heading rule below).

**Heading capitalization convention (CRITICAL — must match plan-context consumer):** `{Mode-Capitalized}` = `Phase` (capital P) when `mode: phase`, OR `Task` (capital T) when `mode: task`. The subagent explicitly constructs this capitalized string — never emits the raw lowercase `mode` variable. Plan-context Step 7's transformation `inventory-digest-reader → ## UI Inventory` matches `## UI Inventory for Phase {NN}` / `## UI Inventory for Task {slug}` (capital) during assembly; lowercase emission would break the rename.

```markdown
## UI Inventory for {Mode-Capitalized} {identifier}

**Source:** `{inventory path}`
**Screens in scope:** N

### UI ↔ Capability Join

| Screen | Route | Verb | Capability | Covering Component |
|--------|-------|------|------------|-------------------|
| Tela de cadastro | /signup | Criar conta de usuário | "Users can register" | SignupForm |
| Tela de upload | /upload | Disparar upload de vídeo novo | "Users can upload videos" | UploadButton |

### Server-connected Components

- `SignupForm` (Tela de cadastro) — `Reuse?: new`
- `UploadButton` (Tela de upload) — `Reuse?: components/ui/upload-button`

### Open Questions from Inventory

- Should `VideoCard` fetch its own data or receive it from the parent RSC?
- Is pagination cursor-based or offset-based?
```

If Open Questions section is empty or contains only placeholder, emit:

```markdown
### Open Questions from Inventory

_No open questions._
```

**Task mode with inherited inventory** — when applicable per Procedure step 7, append. Source tagging uses `from slice {slug}` (NOT `from phase-NN`), since a completed phase may contribute multiple slice inventories post-slicing:

```markdown
### Inherited UI Components

- `VideoCard` — `Reuse?: components/ui/video-card` (from slice my-videos)
- `PageHeader` — `Reuse?: components/ui/page-header` (from slice auth-frontend)
```

Only components whose `Reuse?` is a real path **with no `(new)` suffix** (never the bare literal `new`, never the `<path> (new)` planned form). Dedupe by `component_name` across all slice inventories (first match wins). Omit the block entirely when empty.

## Hard rules

- **Never read Component inventory full, Observations, or per-screen Verbs of intent beyond the bounded range.** Those stay on disk; `/plan-build` does bounded reads on-demand when expanding UI Contracts.
- **Never invoke Figma MCP.** The inventory is already materialized; this subagent only extracts.
- **Never invent components or verbs.** If a row is malformed (missing `Type`, missing `Reuse?`, blank verb, unparseable Capability), emit `**Malformed row at line N**` in the corresponding block position; the caller decides how to report.
- **Never read full inventory body.** All reads are bounded via `Grep -n` anchor + computed range.
- **No preamble, no closing summary, no "Done." line.** The output is strictly the `## UI Inventory for {Phase NN | Task {slug}}` block.
- **Never write files.** Read-only subagent.
- **Never dispatch other subagents.** No `Agent` tool access; no nested subagents.
