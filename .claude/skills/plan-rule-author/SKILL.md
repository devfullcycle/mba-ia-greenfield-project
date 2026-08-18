---
name: plan-rule-author
description: "Scaffolds a new custom rule MD file under docs/rules/{plan-validate,plan-build,plan-resolve}/ following the canonical contract documented inline in this SKILL.md. Use when the user asks to create, author, or scaffold a new validation/build/resolve rule, register a new IC prefix, or add a custom check that fires under one of /plan-validate, /plan-build, or /plan-resolve. Trigger phrases: 'crie uma regra de plan-validate/build/resolve', 'nova regra de validação/build/resolve', 'add a custom rule that detects X', 'register a new IC prefix', 'scaffold a rule for {dispatch point}'. Out of scope: editing/disabling existing rules (Read+Edit directly), creating a new dispatch point (rare manual procedure documented in this SKILL.md as a tail section), authoring suppressions.md (owner-managed file)."
disable-model-invocation: true
---

# Plan Rule Author

Scaffolds a new rule file under `docs/rules/{plan-validate,plan-build,plan-resolve}/` following the canonical contract documented inline in this SKILL.md (frontmatter shape, 5 body responsibilities, per-dispatch emission destinations, suppressions policy). The skill walks the user through a hybrid-adaptive interview (atomic for cascading decisions, batched for correlated, auto for derivable) and produces a single MD file with frontmatter + the 5 canonical body sections.

**Authority chain.** This SKILL.md is the canonical contract for new rules. Live rules in `docs/rules/plan-{validate,build,resolve}/*.md` are exemplars demonstrating tone, depth, and convention. When this SKILL.md and a live rule conflict, this SKILL.md wins; flag the inconsistency to the user.

**In scope.** Authoring a new rule under an existing dispatch point — the zero-edit-to-skills-core happy path.

**Out of scope.** Editing/disabling existing rules; creating a new dispatch point (touches host skill, manual); writing `{target_dir}/suppressions.md` (owner-managed).

## Input handling

The user invokes via slash command. The argument is **optional free text**:

- `/plan-rule-author` (empty) → start interview from Step 1.
- `/plan-rule-author "<free-text description of what the rule should do>"` → run Step 0 to extract hints, then resume interview at the first unresolved step.

Examples of well-formed free-text:

- `/plan-rule-author "preciso de uma regra plan-validate hard-fail que detecta openapi.json com endpoints não mencionados em nenhum decisions doc inherited"`
- `/plan-rule-author "build-time advisory: avisar quando uma seção rendered cita um arquivo que não foi listado em _Source files:_ do context.md"`
- `/plan-rule-author "side-effect resolve: quando uma TD é decidida com Option Z, sincroniza a entry correspondente em library-refs.md"`

If the argument is just a phase reference (`phase NN`, `phase-NN-slug`) — abort: `"This skill authors rules under docs/rules/. For phase research, use /research <phase>; for plan validation, /plan-validate <scope>."`

## Procedure

### Step 0 — Auto-extract hints from free-text argument

Skip if argument empty.

Read the argument and extract whatever the user already specified. Look for:

- **Dispatch point** — keywords `plan-validate` / `validate-time` / `validation` → `validate`; `plan-build` / `build-time` / `build-abort` / `sentinela` / `during build` → `build`; `plan-resolve` / `side-effect` / `edita decisions` / `applies revisions` → `resolve`.
- **Severity** — `hard-fail` / `aborta` → hard-fail; `advisory` / `warning` / `não bloqueia` → advisory; `side-effect` → side-effect (forced for resolve).
- **Description** — the main descriptive phrase becomes the draft for `DESCRIPTION` (used in Step 2a as the seed for name derivation AND as the frontmatter `description:` field). Strip dispatch/severity tokens already classified above so DESCRIPTION carries only the rule's purpose.
- **Dispatch-point conflicts** — if the argument says "validate-time" but also "abort the build", flag and pick `build` (sentinel-bearing dispatch is always build); ask the user to confirm.

Show the user a one-block summary of what was extracted and what is still needed:

```
From your description, I extracted:
  - Dispatch point: plan-validate
  - Severity hint: hard-fail
  - Description: "openapi.json tem endpoints não mencionados em nenhum decisions doc"
Still needed: rule name (will be proposed at Step 2b), exact inputs list, three-pass applicability.
```

Then resume at the first unresolved step (often Step 2b — name proposal — since DESCRIPTION is already filled).

