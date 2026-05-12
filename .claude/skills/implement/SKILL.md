---
name: implement
description: "Execute a phase or task implementation plan step by step, respecting dependencies, running the relevant tests after each SI, and only advancing when tests pass. Use whenever the user asks to implement, execute, build, or deliver a planned phase or task — including variations like 'implement phase X', 'execute phase-02', 'build the auth phase', 'implement task <slug>', 'run the task plan', 'implement the SIs', or any request to turn a plan document (docs/phases/phase-NN-{slug}/phase-NN-{slug}.md or docs/tasks/task-{slug}/task-{slug}.md) into working code."
disable-model-invocation: true
---

# Implement

Execute a plan (phase or task) SI by SI. Each SI is only considered done when its implementation exists **and**, if the SI has a Tests section, the tests listed there pass. Move to the next SI only after the current one is complete (tests passing where the SI has a Tests section).

This skill is the execution counterpart of `plan-pipeline`. The plan document is the contract — this skill does not make technical decisions, it follows them.

## Inputs

`/implement <NN | slug> [continuous]`

The user either points to a plan document directly (e.g., `docs/phases/phase-02-auth/phase-02-auth.md` or `docs/tasks/task-parallel-db-tests/task-parallel-db-tests.md`) or refers to it by number/slug (e.g., "implement phase 02", "run the auth phase", "implement task parallel-db-tests"). Resolve the path before proceeding:

**Mode detection:**

- **Integer arg** → phase mode. Resolve to `docs/phases/phase-NN-{slug}/phase-NN-{slug}.md` (glob `docs/phases/phase-NN-*/phase-NN-*.md`).
- **String arg** → task mode by default. Resolve to `docs/tasks/task-{slug}/task-{slug}.md`. **Phase-slice shortcut (optional, slug-primary):** if no task plan matches, also glob `docs/phases/phase-*-{slug}/phase-*-{slug}.md` — a single match resolves to phase mode on that slice. This aligns with the `plan-pipeline` slicing model without requiring users to remember the phase number.

**Fallback:** if mode detection is ambiguous or an explicit path is given, glob both directories; if multiple match, ask the user which one.

**Multi-match in phase mode is the expected slicing path, not an edge case.** Per the `plan-pipeline` slicing model, a single phase `NN` may have multiple phase-scope slice docs (e.g., `phase-02-auth-backend` + `phase-02-auth-frontend`). When `/implement 2` globs `docs/phases/phase-02-*/phase-02-*.md` and returns ≥2 matches, the "ask the user which one" fallback above IS the slicing resolution — not a degenerate case. Prefer calling it out by slice slug in the disambiguation prompt (e.g., `"Phase 2 has multiple slices: auth-backend, auth-frontend. Which one?"`) so users can re-invoke directly via the slug-primary path (`/implement auth-frontend`).

- If no file matches, stop and tell the user — they likely need to run `plan-pipeline` first.

The user may also request **continuous mode** at the start of the session with phrases like "execute tudo", "don't pause between SIs", "run all at once", "autopilot". The default mode pauses between SIs for confirmation.

## Context — read before implementing

The plan document can be large (many SIs + extensive Technical Specifications). Do **not** load it in full — seek by section on demand. This keeps the context window small throughout the long execution.

1. **Index the plan document (Preflight only, done once):**
   - `Grep -n "^## " <plan-doc>` → positions of all top-level sections (`## Objective`, `## Step Implementations`, `## Technical Specifications`, `## Dependency Map`, `## Deliverables`). Keep this map.
   - `Read` from line 1 with `limit = (line of "## Step Implementations") − 1` → captures the header, Objective, and any pre-SI notes, regardless of how long they are. This gives the agent enough context to describe the plan to the user.
   - `Grep -n "^### SI-" <plan-doc>` → all SI headings with line numbers in order. Keep this map in working memory for the rest of the session.
   - Read the **Dependency Map** and **Deliverables** sections in full (both are required — Preflight's Plan sanity check guarantees their presence). Upper bound for each section is the next `##` line in the top-level map, or end-of-file if it's the last section (typically Deliverables — read until the end of the file).
   - If the plan has an **Error Catalog** or **Authorization Matrix** subsection inside Technical Specifications, read each in full too (each typically <100 lines). Many SIs cross-reference these, so reading once is cheaper than seeking per SI. Locate them with `Grep -n "^### Error Catalog" <plan-doc>` and `Grep -n "^### Authorization Matrix" <plan-doc>`. For the upper bound of each subsection, run `Grep -n "^##+ " <plan-doc>` and take the first line number greater than the subsection's start. If no such line exists (the subsection is the last heading in the document), read to end-of-file. Same pattern used for per-SI Tech Spec seeks below.
   - **Do not** read Step Implementations in bulk. Each SI is read on demand in step 1 of the per-SI loop.
   - **Do not** read the rest of Technical Specifications (Data Model, API Contracts, Events/Messages) in bulk. Seek per SI as needed.
2. **Testing guide skill** — for each target subproject, use the Skill tool to load `testing-guide-{subproject}` if present. It documents what to test (and what to skip) at each layer (Unit, Integration, E2E), gotchas, and best practices per artifact for that subproject. The Tests section of each SI tells you **which** files to create; the testing guide tells you **what** each test at each layer should cover and the best practices per artifact.

## Progress file — persistence across sessions

A progress file tracks which SIs are completed, their test results, and out-of-scope observations. It is the source of truth for resuming a phase or task across sessions and for generating the final completion report.

- **Location:** sibling of the plan document inside the plan folder — e.g., `docs/phases/phase-02-auth/phase-02-auth.md` → `docs/phases/phase-02-auth/progress.md`, or `docs/tasks/task-parallel-db-tests/task-parallel-db-tests.md` → `docs/tasks/task-parallel-db-tests/progress.md`. The filename has no prefix (the folder already scopes it).
- **Created:** during "Set up the SI task list" (fresh start) or read during Preflight (resume).
- **Updated:** at step 6 of the per-SI loop, after each SI completes.

### Header — dual-read, write-new-format-only-for-new-files

- **Read (regex-tolerant):** match `^# .* — Progress` — accepts both the legacy `# Phase NN — <name> — Progress` and the new `# {name} — Progress`. The header itself carries no semantic information used during the run; `implement` parses `Status:` and `SI-*` entries, not the header.
- **Write (new files only):** `# {name} — Progress`, where `{name}` is `phase-02-auth` or `task-parallel-db-tests`.
- **Never reshape the header of an existing `progress.md`.** Legacy files stay with their legacy header forever.

- **Format:**

```markdown
# {name} — Progress

**Status:** in_progress | completed
**SIs:** X/Y completed

### {SI-id} — <name>
- **Status:** completed | pending
- **Tests:** <result or "no tests">
- **Observations:** {inline `none` if no notes; otherwise newline + flat bullet list, one logical note per bullet — free-form prose per bullet, no required tags}
```

**Observations format — hybrid intelligent (forward-only):**

- Empty case → inline `none` (plain, no italic).
- Non-empty case → newline + ≥1 bullet, one bullet per logical note. Single-note SIs still use 1 bullet (consistency over inline-when-trivial); multi-note SIs use N bullets, one per logical observation. Bullets are flat free-form prose; no enum, no required topic tags. The user MAY voluntarily start a bullet with **bold** (e.g., `- **Tooling:** installed Vitest …`) for skimmability, but it is not enforced.
- **Forward-only migration:** existing progress.md files written under the prior single-line-prose convention are NOT rewritten. The new format applies only to entries `/implement` writes from this rule onward; mixed-format files (legacy entries in prose + new entries bulleted) are tolerated. The `Status:` line is unchanged either way, so the resume parser is unaffected.

Examples:

```markdown
### SI-NN.X — <name>
- **Status:** completed
- **Tests:** 8 passing
- **Observations:** none
```

```markdown
### SI-NN.Y — <name>
- **Status:** completed
- **Tests:** 12 passing
- **Observations:**
  - Plan snippet for `clearAuthCookies` used two-arg shape; implemented with options form per Next.js 16 API (semantically identical, syntactically required by current types).
  - Created `.env.local` with `UPSTREAM_URL` (existing `.env.local.example` uses `NESTJS_API_URL`; alignment of the example file is out-of-scope for this SI).
```

**SI labels:**

- **Phase mode:** `SI-NN.X` (dot-prefixed with phase number) — matches the phase doc.
- **Task mode:** `SI-N` (no prefix) — tasks have no external cross-reference by number.

Each SI gets one section. Only `Status`, `Tests`, and `Observations` are updated — the structure is created once and entries are filled in as SIs complete.

## Preflight — run before touching code

Check these before starting implementation. Stop and surface any issue to the user rather than guessing:

- **Branch check**: `git status` and `git branch --show-current`. If the current branch is `main` or `dev`, or if there are uncommitted changes touching files outside the target subproject's directory (i.e., the directory resolved from the plan's `affected_subprojects:` field), stop and ask the user to set up the right branch first.
- **Subproject readiness**: the target subproject exists and its dependencies are installed (the readiness check is stack-specific: `node_modules/` for Node, `.venv/` or installed `pyproject.toml` deps for Python, `vendor/` for Go modules vendoring, etc.). If not, ask the user to set it up first.
- **Plan sanity**: the plan document has the expected structure (Step Implementations, Dependency Map, and Deliverables are all required). If the document looks malformed or incomplete, stop and report.
- **Resume check**: look for `progress.md` in the plan folder (sibling of the plan document — `docs/phases/phase-NN-{slug}/` in phase mode, `docs/tasks/task-{slug}/` in task mode). If found, read it to determine which SIs are already completed. Inform the user: "Encontrado progress file com X/Y SIs completos. Retomando a partir de {resume-SI-id}." (phase mode: `SI-NN.Z`, task mode: `SI-Z`). If the progress file is malformed or inconsistent with the plan document, stop and report.
- **Mode detection (`PLAN_MODE`)**: read the plan frontmatter and decide whether the plan was built with `test_specs_aware: true` (modern) or without it (legacy). Modern plans are subject to the Test Specs preflight + JIT spec read documented below. Legacy plans skip both.

  ```bash
  # (a) Frontmatter check: plan-build modern declares test_specs_aware: true
  TEST_SPECS_AWARE=$(awk '/^---$/{f=!f;next} f' "$PLAN" | grep -c "^test_specs_aware: true$" 2>/dev/null)
  if [ "${TEST_SPECS_AWARE:-0}" -gt 0 ]; then
    PLAN_MODE=modern
  else
    PLAN_MODE=legacy
  fi
  ```

  - `PLAN_MODE=legacy` → planos antigos OR planos onde o frontmatter `test_specs_aware` está ausente. Pular o **Test Specs preflight** e a **Step 3 JIT extension** abaixo. Manter comportamento atual: ler Tests entries do SI, escrever test code a partir da prosa de uma frase (status quo). Note: `phase-a.md` emit rules nunca escrevem `test_specs_aware: false` por construção — o grep `grep -c "^test_specs_aware: true$"` retornaria 0 nesse caso e cairia em legacy de qualquer forma; mas o estado "false explícito" não é uma saída legítima do builder.
  - `PLAN_MODE=modern` → planos novos com `test_specs_aware: true`. Aplicar **Test Specs preflight** + **Step 3 JIT extension** abaixo — mesmo se o plano não tiver nenhum SI com `**Test Specs:**` (caso fase backend pura: passa pelo preflight novo mas todos os greps retornam vazio = OK).

