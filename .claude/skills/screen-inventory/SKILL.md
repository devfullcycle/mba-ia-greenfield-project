---
name: screen-inventory
description: "Generate a screen inventory for a project phase or task. Infers which screens need to be built or updated from the phase's capabilities (phase mode) or from the task's scope prose (task mode), asks the user for the corresponding Figma URLs, then extracts each screen's components via the Figma MCP, classifies them by behavior (Presentational / Local-interactive / Server-connected), and maps server-connected components to capabilities or scope. Use whenever the user asks to inventory screens, extract components from Figma for planning, or prepare the front-end inputs before /plan-context — including variations like 'inventariar as telas', 'inventário de telas da fase NN', 'screen inventory NN', 'screen inventory <task-slug>', 'extrair componentes do Figma', or any mention of connecting Figma screens to planning before plan-context runs. Accepts a phase number (integer) OR a task slug (string), optionally with an upfront list of Figma URLs."
disable-model-invocation: true
---

# Screen Inventory

Generate a screen inventory for a project phase. This document sits between the technical decisions and the implementation plan — it captures what exists visually in Figma, classifies each component's behavior, and ties server-connected components to capabilities in the project plan.

This skill is the front-end counterpart of `research`. It produces **verbs of intent** (e.g., "disparar upload de vídeo novo"), not HTTP specifications — which lets `plan-validate` reconcile the UI and API sources via the UIG-N check and catch gaps in either direction.

## Output Contract

Downstream skills — `plan-context`, `plan-build`, and `implement` — depend on the following seven fields as the **public API** of the inventory document. Any change to their name, format, or location must be coordinated with those skills; a silent rename breaks the contract. The `inventory-digest-reader` subagent dispatched by `plan-context` consumes fields 1–5 to build the `## UI Inventory` digest in `context.md`; `/plan-build` consumes all seven fields via bounded reads of the inventory file when expanding `UI Contracts` per-screen; `implement` consumes field 2 (Figma URL) when executing screen SIs via `figma:figma-implement-design`.

The **Inventory Output Contract Validation** rule below is the canonical checker (self-contained in this skill; no external reference). This skill itself enforces the checker before flipping `Status: Pending` → `Status: Validated` — downstream consumers trust the `Validated` flag and do not re-run the contract check. `plan-validate`'s `UIG-N` check validates **capability coverage** (join-table completeness), not the seven load-bearing fields.

**Load-bearing fields:**

1. **Route per screen** — the real route path (e.g., `/signup`), written on an explicit `**Route:**` metadata line immediately below the `## Screen:` heading. Serves as the join key between the inventory and each screen's UI Contract row in the plan, and between each screen SI and its Figma source during implementation. The `## Screen:` heading carries a human-readable name (`Tela de cadastro`, `Sign-up`); the route lives on the dedicated `**Route:**` line so downstream skills can parse it unambiguously regardless of the screen's display label.
2. **Figma URL with `node-id` per screen** — full Figma URL including the `?node-id=...` query, written on the `**Figma:**` line of each screen section. Consumed directly by `figma:figma-implement-design` during `/implement`. Without it, `/implement` halts the screen SI and asks the user to re-run `screen-inventory`.
3. **Component inventory table with `Type` column** — every row must be classified as `Presentational | Local-interactive | Server-connected`. `/plan-build` filters on `Server-connected` rows to build the `UI ↔ API Traceability Matrix` in the final plan artifact.
4. **`Reuse?` field per component** — three valid forms:
   - **`<path>`** — path to an existing DS component (e.g., `components/ui/button.tsx`); component is already in-repo and ready to be reused. `In DS?` is `✓`. **Existence is determined against the filesystem snapshot built in `## Context` step 6 — NOT against Figma's Code Connect map** (which can lag behind reality and report a path that has not yet been authored). When the snapshot is empty or the path is absent from it, emit form 2 (`<path> (new)`) instead.
   - **`<path> (new)`** — path to a component that is **planned but not yet created** (e.g., `components/ui/icon-button.tsx (new)`). The path is the canonical target the implementer will materialize during `/implement`; the suffix marks it as not-yet-existing. `In DS?` is `✗` (or remains `✗` even when a path is supplied — see Subagent prompt on inheritance rules). The `(new)` suffix is the **load-bearing detection signal** for `phase-b.md` § B2.6 (bootstrap SI synthesis) — `/plan-build` sweeps these markers to emit author + test SIs for the planned components. Stripping or normalizing the suffix downstream silently disables B2.6 detection.
   - **`new`** (bare literal, no path) — pure-DOM element (e.g., `<h1>`, `<p>`, helper text, inline link) rendered directly inside the screen Xa SI. No bootstrap SI is generated; no path target exists. `In DS?` is `✗`.

   Feeds the "Reused DS components" block of each UI Contract and the `figma-implement-design` context for existing-component wiring. Downstream consumers (`templates/tech-specs/ui-contracts.md`, `inventory-digest-reader`) are required to preserve the form byte-verbatim — see `## Field derivation for UI Contracts` for the contractual invariant.
5. **`Verbs of intent` table per screen** — one row per server-connected verb, verbatim (do not paraphrase). Used as-is in the UI Contract's `Verbs covered:` block and in the traceability matrix's `Verb` column.
6. **`### Observations` subsection per screen** — heading must exist even if empty. `/plan-build` routes its contents through a **7-bucket classifier** when rendering UI Contracts: **validation blocker** (→ FAILED mid-build), **open question** (→ `## Open questions` section, ingested as OQ-N by plan-validate), **TD mention** (→ TD cross-ref inside Technical Specifications), **a11y** (→ Accessibility notes on the screen's UI Contract), **interaction** (→ `*Interactions:*` sub-block of Behaviors on the screen's UI Contract), **reuse** (→ Reused DS components note), **other** (→ ignored silently).
7. **`## Open questions` section** — heading must exist even if empty. `plan-validate` ingests each entry as an OQ-N (unresolved open question) during the UI coherence checks.

**Not part of the contract (internal to this skill):** progress-file fields (Status, Screens counter, Decisions log), cross-phase `see screen:` notes, validation diagnostics, the Reconciliation summary table. These can change shape without breaking downstream consumers. The `In DS?` column is **internal in the sense that downstream consumers do not grep it directly** — they read the `Reuse?` form per item 4 — **however, its `✓`/`✗` value is contractually paired with the `Reuse?` form** (`✓` ↔ form 1, `✗` ↔ forms 2 and 3) and follows the precedence rules in the sub-agent prompt template. Display shape may evolve; pairing semantics cannot.