### Step 1 — Dispatch point (atomic; only if not resolved by Step 0)

Ask the user explicitly:

```
Which dispatch point does this rule belong to?

Pick by (a) WHEN your rule's inputs exist and (b) WHAT it should do:

  1. plan-validate — pre-build coherence check on source-of-truth files (decisions docs,
     context.md, openapi.json, inventory). Emits IC into validation.md for the user to fix.
       · hard-fail → flips `status: dirty`; /plan-build refuses to run until /plan-resolve closes it.
                     Pick when shipping with the finding present would corrupt downstream work.
       · advisory  → goes to `advisories:`; /plan-build proceeds. Pick when the finding is
                     informational (e.g., gaps that only matter on the last slice).

  3. plan-resolve — deterministic side-effect on decisions doc / context.md / library-refs.md.
     Writes edits directly (no IC, no user review).
     Pick when the job is to PROPAGATE or SYNC after another decision (apply a Revisions block,
     refresh a library cache, mirror a frontmatter flip).

  2. plan-build — mid-render structural check on just-rendered plan content.
     Pick when inspecting content that ONLY exists after /plan-build renders it (i.e.,
     a structural cross-check between a rendered plan subsection and an external
     source-of-truth file).
       · hard-fail → aborts mid-render; injects `<!-- {name}-pending -->`. Plan stays
                     non-completable until user mediates per the rule's "Next:" message.
                     Pick when shipping the divergent plan would mislead /implement.
       · advisory  → stdout log only; build completes. Pick when surfacing helps the developer
                     but the rendered plan is safe as-is.
```

Validate the answer is one of the three. On invalid → abort with the list above; ask user to re-invoke.

### Step 2 — Name (description → derive → confirm)

Step 2 splits into **2a** (capture description in plain language) and **2b** (Claude proposes a derived name + IC prefix; user accepts or overrides). The user never types kebab-case unless they want to override.

> **Principle — dispatch-aware prompts.** Once Step 1 has resolved the dispatch, every subsequent interactive prompt to the user MUST filter its examples to ONLY the resolved dispatch. Showing examples of unchosen dispatches is noise — the user already committed to one path and confirmation noise reads as inconsistency. This applies to Step 2a's example block, any future interactive Steps, and any user-facing prompt rendered after Step 1.

#### Step 2a — Capture the description

Skip if Step 0 already populated `DESCRIPTION` from the argument; show what was captured and let the user amend before proceeding to 2b.

Pick the prompt block matching the dispatch resolved in Step 1.

For `plan-validate`:

```
What does this rule detect? (one sentence)

Example: "openapi.json has endpoints not mentioned in any decisions doc"
```

For `plan-build`:

```
What does this rule detect? (one sentence)

Example: "rendered Step Implementation cites a library not listed in library-refs.md"
```

For `plan-resolve` (side-effect dispatch):

```
What side-effect does this rule apply? (one sentence)

Examples:
  "when a TD switches Option, append a Revisions block to the decisions doc"
  "sync library-refs.md when a decided TD's **Libraries:** field changes"
```

Capture the response into `DESCRIPTION`. This single value drives both the frontmatter `description:` field of the generated rule AND the seed for name derivation in 2b.

#### Step 2b — Propose name, confirm or override

Derive the proposed filename from `DESCRIPTION`:

1. `Glob docs/rules/{dispatch}/*.md` → bounded-Read each file's frontmatter `description:` line.
2. **Domain-match against existing rules.** If `DESCRIPTION` shares a clear domain with an existing rule (same artifact under check, same conceptual family), note the existing filename's leading kebab segment as a **prefix-to-reuse** so the new rule clusters alphabetically with its siblings in `Glob`.
3. **Derive 2-3 kebab-case words** capturing the domain + property of `DESCRIPTION`:
   - Prefix-to-reuse found → `{matching-prefix}-{distinctive-suffix}.md` (suffix is 1-2 words; distinguishes the new rule from siblings).
   - No prefix-to-reuse → cunhar from scratch: `{domain}-{property}.md` (e.g., DESCRIPTION = "openapi.json has endpoints not mentioned in decisions doc" → `openapi-orphan-endpoints.md` or `openapi-consistency.md`).
4. **Validate regex** `^[a-z][a-z0-9-]*-[a-z][a-z0-9-]*\.md$` (must have 2+ kebab segments — single-word filenames like `freshness.md` are too opaque). If derived name fails, force a second segment using a distinguishing word from `DESCRIPTION`.
5. **Validate uniqueness via Glob.** Collision → propose a disambiguator suffix (`-v2`, `-bff`, `-task`, etc.) inline in the rationale and re-validate.

