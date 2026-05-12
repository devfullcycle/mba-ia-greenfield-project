# Plan Pipeline — Stage 4: Build → Phase A (Scaffold + Technical Specifications)

This file is loaded by `.claude/skills/plan-build/SKILL.md` after Gate 10 dispatches a fresh build (or `--rebuild`). Read SKILL.md for preflight gates, dispatcher rules, hard rules, output contract, and rerun semantics — they apply to every phase.

Phase A writes the artifact scaffold + Technical Specifications subsections + four sentinelas, then pauses at A5 for the user to confirm continuation into Phase B.

The detected `mode`, `identifier`, `slug`, `{target_dir}`, `{target_path}`, parsed context.md frontmatter (including `state:` markers), `library_refs_required`, and `ui_in_scope` are all carried forward from SKILL.md's preflight gates — Phase A does NOT re-run those checks.

## A1. Read context.md (single full read)

Read `{target_dir}/context.md` in full. This is the only full read of context.md in the entire run. All TD information (Recommendation prose + Libraries) is carried in `## Decisions Detail` (current-scope TDs) and `## Inherited Decisions Detail` (inherited TDs), both loaded during this single read and kept in working memory through Phase A and Phase B (when both phases run in the same session).

**Kind sanity-check (defensive).** Re-confirm the `kind:` inferred in Gate 3 against the now-fully-loaded frontmatter — if they disagree (should never happen, since Gate 3 already validated), abort: `"FAILED at input-parse. Written so far: none. Error: kind mismatch between context.md frontmatter ({inferred_kind}) and target_path ({path}). Next: rerun /plan-build {identifier} after reconfirming context.md was generated for the right mode."`

**ui_in_scope cross-check.** Validate that the value computed in Gate 9 still matches a fresh `Grep -n '^## UI Inventory$' {target_dir}/context.md`. On contradiction, abort: `"FAILED at input-parse. Written so far: none. Error: ui_in_scope mismatch between input ({value}) and context.md state ({detected}). Next: rerun /plan-build <arg> to recompute."`

**Subproject CLAUDE.md reads.** For each subproject listed under `**Affected subprojects:**` in `## Scope` (excluding any listed under `**Deferred subprojects:**`), if `{subproject}/CLAUDE.md` exists, Read it in full. It is the source-of-truth for Deliverables commands and environment conventions (Docker wrappers, npm scripts, readiness checks). If the file does not exist, skip silently.

## A2. Build TD indexes filtered by Scope + Renders in marker + ui_in_scope (in memory)