### Inventory Output Contract Validation (canonical)

Before marking `Status: Validated`, every inventory file must satisfy:

1. Every screen section has a `**Route:**` line immediately below `## Screen:`.
2. Every screen section has a `**Figma:**` line with a full URL including `?node-id=...`.
3. Component inventory tables have every row classified (no blank `Type` cells).
4. Every row has a `Reuse?` value matching one of the three canonical forms (per Output Contract item 4): a valid path (existing component), `<path> (new)` (planned target with suffix), or the literal `new` (pure-DOM, no path).
5. Verbs of intent tables are present even when empty (use `_No server-connected components in this screen._` inside a single row).
6. `### Observations` heading exists for every screen, even if empty.
7. `## Open questions` heading exists, even if empty.

Any violation → skill halts `Status: Pending` until fixed.

## Skip criteria (pre-flight abort)

Abort and tell the user when:

- The phase is purely back-end.
- The phase only changes existing screens in ways that do not introduce new verbs or new components (pure styling, copy, token swaps).
- There is no Figma source yet — resolve the design gap first, then come back.

Skip criteria apply equally in phase and task mode. In task mode, the "phase is purely back-end" test maps to "task scope is purely back-end" (detected from prose + scope_description of any associated decisions doc).

## Context — read before generating

1. **Scope source — mode-dependent:**
   - **Phase mode** (slice slug, or integer `NN` resolving to one UI-bearing slice): first bounded-read the slice's `docs/decisions/technical-decisions-{slug}.md` frontmatter.
     - If `covers_capabilities: [...]` is populated → those bullets (verbatim) are the scope source. Every server-connected verb must map to a bullet in `covers_capabilities`, not to any arbitrary phase bullet. This prevents verbs from leaking across slices.
     - If `covers_capabilities` is omitted (monolithic phase) → fall back to `docs/project-plan.md` → `### Fase NN — ...` section. Capabilities there are the source of truth; every verb maps verbatim to a phase bullet.
     - In both cases, `project-plan.md` is still read for phase title, neighbors, and deliverables context, but verb-to-capability mapping uses `covers_capabilities` when present.
   - **Task mode** (string arg): `docs/tasks/task-{slug}/context.md → ## Scope` (read bounded — `Grep -n '^## Scope$' ...` then bounded read to next `^## `). Capability column of the verbs table in task mode holds free-form prose derived from the scope, not verbatim bullets.
   - **Task mode — if `context.md` does not exist yet:** abort with canonical next-command: `"Task scope not defined — context.md missing. Run /plan-context {slug} first to establish task scope, then /screen-inventory {slug} to inventory screens."`. Screen-inventory does NOT accept inline prose args — scope must come from context.md. Co-ownership of bootstrap (per plan `Decisão #18`) means screen-inventory **can create the dir** for its own files (inventory.md, inventory.progress.md), but scope-prose-definition remains plan-context's responsibility. In practice, plan-context runs first in task mode regardless; the co-ownership is a defensive guarantee that screen-inventory doesn't fail on a missing dir if plan-context somehow didn't complete directory writes.