Surface the proposal as an inline assistant message:

```
Proposed:
  Filename:  {name}.md
  IC prefix: {PREFIX}-N        ← uppercased filename root (without .md)
  Rationale: {one-line — explain reuse-vs-new and what makes this name capture the rule}
```

**Vocabulary convention** (used everywhere in this SKILL):
- `{name}` — template placeholder for the lowercase kebab filename root (e.g., `openapi-consistency`).
- `{PREFIX}` — template placeholder for the uppercased form (e.g., `OPENAPI-CONSISTENCY`). Always equals `NAME.upper()`.
- Internal variables: `NAME` stores the lowercase value; `PREFIX` stores `NAME.upper()`.

Then issue a ternary `AskUserQuestion`:

- `[Aceitar]` → store the proposal as `NAME` and `PREFIX`; proceed to Step 3.
- `[Mudar nome]` → enter override capture flow (below).
- `[Cancelar]` → abort silently; nothing further is asked or written.

**Override capture flow.** When the user picks `[Mudar nome]`, ask via inline assistant message (NOT via AskUserQuestion, which is choice-based):

```
Qual nome prefere? Forneça em kebab-case (ex.: openapi-consistency).
```

Capture the user's next message verbatim. Validate:

- **Regex:** `^[a-z][a-z0-9-]*-[a-z][a-z0-9-]*$` (no `.md` suffix; we add it). Fail → re-ask with the regex error spelled out.
- **Glob uniqueness** at `docs/rules/{dispatch}/{override}.md`. Collision → re-ask, citing the colliding file and suggesting `{override}-v2` / `{override}-bff` / etc.

Loop until a valid override accepted, then store as `NAME` (and `PREFIX = NAME.upper()`) and proceed to Step 3.

During this override capture loop, if the user types `cancela` (or clear negation) instead of a kebab-case name, abort silently.

### Step 3 — Severity (atomic; constrained by dispatch point)

Severity options depend on dispatch:

- **plan-validate**: `hard-fail` | `advisory`
- **plan-build**: `hard-fail` | `advisory`
- **plan-resolve**: `side-effect` (no choice — fixed)

For validate/build, ask:

```
Severity for this rule:
  - hard-fail: each finding blocks the host (validate flips dirty / build aborts with sentinel)
  - advisory: each finding is informational (validate lists in advisories: / build logs to terminal only)

Pick the one matching what should happen when the predicate matches.
```

For resolve, skip the question and announce: `"Severity for resolve rules is fixed at 'side-effect'. Rules emit no IC; they edit files directly."`.

### Step 4 — Inputs + Predicate (batched; both prose)

Ask in one turn:

```
Two body sections to draft:

  1. Inputs — which files / sections / variables does this rule read?
     List every artifact the predicate touches: context.md sections (`## Scope`,
     `_Source files:_`, `## Decisions Detail`...), the just-rendered plan file at
     {target_path} (build-time only), on-disk files like openapi.json or decisions
     docs (cite by path or by template `{subproject}/openapi.json`), and any in-memory
     state from the host. Be specific about the section/heading when reading inside
     a markdown file — vague inputs produce vague predicates.

  2. Predicate — what triggers a positive match? Be precise; this becomes the rule's loop logic.
     Show the actual condition expression(s) you want; if multiple conditions, list each independently.
```

Capture the responses verbatim into draft variables `INPUTS_PROSE` and `PREDICATE_PROSE`. The author can refine in Step 8 preview.

### Step 4' — Optional readability sub-blocks within Predicate (auto-suggest + opt-in)

For human readability, the Predicate section can carry two optional sub-blocks. Auto-suggest based on Predicate analysis from Step 4:

- **Pseudocode block** — auto-suggest if Predicate prose mentions `for each`, `loop`, `compare`, or has more than one independent condition. Format as a fenced code block within Predicate.
- **Issue text literal** — auto-suggest if rule emits IC with templated text (validate hard-fail/advisory or build hard-fail). Format as a fenced block showing the exact `"{PREFIX}-N — ..."` string.

Ask:

```
For human readability, two optional sub-blocks within Predicate are available:
  1. Pseudocode block (algorithm in code form) — {auto-suggested: yes/no, reason: "{classifier}"}
  2. Issue text literal (the exact "{PREFIX}-N — ..." string emitted) — {auto-suggested: yes/no, reason: "{classifier}"}