When expanding Technical Specifications, `## Decisions Detail` entries are filtered by **three discriminators**: their `**Scope:**` field, their `**Renders in:**` marker (or default-by-inference when absent), and the in-memory `ui_in_scope` value computed by Gate 9. The composite filter (extending Decisão #17) maps each TD to zero or more applicable Tech Specs subsections:

- **Data Model, API Contracts, Authorization Matrix, Error Catalog** — TDs with `Scope: Backend | Cross-layer`. The `Renders in:` marker is **not consulted** for these subsections (they are backend-side; the marker only governs frontend-subsection routing).
- **UI Contracts** — TDs with `Scope: Frontend | Cross-layer` AND `Renders in: ui-contracts` (explicit) OR `Renders in:` absent AND `ui_in_scope: true` (default-by-inference when the receiving phase has populated UI digest). Emitted only when `ui_in_scope: true`.
- **Frontend Runtime** — TDs with `Scope: Frontend | Cross-layer` AND `Renders in: frontend-runtime` (explicit) OR `Renders in:` absent AND `ui_in_scope: logic-only` (default-by-inference when the receiving phase has the logic-only placeholder). Emitted only when `ui_in_scope ∈ {true, logic-only}`.
- **UI ↔ API Traceability Matrix** — uses already-emitted sections; no direct TD filter. Emitted only when `ui_in_scope: true` (per `traceability-matrix.md` template header).
- **Events/Messages** — TDs with `Scope: Backend | Cross-layer` that reference messaging (event bus, websockets, SSE, background jobs). Backend-only events use `Backend`; events visible to frontend use `Cross-layer`. The `Renders in:` marker is not consulted.

TDs with `Scope: Repo-wide` are tooling (monorepo, CI/CD, lint/format, shared TS config, Docker Compose). They inform Technical Specifications implicitly — **never rendered in any runtime subsection**. The `Renders in:` marker on a Repo-wide TD is **irrelevant** by construction (Scope filter precedes marker check). If a Repo-wide TD has runtime impact, it should have been classified as `Cross-layer` during research.

**Cross-layer + frontend-runtime — multi-rendered.** A TD with `Scope: Cross-layer` AND `Renders in: frontend-runtime` renders in **two** subsections simultaneously: `### API Contracts` (per the Cross-layer rule above — marker is irrelevant for backend subsections) AND `### Frontend Runtime` (per the marker). It does NOT render in `### UI Contracts` (the explicit marker filter excludes it). In a `ui_in_scope: true` phase, the TD appears in both subsections; in a `ui_in_scope: logic-only` phase, it still appears in both (API Contracts is independent of UI scope state). **Same TD, two locations** — each serves a different Step Implementation: backend SI reads API Contracts (HTTP shape); FE Runtime SI reads Frontend Runtime (consumption strategy — TanStack Query, Suspense, etc.). No semantic duplication: API Contracts describes the wire contract; Frontend Runtime describes how the client consumes it with the chosen architectural pattern.

**Contract gate (CXE/CCR) interaction — marker is NOT a gate.** A `Scope: Cross-layer` TD with `Renders in: frontend-runtime` that carries a `**Backend changes required:**` table **continues firing CXE check** in `/plan-validate` (CXE filter is `Scope` + presence of the table; marker is irrelevant). Likewise, **CCR check in `/plan-build` A4.5 operates only over `### API Contracts`** (versus `openapi.json`), NOT over `### Frontend Runtime` — Frontend Runtime describes consumption strategy, not HTTP contract shape, so there is nothing to reconcile against `openapi.json`. When A4.5 aborts via `<!-- ccr-pending -->` sentinel, partial Frontend Runtime subsection persists in the artifact but Gate 10 case 3 covers it — Write-overwrites in the next `/plan-build` regenerates everything from scratch. **No behavior change in the contract gate is needed.**

**Inherited Frontend Runtime TDs (multi-slice scenario).** When the current slice declares `depends_on_slices: [sibling]` AND the sibling has TDs with `Renders in: frontend-runtime` (visible via `## Inherited Decisions Detail`), those inherited TDs appear in the current slice's `### Frontend Runtime` as **a one-line reference, not as a materialized subsection**:

```
_Inherited from slice {sibling-slug}: see {sibling-slug}/TD-XX (renders in Frontend Runtime in {sibling-slug}'s plan)._
```

(One line per inherited TD.) Pattern / Setup / Aplicação / Migração / Verificação fields are **NOT** duplicated — materialization lives only in the slice that decided the TD. This matches the analogous treatment of inherited TDs in other subsections (inherited API Contracts TDs appear as a note, not as duplicated endpoint specs). SIs in the current slice may cite `## Inherited Decisions Detail → {sibling-slug}/TD-XX` in their Technical actions normally; cross-slice library propagation (Gate 7) ensures any required libraries are available locally.

**Misclassification risk (documented limitation):** a `Scope: Repo-wide` TD is silently skipped from every runtime subsection. Unlike `Scope: Frontend` orphans (caught by IC-N in `plan-validate`), Repo-wide TDs have no orphan check. Mitigation: `plan-validate` Check 1's Scope-Subsection orphan IC-N is the canonical last line of defense for Scope misclassification; if user suspects a Repo-wide TD has runtime impact, they should reopen `/research {slug}` and reclassify before `/plan-build`.

Build a per-subsection in-memory list of applicable TD refs for use in A4.

## A3. Write scaffold with sentinela placeholders

Write `{target_path}` with the full skeleton via a single `Write` call. Populate `sources_mtime` by running `stat -c '%y' <file>` via Bash for each source listed in context.md's `sources_mtime` and recording ISO-8601 timestamps.

**Frontmatter emission rules:**

- Always emit `kind:` + `name:`. Never emit `phase:` integer (even in phase mode — `kind: phase` + `name: phase-NN-{slug}` carries all the info).
- When rewriting an existing legacy artifact that had `phase:` integer, drop it — outputs never emit it.
- Always emit `test_specs_aware: true` — declaration that this build understands the spec-driven test system. Read by `/plan-test-specs` (preflight) and `/implement` (mode detection). Plans built before this migration lack the field; readers fall back to legacy mode when absent. Never emit `test_specs_aware: false` — absence is the canonical legacy signal, an explicit `false` is not a legitimate output.

**Objective derivation:**

- **Phase mode:** synthesize one sentence from `## Scope` — `Phase name`, `Deliverables`, and the `Capabilities` bullets (keep verbatim capability language where possible).
- **Task mode:** copy the `## Scope` prose from context.md verbatim as the Objective body. Do not paraphrase — the task's Objective IS its Scope prose.

Scaffold shape:

```markdown
---
kind: {phase | task}
name: {phase-NN-{slug} | task-{slug}}
test_specs_aware: true
sources_mtime:
  {target_dir}/context.md: "ISO-8601-timestamp"
  {target_dir}/library-refs.md: "ISO-8601-timestamp"  # only if present
  docs/decisions/technical-decisions-{slug}.md: "ISO-8601-timestamp"  # if exists
  # one per decisions doc listed in context.md's sources_mtime
---

# {Phase NN — {Phase Name} | {Task Title}}

## Objective

{phase mode: one-sentence summary synthesized from `## Scope`.
 task mode: the `## Scope` prose from context.md verbatim.}

