# Plan Pipeline — Stage 4: Build → Phase B (SIs + Dependency Map + Deliverables)

This file is loaded by `.claude/skills/plan-build/SKILL.md` after Gate 10 dispatches a resume (case 2: both required sentinelas present), OR after Phase A's A5 pause when the user picks "Continue now". Read SKILL.md for preflight gates, dispatcher rules, hard rules, output contract, and rerun semantics — they apply to every phase.

Phase B runs in two scenarios with **different B1 cost profiles**:

- **Same-session continuation** — user picked "Continue now" in A5. `context.md` was fully read at A1 in the same conversation, and each Tech Spec subsection was emitted as an `Edit` `new_string` argument during A4 → both are present in the message log. **B1 is a no-op**; the model proceeds directly to B2 with the inherited working memory.
- **New-session resume** — Gate 10 detected the sentinelas; the model entered Phase B fresh with no Phase A working memory. **B1(a) and B1(b) are both mandatory.**

## B1. Load Phase B inputs (only on new-session resume)

Skip this entire step in same-session continuation. On new-session resume, run both sub-reads:

(a) **`{target_dir}/context.md`** — single full read. Loads `## Decisions Detail` and `## Inherited Decisions Detail` (B4's TD lookups), the scope sections (`## Capability Coverage` + capability bullets in phase mode; `## Scope` prose in task mode — B2's decomposition), the `**Affected subprojects:**` field within `## Scope` (B6's Deliverables command parameterization), and `## Testing Requirements` (per-subproject test command hints for B6).

(b) **`## Technical Specifications` from `{target_path}`** — bounded read of the section Phase A wrote. Locate via `Grep -n '^## Technical Specifications$\|^## Dependency Map$' {target_path}` to get the start and end line numbers (Dep Map heading always sits immediately after Tech Specs, even when its body is still the sentinela). `Read` the line range between them. This loads the materialized Data Model entities, API Contracts endpoints + request/response shapes, Authorization Matrix rows, Error Catalog `errorCode`s, Events/Messages payloads, and (when present) UI Contracts per screen + Traceability Matrix.

The Tech Specs from (b) are the **canonical concrete surface** for B2 and B4 — A's normalization of raw TDs into final field names, route shapes, error codes, and auth rules. B does not re-derive that translation.

If `## Technical Specifications` does not exist in the artifact (Phase A skipped it because no subsection applied AND `ui_in_scope: false` — rare backend-foundations-only case), skip (b).

**On-demand re-read fallback (defensive).** If during B2/B4/B6 the model finds itself unable to recall content that should be in working memory (e.g., a `## Decisions Detail` entry for a cited TD ref is not retrievable; a Tech Spec subsection field needed for an SI Technical action is unclear), the model re-reads on demand from the same source it would have used in B1 (full context.md read; bounded Tech Specs read). This is the recovery path for the rare case where same-session continuation experienced context-window compaction over a long A→B run. Re-reads are not the default — they fire only when needed.

## B2. Decompose scope into Step Implementations (in memory)

Using the scope in context.md (phase mode: `## Capability Coverage` + capability bullets; task mode: `## Scope` prose), the **Tech Specs available to Phase B** (from B1(b) on new-session resume, or from the message log on same-session continuation — see SKILL.md § "Hard rules" → "Phase B Technical actions must align with Phase A Tech Specs") — Data Model entities, API Contracts endpoints, UI Contracts screens that define the concrete implementation surface SIs must collectively cover — and the rules in this file's "Template: SI block" section, the "Template: Screen SI blocks" file (`templates/screen-si.md`, read on demand when `ui_in_scope: true`), and the "Overflow policy" section, draft the list of SIs as a plain list of titles and brief descriptions **in memory** (not in a file). One SI = one cohesive unit of work. Apply the size heuristics:

- Maximum 5 technical actions per SI.
- Maximum 5 test files per SI.
- Separate infrastructure (install, configure) from behavior (implement, test).
- Prefer more smaller SIs over fewer larger ones.

Number SIs as follows:

- **Phase mode:** `SI-NN.1, SI-NN.2, ...` where `NN` is the phase number (dot-prefixed).
- **Task mode:** `SI-1, SI-2, ...` (no prefix — tasks have no external cross-reference by number).

SI order is dependency order (roots first, dependents later). A no-op "Foundations" SI may appear first when the scope only carries inherited TDs that need no new file touches.

**SI decomposition augmented for UI scope (Decisões #32/#33):**

- **Backend-only SIs** — existing granularity (entity, service, controller). ≤5 Technical actions per SI. Cross-ref numbering scheme below.
- **Frontend screen SIs** — by default **split into 3 SIs per screen**: `SI-NN.X.0` (drift audit, 1 action — emits `frontend-drift-report.md` per the schema at `.claude/skills/plan-build/references/frontend-drift-report-schema.md`) + `SI-NN.Xa` (visual shell, ≤2 actions: apply drift decisions + figma plugin invocation, per Decisão #32) + `SI-NN.Xb` (lógica & wiring, ≤5 actions). Pure presentational screens skip `SI-NN.Xb` per Decisão #33 criteria but still receive `SI-NN.X.0` + `SI-NN.Xa` (the audit precedes every visual shell — see "Conditional skip of SI-Xb" inside `templates/screen-si.md`).
- **Frontend Runtime SIs** — flat `SI-NN.X` (no letter suffix, no dotted suffix), one per `#### {td-slug}/TD-NN — {topic}` subsection in `### Frontend Runtime`. Each subsection produces ≥1 SI: 1 Setup SI (provider/root config/lib install) + N Migration SIs (1 per row in the subsection's Migração table) + 1 optional Verification SI (when Verificação requires testing not covered by Setup/Migration). Discriminator vs backend SIs: the SI's Technical actions reference the `### Frontend Runtime → ####` subsection, NOT the backend subsections. Both backend SIs and Frontend Runtime SIs use plain `SI-NN.X` shape (no letter suffix). The conditional-skip rule for `SI-Xb` (Decisão #33) does NOT apply to Frontend Runtime SIs — they are always plain SIs by construction. Read `.claude/skills/plan-build/templates/frontend-runtime-si.md` for the Setup/Migration/Verification template + canonical Dependency contract.
- **Cross-layer SIs** — 1 per end-to-end flow where backend and frontend must be implemented together (rare — usually prefer split backend SI + dependent SI-Xb). Title example: `SI-NN.8 — Fluxo de upload (cross-layer)`.

**Numbering convention (CRITICAL — Decisão #34 Round 7 fix):**

| ID shape | Origin | Example |
|----------|--------|---------|
| `SI-NN.X` | Integer SI — default decomposition (backend OR Frontend Runtime — discriminator is the subsection referenced in Technical actions, not the naming) | `SI-03.5` (backend OR Frontend Runtime) |
| `SI-NN.Xa` / `SI-NN.Xb` | FE screen split (Decisão #32) | `SI-03.5a` (visual), `SI-03.5b` (logic) |
| `SI-NN.X.0` | Drift audit (precedes `SI-NN.Xa`; emits `frontend-drift-report.md` per the schema at `.claude/skills/plan-build/references/frontend-drift-report-schema.md`) | `SI-02.7.0` (audit signup screen), `SI-02.8.0` (audit login screen) |
| `SI-NN.X.k` (k ≥ 1) | BE auto-split (Decisão #34) | `SI-03.2.1` (Infra), `SI-03.2.2` (behavior) |
| `SI-NN.0.k` (k ≥ 1) | Bootstrap SI (synthesis from `<path> (new)` markers — pre-FR, pre-screen) | `SI-02.0.1` (install), `SI-02.0.2` (Test batch) |

`.0` semantics by position (canonical discriminator):

- **Leading** `SI-NN.0.k` → Bootstrap channel; `k ≥ 1`.
- **Trailing (k = 0)** `SI-NN.X.0` → Drift audit; `k = 0` is RESERVED for audit-SIs.
- **Trailing (k ≥ 1)** `SI-NN.X.k` → BE auto-split. The `k ≥ 1` constraint is now explicit — audit-SIs own `k = 0` exclusively, so BE auto-split MUST start at `k = 1`. The SI-parser regex `SI-\d+\.\d+(?:[a-z]|\.\d+)?` accepts all three shapes by construction; no regex change required.

Reader sees `.2.1` vs `.5a` and knows immediately which layer + which decomposition path produced the SI. Plain `SI-NN.X` is the only ambiguous shape — disambiguator is the subsection referenced inside Technical actions (e.g., `(per ### API Contracts → POST /auth/login)` for backend; `(per ### Frontend Runtime → auth/TD-04)` for FE Runtime).

**Cross-slice library propagation for Frontend Runtime libs.** Libraries decided by Frontend Runtime TDs (e.g., `@tanstack/react-query` cited by an `auth/TD-04` marked `Renders in: frontend-runtime`) follow the **same Gate 7 + B2.5 propagation rules** documented in `plan-build/SKILL.md` (Gate 7 verifies sibling `library-refs.md`) and at line 148 of this file (B2.5 sibling-aggregation merge rule "current slice wins"). No Frontend Runtime-specific behavior — the existing flow handles them transparently.

**Dependency Map cross-layer edges:**

- Example: `SI-NN.5b (frontend: signup screen logic) depends on SI-NN.3 (backend: create user endpoint) + SI-NN.5a (visual shell)`.

**Screen count upper bound** — when `ui_in_scope: true`, count screens from `## UI Inventory → UI ↔ Capability Join` (distinct Screen values). If count > 7, emit:

```
FAILED at step-1-decompose. Written so far: scaffold + Technical Specifications. Error: screen count {N} exceeds the documented scale bound (≤7 screens per phase/task, per Decisão #12 — Agent-call overhead of bounded reads beyond this range degrades efficiency). Next: split the scope across multiple phases/tasks, OR defer some screens via plan-resolve UIG-N (option e), OR reclassify the overflow as Non-UI/Deferred, then rerun /plan-build <arg>.
```

This is a hard bound, not advisory.

## B2.5. Library-refs coverage check (current-scope TDs only)

After the SI list is drafted in memory, for each SI identify which TDs it cites and from each cited **current-scope TD** gather the `**Libraries:**` value from the corresponding `### {slug}/TD-XX` entry in `## Decisions Detail` (already in memory from whichever of A1 or B1 ran). Inherited TDs (looked up in `## Inherited Decisions Detail`) do NOT contribute to the coverage set — their libraries, if any, are referenced as prose in Technical actions without a library-refs.md lookup.

Build the set of all current-scope libraries cited by any SI.

**Phase mode note:** `## Decisions Detail` is always non-empty (a phase always has ≥1 TD via its capabilities). The coverage check runs whenever at least one current-scope TD carries libraries.

**Task mode note:** `## Decisions Detail` may be empty (task-sem-research — task was created without a prior `/research` call, and no MD-N surfaced any pending decision). In that case there are zero current-scope libraries to cover; **skip the coverage check entirely** regardless of `library_refs_required`. The grep against `library-refs.md` is never issued.

**If the set is empty** (guaranteed when `library_refs_required` is `false`, always true in task-sem-research, possible elsewhere when no SI cites a current-scope lib), skip the coverage check entirely and proceed to B3 — do not grep `library-refs.md`.

Otherwise, `Grep -n '^### ' {target_dir}/library-refs.md` to list every cached library heading. If any cited current-scope library has no matching `### {lib-name}` heading in library-refs.md, return:

`"FAILED at step-1-coverage. Written so far: scaffold + Technical Specifications. Error: {SI-id} cites library <Y> which is not in library-refs.md. Next: run /plan-resolve <arg> to backfill the library cache before retrying the build."`

The partial artifact (scaffold + Tech Specs + sentinelas) is left in place — Gate 10 on the next run will resume from B1 once the cache is fixed.

## B2.6. Bootstrap SI synthesis from inventory `(new)` markers

After B2.5 passes (or is skipped when `library_refs_required` is `false`), and before B3 applies overflow detection, sweep the materialized UI Contracts in working memory for components flagged as `(new)` and synthesize **bootstrap SIs** that create + test them. Bootstrap SIs occupy the `SI-NN.0.k` numbering slot (precedes `.1`); they are prepended to the SI list before B3 runs.

**Scope predicate.** Run this step ONLY when `ui_in_scope: true`. Skip silently when `ui_in_scope` is `false`, `deferred`, or `logic-only`. Frontend Runtime-only / backend-only / pure-deferred phases never need bootstrap SIs.

### Step 1 — Detect `(new)` rows from working memory

The `**Reused DS components:**` lines are already in working memory:

- **Same-session continuation** — Phase A's A4(c) emitted them as Edit `new_string` arguments while rendering UI Contracts; rows persist in the message log.
- **New-session resume** — B1(b) read `## Technical Specifications` from the artifact, which includes the `**Reused DS components:**` lines verbatim per screen (the `templates/tech-specs/ui-contracts.md` Field derivation invariant guarantees the `(new)` suffix is preserved byte-verbatim from the inventory, along with the Notes column).

Sweep every `**Reused DS components:**` bullet across all `#### Screen:` subsections. For each bullet match the line shape:

```
- `<path>` — <component-name> — <notes>
```

Detection rules (Reuse? field has 3 forms per `screen-inventory/SKILL.md`; B2.6 acts on form 2 only):

| Reuse? form in inventory | Renders in `**Reused DS components:**` as | B2.6 action |
|---|---|---|
| `<path>` (existing component) | `` `<path>` — name — notes `` | skip (already exists) |
| `<path> (new)` (planned but not created) | `` `<path>` (new) — name — notes `` | **emit bootstrap SI** |
| bare `new` (pure-DOM element) | does NOT render here (pure-DOM has no path) | n/a |

Collect into working memory the deduplicated set `{(path, component-name, notes)}` keyed by `path` — rows with identical paths across multiple screens collapse to one entry (component is created once, reused across screens). If the set is empty, skip Steps 2-6 silently and proceed to B3.

### Step 2 — Detect `components.json` (single bounded check)

Single bash existence check, idempotent, cached in working memory for B3+B4:

```bash
test -f <frontend-subproject>/components.json
```

`<frontend-subproject>` resolves from the plan's `affected_subprojects:` field per the same role-to-directory disambiguation hierarchy used elsewhere in this file. Result is one of:

- `shadcn_detected: true` — components.json present → enable shadcn-aware classification (Step 3a).
- `shadcn_detected: false` — components.json absent → fallback classification (Step 3b).

### Step 3a — Classification (shadcn-aware, when `shadcn_detected: true`)

For each `(path, component-name, notes)` tuple, classify against the **shadcn_registry** (hardcoded canonical list — deliberate-coupling per memory `feedback_skills_dont_reference_autoload_paths.md`):

```
accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button,
calendar, card, carousel, checkbox, collapsible, command, context-menu, dialog,
drawer, dropdown-menu, form, hover-card, input, input-otp, label, menubar,
navigation-menu, pagination, popover, progress, radio-group, resizable,
scroll-area, select, separator, sheet, skeleton, slider, sonner, switch, table,
tabs, textarea, toast, toggle, toggle-group, tooltip
```

Classification rules (first match wins):

| Path shape | Filename in shadcn_registry? | Class |
|---|---|---|
| `components/ui/<name>.tsx` | yes (e.g., `card.tsx` → `card`) | `shadcn-installable` |
| `components/ui/<name>.tsx` | no (e.g., `icon-button.tsx`) | `custom-ui-primitive` |
| `components/<feature>/<name>.tsx` (any non-`ui` first segment) | n/a | `custom-business` |
| `components/common/<name>.tsx` | n/a | `custom-business` |

For `custom-business`, sub-classify via Notes signal-keywords (`computed`, `state`, `score`, `toggle`, `local`, `stateful`):

- Notes contains ≥1 keyword → `custom-business-complex` (gets +1 Tests entry beyond baseline).
- Notes empty / pure-presentational ("wordmark + ícone", "see screen: ...") → `custom-business-simple`.

If `shadcn_registry` does not match a path that lives under `components/ui/` (stale list / unknown shadcn registration), the path falls into `custom-ui-primitive` (safe failure — emits author + test SI; no `npx shadcn add` action).

### Step 3b — Classification (fallback, when `shadcn_detected: false`)

All `<path> (new)` rows classify as `custom-authored`. Emit one full-SI per path with:

- 1 Action: `Author <path> per UI Contract`.
- 1 Test entry: `Unit per testing-guide-{subproject} § "Client Components"` (or `§ "UI Primitives"` if path matches `components/ui/`).

No `npx shadcn add` step. No batch install SI. Stack-agnostic.

### Step 4 — Synthesize bootstrap SIs (in deterministic order)

Emit SIs in this order (alphabetical by `path` within each group):

**Group A — Infra: install batch shadcn primitives** (only when ≥1 `shadcn-installable` exists)

```markdown
### SI-NN.0.1 — Infra: install batch shadcn primitives

**Description:** Instalar shadcn primitives via CLI registry; commitar arquivos gerados em `components/ui/`.

**Technical actions:**

1. Rodar `npx shadcn@latest add <name1> <name2> ...` (alphabetical) — gera `components/ui/<name>.tsx` por primitive.
2. Commitar `components/ui/<name>.tsx` per primitive instalado.

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- `components/ui/<name>.tsx` exists for every shadcn primitive in the install batch.
- Generated files compile per `<frontend-subproject>` build command.

---
```

**Group B — Tests for shadcn-installable primitives** (split by 5-test cap when needed)

```markdown
### SI-NN.0.2 — Tests shadcn batch (≤5 files)

**Description:** Unit tests para shadcn primitives instalados em SI-NN.0.1 — variants, a11y, data-slot, event handlers.

**Technical actions:**

1. Author `{test-file}` per primitive (≤5 files per SI; auto-split into SI-NN.0.3 etc. when >5).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `<name>.tsx` | Unit per testing-guide-{subproject} § "UI Primitives" — variants, a11y, data-slot, event handlers | `{test-file}` |
| ... | ... | ... |

**Dependencies:** SI-NN.0.1

**Acceptance criteria:**

- Each primitive in this batch has an Unit test file covering all CVA variants, ARIA attributes, data-slot anchors, and event handler wiring.
- Tests pass per `<frontend-subproject>` test command.

---
```

**Group C — Custom-ui-primitive** (1 SI per path, alphabetical)

```markdown
### SI-NN.0.k — Custom-ui: <name>.tsx

**Description:** Author `<path>` per UI Contract — primitive sob `components/ui/` não disponível no shadcn registry.

**Technical actions:**

1. Author `<path>` per UI Contract specs.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `<name>.tsx` | Unit per testing-guide-{subproject} § "UI Primitives" + custom-logic — variants, a11y, data-slot, event handlers, logic branches | `{test-file}` |

**Dependencies:** none

**Acceptance criteria:**

- `<path>` exists and matches the UI Contract for this component.
- Unit test file exercises every variant + custom logic branch.

---
```

**Group D — Custom-business**

D-simple — group by 5-cap (Actions + Tests):

```markdown
### SI-NN.0.k — Custom-business simple group: <name1> + <name2> ...

**Description:** Author business components sem state/scoring — pure presentational.

**Technical actions:**

1. Author `<path1>` per UI Contract.
2. Author `<path2>` per UI Contract.
... (≤5)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `<name1>.tsx` | Unit per testing-guide-{subproject} § "Client Components" | `{test-file}` |
| ... | ... | ... |

**Dependencies:** none

**Acceptance criteria:**

- Each business component exists at its declared path and matches its UI Contract.
- Unit tests exercise rendering + props.

---
```

D-complex — 1 SI cada (signal-keyword Notes):

```markdown
### SI-NN.0.k — Custom-business complex: <name>

**Description:** Author `<path>` — business component com {state | scoring | computed logic} per Notes "{notes verbatim}".

**Technical actions:**

1. Author `<path>` per UI Contract.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `<name>.tsx` | Unit per testing-guide-{subproject} § "Client Components" baseline | `{test-file}` |
| `<name>.tsx` | Unit: {scoring | state | toggle} assertions per Notes signal | (same file) |

**Dependencies:** none

**Acceptance criteria:**

- `<path>` exists and matches the UI Contract.
- Unit tests cover baseline rendering + the signal-driven logic (e.g., score computation, state transitions).

---
```

### Step 5 — Wire screen SI dependencies

For every screen, wire bootstrap SI ids onto **both** `SI-NN.X.0` (drift audit) AND `SI-NN.Xa` (visual shell) whose `**Reused DS components:**` line cites at least one path created by a bootstrap SI emitted above. Both SIs need bootstrap as a dependency:

- **Audit-SI (`SI-NN.X.0`)** reads DS files from disk to perform value-level diff. If bootstrap hasn't run, files are missing and the audit produces false `componente ausente` rows. Bootstrap MUST precede the audit-SI.
- **Visual-shell SI (`SI-NN.Xa`)** applies drift decisions and renders the screen. Cannot render without the underlying primitives.

Wiring rules:

- For `SI-NN.X.0`: if `**Dependencies:** none`, replace `none` with the comma-separated list of bootstrap SI ids. If it already cites other SIs, append at the end with a `+` separator.
- For `SI-NN.Xa`: the template default already cites `SI-NN.X.0` (the audit-SI) — append bootstrap SI ids after `SI-NN.X.0` with a `+` separator (e.g., `**Dependencies:** SI-NN.X.0 + SI-NN.0.1, SI-NN.0.2`).

### Step 6 — Prepend ordering invariant + NO renumbering rule

Bootstrap SIs MUST occupy the first positions of the in-memory SI list, BEFORE every capability SI (`SI-NN.1, SI-NN.2, ...`), every screen SI (`SI-NN.Xa/Xb`), and every Frontend Runtime SI. Layout in the artifact follows the in-memory order (B4 writes SIs sequentially), so prepend guarantees `SI-NN.0.k` blocks render before `SI-NN.1+` in the file.

**NO renumbering rule:** bootstrap SIs receive `SI-NN.0.k` by construction; every other SI (capability `.1, .2, ...`, screens `.Xa/.Xb`, FR plain `.X`, BE auto-split `.X.1/.2`) keeps the number assigned in B2 unchanged — `.0.k` and `.1` coexist without conflict (the ranges are disjoint).

### Step 7 — Hand off to B3

Bootstrap SIs are now in the working-memory SI list. B3 runs overflow detection across **every** SI (bootstrap + capability + screen + FR) uniformly — no special case. If a bootstrap SI overflows the 5-action / 5-test cap, the same `Group B split by 5-test cap` heuristic applies (split into `SI-NN.0.2`, `SI-NN.0.3`, ...). If the bootstrap SI cannot be split, the FAILED fallback fires per "Overflow policy" below.

### Hard rule — Bootstrap SIs cite no TD

By construction, bootstrap SIs reference no TD ref. B4 step 3 (library-refs.md lookup) is skipped for them automatically — bootstrap SIs cite `npx shadcn@latest add` as a Technical action, but `shadcn` is NOT a TD-cited library; it is a deliberate-coupling registry hardcoded in this section's Step 3a. The implementer reads shadcn docs directly when running the install action. The ref-extraction in B4 step 1 returns an empty set for bootstrap SIs; B4 step 2 + 3 short-circuit.

### Hard rule — Bootstrap SIs do NOT receive `**Test Specs:**` field

Bootstrap SIs are not screen-wiring, not controller wiring, and not cross-layer — they create primitives + business components consumed by screen SIs. Per "Conditional emit of `**Test Specs:**` field" rules below, they fall outside the three categories that receive the placeholder. `/plan-test-specs` ignores them silently; `/implement` preflight does not gate on them.

## B3. Detect overflow + apply auto-split (in memory)

For every SI drafted in B2, run **overflow detection** before any Edit. Three caps checked per SI:

- Technical actions ≤5 (hard rule).
- Test files ≤5.
- Acceptance criteria ≤10.

```
For each drafted SI (in memory):
  count = {technical_actions, test_files, acs}
  if any exceeds cap:
    trigger auto-split logic (layer-specific) — see "Overflow policy" below
```

If an SI cannot be split per the layer-specific heuristics, emit the **FAILED fallback** message documented in "Overflow policy". The scaffold remains; rerun overwrites only after user narrows the scope.

## B4. Append SIs one at a time (no lookback) — replace SIs sentinela

**Invariant — one SI per `Edit`; never bundle.** Even in same-session continuation where the message log carries all SI bodies, dispatch one `Edit` per SI. Per-SI iteration is the only mechanism that forces anchor re-evaluation on each step; bundling N SIs into a single `Edit` hides anchor drift until N-1 SIs are already in the wrong place. "Append SIs one at a time" in this heading is a hard rule, not a stylistic preference. Token-saving via batched Edits is explicitly NOT a justification — the cost of recovering from a misplaced batch (file rewrite via Python, manual section move) dwarfs the savings.

For the **first** SI, `Edit` the SIs sentinela block:

- `old_string`:
  ```
  ## Step Implementations
  
  <!-- SIs will be written in Phase B -->
  
  ---
  ```
- `new_string`:
  ```
  ## Step Implementations
  
  ### {first-SI-id} — {title}
  
  ... (SI body per "Template: SI block")
  
  ---
  ```

  `{first-SI-id}` is the id of the first SI in the in-memory list (after B2.6's prepend). Common shapes: `SI-NN.0.1` when bootstrap SIs were synthesized; `SI-NN.1` otherwise. Do NOT hardcode the literal `SI-NN.1` — the prepend invariant from B2.6 Step 6 places `SI-NN.0.k` blocks first when bootstrap is non-empty.

For each subsequent SI, the bare `---\n` at the end of the previous SI is **not unique** in the file (the same separator appears between every SI and between every top-level section). The Edit must use a longer `old_string` that anchors on what comes after the previous SI. Two equivalent shapes:

- **Anchor on the next section-boundary marker** — heading or sentinel, depending on scaffold variant (works while no other SI sits between the previous SI and the next section). The scaffold variant is determined statically by Phase A — read it from working memory; do not Grep at runtime to choose between the two forms below.
  - **Standard scaffold** (Tech Specs rendered — i.e., at least one Tech Specs subsection applied OR `ui_in_scope` is `true` / `logic-only` / `deferred`):
    - `old_string`: `---\n\n## Technical Specifications`
    - `new_string`: `---\n\n### SI-NN.{next} — {title}\n\n... (SI body)\n\n---\n\n## Technical Specifications`
  - **Tech-Specs-skipped variant** (`ui_in_scope: false` AND no Tech Specs subsection applied — `## Technical Specifications` was omitted entirely from the scaffold per `phase-a.md` § A3; `<!-- phase-a-complete -->` sits adjacent to the SIs section as the next-top-level marker):
    - `old_string`: `---\n\n<!-- phase-a-complete -->`
    - `new_string`: `---\n\n### SI-NN.{next} — {title}\n\n... (SI body)\n\n---\n\n<!-- phase-a-complete -->`
- **Anchor on the previous SI's last line + trailing rule** (works any time):
  - `old_string`: `{last line of previous SI's Acceptance criteria}\n\n---`
  - `new_string`: `{last line of previous SI}\n\n---\n\n### SI-NN.{next} — {title}\n\n... (SI body)\n\n---`

Either shape keeps the file valid and preserves SI ordering. Pick whichever produces a unique `old_string` match without re-reading the file.

**DO NOT anchor on `<!-- phase-a-complete -->` (or any sentinel injected by A4.5 / A4.6 — e.g., `<!-- ccr-pending -->` from A4.5, `<!-- {rule-id}-pending -->` from A4.5, `<!-- phase-a-complete -->` from A4.6) IN THE STANDARD SCAFFOLD (Tech Specs rendered).** This is a doc-time scaffold-variant condition determined by A3 / A4 outcome, NOT a runtime grep target — read the variant from working memory carried over from Phase A. In the standard scaffold, those sentinels sit BETWEEN the end of `## Technical Specifications` (after its last subsection's content) and `## Dependency Map` — anchoring on them inserts SIs into the wrong section (outside `## Step Implementations`, between Tech Specs and Dep Map).

**Exception — Tech-Specs-skipped variant** (`ui_in_scope: false` AND no Tech Specs subsection applied → `## Technical Specifications` is omitted entirely from the scaffold per `phase-a.md` § A3). In that variant, `<!-- phase-a-complete -->` is the *only* marker between the SIs section's closing `---` and `## Dependency Map`, so it IS the legitimate next-top-level anchor. Use `---\n\n<!-- phase-a-complete -->` as the second-shape anchor in that variant (per the two-form `old_string` / `new_string` split shown above). Note: A4.5 sentinels (`<!-- ccr-pending -->`, `<!-- {rule-id}-pending -->`) are unreachable from B4 by construction — Gate 10 case 3 routes any plan with those sentinels back through fresh Phase A1, so B4 never sees them; their inclusion in the DO-NOT list is for completeness, not for an active failure path. Phase C is unaffected (Phase C input has zero sentinels by Gate 10 case 5; C4 uses Grep-based locator, not literal anchors).

These are the only sentinels that survive into the Phase B resume state; the scaffold's other comment placeholders (`<!-- Tech Specs subsections will be appended below in Phase A -->`, `<!-- Dep Map will be written in Phase B -->`, `<!-- Deliverables will be written in Phase B -->`) are either consumed earlier (by A4(d)) or live in sections below `## Dependency Map` and are out of plausible reach for B4. The valid anchors for subsequent SIs are exactly:

- `---\n\n## Technical Specifications` (when Tech Specs were rendered), OR
- `---\n\n<!-- phase-a-complete -->` (when Tech Specs were skipped — the sentinel sits adjacent to SIs in that variant, see Exception above), OR
- the previous SI's last AC line + trailing `---`.

Nothing else. Even though the post-A4.6 sentinel is unique in the file and feels like a clean anchor in the standard scaffold, its **position there** makes it semantically wrong: the sentinel marks the end of Phase A as a whole; the boundary of `## Step Implementations` in the standard scaffold is `## Technical Specifications`. Confusing the two in the standard scaffold lands every SI from the second SI onward in the wrong section, undetectable until manual inspection. The sentinel is only a correct anchor in the rare Tech-Specs-skipped variant.

For each SI:

1. **Identify the TDs cited by this SI.** The coverage table in context.md says which TDs support which capability; pick the subset that governs this SI.

2. **Look up cited TDs.** For each TD ref cited by this SI, search for its `### {ref}` entry in this order:
   a. `## Decisions Detail` (current-scope TDs — phase-scope + ad-hoc tied to NN in phase mode, or the task's own TDs in task mode).
   b. `## Inherited Decisions Detail` (inherited TDs — prior phases in phase mode, or latest completed phase + correlated docs in task mode).
   Take the first match. Extract `**Recommendation:**` prose and `**Libraries:**` value from the matched entry. Both sections are already in memory from whichever of A1 or B1 ran — no file reads needed. If the ref is found in neither section, return `FAILED at step-3-si-{N}. Written so far: {list of SIs already appended, or "scaffold + Technical Specifications"}. Error: {SI-id} cites TD <ref> which is not present in context.md's `## Decisions Detail` nor `## Inherited Decisions Detail`. Next: regenerate context.md via /plan-context with the missing entries, then retry the build.`

3. **Consult library-refs.md** for any library cited by this SI **from a current-scope TD** (i.e., the ref matched in section `## Decisions Detail` in item 2 above). Bounded grep `^### {lib-name}` → Read the bounded range. Libraries from inherited TDs (ref matched in `## Inherited Decisions Detail`) do NOT require library-refs lookup — their Recommendation prose from that section is sufficient to write correct Technical actions. Coverage for current-scope libs is already guaranteed by B2.5, so a missing `### {lib-name}` here is a bug (B2.5 was bypassed or library-refs.md was mutated mid-run). If it happens, return `FAILED at step-3-si-{N}. Written so far: {list}. Error: library <Y> cited by {SI-id} but missing from library-refs.md. Next: rerun /plan-build <arg> after fixing library-refs.md.`

   **Sibling slice library-refs aggregation (slicing only).** When the current slice declares `depends_on_slices: [<sibling-slug>, ...]` AND the SI cites a library present in a sibling's `library-refs.md` (bounded grep `^### {lib-name}` against each existing sibling path recorded in Gate 7), consult the sibling entry too. Merge rule on collision: **current slice wins** (current slice's `library-refs.md` overrides sibling entry verbatim). Rationale: a sibling's library cache is treated as inherited context — the current slice may have locally refreshed / pinned a different version via `/plan-resolve`. Sibling entries supply libraries the current slice never cached locally (e.g., inherited TD cites a lib that the current slice never redecided).

4. **Draft the SI block** in memory (Description, Technical actions citing TDs inline as `` `auth/TD-03` `` or `(per auth/TD-05)`, Tests table if testable artifacts are produced, Dependencies, Acceptance criteria). **Concrete details must align with the Tech Specs available to Phase B** (from B1(b) on new-session resume, or from the message log on same-session continuation — see SKILL.md § "Hard rules"): entity-touching SIs reference Data Model field names + constraints verbatim; controller/route SIs reference API Contracts request/response shapes verbatim; auth-touching SIs match Authorization Matrix rows; exception handlers cite Error Catalog `errorCode`s exactly; UI screen SIs reference the relevant `#### Screen: {name}` UI Contracts subsection. Do not re-derive these from the raw TD prose — Phase A's normalization is the source of truth here.

   **For UI screen SIs**, also `Read .claude/skills/plan-build/templates/screen-si.md` for the Xa/Xb templates + the conditional skip rule. Skip this Read entirely when `ui_in_scope` is `false`, `deferred`, or `logic-only` (no per-screen SIs to generate in those states).

   **For Frontend Runtime SIs**, `Read .claude/skills/plan-build/templates/frontend-runtime-si.md` for the Setup/Migration/Verification template + canonical Dependency contract (Setup `—`; Migration `SI-NN.<setup>`; Verification `Setup + all Migrations`; cross-section dep `+ backend SI` when applicable). Skip this Read entirely when no TD in scope has `Renders in: frontend-runtime` (explicit OR default-by-inference per `phase-a.md` § A2).

5. **Apply the Acceptance Criteria validation checklist** (below) before committing — refine each AC to be observable, specific, scoped, non-redundant, behavioral-not-implementation, and distinct from Technical actions and Tests.

6. **Edit the file** to append this SI per the Edit protocol above.

7. **Do not re-read the file between SIs.** Move to the next SI directly. To reference prior SIs (for Dependency Map cross-refs in B5 or in a later SI's `Dependencies:` line), grep their headers only: `Grep -n '^### SI-' {target_path}`.

## B5. Build Dependency Map — replace Dep Map sentinela

`Grep -n '^### SI-' {target_path}` to list SI headers in order. Build the ASCII tree from the `Dependencies:` line of each SI (parse via a targeted `Grep -n '^\*\*Dependencies:\*\*' {target_path}` if needed — one grep across the file; the `**` markdown bold markers must be regex-escaped as `\*\*`, since `*` is otherwise a regex quantifier).

`Edit` the Dep Map sentinela block:

- `old_string`:
  ```
  ## Dependency Map
  
  <!-- Dep Map will be written in Phase B -->
  
  ---
  ```
- `new_string`: per "Template: Dependency Map" below.

## B6. Build Deliverables — replace Deliverables sentinela

Generate the Deliverables flat checklist with three blocks, in order:

1. **SI checklist** — one line per SI (including screen SIs with letter suffix / BE auto-split dotted sub where present).
2. **Per-screen deliverables (when `ui_in_scope: true`)** — one line per screen from the UI Inventory join table.
3. **Full test suites** — parameterized per subproject from context.md's Affected subprojects.

See "Template: Deliverables" below for the exact shape and the parameterized command lines.

`Edit` the Deliverables sentinela block per the same Edit protocol.

## B7. Emit completion message

Emit the literal `Successful completion (Phase B7)` block from SKILL.md § "Output contract". No prose preamble. No closing summary.

---

## Acceptance Criteria — validation checklist

Before finalizing each SI in B4, verify each AC passes:

1. **Observable?** Verifiable by calling an endpoint, checking a mailbox, or querying a database — without reading source.
2. **Specific?** Names HTTP method, path, status code, error code, or observable outcome.
3. **Scoped?** Belongs to exactly this SI.
4. **Non-redundant?** Not covered by another AC in this or a different SI.
5. **Behavioral, not implementation?** Describes what the system does — not how.
6. **Distinct from Technical actions?** Implementation choices stay in Technical actions.
7. **Distinct from Tests?** ACs do not reference test layers or test files.

Use the template formulas:

- **HTTP endpoint behavior**: `[METHOD] [/path] with [input] returns [status] with [body or error code]`
- **Persistence behavior**: `[operation] — [expected persistence outcome or constraint violation]`
- **Side-effect behavior**: `[trigger] causes [observable effect] containing [key payload]`
- **Security behavior**: `[probing action] returns [response that reveals nothing]`

Aim for 3-7 ACs per SI; cap at 10 — split the SI otherwise (see "Overflow policy").

---

## Template: SI block

Output path: `{target_path}`. Phase mode → `docs/phases/phase-NN-{slug}/phase-NN-{slug}.md`. Task mode → `docs/tasks/task-{slug}/task-{slug}.md`. Template shape is identical across modes.

Follow the shape below literally — Portuguese prose, English identifiers, per-TD traceability via backtick refs, horizontal rules between SIs.

````markdown
### SI-NN.X — {Verbo} {Substantivo}

**Description:** Uma frase — o que este SI entrega e por que pertence aqui.

**Technical actions:**

1. Criar `{module}/{file}.ts` — `{o que faz}` (per `{slug}/TD-XX`)
2. Registrar `{Module}` em `{ParentModule}` — import + provider declaration

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `{EntityName}` | Integration: constraints, defaults | `{test-file}` |
| `{ServiceName}` | Unit: branch logic (mock repo) | `{test-file}` |

**Dependencies:** none _(ou: SI-NN.1 — razão)_

**Acceptance criteria:**

- `POST /path` com `{payload válido}` retorna `201` com `{campos-chave}`
- `POST /path` com `{campo inválido}` retorna `400` com `errorCode: "VALIDATION_ERROR"`

---
````

For UI screen SIs (Xa/Xb), see `.claude/skills/plan-build/templates/screen-si.md` (read on demand when `ui_in_scope: true`).

---

## Conditional emit of `**Test Specs:**` field

This rule fires during B4 step 4 ("Draft the SI block in memory"). It decides which SIs receive the `**Test Specs:** _pending /plan-test-specs_` placeholder before the Edit is dispatched. The `Template: SI block` above is unchanged — the field is conditionally emitted on top of that template, depending on the SI shape.

### Tests format invariant

All SI templates emit the `**Tests:**` section as a markdown table with columns `| Artifact | Layer | Test file |`, OR as the empty form `_(empty — <reason>)_` defined right below — these are the two valid shapes for Tests **entries**; bullets and inline prose enumerating test files are anti-patterns. Explanatory notes around the table or the empty-form marker (e.g., a paragraph after the table noting that E2E rows are intentionally excluded) are permitted — they document the table's scope without re-encoding test entries. This is cross-template invariant — backend SIs (`Template: SI block` above), Frontend Runtime SIs (`templates/frontend-runtime-si.md`), screen Xa/Xb (`templates/screen-si.md`) — Xa is the dedicated case for the empty form (single-owner invariant: Xa generates files, Xb owns the Unit table), Xb uses the table — and bootstrap SIs (B2.6 Groups B/C/D — Group A Infra is the dedicated case for the empty form, Groups B/C/D use the table) all share the shape. The semantics of the rules below — placeholder emission for `**Test Specs:**`, removal of E2E rows for the three eligible SI categories — apply uniformly to every table.

When an SI legitimately has no Tests rows (e.g., Infra SI installing a tool, SI-Xa for visual shell whose tests are owned by SI-Xb, Xa-only pure-presentational screens, Frontend Runtime Setup SIs whose behavior tests live in their Migration/Verification siblings), emit `**Tests:** _(empty — <reason>)_` instead of the table. The `<reason>` MUST be terse and non-empty (1 sentence, ≤120 chars). Common cases (canonical strings — copy verbatim into emitted SIs):

- **SI-Xa for screens with SI-Xb sibling**: `_(empty — shell smoke-gated by build AC; Unit tests live in SI-Xb; E2E in /plan-test-specs spec)_`
- **Xa-only pure-presentational screens** (Decisão #33 conditional skip of Xb): `_(empty — pure presentational, smoke-gated by build/compile)_`
- **Drift audit-SI** (`SI-NN.X.0`): `_(empty — audit-only; the report is the deliverable)_`
- **Infra SI** (e.g., bootstrap shadcn-install Group A): `_(empty — Infra)_`
- **Frontend Runtime Setup SI** (e.g., provider install + wrap): `_(empty — Setup SI; smoke-gated by AC; behavior tests live in Migration + Verification SIs)_`

Never emit `**Tests:**` followed by a literal empty table or a single bullet — those are anti-patterns that historically allowed E2E creep (see the SI-02.14a → `signup-shell.spec.ts` regression).

### Which SIs receive the placeholder

Three categories receive the placeholder; everything else does NOT.

**1. SI-Xb (frontend logic & wiring)** — placed between the `### SI-NN.Xb — ...` heading and the `**UI Contract:**` line:

```markdown
### SI-NN.Xb — Tela de {name} (lógica & wiring)

**Test Specs:** _pending /plan-test-specs_
**UI Contract:** see `## Technical Specifications` → ...
```

**2. SI plain de controller wiring backend** (with `**Route:** <METHOD> /...`) — placed between `**Route:**` and the next field below it (typically `**Authorization:**`). **Scoped to *backend* controller wiring only — this category EXCLUDES frontend BFF Route Handler SIs.** A BFF Route Handler SI is identified by its `**Route:**` being an **FE-facing path that appears as a `#### {METHOD} {path}` heading under the `### API Contracts` BFF tier** (the block carries `**forwards-to:**`), and/or its Technical actions citing `` `### API Contracts` → BFF tier `` (corroborating artifact: `app/api/**/route.ts`). Such SIs own an **inline MSW integration test**, not an external E2E spec, so they fall under the exclusion list below — never emit the placeholder on them (this supersedes the prior manual pre-`/implement` strip):

```markdown
### SI-NN.X — Endpoint POST /auth/register

**Route:** POST /auth/register
**Test Specs:** _pending /plan-test-specs_
**Authorization:** Anonymous
...
```

**3. Cross-layer SIs** — title literally contains `(cross-layer)` (lowercase, parenthesized, hyphenated) — placeholder inserted right after the `**Description:**` block:

```markdown
### SI-NN.8 — Fluxo de upload (cross-layer)

**Description:** ...
**Test Specs:** _pending /plan-test-specs_
```

**SI-Xa (visual shell), SIs Xa-only (Decisão #33), drift audit-SIs (`SI-NN.X.0`), backend service SIs, schemas, providers, frontend runtime SIs (via `templates/frontend-runtime-si.md`), and frontend BFF Route Handler SIs (FE-facing `**Route:**` keyed to a `### API Contracts` BFF-tier `#### {METHOD} {path}` block carrying `**forwards-to:**`, and/or Technical actions citing `### API Contracts → BFF tier`; corroborating artifact `app/api/**/route.ts`) DO NOT receive the placeholder** — none of them have an externally-authored E2E spec. A BFF Route Handler SI nonetheless **owns behavior tests**: per § "Tests entries — drop E2E rows for SIs with `**Test Specs:**`" it keeps its **inline Integration / MSW Tests-table row** (`route.integration.test.ts` per `testing-guide-{frontend-subproject}`) and emits **no** E2E row — there is no E2E row to drop and no external spec to author. Consequently `/plan-test-specs` ignores it (no `_pending_` marker to find) and `/implement` preflight does not gate on it (no `**Test Specs:**` field present), end-to-end, with no manual intervention.

**Defensive note for `/plan-test-specs`:** if a future bug introduces `**Test Specs:**` on an audit-SI, `/plan-test-specs`'s discriminator fall-through case (currently described as "plain `SI-NN.X` sem letra") should also enumerate the `SI-NN.X.0` shape and abort with the same actionable message — preventing silent misclassification. The audit-SI category is excluded from emit by construction here; the defensive check exists only as a guard against accidental re-introduction.

The placeholder is the cross-skill signal: `/plan-test-specs` reads it to know which SI still lacks a spec; `/implement` preflight reads it and aborts with "Run /plan-test-specs <slug> first." until /plan-test-specs has authored the file.

### Populated form (post `/plan-test-specs`)

After `/plan-test-specs` authors the spec(s), the field is rewritten in place to `**Test Specs:** see \`<spec-path>\``. **Single-subproject** (Xb frontend OR backend controller wiring) — uses one backticked path of the form `<subproject>/specs/<feature>.plan.md` where `<subproject>` is the relevant subproject directory:

```markdown
**Test Specs:** see `<subproject>/specs/<feature>.plan.md`
```

**Cross-layer (raro)** — when `/plan-test-specs` authors 2 specs (frontend + backend) for one cross-layer SI, the line stays a SINGLE `**Test Specs:**` line with comma-separated backticked paths:

```markdown
**Test Specs:** see `<frontend-subproject>/specs/<feature>.plan.md`, `<backend-subproject>/specs/<feature>.plan.md`
```

Subproject directory names (`<frontend-subproject>`, `<backend-subproject>`, `<subproject>`) come from the plan's `affected_subprojects:` field. Role-to-directory disambiguation follows the same hierarchy `/plan-test-specs` uses — see `plan-test-specs/SKILL.md` § "Resolving the role-to-directory mapping" (inspect dir layout → cross-reference `docs/project-plan.md` § Subprojects → ask user via `AskUserQuestion`).

Do NOT use alternative forms like `**Test Specs (frontend):**` / `**Test Specs (backend):**` — those would break the canonical grep `^\\*\\*Test Specs:\\*\\* see ` used by `/implement` preflight. The preflight extracts every backticked token via `grep -oE '\`[^\`]+\`' | tr -d '\`'`, which handles both single and comma-separated forms uniformly.

### Tests entries — drop E2E rows for SIs with `**Test Specs:**`

Prior to this migration, `/plan-build` emitted Tests entries like:

```markdown
| E2E `/signup` | E2E (Playwright + MSW): preencher form... | tests/e2e/signup.spec.ts |
```

For Xb / controller wiring / cross-layer SIs (the same three categories that receive the `**Test Specs:**` placeholder), **do NOT emit E2E Tests entries**. The E2E scenarios are authored externally by `/plan-test-specs` in the spec file referenced by `**Test Specs:**`. Unit / Integration / MSW handler test entries continue to be emitted inline as table rows in **SIs that own behavior tests** — Xb, controller wiring, cross-layer, FR Migration, FR Verification, backend SIs, bootstrap Groups B/C/D, **and frontend BFF Route Handler SIs** (carved out of the placeholder per § "Which SIs receive the placeholder" — they own an inline Integration/MSW row and never carried an E2E row, so the E2E-drop above is a no-op for them). **SIs that don't own behavior tests** — SI-Xa (single-owner invariant: Xb owns the Unit table for the screen's Client Components), Infra SIs, FR Setup SIs, bootstrap Group A — emit the empty form `_(empty — <reason>)_` per the "Tests format invariant" above instead of inline rows.

### Backwards-compat (planos legacy)

This rule applies to **builds new** (post-migration). Plans already generated (e.g. `phase-02-auth-frontend.md`) preserve their inline E2E entries. Forcing `/plan-build --rebuild` on a legacy plan triggers BOTH coordinated edits:

- `phase-a.md` re-emits the frontmatter with `test_specs_aware: true`.
- This rule re-emits SIs with `**Test Specs:**` placeholder + drops E2E entries.

User decides when to apply the rebuild — there is no automatic forcing.

---

## Overflow policy (Decisão #34) — detection + auto-split + FAILED fallback

B3 runs overflow detection for every SI **before** any Edit. Three caps checked per SI: Technical actions ≤5 (hard rule), Test files ≤5, Acceptance criteria ≤10.

### Auto-split heuristics per layer

#### (i) Frontend screen SIs — hardcoded boundary

- SI-Xa (visual) is always 1 action → never overflow.
- SI-Xb overflow → split per **functional boundary**:
  - **Multi-step wizards / flows**: `Xb = step 1 flow`, `Xc = step 2 flow`, `Xd = confirmation`.
  - **Multi-form screens** (2+ independent forms): `Xb = primary form`, `Xc = secondary form`.
  - **Complex state setup** (provider + N consumers): `Xb = state provider + primary wiring`, `Xc = secondary components`.

If Xb has no detectable boundary (rare: 6+ tightly-coupled actions within a single form), fall through to **FAILED fallback**.

#### (ii) Backend SIs — progressive heuristics (try in order; first match wins)

BE auto-split uses **dotted sub-numbering** (not letter suffix, to stay distinct from FE Xa/Xb):

1. **Infrastructure vs behavior** (extends the existing infra-vs-behavior rule):
   - Actions with install/configure/migration/seed keywords → extract into new SI with prefix `Infra:` and dotted sub `.1`.
   - Actions with implement/logic/handler keywords → stay in main SI with dotted sub `.2`.
   - Example: `SI-03.2 (7 actions)` → `SI-03.2.1: Infra: Install TypeORM + create migration + configure DataSource` (3 actions) + `SI-03.2.2: Entity + Service + Controller + Tests` (4 actions).

2. **Artifact type** (if (1) did not resolve or resulted in new SI still overflowing):
   - Split per layer: `SI-NN.Y.1 = Entity + Migration + Repository`, `SI-NN.Y.2 = Service + DTO + validation`, `SI-NN.Y.3 = Controller + Guard + Interceptor + OpenAPI decorators`.
   - Dependencies serial: `SI-NN.Y.2` depends on `SI-NN.Y.1`; `SI-NN.Y.3` depends on `SI-NN.Y.2`.
   - Works symmetrically for other stacks (Spring Boot, Django, FastAPI, etc.).

3. **Functional boundary** (if (1) and (2) did not resolve):
   - Split the capability bullet into narrower use-cases (e.g., "user auth" → ["user signup", "user login", "password recovery"]). Each sub-use-case becomes its own SI with dotted sub-numbering.
   - Requires the bullet to be naturally splittable. If bullet is single-concept atomic, (3) fails.

### FAILED fallback — when all layer-specific heuristics fail

```
FAILED at step-1-decompose. Written so far: scaffold + Technical Specifications. Error: SI-{original-id} would require {N} Technical actions (or {M} test files or {P} ACs — first exceeded cap reported), but no natural boundary found for auto-split (concerns are tightly coupled — {reason inferred from heuristic trials}). Next: narrow the scope by editing {project-plan.md capability bullet | task scope prose} to decompose into 2-3 narrower bullets, then rerun /plan-build <arg>. Alternatively, create a TD via /research with Scope: Cross-layer or Repo-wide documenting the coupling that prevents split (documents the exception explicitly — TD becomes auditable).
```

`{reason inferred from heuristic trials}` examples:
- Frontend screen: `"no multi-step/multi-form/state-setup boundary detected in Xb"`
- Backend: `"no infrastructure-vs-behavior separation, no artifact-type separation, and capability bullet is single-concept atomic"`

### Transparency marker

Auto-split SIs carry header (using the numbering convention per layer — letter suffix for FE, dotted sub for BE):

```markdown
### SI-NN.Y.1 — {title} (auto-split from SI-NN.Y by /plan-build)

_Auto-split rationale: original SI would have {N} Technical actions; split per "{heuristic name — e.g., infrastructure vs behavior}"._
```

For FE screen overflow (SI-Xb → Xc/Xd):

```markdown
### SI-NN.Xc — {title} (auto-split from SI-NN.Xb by /plan-build)

_Auto-split rationale: original SI-Xb would have {N} Technical actions; split per "multi-step wizard functional boundary"._
```

**Test files + ACs overflow** — same pass: ≤5 tests per SI → distribute proportionally across the split SIs; ≤10 ACs per SI extends the existing AC cap rule — distribute ACs matching their SI scope.

All three caps share the same detection pass + auto-split trigger. Phase B emits SI Edits only after all SIs pass detection.

---

## Template: Dependency Map

````markdown
## Dependency Map

SI-NN.1 (root)
└── SI-NN.2 — depends on SI-NN.1 (entity must exist before service)
    └── SI-NN.3 — depends on SI-NN.2 (service must exist before controller)
SI-NN.4 (root, independent)
````

---

## Template: Deliverables

````markdown
## Deliverables

- [ ] SI-NN.1 — {title}
- [ ] SI-NN.2 — {title}
- [ ] ...

**Per-screen deliverables** _(when ui_in_scope: true)_:

- [ ] Screen {name} ({route}) is routable
- [ ] Screen {name} ({route}) renders loading, success, and error states
- [ ] Screen {name} ({route}) passes component tests (per testing-guide-{subproject} layers)

**Full test suites:**

- [ ] Backend tests pass (`cd {backend-subproject} && {test-cmd}`)
- [ ] E2E tests pass (`cd {backend-subproject} && {e2e-cmd}`)
- [ ] Type/compilation checks pass (`cd {subproject} && {build-cmd}`) — run per-subproject in scope.
- [ ] Frontend tests pass (`cd {frontend-subproject} && {test-cmd}`) _(when ui_in_scope: true)_
````

Placeholder resolution at emit time:

- `{backend-subproject}` / `{frontend-subproject}` / `{subproject}` come from the plan's `affected_subprojects:` field. Role-to-directory disambiguation follows the canonical hierarchy: inspect the directory layout → cross-reference `docs/project-plan.md` § Subprojects → ask the user via `AskUserQuestion` if still ambiguous (do not guess).
- `{test-cmd}` / `{e2e-cmd}` / `{build-cmd}` come from each subproject's stack — read its dependency manifest's scripts/tasks (e.g., `package.json` scripts for Node → `npm test` / `npm run test:e2e` / `npm run build`; `pyproject.toml`/`pytest.ini` for Python → `pytest` / `pytest -m e2e` / `python -m build`; `go.mod` for Go → `go test ./...` / `go test -tags e2e ./...` / `go build ./...`; etc.). Each subproject in scope may have a different command set. If the manifest declares no script for a given role, ask the user for the correct command.

When the phase spans multiple subprojects, repeat the relevant lines per subproject with subproject-specific commands. Skip lines that don't apply (e.g., no E2E command available, type-check and build are the same command, etc.). Emit `- [ ] Project builds successfully (<full build command>)` only when the build command is distinct from type-check (e.g., produces artifacts beyond type validation); otherwise omit to avoid duplication with Type/compilation checks.