Add? (1, 2, both, none)
```

If user opts in:
- For Pseudocode: capture user's pseudocode (or generate a draft from Predicate prose if user says "draft"). Inject as `### Pseudocode` subheading inside `## Predicate`, with content in a fenced code block.
- For Issue text: capture user's literal IC text (or generate template `"{PREFIX}-N — {one-line summary using captured Inputs and Predicate verbs}"` if user says "draft"). Inject as `### Issue text` subheading inside `## Predicate` (or after `## Emission` for build hard-fail rules where the issue is part of the abort message), with content in a fenced block.

Sub-block shapes (use these as literal structural templates):

````markdown
### Pseudocode
```
for each <input element>:
  if <condition>:
    accumulate / emit {PREFIX}-N
```

### Issue text
```
{PREFIX}-N — {one-line summary; reference the offending input by name/path}
```
````

### Step 5 — Three-pass evaluation (auto + confirm)

Heuristic-classify the rule based on Inputs + Predicate from Step 4:

- **Predicate refers only to mtimes / file existence / structural file properties** → propose `Skipped (mtime-pure: a stale/missing file is a physical fact, not intent. No mediation TD or SI can absorb it.)`
- **Dispatch is `plan-resolve`** → propose `Skipped (side-effect rules execute deterministically; there is no IC to mediate against.)`
- **Otherwise (intent-aware: predicate compares against decisions docs, plan files, or rendered content)** → propose: `Apply 3-pass evaluation. For each candidate finding: **Pass 0** check whether runtime (e.g., openapi.json, code) already covers the expected state — if yes, skip the finding; **Pass 1** check whether a mediation TD (Backend changes required: table) covers the expected change — if yes, intent-captured, skip; **Pass 2** (phase mode only) check whether a BE slice's plan file has a Step Implementation covering the change — if yes, plan-captured, skip; **Pass 3** the finding is uncaptured drift — fire the IC.`

Show the proposal:

```
Step 5 (Three-pass evaluation): I'm proposing "{proposal}".
Reason: {one-line classifier rationale}.
Confirm or override? (ok / change to skipped / change to apply)
```

When ambiguous, **default to Apply** (covers the common case; user can override in preview).

### Step 6 — Build sentinel block (auto; conditional on dispatch=build + severity=hard-fail)

Skip if not (build + hard-fail).

Generate the canonical sentinel + abort sequence using `{name}` (the filename root from Step 2b):

```
After the loop, if `{accumulator_name}` is non-empty:

1. **Inject sentinel** `<!-- {name}-pending -->` into the plan file (`{target_path}`):
   - `Edit` `old_string`: `## Dependency Map`
   - `Edit` `new_string`: `<!-- {name}-pending -->\n\n## Dependency Map`

   This must be done **before** `<!-- phase-a-complete -->` is injected by the host skill.

2. **Abort with this exact message shape**:

   ```
   FAILED at step-4-{name}. Written so far: scaffold + Technical Specifications + <!-- {name}-pending -->. Error: {one-line summary of N findings}:
     - {finding_summary_1}
     - {finding_summary_2}
     ...
   Next: {remediation hint — see Step 6 prompt}.
   ```

3. The `<!-- {name}-pending -->` sentinel keeps the plan in a non-completable state. Gate 10 of `/plan-build` SKILL.md detects the pending sentinel on the next invocation and recovers by rewriting the plan from scratch.

If `{accumulator_name}` is empty, skip — host proceeds to mark the build complete normally.
```

Ask the user only:

```
For the build-abort message, I need:
  - {accumulator_name}: name for the in-memory list of findings (e.g., `drift_list`, `mismatch_list`).
  - {one-line summary template}: e.g., "{rendered subsection} drifts from {source-of-truth file} in {N} points without coverage in any mediation source"
  - {Next: remediation hint}: what should the user do to fix? (e.g., "add the missing entry to {input file}, OR create a mediation TD via /research <slug> if the divergence is intentional, OR suppress via {target_dir}/suppressions.md")
```

The rest of the block is fixed boilerplate.

### Step 6' — Resolve inter-rule dependencies (auto; conditional on dispatch=resolve)

Skip if not resolve.

Per the canonical ordering rule (plan-validate and plan-build rule bodies MUST be order-independent; plan-resolve bodies MAY depend on prior rules' edits in the same dispatch and MUST document such dependencies in their body), ask:

```
Plan-resolve rules dispatch alphabetically and MAY observe edits made by earlier rules in the same run.
Does this rule depend on another resolve rule running first (e.g., it re-reads a decisions doc that another rule modifies)?