---

## Step Implementations

<!-- SIs will be written in Phase B -->

---

## Technical Specifications

<!-- Tech Specs subsections will be appended below in Phase A -->

---

## Dependency Map

<!-- Dep Map will be written in Phase B -->

---

## Deliverables

<!-- Deliverables will be written in Phase B -->
```

A3 plants three sentinelas (`<!-- SIs will be written in Phase B -->`, `<!-- Dep Map will be written in Phase B -->`, `<!-- Deliverables will be written in Phase B -->`); A4.6 adds a fourth (`<!-- phase-a-complete -->`) once Phase A reaches the end. A4.5 may inject a fifth, `<!-- {rule-id}-pending -->` (canonical: `<!-- ccr-pending -->`), when any rule from `docs/rules/plan-build/` aborts — by design, the SIs sentinela is still present at that point and `<!-- phase-a-complete -->` is absent, so Gate 10 (SKILL.md) reads this state as **case 3 equivalent** ("only SIs sentinela present, no phase-a-complete") and routes the next `/plan-build` invocation through fresh Phase A1 (Write in A3 overwrites the half-built file, including the pending sentinel — A4.5 then re-runs against whatever mediation the user added in between). Zero new frontmatter fields — presence/absence of these sentinelas is the only state signal Gate 10 reads. The exact literal forms are fixed by SKILL.md § "Preflight → Gate 10" — do not paraphrase.

If `ui_in_scope == false` AND no other Tech Specs subsection applies, the `## Technical Specifications` heading is omitted entirely (drop the heading + its placeholder comment from the scaffold). This case is rare — most phases produce at least one of Data Model / API Contracts.

## A4. Append Technical Specifications subsections (only applicable ones)

