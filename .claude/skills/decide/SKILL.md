---
name: decide
description: "Front-door for free-text decision needs. Triages user input against existing technical decisions, then routes to one of three branches: Revision (parameter change in existing decided TD), Supersede (Option letter change requires new TD), or Greenfield (no relevant TD exists). Trigger phrases: 'tem decisão sobre X?', 'quero mudar Y', 'preciso decidir Z', 'já decidimos sobre...', 'mudou o caminho/parâmetro/threshold de...', any free-text input describing a need that may or may not be covered by a TD. For structured phase research, use /research <phase> directly. For pipeline-stage operations on known scopes, use /plan-context, /plan-validate, /plan-resolve, /plan-build directly."
disable-model-invocation: true
---

# Decide

Front-door skill for **free-text decision needs**. The user describes a need; this skill figures out whether it maps to a Revision (inline append on existing TD), a Supersede (new TD elsewhere), or a Greenfield decision — and applies the Revision case directly. Supersede and Greenfield abort with explicit `/research` instructions for the user to invoke.

This skill is the entry point when the input is **unstructured**: you don't know which TD exists, you don't know if it's a parameter change or a fundamental shift, you don't even know if a TD covers the area. For structured pipeline work (phase planning, plan refresh), use the direct stage commands.

## Input handling

The user provides a free-text description of the need. Examples:

- `/decide "quero mover openapi.json de docs/ para o subprojeto backend"`
- `/decide "preciso ajustar o threshold do rate limit, está apertado demais"`
- `/decide "tem decisão sobre cache de auth tokens?"`
- `/decide "vamos trocar bcrypt por argon2"`

If the input is empty, abort with: `"Pass a free-text description of your decision need: /decide \"<what you want to change or research>\"."`.

If the input is a phase reference (`phase NN`, `phase-NN-slug`, integer NN matching a phase) — meaning the user really wants structured phase research, not triagem — abort with: `"Phase research has known shape. Use /research phase-NN directly to start a structured research cycle."`.

## Procedure

### Step 1 — Triagem via `decisions-correlator`

Dispatch the existing `decisions-correlator` subagent (already used by `/plan-context`) with:

- `mode`: `task` (matches the broader-pool semantics — searches all decisions docs except the current target's own; here there is no "own" doc, so all candidates are eligible)
- `identifier`: a synthetic placeholder slug like `_decide-triage` (the agent reports this in its filter trace; it does not need a real file)
- `scope_prose`: the user's free-text input verbatim

The agent returns a ranked shortlist of `docs/decisions/technical-decisions-*.md` files semantically correlated with the input.

_Note: this is the first runtime path that uses `decisions-correlator` with a synthetic slug in `mode=task`. The agent's task-mode pool is "every doc EXCEPT the task's own"; with a non-existent slug, the exclusion is a no-op so all docs become eligible — which is the intended triage behavior. SI-3.8 (smoke test, deferred) is the canonical place to verify the agent accepts this dispatch. If the agent rejects synthetic slugs in production, surface the error to the user and we redesign the triage step rather than silently switching to a different (narrower) pool._

Capture the agent's filter trace as proof-of-iteration. Surface it inline in the response so the user sees what was considered.

### Step 2 — Disambiguação via `AskUserQuestion`

Present the **top-3** candidates from the shortlist (or fewer if the agent returned <3). Even when the top match has clear high confidence, show 3 to give the user visibility into competing candidates and a chance to redirect.

Format each candidate option with:

- `label`: the short ref `{slug}/TD-NN` plus a 1-line summary of the TD's topic.
- `description`: the TD's current state (decision letter, scope, last revision date if any).
- For low-confidence matches (correlator score below threshold — agent's own threshold is opaque; treat anything beyond rank 1 as "potentially relevant"), prepend `[low confidence] ` to the label.

Always include a 4th option: `"Nenhum — criar novo TD"`.

The `AskUserQuestion` is single-select with these 4 options (3 candidates + "Nenhum").

When the user picks a candidate, **first verify the TD's status** via bounded grep on its decisions doc (`Grep -n '^### TD-NN:' <file>` to locate the TD's range, then bounded `Read` of that range). Find the `**Decision:**` line:

- If `**Decision:**` is `_[pending]_` → abort with: `"TD-NN está pending — rode /plan-validate <scope> para surfaceear o OQ-N do TD pending, depois /plan-resolve <scope> para preencher a decisão. /decide só opera sobre TDs já decididos: pending TDs não suportam Revision (não há decisão a revisar) nem Reaffirm (não há decisão a reafirmar). Pular /plan-validate antes de /plan-resolve cai em 'validation.md is already clean — nothing to resolve' se o TD nunca foi surfaced como issue."`. Skill terminates without further questions.
- Otherwise (TD has a decided Option letter) → ask a follow-up question to classify the action:

```
"Qual ação aplicar ao {ref}?"
  [1] Revision  — parameter/prose changes; same Option letter
  [2] Supersede — Option letter changes; replace with a different option
  [3] Reaffirm  — TD already correct; just record the user's clarification (no edit)
```

When the user picks `"Nenhum"`, jump to the Greenfield branch (Step 3).

### Step 3 — Branch dispatch

Based on the answer in Step 2, route to one of:

#### Revision branch

- **Constraint:** `AskUserQuestion` is choice-based — does NOT support free-form text input.
- **Mechanism:**
  1. Generate a **draft** `**Revisions:**` block entry using:
     - `date` = today's date via `Bash 'date +%F'` (no user input).
     - `one-liner` = inferred from the user's initial `/decide "..."` input + the affected TD's topic. Concise, ≤150 chars.
     - `rationale` = inferred from contextual cues (TD's existing prose, user's input phrasing, surrounding code if obviously relevant). Brief, factual.
  2. Show the draft inline in the assistant response (not via `AskUserQuestion`) so the user sees the full proposed block.
  3. Issue a final `AskUserQuestion` with 2 options:
     - `[Aceitar e gravar]` — apply the Edit
     - `[Cancelar — vou editar manualmente]` — abort, no Edit
  4. On accept, locate the target TD in its decisions doc and Edit. Anchor priority (first present wins, since `**Libraries:**` is OPTIONAL — `plan-resolve/SKILL.md:138` only adds it when the chosen Option implies specific libraries; TDs decided via inline-create in task mode without library implications have NO Libraries line):
     - Find `**Decision:**` line within the TD's range — always present in a decided TD (this is the gate that brought us here).
     - **Anchor case 1 — Revisions block already exists.** Append a new bullet at the end of the existing `**Revisions:**` block. Locate the block via bounded grep; the block ends at the next blank line OR `---` separator OR next `**` field, whichever comes first.
     - **Anchor case 2 — no Revisions block, but Libraries line exists.** Insert a new `**Revisions:**` block after `**Libraries:**` with a blank line before the heading.
     - **Anchor case 3 — neither Revisions block nor Libraries line.** Insert a new `**Revisions:**` block immediately after `**Decision:**` with a blank line before the heading. (TD may simply not cite libraries; this is a valid state.)
  5. On cancel, terminate without edit; instruct user how to apply manually.
- **Output:** confirmation of the edit (path + line range) followed by Step 4 (impact report).

#### Supersede branch

- **Constraint:** skills do not delegate internally to other skills — abort with an explicit instruction for the user to invoke the next skill.
- **Mechanism:** terminate the skill (no edits) with a copy-paste-ready instruction:

  ```
  Próximo passo: rode /research <slug-sugerido> para criar o novo TD substituto.

  Passe ao /research o seguinte contexto via prompt:
    "Esta pesquisa supersedará <slug-antigo>/TD-NN — Option <X> (<nome>).
     Considere o trade-off da escolha anterior e a nova necessidade: <user input>."

  Após o /research completar (o novo doc fica em docs/decisions/technical-decisions-<slug-sugerido>.md
  com status: pending), rode na ordem (usando o slug do NOVO TD como argumento — não o antigo,
  não um phase number):

      /plan-context <slug-sugerido>     ← bootstrap task-mode (cria docs/tasks/task-<slug>/
                                          via mkdir -p; orphan ad-hoc com related_phases: []
                                          é aceito como task scope)
      /plan-validate <slug-sugerido>    ← surface o pending TD novo como issue
      /plan-resolve <slug-sugerido>     ← AskUserQuestion no pending TD; ao escolher a opção
                                          recomendada, plan-resolve lê o "supersedes <slug-antigo>/TD-NN"
                                          do heading + Notes do novo TD e injeta o marker
                                          <!-- status: superseded-by: <slug-novo>/TD-NN --> no TD antigo
                                          (autoridade cross-doc per plan-resolve/SKILL.md line 43).

  NÃO recomende /plan-resolve diretamente (pulando context/validate). plan-resolve aborta com
  "validation.md not found" se rodado antes de plan-validate, que por sua vez aborta sem context.md.
  ```

  - Substitute `<slug-sugerido>` with a kebab-case slug derived from the user input (e.g., `auth-refresh-grace-period`, `openapi-spec-codegen`).
  - Substitute `<slug-antigo>/TD-NN`, `<X>`, `<nome>`, and `<user input>` with the actual values.

#### Greenfield branch

- **Mechanism:** mirror Supersede branch's abort pattern — terminate with explicit instruction:

  ```
  Próximo passo: rode /research <slug-sugerido> para criar o novo TD greenfield.

  Sua necessidade: "<user input>"
  ```

  - `<slug-sugerido>` derived from the user input.

#### Reaffirm branch

- **Mechanism:** no decisions-doc edit, no other artifact touched. Skill terminates with a brief acknowledgment: `"TD-XX is already aligned with your input; no change needed."`. Reaffirm is a no-op on artifacts — its only purpose is to signal-back to the user that the triage was successful and no Revision/Supersede is warranted.

### Step 4 — Impact report (Revision branch only)

Generate a dynamic impact report listing **only** the next steps with real triggers. This runs only after a successful Revision Edit.

#### Discovery — which scopes are affected

```
Glob 'docs/{phases,tasks}/*/context.md'
```

For each match, bounded `Read` of the top frontmatter block only (`---` ... `---`). Parse the `sources_mtime` mapping. A scope is "affected" iff the path of the TD's decision doc (the one just edited) appears as a key in `sources_mtime`.

#### Sections to emit

For each affected scope, emit applicable subsections:

- **A. Plan artifacts (manual review).** If grep `<old-parameter-value>` in the scope's `task-*.md` / `phase-*.md` / `progress.md` / `validation.md` returns ≥1 hit, list the files. The user typically updates these manually (or via `/plan-context <scope>` regeneration).
- **B. Source-code consumers.** Project-wide `grep -rn <old-value>` filtered to each subproject's source root (e.g., `<subproject>/src/` for backend-flavored layouts, the subproject root itself for Next-style layouts) plus root-level config files (dependency manifests, build configs, lockfiles). List matches by file with line counts. The user edits manually (or via a focused `/implement` subtask if extensive).
- **C. Tests potentially affected.** `grep -rn <old-value> --include='*.spec.*' --include='*.test.*'`. If zero matches, note the absence; if non-zero, list and warn that test updates may be required.
- **D. Documentation.** Filtered to `*.md` outside `docs/decisions/`, `docs/phases/`, `docs/tasks/` (rules, CLAUDEs, READMEs).
- **E. Pipeline (rode na ordem, conforme aplicável):**
  - `/plan-context <scope>` — emit when context.md exists for the scope and cited the doc in `sources_mtime`. Refreshes context.md to reflect the Revision.
  - `/plan-validate <scope>` — emit as sanity check companion to plan-context.
  - `/plan-resolve <scope>` — emit only if the Revision changed the `**Libraries:**` line of the TD (compare pre/post Edit). Resolve will refresh `library-refs.md` via Context7.
  - `/plan-build <scope>` — emit only if a plan file exists in the scope dir AND grep of the affected parameter in the plan's SIs returns ≥1 match. Skill explicitly notes that `/plan-build` will operate in append-mode (per `plan-build/SKILL.md`).

The skill **only suggests**; it never invokes another skill automatically. The user copy-pastes the next command.

#### Output format example

```
✓ Revision aplicada em <slug>/TD-NN (linha NN-MM de docs/decisions/technical-decisions-<slug>.md).

Downstream — rode manualmente conforme aplicável:

A. Plan artifacts:
   - docs/tasks/task-<slug>/task-<slug>.md (3 referências stale)
   - docs/tasks/task-<slug>/context.md (1 referência)

B. Código-fonte:
   - <backend-subproject>/<dependency-manifest> (script Y)
   - <frontend-subproject>/<dependency-manifest> (script Z)

C. Tests:
   - nenhum arquivo de teste do projeto referencia o valor antigo.

D. Documentação:
   - <subproject>/<doc-file> (2 menções)
   - <repo-doc>/<file>.md (1 menção)

E. Pipeline (rode na ordem):
   1. /plan-context task-<slug>
   2. /plan-validate task-<slug>
   3. /plan-resolve task-<slug>        ← Libraries mudaram
   4. /plan-build task-<slug>          ← append-mode auto; SIs pendentes citam o parâmetro
```

Placeholders no example acima são preenchidos at runtime com valores concretos descobertos pela skill (subproject directories from `affected_subprojects:` field of plan frontmatter, file extensions from each subproject's stack, etc.). Quando a skill realmente emite o report, valores são substituídos com paths reais — placeholders são só do template.

If a section has zero items, omit it entirely (no "Nothing to do" placeholders).

## Decisões cravadas (sessão grill 2026-04-27)

Estas decisões orientaram o design do skill. Não voltam a ser pergunta:

- **Triagem zero matches** → top-3 mostrado mesmo com low-confidence; usuário pode escolher um ou criar novo.
- **Múltiplos matches** → AskUserQuestion single-select com escape "criar novo"; multi-select não suportado.
- **Migração de docs antigos** → forward-only; pre-2026-04-27 é histórico opaco.
- **Impact report seção E** é dinâmica; lista APENAS stages com gatilho real.

## Hard rules

- **Single-select only.** AskUserQuestion is choice-based; if multiple TDs are co-affected, the user invokes `/decide` once per TD. Multi-select adds complexity for <10% of cases.
- **No free-form text input via AskUserQuestion.** Drafts are inferred and shown inline; user confirms via Aceitar/Cancelar binary.
- **No skill-to-skill delegation.** Supersede and Greenfield branches abort with copy-paste instructions; the user invokes `/research` explicitly.
- **No automatic pipeline chaining.** Impact report (Step 4) lists suggestions; `/decide` never invokes `/plan-context`, `/plan-build`, etc. on the user's behalf.
- **Forward-only migration.** TDs created before 2026-04-28 (the date this skill landed) are treated as opaque history; absence of a `**Revisions:**` block does NOT mean "never changed", just "not structured before". (The Revisions/Supersede design itself was discussed on 2026-04-27 — the grill session date — but the skill became user-invocable only on 2026-04-28 when the implementation shipped.)
- **Edits restricted to decisions docs.** This skill never edits source code, tests, plan artifacts, or library-refs. Those surfaces are listed in the impact report; the user (or another skill) handles them.
- **Phase mode bypass.** If the user input is a phase reference, abort with the structured-pipeline instruction (see Input handling). `/decide` is for unstructured needs only.

## Trigger sentinel for memory recall

This skill closes the gap left by `/research` (which assumes greenfield) and the pipeline stages (which assume known scope). Before this skill existed, the user had to triage themselves by reading `docs/decisions/*.md` manually before deciding which command to invoke. `/decide` makes the triage automatic.