If yes: name the rule(s) it depends on, and I'll add a "Depends on" subsection.
If no: just say "no" and we'll skip the subsection.
```

If yes, append a `## Depends on` subsection to the body draft listing each predecessor.

### Step 7 — Suppressions block (auto; from per-dispatch boilerplate library)

Generate the suppressions section using the dispatch + severity from Steps 1+3, substituting `{PREFIX}` = `NAME.upper()` (the uppercased filename root from Step 2b) and (for build hard-fail) `{accumulator_name}` from Step 6.

No user input. See `## Per-dispatch boilerplate library` below for the exact text per case.

### Step 7' — Optional tail sections for human readability (auto-suggest + opt-in)

After Suppressions, three optional tail sections can be added. Auto-suggest based on Predicate + dispatch from earlier steps:

- **`## Notes`** — auto-suggest if rule has non-obvious design rationale (e.g., complex 3-pass logic, multi-layer path rewriting, why-we-chose-X-not-Y trade-offs, why this is a rule and not a built-in). Section shape:
  ```
  ## Notes

  - **Why this is a rule, not a built-in.** {one-line rationale: e.g., predicate
    requires inputs not available at host-skill-write time.}
  - **Trade-off considered.** {alternative considered and reason for rejection.}
  ```
- **`## Out of scope`** — auto-suggest if Predicate explicitly excludes related cases (e.g., "this rule detects X but not Y, which is covered by another rule") or if the rule has a narrow boundary that future readers might overstep. Section shape:
  ```
  ## Out of scope

  - {Item 1: a related case this rule deliberately does not detect, with a pointer
    to where it IS handled if anywhere.}
  ```
- **`## Idempotency`** — auto-suggest if the rule is comparison-based, mtime-based, or has resolve side-effects with re-run safety guarantees. Section shape:
  ```
  ## Idempotency

  Re-running {PREFIX} against unchanged inputs produces {byte-identical IC text /
  no side-effects / same accumulator}. {Mention any caveat — e.g., "IDs are stable
  as long as the iteration order over `{input}` is deterministic".}
  ```

Ask:

```
Three optional tail sections to make the rule readable for humans:
  - ## Notes — design rationale ({auto-suggested: yes/no, reason: "{classifier}"})
  - ## Out of scope — what this rule deliberately doesn't detect ({auto-suggested: yes/no, reason: "{classifier}"})
  - ## Idempotency — re-run safety guarantees ({auto-suggested: yes/no, reason: "{classifier}"})

For each: skip / draft (I'll generate a one-line skeleton for you to expand) / inline (you provide text now).
```

Per-section behavior:
- `skip` → omit the section entirely from the skeleton.
- `draft` → generate a one-line skeleton based on rule properties:
  - For `## Notes`: `"{Brief design rationale — fill in: trade-offs, why this approach was chosen, alternatives considered.}"`
  - For `## Out of scope`: `"- {Item 1: a related case this rule deliberately does not detect, with a pointer to where it IS handled if anywhere.}"` (one bullet seed; user expands)
  - For `## Idempotency`: based on classifier — e.g., for mtime-pure rules: `"Re-running {PREFIX} with no file changes produces identical IDs and texts."`; for resolve rules: `"Re-running {PREFIX} on the same input produces byte-identical results."`
- `inline` → capture user's text verbatim and inject directly.

User can refine any section in Step 8 preview before Write.

### Step 8 — Preview + confirm (mandatory before Write)

Render the full MD file in-line. Before the standard preview block, surface a **Readability checkpoint** that quotes the rule's title and opening paragraph for explicit user attention — these are what humans see first when they open the file:

```
Readability checkpoint (filename "{name}.md" alone may not be enough context):
  Title:   {HUMAN_TITLE}
  Opening: {OPENING_PARAGRAPH first 2 sentences, ≤200 chars total}

Are these clear to a reader who has never seen this rule before? (sim / refazer)
```

If user says `refazer`, loop back to skeleton instructions and regenerate HUMAN_TITLE + OPENING_PARAGRAPH with adjusted prompt; re-show checkpoint. If `sim`, proceed to standard preview:

```
Preview of `docs/rules/{dispatch}/{name}.md`:

[full rendered MD]

Write to disk? (sim / muda <step-N> / cancela)
```