Decide which spec subsections apply, then for each one in **canonical order (Decisão #14)**:

1. `### Data Model` — when entities are new/modified.
2. `### API Contracts` — when HTTP endpoints are exposed. Append `#### Validation Rules` nested at the end when validation rules are broad enough to warrant a dedicated subsection; otherwise inline under each endpoint.
3. `### Authorization Matrix` — when behavior depends on auth/roles.
4. `### Error Catalog` — when there are domain-specific error scenarios. The first HTTP-exposing phase in a subproject also defines the error response format (established at first appearance, then inherited by subsequent phases via `## Inherited Conventions` in context.md).
5. `### Events/Messages` — when there are queues / async processing.
6. `### UI Contracts` — emitted only when `ui_in_scope: true`. One `#### Screen: {name}` subsection per screen from `## UI Inventory → UI ↔ Capability Join`.
7. `### Frontend Runtime` — emitted when ≥1 TD with `Renders in: frontend-runtime` (explicit OR default-by-inference) AND `ui_in_scope ∈ {true, logic-only}`. One `#### {td-slug}/TD-NN — {topic}` subsection per applicable TD, populated via the template at `.claude/skills/plan-build/templates/tech-specs/frontend-runtime.md`.
8. `### UI ↔ API Traceability Matrix` — emitted only when `ui_in_scope: true`. Built from the in-memory join of API Contracts + UI Inventory Capability Join (see "Building the matrix" inside `templates/tech-specs/traceability-matrix.md`). Skipped when `ui_in_scope ∈ {false, deferred, logic-only}`.

**Field-name verbatim invariant (F2 protection).** When rendering ANY subsection that cites field names, header names, error codes, endpoint paths, schema names, or library names from TDs, those identifiers MUST be copied byte-verbatim from the TD's Recommendation prose, `**Libraries:**` line, or `**Backend changes required:**` table cells. Do NOT:

- Change casing (`error` ≠ `errorCode` ≠ `error_code` ≠ `Error`).
- "Improve" naming (the TD says `error`; do not render `errorCode` because it "looks more typed" or matches a downstream convention).
- Re-order multi-token names (`access_token` ≠ `token_access`).
- Translate or pluralize (`user` ≠ `users`; `Channel` ≠ `Channels`).
- Strip or add prefixes/suffixes (`token_hash` ≠ `tokenHash` ≠ `hashToken`).

When a field name SHOULD be different (e.g., the TD uses an old name and the new name is intended), the difference MUST appear in a `**Revisions:**` block or in a mediation TD's `**Backend changes required:**` table — not introduced silently during A4 rendering. If the LLM is tempted to "fix" a name, that signals either (a) the TD prose is stale and a `/decide` or `/research` cycle is needed, or (b) the TD intentionally uses a name that A4 must transcribe as-is.

This invariant is the prevention against transcription drift (renaming/casing changes silently introduced when copying field names from TDs into rendered subsections). Custom rules in `docs/rules/plan-validate/` MAY catch violations after the fact via field-grep on the rendered §API Contracts; this invariant prevents the drift from being introduced in the first place.

**Verbatim discipline applies even when:**

- The downstream language convention differs (e.g., TypeScript camelCase): A4 ALWAYS renders the wire-format name as the TD specifies; a separate language-conversion step (downstream of A4) is responsible for any code-side casing.
- The TD's name "looks wrong" stylistically: stylistic concerns are out-of-scope for transcription.
- Multiple TDs disagree: emit the source TD's name verbatim; let validation rules catch the cross-TD inconsistency on the next `/plan-validate` or `/plan-build` cycle.

For each applicable subsection:

a. `Read` the corresponding template under `.claude/skills/plan-build/templates/tech-specs/{subsection}.md`. Templates exist for: `data-model.md`, `api-contracts.md`, `auth-matrix.md`, `error-catalog.md`, `events-messages.md`, `ui-contracts.md`, `traceability-matrix.md`.

b. Draft the subsection content in memory, applying the TD Scope filter from A2 and the per-subsection field-derivation rules embedded in each template (notably `ui-contracts.md` carries the full 7-bucket classifier + most-restrictive-auth heuristic + opt-out marker registry).

c. **For UI Contracts**, when expanding per-screen fields beyond what the digest in `## UI Inventory` provides (Behaviors *Rendered states*, Behaviors *Interactions*, Accessibility notes, Observations classified per the 7-bucket classifier), use **bounded reads per-screen** of the inventory file. Locate via `Grep -n '^## Screen: '` to get screen section boundaries; bounded Read for the target screen only. Source path is the `**Source:** \`{path}\`` field in the `## UI Inventory` section. Never Read the full inventory file.

d. `Edit` `{target_path}` to insert the new subsection. Edit anchor depends on which subsection number this is:

- **First subsection** — replace the placeholder comment:
  - `old_string`: `<!-- Tech Specs subsections will be appended below in Phase A -->`
  - `new_string`: full markdown block of the subsection (heading + content), no trailing horizontal rule.
- **Subsequent subsection** — anchor on the next top-level heading (`## Dependency Map`), which is unique in the file:
  - `old_string`: `\n\n---\n\n## Dependency Map`
  - `new_string`: `\n\n### {NewSubsection}\n\n... (content) ...\n\n---\n\n## Dependency Map`

This anchoring keeps subsections in canonical order and never requires re-reading the file between Edits.

If none of the subsections apply (and `ui_in_scope: false`), skip A4 entirely and proceed to A4.5 — the scaffold's `## Technical Specifications` heading was already omitted in A3, and A4.5's anchor still works (the `## Dependency Map` heading exists in either scaffold variant).

**Build order for UI sections** (when `ui_in_scope: true`): compute the UI ↔ API Traceability Matrix in memory **before** serializing UI Contracts (so per-screen `Server-connected components endpoint` references can read from it), then serialize UI Contracts (position 6) and finally serialize the Matrix itself (position 7). This preserves the canonical output order while keeping the in-memory Matrix as the single source-of-truth for endpoint references.

## A4.5. Run /plan-build custom rules

After A4 finishes (or after the decision to skip A4 entirely) and **before** marking Phase A complete, dispatch any custom rules in `docs/rules/plan-build/`:

1. `Glob docs/rules/plan-build/*.md`. If empty → skip A4.5; proceed to A4.6.
2. For each file in alphabetic order:
   a. Bounded-read frontmatter. If `status: disabled`, skip silently.
   b. Full Read + follow body. The body has access to `context.md` (in memory from A1), the plan file `{target_path}` (in memory after A4), and the disk (Bash, Read, Grep, Glob, Edit).
   c. Hard-fail rules abort: the body injects `<!-- {rule-id}-pending -->` into the plan file (Edit anchored on `## Dependency Map`) **before** emitting `FAILED at step-4-{rule-id}. Written so far: scaffold + Technical Specifications + <!-- {rule-id}-pending -->. Error: ... Next: ...`. Phase A then exits — A4.6 does NOT run; `<!-- phase-a-complete -->` is NOT injected. Gate 10 case 3 (SKILL.md) detects any `<!-- *-pending -->` on the next invocation (SIs sentinel present + phase-a-complete absent) and routes through fresh Phase A1.
   d. Advisory rules log to terminal but do NOT abort.

3. If all rules complete without aborting, proceed to A4.6.

The body owns suppressions reading from `{target_dir}/suppressions.md`.

## A4.6. Mark Phase A complete

After A4.5 finishes (no rule aborted), insert the `<!-- phase-a-complete -->` sentinel via a single `Edit`:

- `old_string`: `## Dependency Map`
- `new_string`: `<!-- phase-a-complete -->\n\n## Dependency Map`

This sentinel is the positive signal Gate 10 reads on rerun to confirm Phase A actually reached the end. Without it, Gate 10 routes a rerun back through Phase A (which Write-overwrites the half-built file) — guaranteeing Phase B never reads a partial Tech Specs surface. The `<!-- ccr-pending -->` sentinel from A4.5 (when an abort happened) sits between Tech Specs and `## Dependency Map`; the `Edit` here would not match the same `old_string` since A4.6 only runs when A4.5 passed cleanly (no `ccr-pending` ever co-exists with `phase-a-complete`).

## A5. Pause point — AskUserQuestion

After Tech Specs are written, dispatch `AskUserQuestion` with two options:

- **Continue now (Phase B in this session)** — Read `.claude/skills/plan-build/phase-b.md` and proceed immediately to Phase B; the in-memory context.md from A1 carries over, no re-reads. Phase B's B1 step is a no-op in this same-session continuation path.
- **Stop here (resume later)** — exit cleanly; emit the partial-artifact message defined in SKILL.md § "Output contract → Phase A pause".

If the user chose "Continue now" → Read `phase-b.md` and fall through into Phase B in the same run.