2. **`docs/decisions/`** — filter by `Scope=Frontend|Cross-layer` (Backend-only TDs don't influence classification); read the full body of each relevant row, since some decisions shape component classification. In **phase mode**, read TDs from the slice's own phase-scope doc (`technical-decisions-{slug}.md`), plus ad-hoc TDs with `NN ∈ related_phases`, plus sibling phase-scope docs listed in this slice's `depends_on_slices` frontmatter (for inherited cross-layer contracts). In **task mode**, read the task's own decisions doc (`technical-decisions-{slug}.md`) if it exists; no auto-inclusion of prior-phase TDs (those shaped existing code, not new task scope). If the decisions doc does not exist yet, the inventory can still be generated; flag it so `plan-context` knows.
3. **`docs/phases/`** — already planned phases, for format and tone consistency reference only. Do not pull technical decisions from here.
4. **`docs/inventories/`** — previous inventories. Read them for format consistency and to detect cross-phase reuse: when the parent spots a component that was already inventoried in a prior phase and still exists unchanged, it passes the prior classification to the sub-agent via the "Already-classified components" bullet of the prompt template (same channel used for intra-phase reuse), so the sub-agent reuses it instead of re-classifying.

   **Cross-phase promotion of `(new)` markers.** When the parent finds a component in a prior inventory with `In DS?: ✗` AND a `Reuse?` path carrying the `(new)` suffix (form 2), AND that path is present in the **step-6 filesystem snapshot** built below (i.e., the prior phase's planned component has since been authored in-repo), **override the inherited entry before passing it to the sub-agent**: emit `In DS?: ✓` AND the `Reuse?` path **with the `(new)` suffix stripped** (form 1). Without this promotion, a planned component that was implemented in a later phase would persist forever as `(new)` in every subsequent inventory, and `phase-b.md` § B2.6 would re-emit a redundant bootstrap SI for an already-existing file. The promotion only fires for **form-2 inherited entries** with a path; form-3 inherited entries (bare `new`, pure-DOM) never have a path to compare against and pass through verbatim.
5. **Figma inputs** — the phase number is required at the start of the session. Figma URLs with nodeIds are collected during "Figma inputs" below: either provided upfront by the user as a shortcut, or gathered after Step 1 screen inference. Both paths converge on the same reconciled screen list before any Figma MCP call is made.
6. **Filesystem DS snapshot — canonical `In DS?` source.** `Glob <frontend-subproject>/components/**/*.{tsx,ts}` to build the set of paths that actually exist in-repo. `<frontend-subproject>` resolves from the slice's phase-scope decisions doc (phase mode) or the task's `context.md` (task mode); role-to-directory disambiguation follows the canonical hierarchy used elsewhere in this skill (inspect directory layout → cross-reference `docs/project-plan.md` § Subprojects → ask via `AskUserQuestion` on ambiguity — do not guess). The resulting set is the **canonical source of truth for `In DS? ✓` vs `✗`** and is passed to every dispatched sub-agent via the "Filesystem-existing DS paths" bullet of the prompt template (see "What the parent passes to each sub-agent" below). When the directory is empty (greenfield) or missing entirely, the set is empty; sub-agents then mark every Reuse? path with the `(new)` suffix per Output Contract item 4 form 2. This step closes the gap where Figma's Code Connect map could falsely suggest a component exists in-repo when the file has not yet been authored.

## Session state — progress file and resume

Inventorying a phase with many screens can exceed the context window in a single session. A progress file alongside the inventory document keeps the work resumable and is the source of truth for the completion state.

- **Location (mode-dependent):**
  - Phase mode: `docs/inventories/screen-inventory-phase-NN-[name-slug].progress.md`, sibling of the inventory document.
  - Task mode: `docs/tasks/task-{slug}/inventory.progress.md`, sibling of `inventory.md`.
- **Updated** after each screen section is appended to the inventory and after each round of user-resolved ambiguities.
- **Format:**

```markdown
# {name} — Screen Inventory Progress

_(where `{name}` is `phase-NN-{slug}` in phase mode OR `task-{slug}` in task mode)_

**Status:** in_progress | completed
**Screens:** X/Y completed

## Reconciled screen list

| # | Screen name                  | URL (fileKey:nodeId) | Status       |
|---|------------------------------|----------------------|--------------|
| 1 | Tela de cadastro             | ABC123:1234:5        | completed    |
| 2 | Tela de login                | ABC123:1234:10       | in_progress  |
| 3 | Tela de confirmação de conta | ABC123:1234:20       | pending      |

Status values: `pending` | `in_progress` | `completed`. The mixed state above reflects a session interrupted mid-dispatch; in a clean run, rows transition together from `pending` → `in_progress` → `completed` because all sub-agents are dispatched and returned in the same turn.

## Screens removed as out-of-scope

- ~~Tela de erro de confirmação~~ — user: "é só um toast, não tem tela"

## Decisions log

- [DECISION: VideoCard fetcha sozinho ou recebe do pai?] — pending
- ✓ [DECISION: SortDropdown é local ou server?] — resolved: local (applied to screen 2)
```

### Preflight and resume

Run these checks before Figma inputs Step 1 — stop and ask rather than guessing:

- **Phase exists in `docs/project-plan.md`** (the `### Fase NN — …` section matching the phase number). If not, stop.
- **Look for an existing progress file.** If found:
  - Read the Reconciled screen list → skip Figma inputs Steps 1–4 entirely (screens, URLs, parsed IDs, and file headers all already exist). The parent still reads the phase section of `docs/project-plan.md` here so it has the capabilities to pass to the sub-agents it's about to dispatch — only the inference and URL-collection work is skipped.
  - Run the **Token drift detection** subsection below — pass any `fileKey:nodeId` from the reconciled list (all entries reference the same file-level variable collections).
  - Resume from the first screen whose status is `pending` or `in_progress`, and tell the user: `"Encontrado progress file com X/Y telas completas. Retomando a partir de: <screen name>."`
  - If all screens are `completed` but `Status` is still `in_progress`, skip screen processing and go straight to the Final sections flow (which runs the cross-screen Validation section first, then builds the Reconciliation summary and Open questions), then mark `completed`.
  - If the progress file is malformed or contradicts the inventory document, stop and report — never overwrite or "clean and restart".
- **No progress file** → fresh run; it will be created during Figma inputs Step 4, once the reconciled screen list is settled and URLs are parsed.
- **Progress file exists with `Status: completed` and the user wants to add a new screen** → extension run. Follow the steps below.
- **Progress file exists with `Status: completed` and no new screen was requested** → tell the user the inventory is already validated and ask whether they want to extend it with a new screen. Do not re-process existing screens.

### Extension run (add screen to completed inventory)

An extension run happens when the user adds a new screen to an inventory that is already `Status: completed` — either because the screen was out-of-scope at first and is now being brought in, or because new Figma designs were produced after the original run.

1. **Collect the new screen's URL** (Figma inputs Steps 2–3 for that screen only). Parse fileKey and nodeId.
2. **Update the progress file.** Append a new row to the Reconciled screen list with status `pending`. Update `Screens: N/(N+1) completed`. Keep `Status: completed` — do not revert to `in_progress`.
3. **Flip the inventory file `Status` from `Validated` to `Pending`** — it is no longer validated until all post-addition steps finish.
4. **Dispatch the sub-agent** for the new screen, following the sub-agent prompt template. Pass already-classified components from ALL existing screens in the inventory (not just the new one) using the extended format including `In DS?`.
5. **Process the returned block** following "Parent processing after sub-agents return" steps 1–4 (append, collect `[DECISION: ...]`, resolve, consolidate).
6. **Run cross-screen Validation in full**, including the staleness check on existing Observations (see Validation section below). If issues are found, stop and resolve before continuing.
7. **Re-generate Reconciliation summary and Open questions in their entirety**, re-reading all screens (old and new). Do not patch individual rows — re-write both sections from scratch to avoid stale phrasing.
8. **Flip statuses back**: set inventory `Status: Validated` and update progress file `Screens: (N+1)/(N+1) completed`.

### Token drift detection (non-blocking, advisory)

Advisory, read-only check: warns if Figma design tokens have drifted from the frontend subproject's design-tokens CSS file, so the inventory is not classifying against stale CSS. Never blocks — only warns. Resolve the design-tokens CSS path from the frontend subproject's framework convention (e.g., Next.js App Router → `app/globals.css`; Vite/CRA → `src/index.css`). If the path cannot be resolved unambiguously, ask the user via `AskUserQuestion`.

**When:** during Preflight on a resume run, or right after Figma inputs Step 3 on a fresh run (before Step 4 creates the files, so aborting is cheap).

**How:** pick any `fileKey:nodeId` from the reconciled screen list → call `mcp__plugin_figma_figma__get_variable_defs` → compare returned tokens against the matching blocks in `globals.css` (`--color-*` → `@theme inline`; `--radius-*`, `--spacing-*`, and semantic theme tokens → `:root` / `.dark`). If drift is found, warn: `"Detectados N tokens com drift entre Figma e globals.css. Recomendo rodar 'pull-figma-tokens' antes de inventariar. Prosseguir mesmo assim?"`. If no drift, stay silent.

**The one non-obvious rule:** never invoke `pull-figma-tokens` inline — if the user aborts, they run it separately.

## Input handling — phase mode (slug-primary)

Phase mode accepts a **slice slug (string)** as the primary identifier. The integer shortcut `NN` still works under the following condition, consistent with the plan-pipeline slicing contract (`plan-pipeline/SKILL.md` — "Phase slicing"):

- **String arg `{slug}`** → resolves to `docs/decisions/technical-decisions-{slug}.md`. If the doc has `scope_type: phase`, proceed as phase mode (slice); `NN` is extracted from `related_phases[0]`.
- **Integer arg `NN`** → glob phase-scope decisions docs with `related_phases: [NN]`. Then filter to **UI-bearing slices** (those whose `covers_capabilities` contains at least one UI bullet per the signals in "What counts as a screen signal" below, or whose `covers_capabilities` is omitted in a monolithic phase).
  - If exactly 1 UI-bearing slice → proceed with that slice's slug.
  - If ≥2 UI-bearing slices → abort with the canonical message: `"Phase NN has multiple UI-bearing slices: <list>. Pass an explicit slice slug."`
  - If 0 phase-scope docs for NN → abort with `"Run /research phase NN first"`.
  - If 0 UI-bearing slices (all slices are purely back-end) → abort per "Skip criteria" below.

**Abort-fast (no UI signal in slice):** if the resolved slice has `covers_capabilities` populated AND none of its entries contain a UI signal (per "What counts as a screen signal"), refuse to run with: `"Slice {slug} declares no UI capabilities — use /screen-inventory on a UI-bearing slice or add UI bullets to covers_capabilities."` This applies only when `covers_capabilities` is explicitly set; a monolithic phase (field omitted) falls back to the phase-level UI detection rules in Step 1.

## Figma inputs — screen identification and URL collection

The skill always operates on a specific phase slice. The user must provide the slice slug (or an integer `NN` that resolves to exactly one UI-bearing slice). URLs may be provided upfront or collected after screen inference — both paths converge at the same place.

### Step 1: Infer candidate screens from the phase or task

**Phase mode** — determine the capability list per the "Scope source" rules above: if the slice's decisions-doc frontmatter has `covers_capabilities`, walk those bullets (verbatim); otherwise fall back to the `### Fase NN — …` section in `docs/project-plan.md` (monolithic). For each capability, decide whether it implies a screen, a component on an existing screen, or nothing screen-related at all. The goal is a **preliminary list of candidate screens** that the user will then confirm and annotate with URLs.

**Task mode** — read the `## Scope` section of `docs/tasks/task-{slug}/context.md` (bounded grep + bounded read). The scope prose is often less structured than phase capabilities — treat each noun phrase that names a UI surface as a candidate screen signal. The `[inferred]` tag and `[DECISION: ...]` markers work identically to phase mode.

**What counts as a screen signal:**

- **Explicit screen mentions.** Phrases like "Tela de …", "Página de …", "Painel de …", "Área de …", "Home page", "Página inicial" are unambiguous screen references. Create one candidate per mention. Example: `"Telas de cadastro, login, confirmação de conta e recuperação de senha"` → four candidates.
- **Implicit user-facing actions.** Capabilities that describe an action a user performs but do not name a screen (e.g., "Edição das informações do vídeo", "Fluxo de rascunho → publicação") usually require a screen to host the action. Create a candidate and mark it `[inferred]` so the user can confirm. These are the most error-prone — err on the side of listing them and letting the user remove what is not actually new UI.
- **Capabilities that cover multiple screens.** A single bullet may imply more than one screen. "Recuperação de senha: solicitação via e-mail → link com token → redefinição" implies at least two screens (solicitar reset, redefinir senha). Split them.

**What does NOT imply a screen:**

- **Backend services and infrastructure.** "Serviço de envio de e-mails transacionais", "Serviço de processamento em segundo plano (filas)", "Serviço de armazenamento de arquivos", "Banco de dados", "Fila" — these are back-end concerns; no screen.
- **Processing and automation.** "Processamento automático do vídeo", "Geração automática de thumbnail", "Criação automática do canal a partir do prefixo do e-mail" — happen without UI; no screen.
- **Cross-cutting concerns.** "Layout responsivo", "Testes dos fluxos principais", "Ambiente de produção e deploy" — not screens.
- **Components, not screens.** "Header/navbar com logo, barra de busca, botão de login/avatar" describes a component that lives across screens. It is **not** a candidate screen — it belongs to the inventory of whichever screens render it. Flag these separately as shared components, not as candidates.
- **Capabilities already delivered in previous phases.** If an earlier phase (per `docs/phases/`) already covered the screen, skip it unless the current phase explicitly modifies it.

**When genuinely unsure, ask — do not guess.** Some capabilities are ambiguous in a way that "listing it optimistically" does not resolve: a single bullet might mean one screen or several, or might not need a screen at all depending on a UX choice the designer has not yet committed to. When that happens, capture the uncertainty as a `[DECISION: ...]` marker alongside the candidate list instead of picking a side. These markers are presented to the user in Step 2, together with URL collection, so inference ambiguities and URL assignment get resolved in the same round. Examples:

- `[DECISION: "Recuperação de senha: solicitação → link → redefinição" — 2 screens or 3? Does the email link land on an intermediate page or redirect straight to the reset form?]`
- `[DECISION: "Telas de cadastro e login" — two separate routes or one auth page with tabs?]`
- `[DECISION: "Acompanhamento do processamento do vídeo" — does this imply a progress screen, or is it a notification/toast on the upload screen?]`

`[DECISION: ...]` is the single marker syntax used throughout this skill; unresolved markers at session end go into the progress file's "Decisions log" block regardless of origin.

The output of this step is an internal draft list plus any `[DECISION: ...]` markers, not yet the inventory.

### Step 2: Present candidates and collect URLs from the user

Show the candidate list to the user and ask these four things in a single turn:

1. **For each candidate, the Figma URL with `node-id`.** Make the list a numbered checklist so the user can paste URLs next to each item.
2. **Confirmation or removal.** The user may tell you a candidate is out of scope (e.g., "confirmação de conta é só um link, não tem tela própria — o usuário cai direto no login"). Remove it from the final list.
3. **Additions.** The user may name screens the skill missed (a designer may have created a screen that is not obvious from the capabilities alone). Add them.
4. **Answers to any `[DECISION: ...]` markers raised in Step 1.** Present each marker verbatim alongside the candidate list. The user's answer may split a candidate into multiple screens, merge two into one, drop one entirely, or add a new one. Apply the answer before moving to Step 3.

If the user already supplied a list of URLs upfront (the shortcut path), still run Step 1 and reconcile: every candidate must either have a URL from the user or be explicitly marked out-of-scope. Every user-supplied URL must map to at least one candidate (or to an explicit addition). Mismatches are ambiguities — stop and ask before proceeding.

### Step 3: Parse the URLs

Once the final screen → URL list is settled, parse each URL. Acceptable forms:

- `https://www.figma.com/design/:fileKey/:fileName?node-id=:nodeId`
- Branch URL: `https://www.figma.com/design/:fileKey/branch/:branchKey/:fileName?node-id=:nodeId` (use `branchKey` as `fileKey` when calling the MCP).

For each URL, extract `fileKey` and `nodeId`. Convert `nodeId` from URL form (`123-456`) to MCP form (`123:456`). If any URL is missing a `nodeId`, stop and ask — the skill inventories a specific screen node, not an entire file. If the user provides a screen name without a URL (e.g., "the /my-videos page"), ask for the exact URL; resolving screen names from a file is guesswork and produces wrong inventories.

Before moving on to Step 4, run the **Token drift detection** subsection (under "Session state — progress file and resume" above). On a fresh run, this is the point where `fileKey:nodeId` pairs first become available — the drift check must fire here so the user can abort and run `pull-figma-tokens` before the inventory and progress files are created.

### Step 4: Create the inventory and progress files

Before dispatching any sub-agent, create both files on disk. All later operations are `Edit` insertions into pre-existing structure, which makes parent processing simple and the progress file meaningful on resume.

**Paths (mode-dependent):**

- Phase mode:
  - Inventory: `docs/inventories/screen-inventory-phase-NN-[name-slug].md`
  - Progress: `docs/inventories/screen-inventory-phase-NN-[name-slug].progress.md`
- Task mode:
  - Inventory: `docs/tasks/task-{slug}/inventory.md`
  - Progress: `docs/tasks/task-{slug}/inventory.progress.md`

**Directory bootstrap (task mode only):** before writing the inventory file:

1. Verify `docs/tasks/task-{slug}/context.md` exists. **If not:** abort with `"Task scope not defined — docs/tasks/task-{slug}/context.md missing. Run /plan-context {slug} first to establish task scope, then rerun /screen-inventory {slug}."`. Screen-inventory needs scope prose to extract capability mapping and cannot define it on its own.
2. If context.md exists but dir is incomplete (edge case — corruption or re-entrancy), apply slug collision check (Decisão #22 of `unify-plan-and-implement.md`); create missing files via `mkdir -p` (idempotent, defensive).
3. Proceed with writes of inventory.md + inventory.progress.md.

Rationale: narrow co-ownership (per plan `Decisão #18`) — screen-inventory creates only its own files, but does not substitute plan-context in defining task scope. Canonical workflow remains plan-context → screen-inventory.

**Inventory file header:**

- Phase mode: `# phase-NN-{slug} — Screen Inventory`
- Task mode: `# task-{slug} — Screen Inventory`

Write the header from the "Output structure" template (`Status: Pending`, current date, `Screens in scope: N`), followed **directly** by an empty `## Reconciliation summary` heading and an empty `## Open questions` heading. Screen sections are inserted later via `Edit`, each one placed immediately before the `## Reconciliation summary` heading — so insertion order in the file matches the order in the Reconciled screen list, and the two final sections stay anchored at the end.

**Progress file** — write the header with `Status: in_progress` and `Screens: 0/N completed`, followed by the Reconciled screen list with `fileKey:nodeId` parsed in Step 3 (every row initially `pending`). Include the "Screens removed as out-of-scope" and "Decisions log" headings even if empty — any entries produced during Step 2 go in at creation time: removals into "Screens removed as out-of-scope", resolved `[DECISION: ...]` markers into "Decisions log".

Only after both files exist do you move on to "How to extract structure from Figma".

## How to extract structure from Figma

Figma extraction is **always delegated to sub-agents via the `Agent` tool**, one per screen that still needs extraction (all screens on a fresh run; just the `pending`/`in_progress` rows on resume). For multi-screen phases, spawn them in parallel in a single turn (multiple `Agent` tool calls in one message). Each sub-agent has its own context window, so the raw output of `get_design_context` + `get_screenshot` never enters the parent's context — the parent only sees the sub-agent's structured return, a markdown block ready to paste into the inventory file.

### Sub-agent contract

The parent is the only entity that talks to the user, reads files, writes files, and updates the progress file. Sub-agents are pure extractors — they receive a self-contained prompt, call Figma MCP, classify, and return.

**What the parent passes to each sub-agent:**

1. **The Figma target:** `fileKey`, `nodeId` (in MCP form), and the full URL.
2. **The phase capabilities, quoted verbatim** from the relevant `### Fase NN — …` section of `docs/project-plan.md`. Sub-agents do NOT read project-plan.md themselves — the parent reads it once (during Figma inputs Step 1 on a fresh run, or during preflight on a resume) and passes the relevant slice to every sub-agent it dispatches.
3. **A pointer to the classification rules:** the sub-agent is instructed to read the sections "How to classify components", "How to derive verbs of intent", and "Output structure" from `.claude/skills/screen-inventory/SKILL.md`. These rules are too long to restate in every prompt and change rarely, so pointing to them keeps the prompt short; only the short extraction-time rules are still restated inline in the template below.
4. **Already-classified components the sub-agent should reuse**, aggregated by the parent from two sources: (a) screens already appended to the current inventory file — only populated when a new parent resumes a partially-completed run from an existing progress file; (b) components found unchanged in prior-phase inventories under `docs/inventories/` — populated when the parent identified cross-phase reuse candidates while reading that directory in the Context step. Format: `ComponentName → Type, In DS?: ✓/✗[, reuse path][, source: current | phase-NN]`. When building this list, read the corresponding row in the Component inventory table of the existing inventory and extract: Type, In DS?, Reuse?, and any "see screen:" Notes. Do not omit `In DS?` — it is the most critical field for cross-screen consistency. If In DS? is `✗`, keep it `✗` even if Reuse? has a path value (the path is planned, not yet implemented) — **except** when the Cross-phase promotion rule fires (see Context step 4: a form-2 inherited entry whose path is now present in the step-6 filesystem snapshot is overridden to `In DS?: ✓` with the `(new)` suffix stripped).
5. **The return contract** (see below).

**What the sub-agent returns:**

A markdown block matching the Output structure template: `## Screen: …`, the `### Component inventory` table, the `### Verbs of intent` table, and `### Observations` if any. Ready for the parent to paste into the inventory document. For any component or verb the sub-agent cannot resolve, the corresponding row is filled with `[DECISION: option A | option B — context]` as the classification or verb value (including enough context — component name, node id, missing evidence — for the parent to present it to the user as a standalone question). Output is always complete; ambiguity is expressed **inline** in the affected row, never by withholding the block or returning a separate marker list.

**What sub-agents MUST NOT do:**

- Write to any file (inventory, progress, or otherwise).
- Ask the user anything — sub-agents are non-interactive.
- Invent components not present in the Figma output.
- Define API contracts, endpoint shapes, or HTTP details. Verbs only.
- Silently fill in components visible in the screenshot but absent from `get_design_context` — these MUST be flagged in the Observations subsection instead.

### Sub-agent prompt template

Use this as the prompt body when spawning each sub-agent (fill in the bracketed fields):

```
You are inventorying a single Figma screen for the screen-inventory skill.

Screen: [screen name from the reconciled list]
Figma fileKey: [fileKey]
Figma nodeId: [nodeId in MCP form, e.g. 1234:5]
URL: [full URL]

Your task:
1. Read .claude/skills/screen-inventory/SKILL.md, sections "How to classify components", "How to derive verbs of intent", and "Output structure" (for the exact screen section format to emit). These are the rules you must follow.
2. Call mcp__plugin_figma_figma__get_design_context with the fileKey and nodeId above.
3. Call mcp__plugin_figma_figma__get_screenshot with the same.
4. List every component in the tree. Classify each as Presentational, Local-interactive, or Server-connected, using evidence from BOTH the Figma output AND the phase capabilities listed below.
5. For each Server-connected component, derive one or more verbs of intent and map each verb to exactly one capability from the list below (quote the capability verbatim).

Phase capabilities (verbatim from docs/project-plan.md, phase [NN]):
- "[capability 1]"
- "[capability 2]"
- ...

Already-classified components to reuse rather than re-deriving (aggregated by the parent from the current inventory file on resume AND from prior-phase inventories under docs/inventories/ when unchanged; empty on a fresh run with no cross-phase matches):
- [ComponentName] → [Type], In DS?: ✓/✗[, reuse path] (source: current | phase-NN)
- ...
(or the literal string "none")

Filesystem-existing DS paths (canonical `In DS?` source — built by the parent in `## Context` step 6 via `Glob <frontend-subproject>/components/**/*.{tsx,ts}`; this set is the ground truth for whether a path actually exists in-repo, NOT Figma's Code Connect map):
- [path]
- [path]
- ...
(or the literal string "none" when the components directory is empty or missing)

**Precedence rules for `In DS?` and `Reuse?`** (apply in this order; first match wins):

1. **Inherited list** — If a component appears in the "Already-classified components" list, inherit its `In DS?` and `Reuse?` values exactly as given — do NOT re-derive them from the Figma output, the Filesystem-existing DS paths set, or any inference about the codebase. If the record says `In DS?: ✗`, keep `✗` in your output even if a path seems to exist elsewhere. **For planned-but-not-yet-created components** (the second `Reuse?` form per Output Contract item 4 — `<path> (new)`), keep `In DS?: ✗` AND emit the path with the literal ` (new)` suffix preserved byte-verbatim — the suffix is the load-bearing detection signal for `phase-b.md` § B2.6 (bootstrap SI synthesis). Never strip it, never normalize it, never substitute the bare literal `new`.

2. **Filesystem-existing DS paths** — If the component is NOT in the inherited list AND Figma's `get_design_context` (Code Connect map) emits a `Reuse?` path candidate, check the path against the "Filesystem-existing DS paths" set above. **In set → emit the path verbatim with `In DS?: ✓`. NOT in set → emit the SAME path with the literal ` (new)` suffix appended AND `In DS?: ✗`.** This is the canonical mechanism that prevents Code Connect's lag-behind-reality from leaking into the inventory as false-positive `✓` rows (e.g., a Code Connect entry for `components/ui/button.tsx` while the file has not yet been authored on disk).

3. **No path emitted by Figma** — If Figma's output suggests no DS-path target for the component (genuinely new pure-DOM element like `<h1>`, `<p>`, helper text, inline link), emit the bare literal `new` (no path) with `In DS?: ✗`.

The parent, not you, is responsible for any updates to DS state beyond this discriminator (e.g., flipping a row's `In DS?` from `✗` to `✓` after a future phase actually creates the component — that propagates via the cross-phase reuse rule at Context step 4 on the next inventory run).

Return format:

Return ONLY a markdown block matching the screen section format defined in "Output structure" (no preamble, no explanation). Populate Component inventory, Verbs of intent, and Observations (omit Observations if empty). For any row you cannot resolve, use `[DECISION: option A | option B — concrete context including component name, node id, and what evidence is missing]` as the value in the ambiguous column. Never omit a row, never return a separate marker list.

Rules:
- Do NOT write to any file.
- Do NOT invent components not present in the Figma output.
- Do NOT define API contracts, endpoints, or HTTP specifics. Verbs are intents, not endpoints.
- Do NOT ask questions — return ambiguities as markers instead.
- Components visible only in the screenshot but absent from get_design_context MUST be flagged in the Observations subsection, not silently filled in.
```

### Parent processing after sub-agents return

Once all sub-agents have returned in the same turn, process them in this order. Each step that mutates state updates the progress file before moving on — a session interruption should lose at most the work of one in-flight sub-agent.

1. **Append every returned block to the inventory.** Insert each one directly before the `## Reconciliation summary` heading (created in Figma inputs Step 4) using `Edit`, and mark that screen `completed` in the progress file.
2. **Collect inline `[DECISION: ...]` markers and batch one user round.** Scan the appended tables for rows whose value is a `[DECISION: ...]` marker and present them together — via `AskUserQuestion` if the total is ≤4, otherwise as a numbered list in a regular message. Write pending markers to the progress file's "Decisions log" block *before* asking, so a session interruption does not lose them.
3. **Apply resolutions by editing the specific rows.** For each user answer, `Edit` the affected table row in place — no re-dispatch, no re-calling Figma MCP. Update the progress file's Decisions log block to mark the resolution.
4. **Consolidate duplicates across screens.** Scan the concatenated inventory for components that appear in multiple screens with identical classifications (e.g., `PageHeader`, `Footer`, `Toast`). Leave the first occurrence intact and replace later occurrences with a `see screen: <name>` reference in the Notes column — keeps the inventory compact and prevents re-classification drift.

### Final sections: Reconciliation summary and Open questions

Once consolidation is done, the inventory file has all its screen sections but the `## Reconciliation summary` and `## Open questions` headings are still empty. Before filling them:

1. **Run the cross-screen Validation section below.** It checks uncovered capabilities, missing Figma inputs, and residual decision dependencies. If any issue is raised, stop and resolve with the user before continuing — the Reconciliation summary cannot be trusted without it.
2. **Build the Reconciliation summary.** Walk the Verbs of intent tables across all screen sections in the inventory file. For every capability in the phase's project-plan.md section, produce one row: the capability quote, the components that cover it (aggregated across screens), and the screens where they appear. Validation has already confirmed every capability has coverage, so every row is populated.
3. **Build the Open questions section.** Collect, in order: residual decision dependencies from each screen's Observations subsection, any `[DECISION: ...]` markers still pending in the progress file's Decisions log block, and anything the parent surfaced during consolidation or validation that needs pipeline-level resolution (ingested by `plan-validate` as OQ-N). If there are none, omit the section entirely (remove the empty heading from the inventory file). **In extension runs**, the old Open questions section may contain narrative prose (e.g., "apenas Tela X e Tela Y" screen counts, or capabilities described as fully out-of-scope that are now partially covered) that contradicts the new state. Update that prose in place with `Edit` **before** replacing the bullet list from scratch.
4. **Flip statuses.** Set the inventory file's `Status` from `Pending` to `Validated` and the progress file's `Status` from `in_progress` to `completed`.

## How to classify components

Every component in each screen falls into exactly one of three categories. Classification requires evidence from **both** the Figma structure **and** the project plan — Figma alone cannot tell you whether a button triggers a server action, and the project plan alone cannot tell you how it is expressed visually.

### Presentational

- Renders content, holds no state, reacts to no events.
- Receives props and shows them.
- Examples: `Avatar`, `Badge`, `Heading`, static `PageHeader`, the text block of an `EmptyState`.
- **Evidence:** the component has no interactive affordance in the Figma design (no pressed/hover variant with distinct behavior, no form field, no action icon) **and** no capability in the project plan implies it does anything.

### Local-interactive

- Holds UI state that lives entirely in the client.
- May react to events, but none of those events cause I/O to the backend.
- Examples: dropdown open/close, tabs, accordion, tooltip, password-visibility toggle, sort dropdown that reorders already-loaded data, a confirm dialog that wraps a server action but does not perform it itself.
- **Evidence:** the component has interactive states in Figma **but** removing the backend entirely would not break it. If in doubt, ask: "if the backend did not exist, would this component still function?" If yes, it is local-interactive.
- **Framework navigation note:** framework-provided client-side navigation links that just change route count as local-interactive unless the navigation itself is the server action (rare). E.g., Next.js `<Link>`, React Router `<Link>`, Vue Router `<router-link>`, SvelteKit `<a>` com prefetch.

### Server-connected

- Triggers I/O to the backend: reads data the screen did not start with, writes data, or depends on server state to decide what to render.
- Examples: `VideoCard` (displays data fetched from backend), `UploadButton` (dispatches a mutation), `LikeButton` (optimistic update + server call), `CommentList` (fetches + paginates from server), a `DeleteAction` inside a list item (server mutation).
- **Evidence:** the component's purpose requires the backend to function **and** the project plan has a capability that describes the action.

### When classification is ambiguous

Do not guess — the sub-agent fills the Type column with an inline `[DECISION: ...]` marker (see Sub-agent contract). One exception worth settling in advance: a form that combines local validation and server submission always classifies as **Server-connected**; the backend interaction dominates.

## How to derive verbs of intent

For every server-connected component, write one or more **verbs**. A verb is a short phrase in the infinitive that describes what the user is accomplishing through that component — not how the backend implements it.

**Good:** "Exibir lista paginada de vídeos do canal", "Disparar upload de vídeo novo".

**Bad:** "POST /videos com multipart/form-data" (API contract — `/plan-build`'s job in the final artifact), "Fetchar dados" (too vague — dados de quê, para quê?).

Each verb must map to exactly one capability in `docs/project-plan.md` (phase mode) or exactly one scope implication from the task's `## Scope` prose (task mode). Write the capability/scope's verbatim text (or a short quote) next to the verb. If no capability matches, fill the Capability column of that row with a `[DECISION: ...]` marker so the parent picks it up during the user-round batching step. Never guess.

In task mode, the **Capability (project-plan.md)** column header is renamed to **Scope match** (or similar neutral label), and its value is a short prose phrase derived from the task's `## Scope`, not a verbatim bullet quote. The bijection check (every verb has a scope match; every scope implication has a verb covering it) still applies — `plan-validate` enforces it via the UIG-N check.

A single component can have multiple verbs (e.g., a list item with both "exibir vídeo" and "remover vídeo" via a kebab menu). Record all of them — one row per verb in the verbs table.

## Validation — cross-screen, run before Final sections

Per-screen validation (component classification ambiguity, verb without matching capability for a specific component) is handled inside each sub-agent by emitting inline `[DECISION: ...]` markers in the affected rows, and resolved during Parent processing steps 2–3 (batch user round, then edit the affected rows in place). This section covers the complementary **cross-screen** checks the parent runs once every screen has been appended and consolidation is done, but before building the Reconciliation summary and Open questions:

**Capabilities without coverage:**

- Every capability in the phase's project-plan.md section must be covered by at least one verb in at least one screen's Verbs of intent table. A capability with zero coverage means either a screen is missing from scope, a verb was phrased too far from the capability text to match, or the design is incomplete — surface it to the user so they can decide which.

**Figma completeness:**

- Screens referenced in project-plan.md (explicit mentions or Step 1 inferences) that the user did not supply URLs for during Step 2, if any slipped past reconciliation.
- Components flagged in any screen's Observations subsection as "visible in screenshot but absent from `get_design_context`" — ask whether they are in scope, need a new Figma extraction, or should stay as notes.

**Residual decision dependencies:**

- Entries in the Decisions log (progress file) that were not resolved during per-screen ambiguity rounds but still affect the Reconciliation summary or Open questions output (e.g., classifications that depend on a pipeline-level decision not yet made — ingested by `plan-validate` as OQ-N).

**Staleness of Observations (extension runs only):**

- Re-read all Observations from previously-completed screens.
- For any sentence that mentions "fora do escopo", "pendente", "não inventariada", or references a specific screen by name — check whether the newly added screen changes that state. If so, `Edit` the Observation to reflect the new context.
- Patterns to detect: "fluxo X está fora do escopo desta fase", "rota de destino existirá como stub", "nenhuma das N telas foi inventariada", "[link] aponta para rota ainda inexistente".

If any issues are found, stop and present them grouped by type, each with concrete references (capability quote, screen name, component name, node id). Wait for the user to resolve them — typically by adding a missing screen via a targeted re-run of the Figma inputs flow, updating `docs/project-plan.md`, or filling in `docs/decisions/`. Once resolved, re-run this validation and proceed to the Final sections step.

## Output structure

The inventory is a single markdown file per phase. Follow this template.

> **Reading the template below:** text rendered as `_(italic in parentheses)_` is author guidance about when to include the surrounding section. Do **not** copy these parentheticals into the generated file — apply them as conditions.

```markdown
# {name} — Screen Inventory

> **Phase:** [Phase name] _(phase mode only)_
> **Task:** [Task slug] _(task mode only)_
> **Status:** Pending | Validated
> **Date:** [YYYY-MM-DD]
> **Screens in scope:** N

---

## Screen: [Screen name — human-readable display label]

**Route:** `/actual/next/route`
**Figma:** [URL] (node `fileKey:nodeId`)
**Purpose (from project-plan.md):** one-sentence quote of the capability this screen primarily serves.

### Component inventory

| Component (Figma node)  | Type              | In DS? | Reuse?                      | Notes |
|-------------------------|-------------------|--------|-----------------------------|-------|
| VideoCard (1234:10)     | Server-connected  | ✓      | `components/ui/video-card`  | —     |
| DeleteAction (1234:70)  | Server-connected  | ✗      | new                         | sub-component of VideoCard kebab |
| UploadButton (1234:20)  | Server-connected  | ✗      | new                         | —     |
| SortDropdown (1234:40)  | Local-interactive | ✓      | `components/ui/dropdown`    | operates on already-loaded data |
| PageHeader (1234:5)     | Presentational    | ✓      | `components/ui/page-header` | —     |

### Verbs of intent

| Verb                                       | Component                        | Capability (project-plan.md)    |
|--------------------------------------------|----------------------------------|----------------------------------|
| Exibir lista paginada de vídeos do canal   | VideoCard                        | "Users view their videos"        |
| Disparar upload de vídeo novo              | UploadButton                     | "Users can upload videos"        |
| Remover vídeo do usuário                   | DeleteAction in VideoCard kebab  | "Users can delete own videos"    |

### Observations

_(optional — anything that does not fit the tables: decision dependencies, open questions, reuse notes, accessibility concerns flagged by the designer. Omit this subsection if empty.)_

---

_(repeat for each screen)_

## Reconciliation summary

| Capability (project-plan.md)   | Covered by   | Screens     |
|--------------------------------|--------------|-------------|
| "Users view their videos"      | VideoCard    | /my-videos  |
| "Users can upload videos"      | UploadButton | /my-videos  |
| "Users can delete own videos"  | DeleteAction | /my-videos  |

_List every capability in the phase scope. For each, show which component(s) cover it and in which screen(s). A capability with no coverage is a gap — flag it during Validation, do not fabricate coverage here._

## Open questions

_(optional — decisions the inventory could not resolve that plan-validate / plan-resolve will need to handle. Omit if empty.)_

- Should `VideoCard` fetch its own data or receive it from the parent RSC?
- Is pagination cursor-based or offset-based? (Affects the shape of data `VideoCard` receives.)
```

## Output

Save to:

- Phase mode: `docs/inventories/screen-inventory-phase-NN-[name-slug].md`
- Task mode: `docs/tasks/task-{slug}/inventory.md`

Examples:

- `docs/inventories/screen-inventory-phase-03-my-videos.md`
- `docs/tasks/task-refactor-video-card/inventory.md`

After the user reviews the draft and resolves any open markers, set `Status: Validated` in the header. This document is then consumed by `plan-context` (via the `inventory-digest-reader` subagent) as an additional input alongside `docs/decisions/`, and contributes to the `## UI Inventory` digest in `context.md`. `plan-build` later reads the inventory file with bounded per-screen reads when emitting `UI Contracts` and `UI ↔ API Traceability Matrix` in the final artifact.

## Hard rules (task mode specific)

These rules crystallize invariants implicit in the canonical workflow plan-context → screen-inventory. Violating any generates deadlock or state corruption.

- **Task mode — slug-only arg.** Accept exclusively a slug (kebab-case string) or prose auto-derivable to a slug. **Never** accept inline prose as "scope definition". Scope prose always comes from `docs/tasks/task-{slug}/context.md → ## Scope`, written by `plan-context`.
- **Task mode — context.md missing → abort, never bootstrap scope.** If `docs/tasks/task-{slug}/context.md` does not exist at preflight, abort with canonical next-command requiring `/plan-context {slug}` first. Bootstrap co-ownership covers only **dir and own files** (inventory.md, inventory.progress.md) — **never** scope definition.
- **Never write to `context.md`.** `plan-context` is sole writer. Screen-inventory only reads `## Scope` to extract capability mapping in task mode.
- **Never invoke `/plan-context`, `/plan-validate`, `/plan-resolve`, `/plan-build`, or `/implement` from within screen-inventory.** Skill is non-orchestrative — user is sole orchestrator of the pipeline. Abort-with-command pattern always returns control to the user.
- **Never touch `docs/decisions/`.** Decisions docs are owned by `/research` (create) and `plan-resolve` (mutate `**Decision:**` fields). Screen-inventory only reads ad-hoc docs with `Scope: Frontend | Cross-layer` as classification hints, never writes.
- **Never invoke `pull-figma-tokens` inline.** Drift check (existing behavior) is advisory non-blocking — always delegates the decision to the user.