User responses:
- `sim` (or any clear affirmation) → proceed to Step 9.
- `muda <step-N> {new value}` → loop back to that step, re-derive downstream sections, re-show preview.
- `cancela` (or any clear negation) → abort silently; nothing is written.

Honor the auto-mode override if present (`auto-mode` system reminder in conversation indicating "minimize interruptions"): in auto-mode, you MAY skip the explicit confirmation prompt and write directly, but ALWAYS still show the preview before Write so the user can intervene if the rendered MD is wrong.

### Step 9 — Write + verify suggestion

1. `Write` the file to `docs/rules/{dispatch}/{name}.md`.
2. Emit a one-block confirmation:

```
Created `docs/rules/{dispatch}/{name}.md`.

To verify the rule fires correctly, run `/plan-{dispatch} <scope>` against a slice known to trigger {PREFIX}.
The rule will be picked up automatically on the next invocation — no skill-core edit needed.

If the rule is intent-aware, you may also want to:
  - Test that suppressions work: add a {PREFIX}-N entry to {target_dir}/suppressions.md and re-run.
  - Cross-check against sibling rules sharing the same filename prefix in `docs/rules/{dispatch}/` (e.g., if `{name}` reused an existing prefix in Step 2b, the family conventions on emission format, suppressions filter, and sentinel naming should match).
```

## Per-dispatch boilerplate library

These blocks are auto-substituted into the generated rule body. Substitute `{PREFIX}` with `NAME.upper()` (the uppercased filename root from Step 2b — e.g., `openapi-consistency` → `OPENAPI-CONSISTENCY`) and `{accumulator_name}` with the value from Step 6 when applicable.

### Emission contract — plan-validate hard-fail

```markdown
## Emission

- **Prefix:** `{PREFIX}-N` (one IC per matching condition).
- **Severity:** hard-fail — flips `validation.md` `status: dirty`; entries go to `issues:` array (not `advisories:`).
- **Destination:** `validation.md` `issues:` accumulator (merged with built-in checks by the host's merge step).
```

### Emission contract — plan-validate advisory

```markdown
## Emission

- **Prefix:** `{PREFIX}-N` (one IC per matching condition).
- **Severity:** advisory — never blocks. Entries go to `validation.md` `advisories:` array; `status: dirty` is NOT flipped.
- **Destination:** `validation.md` `advisories:` accumulator.
```

### Emission contract — plan-build hard-fail

For build hard-fail rules, the body uses **two** Emission-family headings:

1. `## Emission contract` near the top — short prefix/severity/destination summary (block below).
2. `## Emission (build abort)` after Three-pass evaluation — the expanded sentinel-injection + abort-message sequence from Step 6.

This split exists because the abort flow is too verbose to nest inside the contract block, and readers benefit from seeing the contract upfront before the predicate/three-pass detail.

```markdown
## Emission contract

- **Prefix:** `{PREFIX}-N` (one per uncaptured finding in `{accumulator_name}`).
- **Severity:** hard-fail — aborts the host's render flow; no `<!-- phase-a-complete -->` is written.
- **Destination:** terminal `FAILED at step-4-{name}` message + `<!-- {name}-pending -->` sentinel injected in plan file.
```

### Emission contract — plan-build advisory

```markdown
## Emission

- **Prefix:** `{PREFIX}-N`.
- **Severity:** advisory — terminal log only; build proceeds. No sentinel injection.
- **Destination:** stdout (build log line).
```

### Emission contract — plan-resolve side-effect

```markdown
## Emission contract

- **Prefix:** Side-effect; does not emit IC.
- **Severity:** side-effect.
- **Destination:** {describe what the rule edits — decisions doc / context.md / library-refs.md}; appended summary line to host's next-command output.
```

### Suppressions — plan-validate (hard-fail or advisory)

```markdown
## Suppressions

1. Read `{target_dir}/suppressions.md` if present; no-op silently if absent. (`{target_dir}` is the host scope dir — `docs/phases/phase-NN-{slug}/` in phase mode or `docs/tasks/task-{slug}/` in task mode; resolved by the host from context.md `kind` + `name`.)
2. For each entry under `suppressions:` whose `id` matches `{PREFIX}-N`, add the ID to the per-rule suppressed set. Missing/malformed entries are skipped silently.
3. Filter emissions against the suppressed set. Honored IDs render in `validation.md`'s `## Active Suppressions` instead of `## Findings`.
```

### Suppressions — plan-build hard-fail

```markdown
## Suppressions

{PREFIX} aborts the build, but suppression is still honored:

1. Read `{target_dir}/suppressions.md` if present; no-op silently if absent.
2. For each entry whose `id` matches `{PREFIX}-N`, add the matching item to the suppressed set.
3. Filter `{accumulator_name}` against the suppressed set before deciding whether to abort. If `{accumulator_name}` becomes empty after filtering → no abort, no `<!-- {name}-pending -->` injection; the host proceeds to mark complete.
4. Even when filtering leaves `{accumulator_name}` non-empty and the abort proceeds, the user audits honored suppressions via `{target_dir}/suppressions.md` directly (no surfacing artifact at build time).
```

### Suppressions — plan-build advisory

```markdown
## Suppressions

Honored advisory suppressions have no surfacing artifact at build time:

1. Read `{target_dir}/suppressions.md` if present; no-op silently if absent.
2. For each entry whose `id` matches `{PREFIX}-N`, add the ID to the per-rule suppressed set.
3. Filter terminal-log emissions against the suppressed set. Honored IDs are silently dropped; the user audits via `{target_dir}/suppressions.md` directly.
```

### Suppressions — plan-resolve

```markdown
## Suppressions

Not applicable. Resolve rules are side-effect-only and emit no IC, so there is nothing to suppress. To prevent a side-effect from running, edit or remove the input that triggers it before re-invoking `/plan-resolve`.
```

## Generated body skeleton

After all steps, the rule MD has this exact structure (in this order):

```markdown
---
description: "{description from Step 2, ≤200 chars}"
status: active
---

# {HUMAN_TITLE}