- **Test Specs preflight (only when `PLAN_MODE=modern`)**: single Bash command that detects MISSING + STALE specs e `_pending_` markers. Output vazio → continue; output com linhas → abort com a output literal + mensagem `"Run /plan-test-specs <slug> first."`.

  ```bash
  PLAN_MTIME=$(stat -c %Y "$PLAN")

  # (a) Aborta se ainda há _pending placeholders (significa que /plan-test-specs nunca rodou)
  PENDING=$(grep -c "^\*\*Test Specs:\*\* _pending" "$PLAN" 2>/dev/null)
  [ "${PENDING:-0}" -gt 0 ] && echo "PENDING TEST SPECS: $PENDING SI(s) ainda têm placeholder. Run /plan-test-specs <slug> first."

  # (b) Aborta em MISSING ou STALE — extrai TODOS backticked paths da linha (cross-layer pode ter múltiplos)
  grep -n "^\*\*Test Specs:\*\* see " "$PLAN" | while IFS= read -r line; do
    echo "$line" | grep -oE '`[^`]+`' | tr -d '`' | while IFS= read -r SPEC_PATH; do
      [ ! -f "$SPEC_PATH" ] && echo "MISSING: $SPEC_PATH"
      [ -f "$SPEC_PATH" ] && [ "$(stat -c %Y "$SPEC_PATH")" -lt "$PLAN_MTIME" ] && echo "STALE: $SPEC_PATH"
    done
  done
  ```

## Execution order

Implement SIs in the order defined by the **Dependency Map** in the plan document. If the Dependency Map contradicts any SI's `Dependencies:` field, the `Dependencies:` field is authoritative — derive the order from those fields using a topological sort and stop to report the inconsistency to the user. An SI can only start once all its dependencies are complete (tests passing where the SI has a Tests section).

Never skip ahead. Never implement two SIs in parallel in the same run. The guarantee "previous SI is complete (tests passing where the SI has a Tests section) before the next starts" is the core value this skill provides; violating it defeats the purpose.

## Set up the SI task list — before entering the per-SI loop

Before implementing the first SI, you **MUST** create a persistent task list that contains **one task per SI** in the plan, in the order they will be executed. Use the `TaskCreate` tool (one call per SI).

- Task subject format:
  - **Phase mode:** `SI-NN.X — <SI name>` (e.g., `SI-02.1 — HTTP Infrastructure Foundations`).
  - **Task mode:** `SI-N — <SI name>` (e.g., `SI-1 — Parallel DB Harness`).
  Match the SI labels used by the plan document (see "SI labels" under the Progress file section).
- Task description: a one-line summary of what the SI delivers.
- Task activeForm: what you will be doing while the SI is in progress (e.g., `Implementing HTTP infrastructure`).
- All tasks start as `pending`.

This list is the visible plan the user can see before any code is written. It mirrors the plan document's SI sequence and serves as the execution contract for the session.

**Fresh start** (no progress file found): after creating the task list, create the progress file with all SIs as `pending`.

**Resume** (progress file found): after creating the task list, immediately mark already-completed SIs' tasks as `completed` (based on the progress file). The per-SI loop will skip completed SIs and start from the first `pending` one. If all SIs are already completed but the progress file's `Status` is still `in_progress`, skip the per-SI loop and proceed directly to final verification.

During the per-SI loop:
- Flip the current SI's task to `in_progress` when you start step 1 (Plan the SI).
- Flip it to `completed` at the beginning of step 6, **before** emitting the per-SI completion report and the "Seguir para {next-SI-id}?" question (phase mode: `SI-NN.X+1`, task mode: `SI-N+1`). The `TaskUpdate` and progress file update are the last tool calls allowed before the mandatory STOP in default mode (in continuous mode, the per-SI completion report is emitted, then the next SI's `TaskUpdate → in_progress` follows).
- Never skip tasks, never batch updates — one SI's status is changed at a time.

Do **not** merge multiple SIs into one task. Do **not** add ad-hoc tasks for individual technical actions — those live in the per-SI working memory (step 1), not in the persistent task list.

## The per-SI loop

For each **pending** SI (completed SIs from a previous session are skipped), execute these steps in order. Do not batch them; each step's output informs the next.

### 1. Plan the SI

**Read only this SI's section, not the whole plan doc.** Use the SI-line-number map captured during Preflight:

- `Read(offset=SI_start_line, limit=next_SI_start_line − SI_start_line)` — reads exactly this SI's Description, Technical actions, Tests, Dependencies, Acceptance criteria. For the last SI, the upper bound is the next `## ` heading after the SI — use the top-level-section map (from the Preflight `Grep -n "^## "`) to find it. This is whichever of `## Technical Specifications`, `## Dependency Map`, or `## Deliverables` comes first after Step Implementations (not every plan has Technical Specifications).

**Seek Tech Spec references only when this SI mentions them.**

- **Entities or endpoints** — if the SI's Technical actions or Tests reference a specific entity or endpoint:
  - `Grep -n "^#### <EntityName>"` or `Grep -n "^#### METHOD /path"` on the plan doc → get the offset. When seeking inside `### API Contracts`, skip any `#### Validation Rules` heading (it is not an endpoint).
  - `Grep -n "^##+ "` on the plan doc → list of every heading at level 2 or deeper; pick the first line number greater than the offset from the previous step as the upper bound. If no such line exists (the subsection is the last heading in the document), read to end-of-file. (The Grep tool uses ripgrep/Rust regex — `{3,4}`-style BRE quantifiers do not work here; `##+ ` means "two or more `#` followed by space", which matches any section boundary.)
  - `Read(offset, limit)` → read only that entity/endpoint subsection.
- **Events** — if the SI's Technical actions or Tests reference events, read the entire `### Events/Messages` section: `Grep -n "^### Events/Messages"` to get the offset, then apply the same upper-bound rule above to find the limit.

Do not read all of Data Model or all of API Contracts — seek only what this SI consumes. Error Catalog and Authorization Matrix were already read during Preflight and live in working memory.

**Seek library references only when this SI mentions a specific library.** The plan folder may contain a `library-refs.md` file (sibling of the plan document) grouping library examples under `## {library-name}` headings. If the SI's Technical actions or Dependencies reference a library that has an entry there:
- `Grep -n "^## {library}" library-refs.md` → get the offset.
- `Grep -n "^## " library-refs.md` → pick the first line number greater than the offset as the upper bound (or end-of-file if it's the last heading).
- `Read(offset, limit)` → read only that library's section.

Never read `library-refs.md` in full. A phase typically has 3–5 library entries; any single SI consumes 1–2 of them. Memoize per session — if an earlier SI already read the `@nestjs/jwt` section, a later SI does not re-read it.

Load relevant best-practices skills matching the artifacts this SI builds (e.g., `nestjs-best-practices` for modules/controllers/services, `typeorm` for entities/migrations) — load only what this SI needs, not all available skills. Keep a short internal checklist for this SI: one item per technical action; additionally, when the SI has a Tests section, one item per test file plus a "run tests" item. This is working memory to keep the SI on track — not a formal deliverable.

**Screen SI detection:** frontend SIs use the letter-suffix convention `SI-NN.Xa` (visual shell) + `SI-NN.Xb` (lógica & wiring) per Decisões #32+#33, plus a leading **drift audit-SI** `SI-NN.X.0` (k=0 trailing) emitted by `/plan-build`. Backend auto-split SIs use dotted sub-numbering `SI-NN.X.1` / `SI-NN.X.2` (k≥1) per Decisão #34. **Bootstrap SIs** (synthesized by `phase-b.md` § B2.6 from inventory `(new)` markers) use dotted sub-numbering under the `.0` channel — e.g., `SI-02.0.1` (Infra: shadcn install batch), `SI-02.0.2` (Tests batch), `SI-02.0.3+` (custom-ui / custom-business components). The `.0` channel is disjoint from the capability range `.1+`, so bootstrap and capability SIs coexist without renumbering. SI parsing regex: `SI-\d+\.\d+(?:[a-z]|\.\d+)?` — accepts `SI-NN.X`, `SI-NN.Xa/Xb`, `SI-NN.X.k` (BE auto-split, k≥1; OR drift audit, k=0), and `SI-NN.0.k` (bootstrap, leading) by construction. **`.0` semantics by position:** leading `.0.k` → bootstrap (k≥1); trailing `.0` → drift audit (k=0 RESERVED); trailing `.k` (k≥1) → BE auto-split. Progress tracking at action-level within SI-Xb.

**Plain `SI-NN.X` covers two distinct kinds — both execute on main thread without figma plugin.** A plain SI ID (no letter suffix, no dotted sub-number) is emitted by `/plan-build` for either: (a) **backend SIs** — Technical actions reference `### Data Model`, `### API Contracts`, `### Authorization Matrix`, etc. (Decisão #34); (b) **Frontend Runtime SIs** — Technical actions reference `### Frontend Runtime → ####`. Both cases skip the figma-implement-design plugin load by construction — the plugin is only loaded for `Xa` letter-suffix SIs (the SI-Xa branch below). Discriminator at runtime: read the SI's Technical actions to identify which Tech Specs subsection is cited; load best-practices skills accordingly (e.g., `vercel-react-best-practices` for FE Runtime SIs that adopt TanStack Query / React Compiler patterns; `nestjs-best-practices` for backend SIs).

**SI-NN.X.0 — Drift audit (precedes every SI-Xa):** load `figma:figma-implement-design` plugin skill. The audit's purpose is to surface DS-component drift to the user via `frontend-drift-report.md` BEFORE SI-Xa applies any DS file edits. The audit RECORDS decisions; it does NOT apply edits. Schema reference: `.claude/skills/plan-build/references/frontend-drift-report-schema.md`.

Sub-steps in order:

**1. Read prior sections of `frontend-drift-report.md`.** The file lives at `docs/phases/phase-NN-{slug}/frontend-drift-report.md` (sibling of plan doc) when this is not the first audit-SI of the phase. If the file exists, parse all `## Screen: ...` sections and build a `prior_decisions` map keyed by `component_path → (status, decision, source_si)`. If the file does not exist (this is the first audit-SI of the phase), `prior_decisions` is empty and the audit-SI will CREATE the file in sub-step 5.

**2. Read this screen's UI Contract — Reused DS list + Figma URL.** The SI-NN.X.0 block carries `**Figma:**` (URL) and `**UI Contract:**` (pointer to `#### Screen: <name>` subsection). Bounded-read the screen subsection (locate via `Grep -n '^#### Screen: '`, pick the cited screen, upper bound = next `^#### ` or `^### ` line). Pull the **`**Reused DS components:**` bullet list verbatim** — the rich form `<path> [(new)?] — <usage hint>`. Each path is canonical (e.g., `components/ui/button.tsx`); the `(new)` marker is documentation-only — at audit-SI runtime the file always exists on disk because bootstrap SIs (`SI-NN.0.k`) ran first per Dependency Map (B2.6 Step 5 wires bootstrap → audit-SI dependencies).

**3. Invoke `figma:figma-implement-design` with the narrow handoff.** Same handoff shape as SI-Xa (Decisão #31 — no auth, no errors, no validation):

- Figma URL (from `**Figma:**` field)
- Reused DS list (path + usage hint)
- Server-connected component **names only**
- Target paths (inferred from route + framework convention) — read-only context for the audit; no writes happen here

**Screenshot discipline:** pass `excludeScreenshot: true` to `get_design_context` when a separate `get_screenshot` call follows. One image per audit-SI invocation, not two.

The plugin returns design context (structured representation) and a screenshot. The reference snippet's `<Component prop='value-A' ...>` calls form the **demand list** consumed by sub-step 4 — the same demand list shape SI-Xa used to consume in the pre-audit-SI model.

**4. Classify each Reused DS component per the 4-value status enum + populate Decision per default policy.** For each component in the Reused DS list, read the file from disk and diff against the Figma demand.

**Before composing `auto-Edit "<specifics>"` Decisions, consult the project's design-system alias map** (one-time per `/implement` session — memoized, same pattern as library-refs.md):

- `Bash test -f .claude/rules/design-system.md` (typical project path; adjust per project convention).
- If present: `Grep -n '^## .* Aliases' .claude/rules/design-system.md` to locate the aliases section → bounded-Read it (upper bound: next `^## ` heading or end of file). Parse the table into an in-memory map: `(figma_value, component_path) → code_variant`. Component scope `*` matches all paths.
- If absent (no rule file, or no aliases section): alias map is empty; audit proceeds — additive fallback applies.

Apply the discriminator from the schema reference:

- `alinhado` → byte-level match between DS value and Figma value (same Tailwind utility, custom-property reference, or mathematical equivalence)
- `drift menor` → deviation within DS token system, same token family/category (e.g., `rounded-xl` vs `rounded-md`)
- `drift relevante` → missing surface (variant / prop / state demanded but undeclared), system breakage (different token family), hardcoded leak (hex/rgb literal), or component file absent on disk
- `componente ausente` → file listed in Reused DS list does not exist on disk

For `drift menor` / `drift relevante`, compose `auto-Edit "<specifics>"` per the **3-form constraint** in schema § "Naming constraint for `auto-Edit` `<specifics>`" — try in order; first match wins:

1. **Exact-name retune** — DS file has a variant with the same name as the Figma demand value → emit `auto-Edit "retune <prop>: <existing-variant> — <old> → <new>"`.
2. **Alias-mapped retune** — alias map contains `(figma-name, *)` (global) OR `(figma-name, <this-component-path>)` (per-component) → emit `auto-Edit "retune <prop>: <code-variant> per Figma '<figma-name>' demand — <old> → <new>"`.
3. **Additive fallback** — neither exact nor alias matches → emit `auto-Edit "+<dim> '<figma-name>' from Figma demand"`. The `<figma-name>` is **byte-literal** from the Figma component property; **inventing names from screen context (slug, route, feature, business domain) is forbidden** per schema § Naming constraint.

Default decision per status (see schema § Default decisions):

- `alinhado` → `skip`
- `drift menor` → `auto-Edit "<specifics>"` (per 3-form constraint above)
- `drift relevante` → `auto-Edit "<specifics>"` (default per 3-form constraint above — try retune first, fall back to additive; cross-screen consultation below may upgrade to CONFLICT prefix — CONFLICT default verb body is **form 3 only** (additive) per schema § Decision row, since forms 1 + 2 retune existing variants and would break the prior screen)
- `componente ausente` → `create`

**Cross-screen consultation (CONFLICT detection).** For each Reused DS component, look up its `component_path` in `prior_decisions`:

- If absent → first-time component; standard discriminator flow; `**Prior:**` is `_(none)_`.
- If present AND prior decision was `exception "<reason>"` → re-classify standalone (no auto-Edit was applied; file in original state); `Prior: "exception at <source_si> — '<reason>'"` (informational only, no CONFLICT framing).
- If present AND current Figma demand reproduces prior outcome → `status: alinhado`, `decision: skip`, `Prior: "<prior summary> at <source_si> honored"`.
- If present AND current Figma demand DIVERGES from prior outcome → `status: drift relevante`; verb is `CONFLICT` rendered in the vertical hierarchical format per schema § Decision:

  ```markdown
  - **Decision:** `CONFLICT`
    - **Note:** <one-liner describing divergence — e.g., "current screen demands `size: lg`, prior demanded `size: md`">
    - **Verb body:** `auto-Edit`
      - +<dim> '<figma-name>' from Figma demand
  ```

  `Prior: "<prior summary> at <source_si>"`. **Default `**Verb body:**` is `auto-Edit` form 3 only** (additive — new variant identity); forms 1 + 2 (retune existing or alias-mapped) are structurally unsafe in CONFLICT cases because they modify variants the prior screen depends on. **The naming constraint from sub-step 4 (and schema § Naming constraint) still applies** — `<figma-name>` is byte-literal from the current screen's Figma component property; inventing names from screen context is forbidden. User reviews and may override at the file-based checkpoint (e.g., switch the `**Verb body:**` to a retune form, accepting the prior-screen-break risk).

**Variant-conflict scan.** After deciding the base-form drift bullets above, run a second pass: for every property the auto-Edit bullets target (e.g., `background`, `border`, `border-width`, `radius`, `padding`, `gap`, `text-size`, `font-weight`), grep the DS file for sibling utilities of the SAME property under any Tailwind variant prefix. Variant prefixes come in two shapes that BOTH need coverage: (a) **concise** — single-word or hyphenated identifiers like `dark:`, `hover:`, `focus:`, `focus-visible:`, `disabled:`, `aria-invalid:`, `data-checked:`; (b) **bracket-arbitrary** — Tailwind v4's `data-[<attr>=<val>]:` / `aria-[<attr>=<val>]:` forms like `data-[state=open]:`, `data-[size=sm]:`, `aria-[expanded=true]:`. Variant prefixes can also be **chained** (e.g., `dark:hover:`, `dark:data-[state=checked]:`) up to a few levels deep. A regex covering all three shapes: `(?:^|\s)((?:[\w-]+(?:\[[^\]]+\])?:){1,3})(bg|border|rounded|p[xytrbl]?|gap|text|font)-` — breakdown: `[\w-]+` matches the identifier (concise + hyphenated), `(?:\[[^\]]+\])?` optionally captures a bracketed arbitrary value, `:` terminates each prefix, `{1,3}` allows chaining.

For each sibling found, classify:

- **Stale shadcn/library opinion that conflicts with the project's token-driven control** — e.g., DS file has `bg-transparent ... dark:bg-input/30` and the audit is moving `bg-transparent` → `bg-input-background` (a project token explicitly designed to cover both modes via cascade). The `dark:` variant has higher specificity (`0,2,0` vs `0,1,0`) and would override the new base utility under `.dark`. Emit an additional bullet: `drop variant override: <variant>:<prop>-<value> (conflicts with token-driven <prop>)`.
- **Legitimate state utility that drifts from Figma's resolved value in the same state** — e.g., DS has `hover:bg-muted` but Figma's hover state demands a different fill. Emit: `retune variant override: <variant>:<prop>: <old> → <new>`.
- **Legitimate state utility that does NOT drift** — leave alone; do not emit a bullet.

The classification is project-aware: read `globals.css` (or the project's design-system rule file) to know which custom properties are dual-mode tokens (have light + dark resolutions). When such a token exists for the property the audit is tuning, **`dark:`-style mode-covering variants on that property are stale by definition** — the project chose the token paradigm; the cascade already covers the dark mode via the token, so the `dark:<prop>-X` utility is residual coupling from the library scaffold (typical with `npx shadcn add`) that overrides the token via specificity. Emit `drop variant override:` for those. **State variants (`hover:`, `focus:`, `focus-visible:`, `aria-*:`, `data-*:`, etc.) are NOT stale** — they scope a state, not a mode the token covers; classify them per the retune-vs-skip path above (retune if value drifts from Figma's same-state demand, skip if it matches).

These bullets are **outside the 3-form Figma-name-anchored constraint** (they target stale code-side opinions, not Figma demand). See schema § "Variant-conflict bullets" for their canonical form.

**5. Write the section to `frontend-drift-report.md`.** Compose a `## Screen: <slug> — audited at SI-NN.X.0 ({YYYY-MM-DD})` section per the schema § Body. The section is **vertical, NOT tabular**: it consists of a `**Quick scan:**` tally line, a TOC bullet list (one bullet per component), and one `### {path} — {ComponentName}` H3 section per component with `**Status:**` / `**Decision:**` (with nested specifics bullets per the hybrid intelligent format) / `**Prior:**` fields.

**Hybrid intelligent format rules (per schema § Decision):**

- `skip` → inline (no nested bullets).
- `auto-Edit` → bulleted; one specifics bullet per drift dimension (≥1; multi-dimension drift → multi-bullet).
- `exception` → bulleted with one `reason:` bullet.
- `create` → bulleted with one `source:` bullet.
- `CONFLICT` → bulleted with `**Note:**` bullet (audit's diagnostic) + `**Verb body:**` sub-section nesting its own verb + specifics. CONFLICT default verb body is `auto-Edit` form 3 only (additive).

Compose the TOC bullets deterministically from the H3 sections per the suffix rules in schema § Body "TOC format". The `Quick scan` tally is the count of each Status enum value.

Two write cases:

- **First audit-SI of the phase** (file does not exist) → CREATE the file with frontmatter (`kind: drift-report`, `phase: phase-NN-{slug}`, `plan_mtime: <ISO timestamp captured at this run>`) + H1 `# phase-NN-{slug} — Drift Report` + this screen's section (Quick scan + TOC + H3 sections). Mark "Created: frontend-drift-report.md." in the per-SI completion report.
- **Subsequent audit-SI** (file exists) → APPEND this screen's full section in execution order; OR overwrite-in-place if this same audit-SI ran before (re-run; date in heading reflects last run; TOC + H3 sections re-emitted from current state). Preserve existing frontmatter — `plan_mtime` is immutable per schema § Frontmatter immutability and is NOT recaptured on subsequent runs. Mark "Updated: frontend-drift-report.md." in the per-SI completion report.

**No code edits in the target subproject.** AC enforcement: `git diff --name-only HEAD -- <target-subproject>` after the SI must be empty. The plan folder lives outside `<target-subproject>` so the report file is excluded by path scope.

**6. Pause for user review at Step 6 (default mode).** The user opens `frontend-drift-report.md`, optionally edits Decisions on per-component H3 sections (the file-based override mechanism — see schema § File-based user override mechanism), saves, and responds "Seguir". `/implement` then proceeds to SI-NN.Xa, which reads the (potentially user-edited) report and applies decisions verbatim.

---

**SI-Xa — Visual shell (≤2 Technical actions; depends on SI-NN.X.0):** load `figma:figma-implement-design` plugin skill. SI-Xa is now SIMPLIFIED — drift detection moved to the audit-SI; SI-Xa applies the audit's decisions mechanically and renders the screen. The constraint relaxation from "1 Technical action only" to "≤2 Technical actions" is an intentional template change to accommodate the new 2-action shape (apply drift decisions + visual shell generation).

Sub-steps in order:

**1. Read the Drift Report section for this screen.** The SI-Xa block carries a `**Drift Report:** see \`frontend-drift-report.md\` → \`## Screen: <slug>\`` field. Bounded-read that section — locate via `Grep -n '^## Screen: <slug>'` on the report file; upper bound = next `^## Screen: ` or end of file.

The section is the **vertical hierarchical format** per schema § Body — Quick scan + TOC + N H3 sections (one per component). Iterate H3 sections within the bounded read; the TOC bullet list is auto-generated by the audit and **ignored by SI-Xa** (parser uses H3 sections as the source of truth).

**Per-component parsing algorithm (within the bounded screen section):**

```
For each `^### {path} — {ComponentName}` heading found within the bounded screen section:
  - bound this H3's region: lines from this `### ` heading until the next `^### ` or `^## ` or end of bounded screen section
  - extract `path` and `ComponentName` from the H3 line
  - within H3's region, extract:
    - status_line: line matching `^- \*\*Status:\*\* <value>` → status enum value
    - decision_line: line matching `^- \*\*Decision:\*\* \`<verb>\`` → 5-verb enum value
    - decision_specifics: lines indented `^  - <text>` directly after decision_line, until non-2-space-indented line OR another `^- \*\*` field
    - prior_line: line matching `^- \*\*Prior:\*\* <value>` → informational only
  - dispatch by verb (see step 2)
```

Backslash-escape `**` in regex (markdown bold markers); use ripgrep regex on the bounded read.

**2. Apply Decisions verbatim — mechanical application; no judgment.** For each H3 component section parsed:

- `skip` → no-op (specifics block is empty/inline by construction)
- `auto-Edit` → for **each** specifics bullet (one per drift dimension), apply one `Edit` on the cited DS file using the bullet text per the 3-form constraint in schema § "Naming constraint". Multi-bullet → multi-Edit on the same file
- `exception` → no-op (read `reason:` bullet only for logging in the per-SI completion report; preserves existing DS value)
- `create` → use the `source:` bullet to determine asset/spec. For icons (asset name/role recorded by audit), re-fetch via `figma:figma-implement-design` in sub-step 3 below if asset URL is needed at create time, OR pull from the design context returned by sub-step 3 once it has run. For component files (custom-business-component), create per UI Contract spec
- `CONFLICT` → ignore the `**Note:**` bullet (informational diagnostic, audit-owned). Find the `**Verb body:**` bullet, extract its inner verb (`auto-Edit` or `exception` only on CONFLICT rows — `create`/`skip` categorically incompatible), and recursively apply that verb's nested specifics (auto-Edit's specifics bullets, OR exception's reason bullet)

**No drift detection or auto-judgment in this step.** The audit-SI did the analysis; SI-Xa is mechanical application. If a component's H3 section is malformed (verb not in 5-verb enum, verb incompatible with Status, missing required nested bullet for verb shape, CONFLICT without `**Note:**` or `**Verb body:**`), **halt and ask the user to fix the report** (do not improvise — the report is the contract).

**Path-resolution fallback (rename corner case).** If a path the Drift Report cites doesn't exist on disk (a previous SI-Xa renamed/split the file), grep the DS component directory for a component whose default export name matches the cited file's stem. On exactly one match, treat that as the resolved path and proceed. On zero or multiple matches, **halt and ask the user**.

**Post-edit variant-conflict guard (defense-in-depth).** After applying every `auto-Edit` bullet that introduces or retunes a base-form (no variant prefix) Tailwind utility on property X (e.g., `bg-input-background`, `rounded-md`, `border border-border`), grep the same DS file for sibling utilities of property X under any variant prefix — both **concise** (`dark:`, `hover:`, `focus:`, `disabled:`, `data-checked:`, etc.) and **bracket-arbitrary** (`data-[state=open]:`, `aria-[expanded=true]:`, etc.), including **chained** forms (e.g., `dark:hover:`, `dark:data-[state=checked]:`) — using the same regex shape from the audit-SI's variant-conflict scan. If a sibling is found AND the Drift Report's H3 section for this component does NOT contain a `drop variant override:` or `retune variant override:` bullet for it: **halt and ask the user** with a one-liner like `"<file>: applying base utility 'bg-input-background' but found sibling 'dark:bg-input/30' uncovered by Drift Report — variant has higher specificity (0,2,0) and would override base in dark mode. Drop, retune, or keep?"`. The user resolves with one of: (a) drop the sibling (apply an extra Edit removing it from the class string), (b) retune the sibling (apply an extra Edit changing its value), (c) keep the sibling (proceed; the user accepts the override behavior). The chosen action is recorded in the per-SI completion report's `Updated existing DS:` annotation. This guard is the defense-in-depth complement to the audit-SI's variant-conflict scan — catches drift that the audit missed (e.g., a variant prefix the audit's regex didn't enumerate, or a project where the dual-mode token paradigm wasn't legible from `globals.css`).

**3. Visual shell generation — invoke `figma:figma-implement-design` with the narrow handoff (Decisão #31).** Pass:

- Figma URL (from SI-Xa `**Figma:**` field)
- Reused DS list (path + usage hint) — *now reflecting the DS edits applied in sub-step 2*
- Server-connected component **names only**
- Target paths (inferred from route + framework convention)

**Do NOT pass** Auth requirement, Rendering strategy, Error Catalog mapping, Client-side validation mirror, or endpoint references — those concerns belong to SI-Xb.

**Screenshot discipline:** same as audit-SI — pass `excludeScreenshot: true` to `get_design_context` when a separate `get_screenshot` call follows.

Translate the reference snippet into project-shaped code using the (now-aligned) DS components. Write `<page.tsx>` and `<form-component.tsx>`.

**Anti-pattern — NO call-site override of intrinsic visual identity.** Allowed via call-site overrides: utilities that **position the component relative to its parent** (full-width fill, margin, flex grow/shrink, gap, alignment). Forbidden: any utility / style / inline rule that re-defines the component's intrinsic visual identity (dimensions, typography, color, border, radius, background) — the fix for those belongs at the DS file via the audit's `auto-Edit` rows, not at the call site.

**SI-Xa completion report extension.** When the audit's Decisions list `auto-Edit` / `create` rows for DS files, SI-Xa applies them. The per-SI completion report (Step 6 below) carries an `Updated existing DS:` line listing each modified DS file with a one-token annotation matching the verb body (`(+variant '<name>')`, `(+variant '<name>' (retuned))`, `(+prop '<name>')`, `(+state '<name>')`, `BREAKING(prop): <one-liner>`, `BREAKING(rename): <one-liner>`). For `BREAKING(rename)` cases, caller files patched as a side effect go on `Updated:` (not `Updated existing DS:` — callers are not DS components). See Step 6 for the canonical shape.

After SI-Xa completes, **stop invoking** `figma:figma-implement-design` for the rest of the screen's work (SI-Xb + onward). This is the cadencing mechanism — not literal skill unload, but behavioral: SI-Xa loads Figma MCP data during its single invocation; MCP releases data when invocation returns; SI-Xb runs without re-invoking figma plugin → no accumulated Figma context. Framework-specific sub-skills (`next-auth-guard`, `react-hook-form-validation`, etc.) load fresh into SI-Xb scope without MCP pressure.

**SI-Xb — Lógica & wiring (≤5 Technical actions):** executed by `/implement` main thread OR framework-specific sub-skills when available. Actions map UI Contract fields → concrete code edits:

- Route guard (Auth requirement)
- Rendering strategy (TD-derived or placeholder)
- Endpoint wiring (using shared types per Decisão #29)
- Error mapping (Error Catalog → UX mapping table)
- Client-side validation mirror (mirrors BE Validation Rules)

Progress tracking at **action-level granularity within SI-Xb** — each action marked completed individually in progress.md. Rerun after context limit picks up at first incomplete action.

**Conditional skip of SI-Xb (Decisão #33):** some screens have no SI-Xb emitted (`/plan-build` decided pure-presentational). `/implement` simply doesn't see SI-Xb for those screens — SI-Xa alone completes the screen. No special handling needed.

### 2. Implement the technical actions

Work through the technical actions in order. Stay within scope — only touch files required by **this** SI. If you notice unrelated issues (dead code, formatting, refactoring opportunities), note them for the user but do not act on them.

**SI-Xa exception (frontend visual-shell SIs only):** SI-Xa applies the audit-SI's `auto-Edit` / `create` Decision rows verbatim (see Step 1 → SI-Xa branch sub-step 2), which explicitly puts **DS component files cited in this screen's Reused DS list IN scope** — extending those files (new variant / prop / state, or breaking rename per the documented annotation categories) is what the SI semantically requires for the screen to render correctly. The "stay within scope" rule applies to UNRELATED files (siblings, ancestors, unrelated subtrees), not to DS components the audit-SI's Drift Report names. Every modification to a DS file MUST surface in the per-SI completion report (`Updated existing DS:` line) so the user reviews the change at the per-SI pause. **Audit-SIs (`SI-NN.X.0`) do NOT trigger this exception** — by construction the audit produces no code edits; its scope is bounded to writing `frontend-drift-report.md` (outside the target subproject). Backend SIs and Frontend Runtime SIs do NOT trigger this exception either (they don't have a `**UI Contract:**` field nor a Reused DS list); their scope rule is the standard one above.

When the SI introduces new dependencies, install them with the exact version ranges listed in the SI's technical actions.

Follow the target subproject's conventions. When you need to discover naming/style/structure patterns of the subproject (e.g., "how are services organized", "what's the module structure convention"), delegate the exploration to a subagent via the `Agent` tool with `subagent_type: Explore`. The subagent reads the neighbor files in its own context and returns a concise summary, keeping the full file contents out of your main session. Only read a specific neighbor file directly when you need to modify it or mirror it closely — not when you're just learning conventions. The "mirror closely" case still follows the **Targeted Reads** preference below: read only the sections you are actually mirroring, not the whole file.

Scope note: `Explore` is for **project-specific** conventions (file naming, folder layout, local helpers, repository idioms) that the loaded best-practices skills (e.g., `nestjs-best-practices`, `typeorm`) do **not** cover. If the convention you need is already documented by a loaded skill, use that — don't spawn Explore redundantly.

**Explore response contract** — when invoking `Explore`, specify the response format explicitly in the prompt, requesting the minimum sufficient detail. Default templates:
- Learning a convention → prose description + 1–2 short examples (5–10 lines each), **not the full file**.
- Understanding a neighboring class or API → **signatures only** (class/method names, parameter types, return types) — never the bodies.
- Discovering folder layout → a path tree, no file contents.

Never phrase the prompt as "show me the file" — phrase it as "summarize the pattern / list the signatures / describe the convention". If the summary reveals you actually need the contents of a specific file, do a **targeted Read of just that one file** (using `offset` + `limit` centered on the relevant section, per the Targeted Reads rule below) — or a full-file Read only when you genuinely need to rewrite most of it. Don't pay the cost of having Explore return many full files upfront.

**Subagent inheritance caveat** — like any subagent (see the full rationale in step 4's test-subagent contract), `Explore` does **not** inherit Claude Code's system prompt: CLAUDE.md files and `.claude/rules/*` are invisible to it. For pattern discovery from source files this is usually fine — the code itself is the authoritative source. But if the convention you're asking about is documented **only** in a CLAUDE.md or a rule file (not observable from code), include a pointer to that file in the invocation prompt so `Explore` can Read it.

**Targeted Reads** — when you Read a subproject file directly (either after Explore or in any other context), prefer `offset` + `limit` over whole-file reads. Examples:
- To inspect a class's shape → read the first ~30 lines.
- To read a specific method → use `Grep -n "methodName"` to locate the line, then Read with `offset` centered on it and a small `limit` (e.g., 40 lines).
- To check imports/exports → read only the first ~20 lines.
- To mirror an existing test file → read imports + setup block (top ~20 lines) + one representative `describe` block (next ~40 lines via `Grep -n "^  describe\\|^describe"` + `Read` with offset). The remaining `describe` blocks typically repeat the same pattern; pull more only if you need a specific edge case.

Full-file Reads are warranted only when you are rewriting most of the file or genuinely need to see cross-cutting structure. A Read of a 500-line file that you only wanted 30 lines of is 470 lines of wasted context for every subsequent turn.

### 3. Write the tests

If the SI has no Tests section, OR the Tests section is the empty form `**Tests:** _(empty — <reason>)_` (per `phase-b.md` § "Tests format invariant"), skip this step and steps 4–5, and go straight to step 6 (pause). Otherwise, continue below.

Create the test files listed in the SI's Tests section table (column `Test file` of each row). Use the testing guide skill as the reference for what to test at each layer and best practices per artifact. Each test must verify something specific the SI introduces — do not write placeholder tests.

Cover the SI's Acceptance Criteria. Every AC owned by this SI should be observable from at least one of this SI's tests (the AC-to-test mapping is not always 1:1, but no AC should be untestable). Note: SIs with no testable artifacts (infrastructure SIs where behavior is exercised through other SIs' tests, pure-configuration SIs, screen visual-shell SIs whose Unit tests are owned by the wiring SI, or similar) emit the empty form `**Tests:** _(empty — <reason>)_` instead of a table — the skip branch above covers all such cases. Legacy plans (pre-invariant) may still have a literally absent Tests section; the same skip branch covers them too.

#### 3a. JIT spec read — only when `PLAN_MODE=modern` AND the SI carries `**Test Specs:**`

When the current SI has a `**Test Specs:**` field pointing at a real spec path (not `_pending_`), perform spec-derived test authoring **before** creating the inline Tests-section files. The model is **single-pass LLM-authored** for both frontend and backend runners — the main thread reads the spec and writes the test file directly in one pass. The frontend (Playwright) path additionally **loads the vendored `playwright-cli` Skill into context** for active reference of Playwright code patterns (selectors, fixtures, locator API, mocking idioms); the backend path relies on the **`testing-guide-{subproject}` Skill already loaded at Step 2** for E2E what-to-test, gotchas, and best practices per artifact — no additional skill load is needed at 3a for the backend runner.

> **Important — what is NOT done here:** the binary subcommand `playwright-cli generate <spec>` does NOT exist (only `generate-locator <ref>` exists, for generating a single locator expression from a snapshot ref). The Section 2 "Generate" workflow of the vendored skill is interactive (requires a running app + browser attach + manual step-walking) and is not invoked by `/implement` because no app is running yet at SI-N time. The Skill load below is for **pattern reference**, not for executing the interactive workflow.

1. **Extract every backticked path** from the SI's `**Test Specs:**` line. Single-subproject SI has 1 backticked path; cross-layer SI has 2 paths comma-separated. Use `grep -oE '\`[^\`]+\`' | tr -d '\`'` to extract both cases uniformly.

2. **For each extracted spec path**, process independently (cross-layer runs the loop twice):

   - **Read** the spec (single Read, full file — specs are small).
   - **Determine runner** via the spec frontmatter `subproject:` field. This field carries a **semantic role** (`frontend` | `backend`) — not a subproject directory name. Map the role to the runner: `frontend` → Playwright (load `playwright-cli` Skill at step 3 below); `backend` → the backend subproject's test runner (framework conventions auto-loaded from the target subproject; the `testing-guide-{subproject}` Skill already loaded at Step 2 informs what-to-test and best practices per artifact — no additional load needed at 3a). The role-to-directory mapping is project-specific and is the same one used by Step 2's per-subproject skill load.
   - **Author the test file in TS, single-pass.** Interpret each scenario's `Steps:` + `- expect:` bullets and emit one `test()` block per scenario inside one `test.describe()` block. Save UM arquivo no path declarado pelo `target_file:` field do frontmatter do spec (e.g., `tests/e2e/signup.spec.ts` for frontend, `test/auth-register.e2e-spec.ts` for backend). Cardinality: **1 spec → 1 file with exactly one `test.describe()` containing N `test()` blocks** (NOT 1 describe per group, NOT 1 file per scenario — the project rule is one file per feature/flow). The `describe()` label is the spec's `<feature>` (the filename stem, e.g. `signup` from `tests/e2e/signup.spec.ts`). Group headings (`### N. <Group Name>`) are NOT used as describe labels — they exist only as organizational markers inside the `.plan.md`; in the generated `.spec.ts` they may appear as a comment above each block of `test()`s but never as nested describes.

3. **Frontend — load `playwright-cli` Skill for pattern reference (active invocation).** Before authoring the `.spec.ts`, invoke:

   ```
   Skill: playwright-cli
   ```

   The skill load makes the vendored references available **in the LLM's context** during authoring, so the test code uses correct Playwright idioms without guessing. The references most relevant to authoring:

   - `references/test-generation.md` — how each user step maps to Playwright TS (selectors via `getByRole`, `getByLabel`, action APIs like `fill`/`click`/`press`).
   - `references/request-mocking.md` — `page.route()` patterns. **Do NOT use `page.route()` in generated specs.** The project mocks at the handler layer via the MSW network fixture (`tests/fixtures.ts`); per-scenario overrides MUST use `network.use(http.post(...))` (the MSW fixture override path), not `page.route()`. The reference is loaded so the LLM can recognize `page.route()` patterns when reading vendored docs, but it must NOT emit them.
   - `references/element-attributes.md` — preferred locator strategies.

   The skill load does **not** trigger any binary execution — it just enriches LLM context with the pattern library. The LLM then authors the `.spec.ts` file itself, leveraging the loaded patterns + the spec's `Steps:` + `expect:` bullets.

4. **Imports — runner-specific:**

   - **Frontend (Playwright):** import the test entry-point per the frontend subproject's testing conventions (typically a per-test fixture file rather than `@playwright/test` directly when the project uses MSW network fixtures). The `Setup:` field on the group declares which fixture provides the per-scenario setup. What to test (and what to skip), gotchas, and best practices per artifact come from the **`testing-guide-{subproject}` Skill already loaded at Step 2** for the frontend subproject — no additional skill load at 3a.
   - **Backend:** the `Setup:` field on the group declares the per-test setup pattern (typically a per-test data cleanup + test module bootstrap; e.g., for a NestJS-style backend: `beforeEach` truncate + `Test.createTestingModule(...).compile()`). Imports follow the backend subproject's testing conventions; what to test (and what to skip), gotchas, and best practices per artifact come from the **`testing-guide-{subproject}` Skill already loaded at Step 2** for the backend subproject — no additional skill load at 3a.

5. **Keep the generated file path in working memory** (1 path per spec, NOT N) — this list feeds Step 4 below.

After completing 3a, proceed with the inline Tests-section files (Unit / Integration / handler tests) per the original Step 3 prose above. Cross-layer SI processed in this step authors 2 spec-derived test files (1 frontend `.spec.ts` + 1 backend `.e2e-spec.ts`) plus whatever inline Tests entries the SI lists.

**Subagent caveat (preserves existing pattern):** the spec content + the loaded Skill context are consumed **only by the main thread** during 3a (authoring) and discarded naturally. The subagent at Step 4 receives only the resulting test file paths — never spec content nor the skill reference docs. The existing pattern of "subagent reads CLAUDE.md, runs the test files listed, returns a noise-stripped report" is unchanged.

### 4. Run the tests for this SI

Delegate test execution to a subagent via the `Agent` tool with `subagent_type: general-purpose`. The subagent absorbs the raw output in its own context and returns you a **diagnosis-preserving, noise-stripped** report, keeping verbose test output out of your main session.

Instruct the subagent to:
- **First, read `{target-subproject}/CLAUDE.md`** to learn the subproject's command conventions (containerization, env vars, wrappers, etc.). Subagents receive **only** their invocation prompt plus basic environment details (cwd) — they do **not** inherit Claude Code's system prompt, so neither the root `CLAUDE.md` nor the subproject `CLAUDE.md` is visible to them until explicitly read. Without this Read, the subagent will guess a plausible-looking invocation that may run in the wrong environment (e.g., on the host instead of in the container).
- Run **only** the test files listed in the SI's Tests section — never the full suite. **Modern mode extension:** when `PLAN_MODE=modern` AND Step 3a authored spec-derived files, the list sent to the subagent is the **union** of (Set A) the SI's inline Tests-section paths and (Set B) the spec-derived files saved in working memory. The subagent infers the runner per path/extension based on the subproject's testing conventions (Playwright for `tests/e2e/*.spec.ts`; for other paths, the runner is determined by the per-subproject test conventions — e.g., a frontend unit runner for `*.spec.tsx` in `components/`, the backend's E2E runner for `test/*.e2e-spec.ts`). 1 spec → 1 entry in Set B (NOT 1 per scenario; the file holds N `test()` blocks). Critério de SI completo é unchanged: subagent reports "all N tests pass" para a lista combinada A ∪ B; if any file from A OR B fails, Step 5 fix loop entra. Modo legacy (`PLAN_MODE=legacy`): Set B does not exist; lista enviada ao subagent é apenas Tests-section inline (which in legacy plans may include rows E2E authored as prose by the old `/plan-build`). Behavior Step 3/4/5 stays byte-by-byte preserved.
- **Preserve all diagnostic content verbatim** — test names, failure messages, assertion diffs (actual vs expected), stack frames pointing into subproject code, console output emitted by the test, setup/teardown errors, timeouts, unhandled rejections. When in doubt, include it.
- **Strip only noise** — framework-internal stack frames (e.g., test framework or DI container paths, vendored dependency directories), startup/shutdown banners, coverage tables, and passing-test listings (report these as a single count: "N tests passed").
- **Fallback to raw output** when: (a) the raw output is already small (<2k tokens), or (b) the subagent is uncertain whether something is diagnostic or noise. Over-inclusion is always preferred to under-inclusion.
- For fully passing runs: report "all N tests pass" and nothing else.

**Rule:** if after reading the subagent's report you still cannot diagnose the failure, re-invoke the subagent with explicit instructions to return raw stdout/stderr verbatim. Losing diagnostic fidelity is never an acceptable cost-saving measure — the subagent exists to filter boilerplate, not to abstract failures.

### 5. Handle test failures (up to 3 fix attempts)

If tests pass on the first run, proceed to step 6 (pause).

If tests fail, enter the **fix loop**: read the failure output, diagnose the root cause, apply a focused fix, re-run the same tests. Do this at most **3 times**. Count attempts deliberately — do not lose count and loop indefinitely.

Fix-loop discipline:
- **Diagnose from the report.** Work from the subagent's noise-stripped report delivered by step 4 — that *is* your view of the error. Do not retry blindly. If the same fix is applied twice, that's a sign the diagnosis is wrong. If the report is insufficient to pinpoint the failure, invoke the subagent again with explicit instructions to return raw stdout/stderr verbatim.
- **Fix the root cause.** Do not weaken tests to make them pass. Do not add skips, `.only`, or `xit`. Do not catch and swallow errors just to hide them.
- **Stay in scope.** If the failure reveals a problem in a previous SI's code, stop — that's a signal to escalate, not to quietly edit a completed SI.
- **No shortcuts.** Never disable hooks or bypass safety checks.
- **Re-run via the same subagent pattern** (see step 4). Each re-run returns a fresh noise-stripped report covering the *current* state. Do not re-read previous reports for context — your diagnosis from the previous iteration already lives in your working memory, and the new report only needs to tell you what is currently failing, not replay the full history. If the new report lacks enough information to understand what changed between attempts, instruct the subagent on the next re-run to return raw output verbatim. Diagnostic clarity trumps token savings.

After 3 unsuccessful fix attempts, **stop**. Report to the user:
- Which SI is stuck.
- The current test failure output (concise).
- Your hypothesis about the root cause.
- What you've tried.

Wait for the user's guidance. Do not proceed to the next SI until the user unblocks you.

### 6. Pause for confirmation — STOP before the next SI

This step is a **hard stop**. After completing an SI you **MUST NOT** begin the next SI without the user's explicit approval (given per-SI in default mode, or upfront when the user requested continuous mode).

- **Default mode (pause — this is the default)**: First, make a `TaskUpdate` call marking the current SI's task as `completed`, then update the progress file (mark the SI as `completed`, record test results and any out-of-scope observations noted during this SI) — these are the final tool calls permitted in this step. Then emit the per-SI completion report (see "Per-SI completion report shape" below) and emit exactly this question as the final line of your message, substituting the **next SI's literal id** (phase mode: `SI-NN.X+1`, task mode: `SI-N+1`): **"Seguir para {next-SI-id}?"**. Then **STOP**. Do not call any further tools. Do not start reading files for the next SI. Do not update the next SI's task to `in_progress`. Wait for the user's reply in a new turn before doing anything else.
- **Continuous mode** (only when the user **explicitly** requested it at the start of the session with phrases like "execute tudo", "autopilot", "don't pause between SIs", or "run all at once"): Still perform the `TaskUpdate → completed` and progress file update, and emit the per-SI completion report (see "Per-SI completion report shape" below), but **skip** the "Seguir para {next-SI-id}?" question and the STOP. Then proceed directly to step 1 of the next SI. If you are unsure whether continuous mode was requested, assume default mode and pause.
- **Last SI of the plan**: Still perform the `TaskUpdate → completed` and progress file update (same as the other modes). The per-SI completion report is folded into the plan-level Completion report (see section below), so skip the per-SI report itself. Then branch by mode:
  - **Default mode (pause — this is the default)**: Emit a short status line ("All N SIs complete. Ready to run the final verification: full test suite, type-check, build.") followed, on a new line, by exactly this question: **"Rodar final verification?"**. Then **STOP**. Do not start any final-verification command until the user replies in a new turn.
  - **Continuous mode** (only when the user explicitly requested it at the start of the session): Skip the pause and go straight to final verification.

Violating this stop is the single most common failure mode of this skill. Treat "Seguir para {next-SI-id}?" as a terminator, not a rhetorical question.

#### Per-SI completion report shape

Canonical lines, in order. Omit any line that does not apply.

- **Header:** `SI-{id} done.` (e.g., `SI-02.7a done.` in phase mode, `SI-3 done.` in task mode).
- **`Drift Report:`** drift audit-SI-specific extension (`SI-NN.X.0` only) — line summarizing the report's Quick scan tally for this screen in the form `<N> components (<a> alinhado, <b> drift menor, <c> drift relevante, <d> ausente)`. The numeric breakdown helps the user spot unusual outputs (e.g., `0 alinhado` suggests something is off) before opening the file. Omit on every non-audit SI.
- **`Created:`** comma-separated list of files created in this SI (relative paths). Omit when none. **Audit-SI special case:** the FIRST audit-SI of a phase emits `Created: frontend-drift-report.md.` (the file is created at sub-step 5); subsequent audit-SIs use `Updated: frontend-drift-report.md.` instead since the file already exists.
- **`Updated:`** comma-separated list of files modified in this SI that were NOT created in this SI (e.g., adding an import to an existing layout). Each entry may carry a one-token annotation in parentheses when relevant. Omit when none.
- **`Updated existing DS:`** SI-Xa-specific extension (frontend visual-shell SIs only) — comma-separated list of DS component files extended via the SI-Xa Decision-application step (the audit-SI's `auto-Edit` rows applied verbatim by SI-Xa, plus any `create` rows for new icons/components); the path layout follows the project's frontend conventions (e.g., `components/ui/*.tsx` in shadcn-based projects; the directory and file naming are project-defined). Each entry carries a one-token annotation: `(+variant '<name>')` for an additive variant, `(+variant '<name>' (retuned))` for a value-drift retune of an existing variant (same name, different concrete values), `(+prop '<name>')`, `(+state '<name>')`, `BREAKING(prop): <one-liner>` for in-place prop / type rename inside one DS file, or `BREAKING(rename): <one-liner>` for component file rename / split that also touches callers. The two `BREAKING(...)` sub-tokens differ in blast radius: `BREAKING(prop)` affects only the DS file itself; `BREAKING(rename)` always comes with one or more caller files on `Updated:`. Caller files patched as a side effect of a rename / split go on `Updated:` (above), NOT on this line — `Updated existing DS:` is reserved for the DS components themselves. Omit on every non-Xa SI (backend SIs, Frontend Runtime SIs, and audit-SIs never emit this line) and on Xa SIs whose Drift Report listed only `skip` / `exception` decisions.
- **`Tests:`** `<n> passing` | `no tests` | `no tests (visual shell)` | `no tests (audit-only)`. Always emit.

Examples:

```
SI-02.7.0 done.
  Drift Report: 12 components (4 alinhado, 5 drift menor, 3 drift relevante, 0 ausente).
  Created: frontend-drift-report.md.
  Tests: no tests (audit-only). Seguir para SI-02.7a?

SI-02.8.0 done.
  Drift Report: 9 components (6 alinhado, 1 drift menor, 1 drift relevante, 1 ausente).
  Updated: frontend-drift-report.md.
  Tests: no tests (audit-only). Seguir para SI-02.8a?

SI-02.7a done.
  Created: app/signup/page.tsx, components/auth/signup-form.tsx
  Updated: components/auth/login-form.tsx, components/auth/forgot-form.tsx
  Updated existing DS: components/ui/button.tsx (+variant 'xs'), components/ui/text-field.tsx (+prop 'leadingIcon'), components/ui/toggle.tsx (+state 'aria-pressed'), components/ui/progress-linear.tsx (BREAKING(rename): split into Progress.Linear + Progress.Root)
  Tests: no tests (visual shell). Seguir para SI-02.7b?

SI-02.3 done.
  Created: lib/upstream-client.ts, app/api/auth/register/route.ts, app/api/auth/login/route.ts, app/api/auth/refresh/route.ts, app/api/auth/forgot-password/route.ts
  Tests: 8 passing. Seguir para SI-02.4?

SI-02.6 done.
  Created: components/auth/auth-provider.tsx
  Updated: app/layout.tsx
  Tests: 4 passing. Seguir para SI-02.7a?
```

## Final verification — after all SIs are done

Once every SI in the plan has been implemented and tested, run the plan-level checks defined in the plan's **Deliverables** checklist. These typically include:

1. **Full test suite**: Run every test command listed in the plan's Deliverables (typically one for unit/integration tests and, when applicable, a separate one for E2E tests). The goal is to exercise every test in the plan together, not just the tests of a single SI.
2. **Type-check / static analysis**: Run the type-check command defined in the plan's Deliverables (e.g., `npx tsc --noEmit` for TypeScript, `mypy` for Python, `go vet` for Go, `cargo check` for Rust). Skip when the stack has no separate type-check phase.
3. **Project build**: Run the build command defined in the plan's Deliverables (e.g., `npm run build` for Node, `python -m build` or `poetry build` for Python, `go build ./...` for Go, `cargo build` for Rust, `mvn package` for Maven) to verify the code compiles and bundles correctly.

Verify any additional deliverables listed in the plan (migrations, documentation updates, seed data, configuration files). These results are presented in the **Completion report** (see section below).

If the plan spans multiple subprojects, the plan's Deliverables checklist will list these checks per subproject (e.g., `All SI tests pass in {backend-subproject}` and `All SI tests pass in {frontend-subproject}`) — run each subproject's commands independently, in the order implied by the checklist.

If any final check fails, apply the same fix-loop discipline as step 5: up to 3 focused fix attempts total (shared across all failing checks, not 3 per check), re-running the affected checks after each attempt. If still failing after 3 attempts, stop and report to the user.

## Completion report

When the phase is fully done, read the progress file and generate the report:
- Results of each deliverable check (from final verification — the only new information at this point).
- Out-of-scope observations aggregated from the progress file (as a list of follow-ups for the user, not as things to act on). Reproduce each entry verbatim — both legacy single-line prose and the new bullet format are valid per the forward-only migration in § "Progress file"; do not normalize across formats.

Mark the progress file's `Status` as `completed`. Git operations (add, commit, push, PR) are out of scope — the user owns version control.

## Rules

- The plan document is the contract. Do not add SIs, drop SIs, or change SI boundaries mid-execution. If the plan is wrong, stop and ask the user to revise it via `plan-pipeline`.
- Before the first SI, create the SI task list (one `TaskCreate` per SI, in order) so the user sees the full plan. Flip each task's status exactly at the boundaries defined in step 1 (`in_progress`) and step 6 (`completed`).
- Respect dependency order — never implement an SI whose dependencies are not yet complete (tests passing where the SI has a Tests section).
- One SI at a time. No parallel implementation within the same phase run.
- Run only the SI's own tests during the loop, via the subagent pattern defined in step 4 — which requires the test subagent to first Read `{subproject}/CLAUDE.md` for command conventions (subagents inherit nothing from Claude Code's system prompt). Save the full suite for final verification.
- When reading subproject files directly, prefer `offset` + `limit` over whole-file reads; full-file reads only when rewriting most of the file. Delegate convention discovery to an `Explore` subagent with an explicit response-format contract (signatures / prose summary / path tree — never full file dumps). See step 2.
- Never weaken tests to make them pass. Never bypass hooks.
- Stay within the scope of the current SI — note unrelated issues, don't act on them.
- After each SI in default mode, **STOP** and wait for user approval before advancing — per-SI transitions via "Seguir para {next-SI-id}?" (phase mode: `SI-NN.X+1`; task mode: `SI-N+1`), and after the final SI via "Rodar final verification?" before starting the plan-level checks. Continuous mode applies only when the user explicitly requested it at the start of the session, in which case both pauses are skipped.
- Stop and ask when the fix loop exhausts its 3 attempts, when a dependency is missing, or when the plan conflicts with reality.
- **Narrow handoff to `figma:figma-implement-design`** (Decisão #31). Pass only Figma URL, Reused DS, Server-connected component names, target paths. **Never** pass auth/rendering/error/validation info — those belong to SI-Xb.
- **SI-Xa and SI-Xb are distinct SIs, not sub-SIs of the same entity** (Decisão #32). Each has its own Dependency Map entry, its own Tests table, its own Acceptance criteria, its own progress.md line. Completing SI-Xa marks Xa done; completing SI-Xb independently marks Xb done.
- **SI-Xb execution is per-action, not monolithic.** Iterate Technical actions (1) through (N ≤5) in order; each marked individually in progress.md as completed. If action (K) fails, SI-Xb is half-done; rerun `/implement {slug}` picks up at action (K).
- **Graceful fallback if figma-implement-design is unavailable.** If the skill is not registered (not installed, plugin absent), halt SI-Xa with error: `"SI-NN.Xa requires skill 'figma:figma-implement-design' which is not available. Install the figma plugin or implement visual shell manually (create target files + mark SI-NN.Xa as manual-done in progress.md) before resuming /implement."`. SI-Xb **does NOT block** on figma plugin availability — if user completes SI-Xa manually and marks it done, `/implement` proceeds normally to SI-Xb. Other SIs (backend) continue executing.
- **Do NOT re-invoke `figma:figma-implement-design` during SI-Xb execution.** Cadencing is behavioral (see SI-Xa block in step 1) — figma-implement-design fires only on SI-Xa, never SI-Xb.
- **Screen SIs are Xa/Xb pairs OR SI-Xa alone** (Decisão #33). Never emit SI-Xb without SI-Xa; never emit a bare `SI-NN.X` without letter suffix for screens (letter suffix is load-bearing).