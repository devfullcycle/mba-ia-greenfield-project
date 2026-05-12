# Plan Pipeline — Stage 4: Build → Phase C (Append-mode)

This file is loaded by `.claude/skills/plan-build/SKILL.md` after Gate 10 dispatches Append-mode (Rerun semantics case 5: fully-completed artifact, no sentinelas, no `--rebuild` flag). Read SKILL.md for preflight gates, dispatcher rules, hard rules (including the **append-mode-specific Hard rules** under the same heading), output contract, and rerun semantics — they apply to every phase.

Append-mode propagates **deltas** — Revisions blocks and supersede markers added to decisions docs since the last build — into the existing plan artifact without renumbering or destroying executed SIs.

Append-mode reads `progress.md` (to classify each delta against per-SI status) and may write to it (C6 adds rows for newly-appended SIs). The schema is owned by `.claude/skills/implement/SKILL.md` § "Progress file → Format" — `/implement` is the **initial writer** (creates `progress.md` on first SI executed). `/plan-build` Phase C is a documented secondary writer, restricted to appending new-SI rows in C6. Per-SI `Status:` is `completed | pending` (the file-level `Status:` field that takes `in_progress | completed` is NOT a per-SI value). If `/implement` ever changes that schema, the parsing logic in C2 / C6 below must be updated to match.

## When append-mode runs

| Plan file | progress.md | Mode | Comportamento |
|---|---|---|---|
| existe | existe | append (auto) | Phase C — fluxo abaixo |
| existe | ausente | append (auto) | **Aborta**: `"progress.md ausente para {scope}. Plan está construído mas /implement nunca rodou (progress.md is created by /implement on first SI). Rode /implement {scope} primeiro, ou passe --rebuild para reconstruir o plan do zero."` |
| ausente | ausente | full (auto) | Phases A+B (caso 1). `progress.md` será criado por `/implement` na primeira execução do plano gerado — não por `/plan-build`. |
| ausente | existe | (degenerate) | **Aborta**: `"progress.md presente sem plan file correspondente em {scope}. Estado inesperado — verifique manualmente; mova/delete progress.md ou recupere o plan file antes de rodar."` |

## C1. Delta detection via `sources_mtime`

Read the plan file's frontmatter `sources_mtime` block. For each `<path>: <ISO-8601 timestamp>` entry that points to a `docs/decisions/technical-decisions-*.md` file:

1. Run `stat -c '%y' <path>` to get current mtime.
2. If current mtime > recorded mtime → file edited since last build; mark as **dirty source**.

For each dirty source:

3. Bounded `Read` of the file. Locate every `**Revisions:**` block (per `research/SKILL.md` § "Revisions block") and every `<!-- status: superseded-by: {ref} -->` marker.
4. Filter Revisions entries by date: keep only those with `YYYY-MM-DD >= last-build-date` (where last-build-date is parsed from the recorded `sources_mtime` ISO-8601 value's date component). Using `>=` (inclusive) rather than `>` ensures Revisions made on the same calendar day as the last build are NOT silently skipped. The file-level mtime gate at step 1–2 above (`current mtime > recorded mtime`) is the canonical replay guard — if no decisions doc has been touched since the last append, the dirty-source loop is empty and no Revisions are re-processed, so `>=` here is safe.
5. Filter supersede markers: keep only those whose target TD is referenced in the plan file (otherwise the marker is irrelevant to this scope).

Each filtered entry becomes a **delta event** with fields:
- `td_ref` — `{slug}/TD-NN` of the affected TD.
- `kind` — `revision` | `supersede`.
- `payload` — the revision one-liner OR the `superseded-by` ref.

If the resulting delta event list is empty, abort with: `"No deltas detected in dirty sources since last build. Plan is up-to-date. (To force a rebuild anyway, pass --rebuild.)"`.

## C2. Delta classification per event

**Frontend Runtime TD pre-check.** Before the parameter-extraction grep below, look up the affected TD's `**Renders in:**` value via bounded grep on the dirty source file: `Grep -nE '^\*\*Renders in:\*\* ' <decisions-doc>` within the TD's line range (`### TD-NN:` header to next `### TD-` or EOF). Then:

- **TD has `Renders in: frontend-runtime`** (explicit) → route the event through the Frontend Runtime delta path (below) instead of the parameter-extraction grep. The classification is structurally different: edits target the `### Frontend Runtime → #### {td-slug}/TD-NN` subsection (when the subsection already exists in the plan) and the `SI-NN.X` Setup/Migration/Verification SIs derived from it (per `templates/frontend-runtime-si.md`).
- **TD has `Renders in: ui-contracts`** OR marker absent → continue with the standard parameter-extraction flow below (backend / per-screen UI behavior).

**Frontend Runtime delta path (when the pre-check matched):**

1. Bounded grep `Grep -n '^### Frontend Runtime$' {target_path}` to locate the subsection. Two cases:
   - **Subsection present:** bounded read of the subsection range (start to next `^### `) → look for `#### {td-slug}/TD-NN —` heading. If present, the affected TD is already materialized; revisions edit the subsection in place (Pattern / Setup / Migração rows / Verificação fields per the Revisions one-liner's prose). If absent (i.e., subsection exists for OTHER FE Runtime TDs but not this one), append a new `#### {td-slug}/TD-NN — {topic}` block via the `templates/tech-specs/frontend-runtime.md` template before processing SI-level deltas.
   - **Subsection absent (first appearance of any Frontend Runtime TD in this plan):** append the entire `### Frontend Runtime` subsection in canonical order — after `### UI Contracts` if present, otherwise after the last existing `### ` Tech Specs subsection, and **before** `### UI ↔ API Traceability Matrix` if that exists. Materialize the subsection completely via `templates/tech-specs/frontend-runtime.md`. Then proceed to SI-level deltas.
2. SI-level edits: locate the SIs that derived from this TD's Frontend Runtime subsection — they are plain `SI-NN.X` SIs whose Technical actions cite `### Frontend Runtime → #### {td-slug}/TD-NN` (find via `Grep -n '### Frontend Runtime → #### {td-slug}/TD-NN' {target_path}` then walk up to the nearest `^### SI-` header). Cross-reference each SI's status in `progress.md` (same `completed | pending` table as the standard flow below).
3. For events that did NOT match any existing SI (the TD is new to the plan, or the cited subsection is freshly materialized in step 1), classify as **new behavior** and append SIs via `templates/frontend-runtime-si.md` (Setup + Migrations + optional Verification per the canonical Dependency contract), in place of the standard generic `### SI-N.M — <delta-derived title>` prose.
4. **Supersede edge case** (TD's `**Renders in:**` flipped from `ui-contracts` to `frontend-runtime` via `/plan-resolve` M3 (d)): the M3 edit kind in `plan-resolve/SKILL.md` mutates the decisions doc but does NOT add a Revisions block or supersede marker — so C1 currently DOES NOT detect this re-classification as a delta event. The canonical recovery is `/plan-build <scope> --rebuild`, which forces fresh Phase A and re-runs A2 filter from scratch (correctly routing the re-classified TD into `### Frontend Runtime` and skipping it from per-screen UI Contracts subsections). **Future extension (not yet implemented):** add `kind: reclassify` delta detection that, when a TD's `**Renders in:**` marker has flipped between dispatches, annotates the old per-screen UI Contracts SIs as superseded (`> SUPERSEDED — see SI-N.M (TD migrated to ### Frontend Runtime)`) and appends fresh Setup/Migration/Verification SIs via `templates/frontend-runtime-si.md`.

**Standard parameter-extraction flow (when the Frontend Runtime pre-check did NOT match):**

- `Grep -n '<parameter-or-keyword>' {target_path}` where the parameter is extracted from the Revisions one-liner's prose. Heuristic priority (first non-empty wins): (1) explicit path fragments containing `/` — these can reference **any subproject** in scope (e.g., `docs/openapi.json` for repo-shared docs, `<backend-subproject>/openapi.json` for backend-owned artifacts, `<frontend-subproject>/<entry>/<file>` for frontend-owned files); (2) backticked code tokens (e.g., `` `argon2id` ``, `` `@nestjs/jwt` ``); (3) numeric thresholds with units (e.g., `64MiB`, `30s`, `12 rounds`); (4) bare lib/identifier names matching the TD's `**Libraries:**` line (e.g., `argon2`, `bcrypt`). When the one-liner contains multiple tokens of the same priority, extract the **longest** concrete token. The C3 diff preview is the user-facing safety net for misextraction — they cancel the affected delta if the grep target is wrong.

For each match, look up the SI containing the matched line (find the nearest `^### SI-` header above the match line). Cross-reference the SI's status in `progress.md` (per-SI Status is `completed | pending` per `implement/SKILL.md` § "Format" — there is no per-SI `in_progress` value):

| SI status | Action |
|---|---|
| `completed` | Append a new SI at the end of the plan with prose like `### SI-N.M (amendment of SI-X.Y) — <delta one-liner>`. The amendment SI documents the retroactive change in code that was already shipped. Numbering: continue from the highest existing SI number. |
| `pending` | Edit cirúrgica in-place: replace the matched parameter in the SI's prose with the Revision's new value. The SI's structure is preserved; only the affected token changes. |

The file-level `Status:` field in `progress.md` (which CAN be `in_progress | completed`) is NOT inspected by append-mode — append acts on per-SI Status only. If a user runs `/plan-build` while `/implement` is mid-loop on a `pending` SI (the SI hasn't flipped to `completed` yet), the SI is still classified as `pending` here and append plans an edit cirúrgica. The C3 diff preview is the safety net: the user sees the proposed SI rewrite and cancels if it would collide with in-flight code work.

For events that did NOT match any SI (the parameter isn't cited in any existing SI), classify as **new behavior**: append a new SI describing the work introduced by the Revision (`### SI-N.M — <delta-derived title>`).

For supersede events: mark the affected SI(s) with an annotation `> SUPERSEDED — see SI-N.M (covers the new TD <new-ref>)` and append a new SI implementing the substitute TD's path. The original SI's prose is preserved but flagged.

**Conditional `**Test Specs:** _pending /plan-test-specs_` placeholder em new SIs (modern plans only).** Quando o plan-build emite um new SI (amendment OR new behavior) em modo modern (frontmatter declara `test_specs_aware: true`), aplicar o mesmo critério field-based descrito em `phase-b.md` § "Conditional emit of `**Test Specs:**` field":

- **Frontend wiring (Xb)** — SI_ID emitido termina com sufixo `b` (ex: `SI-NN.5b`) → emit `**Test Specs:** _pending /plan-test-specs_` no header. Esse case ocorre quando C2 deriva o new SI de um delta no `### UI Contracts` ou inventário, e usa o template `screen-si.md` Xb.
- **Backend controller wiring** — SI emit inclui `**Route:** <METHOD> /...` no header (regex `^\\*\\*Route:\\*\\* (GET|POST|PUT|PATCH|DELETE) /` no rendered SI block) → emit placeholder.
- **Cross-layer SI** — title contém literalmente `(cross-layer)` keyword (ex: `### SI-NN.8 — Fluxo de upload (cross-layer)`) → emit placeholder.

Plain backend service SIs, schemas, providers, frontend runtime SIs (via `templates/frontend-runtime-si.md`) NÃO recebem placeholder — comportamento existente preservado. Frontend Runtime delta path (acima) explicitly NÃO recebe placeholder porque seus SIs não têm `**Route:**` nem `**Figma:**` por construção.

Mode detection é via grep do frontmatter:

```bash
TEST_SPECS_AWARE=$(awk '/^---$/{f=!f;next} f' "$PLAN" | grep -c "^test_specs_aware: true$" || echo 0)
```

Modern (`TEST_SPECS_AWARE > 0`) → aplica regra acima. Legacy (`TEST_SPECS_AWARE = 0`) → skip; new SIs emitem sem `**Test Specs:**` field (back-compat — comportamento pré-migração).

## C3. Diff preview before apply

Before any Edit, dispatch a single `AskUserQuestion` summarizing all proposed changes:

```
Append-mode detectou {N} deltas. Mudanças propostas:

  1. SI-X.Y (pending) — Edit cirúrgica: trocar `<old>` por `<new>` na linha NN.
  2. SI-Z.W (completed) — Append SI-13 (amendment of SI-Z.W) — <one-liner>.
  3. (novo comportamento) — Append SI-14 — <delta-derived title>.

[Aplicar todos] [Aplicar selecionados] [Cancelar tudo]
```

The `AskUserQuestion` is single-select with 3 options. `[Aplicar selecionados]` triggers a follow-up multi-select where the user can opt-in per change. `[Cancelar tudo]` aborts without writing.

## C4. Apply edits

For each accepted change, Edit the plan file:

- **Edit cirúrgica:** standard `Edit` call with `old_string` / `new_string`. The match is bounded to the SI's line range from C2.
- **Append amendment SI:** `Edit` to insert a new `### SI-N.M ...` block at the end of `## Step Implementations` (locate via `Grep -n '^## ' {target_path}` to find the next `## ` header after the SIs section, then insert before it).
- **Annotate superseded SI:** `Edit` to insert the `> SUPERSEDED — see SI-N.M ...` blockquote right below the affected `### SI-X.Y:` heading.

## C5. Refresh `sources_mtime`

After all Edits applied, refresh `sources_mtime` entries in the plan file's frontmatter for each dirty source processed: `stat -c '%y' <path>` → write ISO-8601 timestamp. This prevents the same deltas from re-firing on the next `/plan-build` invocation.

**Modern-mode interaction with specs.** O refresh do `sources_mtime` torna `mtime(plan) > Last sync(spec)` para todo spec PRESERVED existente — o que dispararia falso STALE no `/implement` preflight. Por isso, em modo modern (frontmatter declara `test_specs_aware: true`), após `/plan-build` append-mode terminar, o user **deve** rodar `/plan-test-specs <slug>`, que re-stampa `Last sync` dos PRESERVED + processa NEW (placeholders adicionados na C2). O hint condicional do C7 (vide `SKILL.md` § "Output contract → Phase C7") emite essa instrução automaticamente quando aplicável; phase-c.md NÃO duplica o template do output — o conditional emit vive **exclusivamente** em `SKILL.md`.

## C6. Update `progress.md` for newly-appended SIs

Any SI appended in C4 (amendment or new behavior) needs a corresponding row in `progress.md` with `Status: pending`. Use the existing format observed in `docs/tasks/task-X/progress.md`:

```
### SI-N.M — <title>
- **Status:** pending
- **Tests:** —
- **Observations:** Appended by /plan-build append-mode on YYYY-MM-DD; tracks delta from <slug>/TD-NN Revision YYYY-MM-DD.
```

## C7. Output summary

Emit the literal Phase C7 success block from SKILL.md § "Output contract" → "Successful completion (Phase B7 or Phase C7)", populated with:
- Each delta event processed and the action taken (Edit cirúrgica / Append amendment / Append new behavior / Annotate superseded).
- Lines/SI numbers affected.
- The "Next:" line — only mention `/implement <new-SI>` when amendment or new-behavior SIs were created.