`{HUMAN_TITLE}` MUST be human-readable and self-explanatory — never the bare kebab-case filename. Pattern: title-case rendering of `{name}`, optionally split with an em-dash (`—`) for semantic grouping when the name has a domain prefix + property tail. Technical tokens preserve their canonical casing (e.g., `OpenAPI`, `I18N`, `JWT`, not `Openapi` / `I18n` / `Jwt`). Examples:
- `# OpenAPI Consistency` ✅ (filename `openapi-consistency.md` — single-phrase rendering)
- `# I18N Sync — Missing Translation Keys` ✅ (filename `i18n-sync-missing-keys.md` — em-dash splits domain prefix `i18n-sync` from property tail `missing-keys`, expanded to a fuller phrase)
- `# openapi-consistency` ❌ (kebab-case literal; reader can't tell what this is)
- `# OC` ❌ (cryptic abbreviation; opaque)

{OPENING_PARAGRAPH}

`{OPENING_PARAGRAPH}` MUST be 2-3 sentences in plain language covering: (1) **what** the rule detects or applies (concrete, no jargon — "stale openapi.json files" not "F2-class drift"); (2) **when** it runs (which dispatch + which moment in the host's flow — "during /plan-validate after Checks 1-8" or "during /plan-build mid-render, right after the {input subsection} is emitted"); (3) **what action** it triggers (block / log advisory / edit files). Assume the reader has not read other rules and may be opening this file because they hit the `{PREFIX}-N` ID in validation.md and want to understand it. AVOID: forward references to other rules, references to frozen plans, undefined acronyms beyond `{PREFIX}` itself.

## Emission {contract}    ← per Step 7 boilerplate; the word "contract" appears only for build hard-fail (where the contract block is split from the abort sequence)

{boilerplate per dispatch + severity}

## Inputs

{INPUTS_PROSE from Step 4}

## Predicate

{PREDICATE_PROSE from Step 4}

### Pseudocode    ← optional; only if user opted in at Step 4'

{pseudocode in fenced code block, from Step 4'}

### Issue text    ← optional; only if user opted in at Step 4' (validate/build emission rules); for build hard-fail this lives after ## Emission instead

{literal IC text in fenced block, from Step 4'}

## Three-pass evaluation     ← always present; body is "Skipped. {reason}" when classifier said Skipped

{either "Skipped. {reason}" or the Apply block from Step 5}

## Emission (build abort)    ← only for build + hard-fail; insert Step 6 expanded sequence here

{Step 6 sequence}

## Suppressions

{Step 7 boilerplate}

## Depends on    ← only for resolve rules with inter-rule deps; from Step 6'

{predecessor list}

## Notes    ← optional; only if user opted in at Step 7' (Notes)

{notes prose from Step 7' — design rationale, trade-offs}

## Out of scope    ← optional; only if user opted in at Step 7' (Out of scope)

{bulleted list of out-of-scope items from Step 7'}

## Idempotency    ← optional; only if user opted in at Step 7' (Idempotency)

{idempotency guarantee prose from Step 7'}
```

Sections that are conditional:
- Three-pass when Skipped → still include with one-line "Skipped. {reason}" body.
- build-abort block → omit if not build+hard-fail.
- Depends on → omit if no resolve dependencies.
- **Pseudocode / Issue text (Predicate sub-blocks)** → omit unless opted in at Step 4'.
- **Notes / Out of scope / Idempotency (tail sections)** → omit unless opted in at Step 7'.

## Filename + collision policy

- **Format:** `{name}.md` — kebab-case, 2+ segments separated by `-`. Regex: `^[a-z][a-z0-9-]*-[a-z][a-z0-9-]*\.md$`. Single-segment names (e.g., `freshness.md`) are rejected as too opaque; the second segment is what makes the rule's domain readable in `Glob` listings.
- **Location:** `docs/rules/{plan-validate,plan-build,plan-resolve}/` — chosen by Step 1.
- **Collision:** any pre-existing file at the target path → Step 2b's override flow asks the user for an alternative (or accepts a disambiguator suffix proposed inline). Never auto-suffix without user confirmation.
- **Filename-prefix grouping is informal but encouraged.** Multiple rules sharing a leading kebab segment cluster alphabetically in `Glob docs/rules/{dispatch}/{prefix}-*.md`, which is the canonical way to find a "family". This is a naming convention, not a structural field — the SKILL has no separate "concern" concept, so families exist only by the prefix authors choose at Step 2b.

## Authority chain

Two sources of truth, in order of authority:

1. **This `SKILL.md`** — the canonical contract for frontmatter, body responsibilities, per-dispatch emission destinations, suppressions handling, sentinel format, and filename convention. New rules MUST conform.
2. **Live rules in `docs/rules/plan-{validate,build,resolve}/*.md`** — exemplars for tone, depth, idempotency notes, "Out of scope" tail sections. NOT authoritative; if a live rule conflicts with this SKILL.md, this SKILL.md wins.

When in doubt about a body convention (heading order, "Idempotency" sub-heading inclusion, "Out of scope" tail), `Read` 1-2 live rules from the same dispatch point and match their pattern. If an existing rule cites an external planning doc as the source of an algorithm it implements, treat that citation as the rule's own historical context — do not promote it to SKILL-level authority and do not propagate it to new rules unless the algorithm is genuinely re-used and the cite is needed for the reader to understand it.

## Out of scope: adding a new dispatch point (rare procedure; documented here for reference)

This SKILL only authors rules under one of the three existing dispatch points (`plan-validate`, `plan-build`, `plan-resolve`). Adding a 4th dispatch point is a one-time architectural change that touches a host skill's source code and CANNOT be scaffolded by this SKILL — the procedure is documented here only so the knowledge does not become tribal.

**When you might need this:** you are introducing a new pipeline command (e.g., `/plan-something`) and want it to dispatch custom rules the same way `/plan-validate` does.

**Procedure:**

1. Pick the host skill and the dispatch step in its procedure (the moment when rules should fire).
2. `mkdir docs/rules/{skill-name}/` (e.g., `docs/rules/plan-something/`).
3. Add ~5-10 lines of glue to the host skill's procedure at the dispatch point. Canonical shape:

   ```markdown
   ## Custom rules

   At {dispatch step}, run all rules registered for /{skill-name}:

   1. `Glob docs/rules/{skill-name}/*.md`. If empty, skip.
   2. For each file in alphabetic order: bounded-Read frontmatter; if `status: disabled`, skip silently; otherwise full Read + follow body. Body declares emit prefix, severity, output destination.

   See `.claude/skills/plan-rule-author/SKILL.md` for the canonical rule contract.
   ```

4. (Optional) Update this SKILL.md's Step 1 question block (lines ~62-71) to list the new dispatch point as option 4, and add corresponding Emission contract + Suppressions blocks to the `## Per-dispatch boilerplate library` so future rules under the new point are scaffoldable.
5. Authors of subsequent rules under this dispatch point: zero edit to the host skill (Glob+Read picks them up automatically).

**Why this isn't automated:** adding a dispatch point is per-host-skill design work — choosing the right dispatch step, deciding emission destination semantics (does it write to a doc? abort the host? edit files?), and committing to a suppressions policy. Wizard-scaffolding it would either over-prescribe or under-specify; the manual procedure above is short enough that no automation is justified.
