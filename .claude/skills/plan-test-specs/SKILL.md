---
name: plan-test-specs
description: "Stage 5 of the plan pipeline (post-build). Generates and syncs <subproject>/specs/<scenario>.plan.md files from phase/task plans, in Microsoft spec-driven format. Specs are later consumed by /implement Step 3a — frontend path loads the playwright-cli Skill for Playwright pattern reference and LLM-authors the E2E test file; backend path LLM-authors its E2E test file (file path/suffix per the per-subproject testing-guide skill; what-to-test and best practices per artifact come from that same skill, already loaded at /implement Step 2). Use after /plan-build completes. Triggers: 'plan-test-specs NN', 'plan-test-specs <slug>', 'gerar test specs da fase X'."
disable-model-invocation: true
---

# Plan Pipeline — Stage 5: Test Specs

This is **Stage 5** (optional, post-build) of the plan pipeline defined in `.claude/skills/plan-pipeline/SKILL.md`. Read that file first for the cross-stage convention (frontmatter format, registered values, stage interaction). Stage 1-4 produce/edit a phase or task plan; Stage 5 derives external **spec files** from screen-wiring / controller-wiring / cross-layer SIs of that plan.

The skill is **skippable**: legacy plans (frontmatter without `test_specs_aware: true`) are routed to an abort message instructing migration; modern plans without any SI carrying `**Test Specs:**` (e.g., backend-pure phases) fall through silently.

## Input

- Positional argument: phase number `NN` (phase mode) OR task slug (task mode).
- Resolves the plan path same way `/implement` does:
  - phase mode → `docs/phases/phase-{NN}-{slug}/phase-{NN}-{slug}.md`
  - task mode → `docs/tasks/task-{slug}/task-{slug}.md`
- No flags in v1. (`--analyze`, `--reconcile`, `--force-regen <scenario>` deferred to v2 — see § "Out-of-scope".)

## Preflight

Run **in order**; abort on the first failure.

### 1. Plan existence

`Bash`-based stat on the resolved plan path. If file missing:

```
Plano não existe em <resolved-path>. Verifique se /plan-build já rodou para <slug>.
```

### 2. Mode detection

The discriminator is the frontmatter `test_specs_aware: true` field — same algorithm `/implement` uses for `PLAN_MODE`:

```bash
TEST_SPECS_AWARE=$(awk '/^---$/{f=!f;next} f' "$PLAN" | grep -c "^test_specs_aware: true$" || echo 0)
```

- `TEST_SPECS_AWARE = 0` → plano legacy. Abort:

  ```
  Plano <slug> está em modo legacy (frontmatter não declara `test_specs_aware: true`).
  Para migrar: rode '/plan-build <slug> --rebuild' primeiro para regenerar no novo formato,
  então rerun /plan-test-specs.
  ```

- `TEST_SPECS_AWARE > 0` → plano modern. Continue.

### 3. SI count with `**Test Specs:**`

```bash
TEST_SPECS_COUNT=$(grep -c "^\*\*Test Specs:\*\*" "$PLAN" || echo 0)
```

- `TEST_SPECS_COUNT = 0` → modern plan but zero screen/controller/cross-layer SIs (legitimate backend-pure phase or foundations-only). **No-op exit silently** with:

  ```
  /plan-test-specs: nenhum SI com `**Test Specs:**` field em <slug>. Skip silently.
  ```

  Não é erro — é o caminho previsto para fases backend puras.

- `TEST_SPECS_COUNT > 0` → continue to Procedure.

### 4. (No host-only binary precondition)

`/plan-test-specs` does NOT depend on the `playwright-cli` host binary. The binary's interactive workflow (Section 2 / Section 3 of the vendored skill) is not invoked by this skill nor by `/implement` Step 3a — both stages author specs and tests via single-pass LLM authoring (see `playwright-cli/VENDOR.md` § "Adaptations vs source"). The Playwright **test runner** (`@playwright/test` package in the frontend subproject) is a runtime dependency of `/implement` Step 4 (subagent runs the generated tests via the frontend subproject's Playwright invocation — e.g., `npx playwright test ...` for Node-based stacks), but that is the frontend subproject's dependency-manifest responsibility — not a precondition this skill checks.

## Procedure

Three stages, em ordem. Stage 1 lê e classifica; Stage 2 emite report; Stage 3 aplica NEW + re-stamp PRESERVED + no-op-bump per spec. UPDATED/DELETED/ORPHAN são apenas reportados (warnings) em v1.

### Stage 1 — Iterate SIs and classify

Locate every SI block via `Grep -n '^### SI-' "$PLAN"`. For each SI block:

1. **Bounded read** between this SI's header and the next `^### SI-` header (or end of file).
2. **Compute discriminator triplet** (canonical algorithm — see § "Discovery via **Test Specs:** field" below for the full rationale):

   The bounded read from Step 1 (the SI block content from `### SI-NN.X` until the next `### SI-` or EOF) is the canonical extraction mechanism. The pseudo-code below is illustrative and uses awk only to make the field-extraction logic concrete; the LLM may use the Read-tool excerpt instead.

   ```bash
   # Inputs: $SI_HEADER_LINE = the matched header from `Grep -n '^### SI-'` output
   # (e.g., "42:### SI-03.5b — Tela de Signup (lógica & wiring)")
   SI_HEADER=$(echo "$SI_HEADER_LINE" | sed -E 's/^[0-9]+://')
   N=$(echo "$SI_HEADER" | sed -E 's|^### SI-([0-9]+)\.[0-9a-z.]+.*|\1|')   # ex: "03"
   Y=$(echo "$SI_HEADER" | sed -E 's|^### SI-[0-9]+\.([0-9a-z.]+).*|\1|')    # ex: "5" or "5b"

   # Bounded slice of this SI's content (already obtained via Read in Step 1; awk shown for clarity):
   SI_BLOCK=$(awk "/^### SI-${N}\\.${Y}/,/^### SI-/" "$PLAN")

   HAS_TEST_SPECS=$(echo "$SI_BLOCK" | grep -c "^\*\*Test Specs:\*\*")
   HAS_ROUTE=$(echo "$SI_BLOCK" | grep -cE "^\*\*Route:\*\* (GET|POST|PUT|PATCH|DELETE) /")
   SI_ID="SI-${N}.${Y}"
   TITLE=$(echo "$SI_BLOCK" | head -1)
   IS_CROSS_LAYER=$(echo "$TITLE" | grep -c '(cross-layer)')
   ```

3. **Classify** per the discriminator table:

   | Caso | HAS_TEST_SPECS | HAS_ROUTE | SI_ID shape | `(cross-layer)` no título | Subproject inferido |
   |---|---|---|---|---|---|
   | Skip — não é screen/controller wiring | 0 | * | qualquer | * | n/a (skip silently) |
   | **Frontend Xb** | 1 | 0 | termina em `b` (ex: `SI-03.5b`) | * | `frontend` (Playwright) |
   | **Backend controller wiring** | 1 | 1 | plain `SI-NN.X` ou `SI-NN.X.Y` (sem letra) | * | `backend` |
   | **Cross-layer** | 1 | 0 | plain `SI-NN.X` (sem letra, sem Route) | sim | emit AMBOS frontend + backend specs |
   | (impossível por construção) | 1 | 1 | termina em `b` | * | assert + abort |
   | **FALL-THROUGH** | 1 | 0 | plain `SI-NN.X` sem letra **OU** shape `SI-NN.X.0` (drift audit-SI) | não | abort com mensagem actionable (ver baixo) |

   Fall-through abort message:

   ```
   SI-NN.X tem **Test Specs:** mas não casa nenhum case válido
   (sem sufixo 'b', sem **Route:**, sem keyword '(cross-layer)' no título;
   OU shape SI-NN.X.0 — audit-SIs nunca devem carregar **Test Specs:** field
   por construção, ver phase-b.md § "Which SIs receive the placeholder").
   Estado inválido por construção — investigar emissão do placeholder em phase-b.md/phase-c.md.
   Provavelmente bug em /plan-build.
   Run /plan-build <slug> --rebuild OR remova manualmente o **Test Specs:** field do SI antes de retry.
   ```

4. **Resolve spec path(s) for this SI:**

   The default path is `<subproject>/specs/<feature>.plan.md` where `<subproject>` is the relevant subproject directory (resolved from the plan frontmatter's `affected_subprojects:` field — the entry that plays the frontend or backend role for the SI). Per-case:

   - **Frontend Xb (single subproject):**
     - `<subproject>` = the frontend subproject directory; `<feature>` is derived from the SI title's screen name (kebab-cased, no spaces, no special chars).
     - If `**Test Specs:**` is already populated (`see \`<path>\``), trust the path verbatim — user may have customized it.
   - **Backend controller wiring (single subproject):**
     - `<subproject>` = the backend subproject directory; `<feature>` derives from the route's resource name (e.g., `POST /auth/register` → `auth-register`).
   - **Cross-layer (dual subproject):** emit BOTH `<frontend-subproject>/specs/<feature>.plan.md` and `<backend-subproject>/specs/<feature>.plan.md`.

   **Resolving the role-to-directory mapping:** `affected_subprojects:` lists directory names but does NOT label which one plays the frontend/backend role. Discover the mapping in this order:

   1. Inspect the directory's layout and dependency manifest for framework markers — entry-point conventions, framework-specific config files, and routing structure (e.g., a Next.js `app/` or `pages/` layout signals frontend; a Vite + React entry signals frontend; a NestJS-style controllers/modules layout signals backend; a Django `manage.py` or a Spring Boot `pom.xml` signals backend) — to infer the role unambiguously.
   2. Cross-reference `docs/project-plan.md`'s `### Subprojects` section, which typically annotates each subproject's role.
   3. **If the mapping is still ambiguous** (e.g., two backend candidates, or a stack-agnostic name like `app/`), ask the user via `AskUserQuestion` before resolving the path. Do not guess — writing a spec to the wrong directory is silent corruption.

5. **Read existing spec(s)** if any. Do a single Read per spec file (full content — specs are small, ~100-200 lines). Cross-layer iterates twice.

6. **Compute lifecycle state per scenario** of the spec — the per-cenário classification feeds the delta report:

   | State | Detection | Decision in Stage 3 |
   |---|---|---|
   | **NEW** | AC do plano sem cenário cobrindo | Generate scenario; mark `Source: auto`; set `Last sync` ao timestamp da operação |
   | **PRESERVED** | Cenário existe; mtime do source (phase plan) ≤ `Last sync` do cenário | Re-stamp `Last sync` (Edit cirúrgica substitui só a linha) — atualiza file mtime como side-effect |
   | **MANUAL** | Cenário com `Source: manual` ou sem `Source` field | Skip silently (não toca o file; user é dono) |
   | **UPDATED** | Cenário com `Source: auto` E mtime do plano > `Last sync` | Warning only (v1) |
   | **DELETED** | Cenário com `Source: auto` cobrindo apenas ACs que sumiram do plano | Warning only (v1) |
   | **ORPHAN** | `Covers AC: #N` aponta a AC inexistente no SI | Warning only (v1) |

   **Comparison mechanism (PRESERVED vs UPDATED).** The plan's `mtime` from `stat -c %Y` is an integer (Unix epoch seconds); each scenario's `Last sync` is an ISO-8601 string (e.g. `2026-05-02T14:30:00Z`). Both must be normalized to epoch integers before comparison:

   ```bash
   PLAN_MTIME=$(stat -c %Y "$PLAN")
   LAST_SYNC_EPOCH=$(date -u -d "$LAST_SYNC_ISO" +%s)
   if [ "$PLAN_MTIME" -le "$LAST_SYNC_EPOCH" ]; then echo PRESERVED; else echo UPDATED; fi
   ```

   Date-only comparison (e.g., `2026-05-02 > 2026-04-29`) is **insufficient** — same-day edits would be silently misclassified as PRESERVED.

7. **Coverage gate** (warnings, never abort):

   ```
   ACs_SI         = todas linhas Acceptance criteria do SI
   ACs_in_spec    = união de **Covers AC:** fields de TODOS os cenários em TODOS os specs do SI
   ACs_no_spec    = ACs_SI \ ACs_in_spec
   ```

   For cross-layer especificamente: a união entre frontend.plan.md + backend.plan.md cobre o SI. Warning emite só se algum AC fica uncovered em AMBOS os specs.

   `ACs_no_spec ≠ ∅` → warning no delta report. Razão: muitas ACs podem ser cobertas legitimamente por linhas Unit/Integration na Tests table do SI; v1 não infere essa cobertura.

8. **Accumulate** per-spec:
   - List of (state, scenario_id, AC_set) tuples.
   - Coverage gap (`ACs_no_spec`).
   - Whether any Edit will fire in Stage 3 (PRESERVED re-stamp ou NEW append).

### Stage 2 — Surface delta report

Emit a single block to user (no `AskUserQuestion` in v1 — informational only):

```
/plan-test-specs: delta report for <slug>

Per-spec breakdown:

  <frontend-subproject>/specs/signup.plan.md (frontend, SI-03.5b)
    NEW:        2 cenários
    PRESERVED:  3 cenários (Last sync re-stamp)
    UPDATED:    0
    MANUAL:     0
    Coverage:   AC #1, #2, #3, #4 covered ✓

  <backend-subproject>/specs/auth-register.plan.md (backend, SI-03.3)
    NEW:        1 cenário
    PRESERVED:  0
    UPDATED:    1 (warning — review manually)
    MANUAL:     0
    Coverage:   AC #5 not covered (warning)

Warnings:
  - SI-03.3 spec has 1 UPDATED scenario: source mtime (2026-05-02) > Last sync (2026-04-29).
    Resolutions: (a) edit content + manually update Last sync; (b) mark Source: manual.
  - SI-03.3 AC #5 not covered by any spec scenario. Add a cenário OR ensure Tests table
    Unit/Integration row covers it (v1 não rastreia coverage cross-source).

Apply pass: vai emitir 3 NEW cenários + 3 Last sync re-stamps + 1 no-op file mtime bump.
```

### Stage 3 — Apply NEW + re-stamp PRESERVED + no-op bump

For each spec file:

1. **NEW state per scenario**: Edit (or Write if file não existe) — append a new `#### N.M. <kebab-name>` block under the appropriate `### N. <Group Name>` section. Frontmatter is initialized on Write (first NEW per file). Each NEW scenario gets:

   ```markdown
   #### 1.2. <kebab-case-name>

   **Covers AC:** #2
   **Source:** auto
   **Last sync:** 2026-05-02T14:30:00Z

   **Steps:**
     1. <user-actor or API-caller voice — depending on subproject>
       - expect: <observable outcome>
   ```

   Material de partida vem da UI Contract section (frontend) ou da API Contract section (backend) — interpretado autoral mas determinístico (mesmos prompts → mesmas saídas).

2. **PRESERVED state per scenario**: Edit cirúrgica substitui apenas a linha `**Last sync:** <old-iso>` pelo `**Last sync:** <current-iso>`. Conteúdo do cenário fica intacto.

3. **MANUAL / UPDATED / DELETED / ORPHAN state**: skip — emite warning no Stage 2 já reportado, mas Stage 3 não toca conteúdo.

4. **Update `**Test Specs:**` field no plano se ainda contém `_pending_`** (independente de qual state classificou os cenários). The trigger is "field is still pending", NOT "we just generated a NEW scenario" — caso contrário, um `--rebuild` que regenera o plano com `_pending_` placeholder e logo depois roda `/plan-test-specs` (todos cenários classificados PRESERVED ou UPDATED) ficaria em deadlock infinito: `/implement` aborta `PENDING TEST SPECS`, user roda `/plan-test-specs`, nada de NEW, field nunca repara.

   Algorithm:

   ```bash
   # For each spec path resolved in Stage 1 Step 4 (regardless of lifecycle state distribution):
   if grep -q "^\*\*Test Specs:\*\* _pending" <SI_BLOCK_in_PLAN>; then
     # Edit cirúrgica no plano: replace `_pending /plan-test-specs_` with populated form
     # Single-subproject:    `see \`<spec-path>\``
     # Cross-layer:           `see \`<frontend-path>\`, \`<backend-path>\``
   fi
   ```

   `_pending_` placeholder → `see \`<spec-path>\`` populated form. Single-subproject SI → 1 path; cross-layer SI → 2 paths comma-separated. Edit cirúrgica no plano. Forma populada:

   ```markdown
   **Test Specs:** see `<frontend-subproject>/specs/<feature>.plan.md`
   ```

   Cross-layer (subproject names resolved per Step 4 above — including the role-to-directory ask-user fallback):

   ```markdown
   **Test Specs:** see `<frontend-subproject>/specs/<feature>.plan.md`, `<backend-subproject>/specs/<feature>.plan.md`
   ```

   If the field is already populated (`see ...`), skip — already done in a prior `/plan-test-specs` run.

5. **Edge case — non-content-touching specs (zero NEW + zero PRESERVED Edits).** Quando TODOS os cenários de um spec ficaram em **UPDATED / MANUAL / DELETED / ORPHAN** states, nenhum Edit content-bearing fire e o file mtime stays old → /implement preflight aborta STALE mesmo após /plan-test-specs ter rodado. **Mitigação obrigatória (aplica-se inclusive a all-MANUAL specs):** emit um **no-op Edit no frontmatter do spec** (substituição idempotente do próprio valor atual — ler o frontmatter, escolher uma linha estável, e substituí-la por ela mesma) só pra bumpar o file mtime. Exemplo: para um spec frontend, replace `subproject: frontend` por `subproject: frontend`; para um spec backend, replace `subproject: backend` por `subproject: backend`. **Use o valor atual do campo, não um literal hardcoded** — substituir `subproject: backend` por `subproject: frontend` corromperia o spec e quebraria a detecção de runner em `/implement` Step 3a. O frontmatter bump **não viola** a invariant "user is owner of MANUAL content" porque nenhum cenário tem seu corpo tocado — a única mudança é file metadata. Alternativa equivalente: `Bash touch <spec-path>`. Skill **escolhe o no-op Edit** (não requer dispatch de Bash). Esta é a mitigação canônica do **MANUAL deadlock**: sem ela, all-MANUAL specs causariam loop infinito (`/implement` aborta STALE → user roda `/plan-test-specs` → MANUAL skip silently → file mtime ainda velho → `/implement` aborta STALE de novo).

### Stage 4 — Output summary

Emit a single block:

```
DONE. /plan-test-specs <slug>:
  Test specs created: <list of NEW spec file paths>
  Test specs updated: <list of files with NEW or re-stamped scenarios>
  Test specs mtime-bumped only: <list of files where ALL scenarios are MANUAL/UPDATED/DELETED/ORPHAN — no content edit, only no-op frontmatter bump from Stage 3 Step 5>
  Warnings: <count>

Next: run /implement <slug> to execute the plan with these specs.
```

If warnings count > 0, ensure the report references the line numbers (or just the warning text) emitted in Stage 2.

## Spec format (universal)

The spec file is **NOT** a planning artifact — it does not follow `kind:` / `name:` convention from `.claude/skills/plan-pipeline/SKILL.md`. Specs are test contracts, parallel to `library-refs.md` exemption.

```markdown
---
subproject: backend | frontend       # canonical runner discriminator (consumed by /implement Step 3a)
runner: <runner-tag>                 # informational only — `playwright` for frontend; per-backend runner tag for backend (e.g., `jest+supertest`, `pytest`, `gotest`); must match `subproject:`; `subproject:` is canonical
scope: phase-NN-{slug} | task-{slug}
si: SI-NN.X | SI-N
target_file: <resolved E2E test path>         # 1 arquivo de teste por spec; cenários viram test() blocks.
                                              # Path concreto (pasta + sufixo + nome) derivado da convenção E2E
                                              # do subprojeto via testing-guide-{subproject} e resolvido por
                                              # /plan-test-specs na geração — NÃO hardcodar pasta/sufixo aqui.
---

# <Screen | Endpoint> Test Plan

## Application Overview

<Um parágrafo descrevendo o que esta tela / endpoint faz e por quê.>

## Test Scenarios

### 1. <Group Name — verbatim from screen-inventory ou API Contract>

**Setup:** <fixture reference (frontend) | DB cleanup + module bootstrap (backend)>

#### 1.1. <kebab-case-scenario-name>

**Covers AC:** #1, #4
**Source:** auto
**Last sync:** 2026-05-02T14:30:00Z

**Steps:**
  1. <user-actor or API-caller voice — depending on subproject>
    - expect: <observable outcome>
    - expect: <another outcome>
  2. <next step>
    - expect: <outcome>
```

### File-naming convention

- **1 spec → 1 test file**, declarado via `target_file:` no frontmatter. O path concreto (pasta + sufixo + nome) é derivado da convenção E2E do subprojeto via `testing-guide-{subproject}` (ver Reason abaixo) e resolvido por `/plan-test-specs` na geração — esta skill NÃO fixa pasta nem sufixo.
- **N cenários no spec → N `test()` blocks** dentro de um único `test.describe('<feature>')` no arquivo gerado.
- Cenário individual NÃO tem `**File:**` field — caminho é shared via `target_file:`.

Reason: the project's frontend testing convention is *"one file per feature/flow"* with `test.describe('<feature>')` agrupando. Adotar 1 arquivo por cenário (Microsoft canonical) violaria essa regra. The `testing-guide-{subproject}` Skill (loaded by `/implement` Step 2 for the frontend subproject) is the canonical entry point for that convention. It is also the single source of truth for the `target_file:` path itself (folder + suffix per subproject); `/plan-test-specs` reads that convention at generation time and writes a concrete `target_file:` — no folder or suffix is hardcoded in this skill.

### Per-subproject vocabulary

| Field / Voice | Frontend | Backend |
|---|---|---|
| `Setup:` | `<frontend-subproject>/tests/fixtures.ts` (MSW network fixture auto-applied) | `beforeEach` truncate test DB; bootstrap backend test module (e.g., NestJS: `Test.createTestingModule(...).compile()`) |
| Step voice | "Usuário clica em Sign in" (user-actor) | "POST /auth/register com body X" (API-caller) |
| Expect vocabulary | DOM-observable + URL state + toast text | HTTP status + response body shape + DB state + side-effects |
| File path (per spec) | per `testing-guide-frontend` E2E convention — resolved at generation, no folder/suffix hardcoded here | per `testing-guide-backend` E2E convention — idem |
| Import in generated test | the MSW network fixture, imported from its path per `testing-guide-frontend` (NEVER `'@playwright/test'`) | backend test bootstrap module + HTTP client (e.g., NestJS `Test` module + Supertest) |

### Boundary — what externalizes vs stays inline

| Camada | Localização | Razão |
|---|---|---|
| Playwright E2E (frontend) | `<frontend-subproject>/specs/*.plan.md` | externaliza |
| E2E (backend) | `<backend-subproject>/specs/*.plan.md` | externaliza |
| Unit (frontend) | inline na Tests table do SI | fica inline |
| Integration (frontend — e.g., Route Handlers / msw/node) | inline na Tests table do SI | fica inline |
| MSW handler tests (`auth-handlers.spec.ts`) | inline no SI próprio | fica inline (não é screen wiring) |
| Unit (backend — services / repos) | inline na Tests table do SI | fica inline |
| Backend integration (ORM repos / modules — e.g., TypeORM, Prisma, SQLAlchemy, Hibernate) | inline na Tests table do SI | fica inline |

## Lifecycle states (MVP — L2 revisado)

| State | Detection | v1 action |
|---|---|---|
| **NEW** | AC do plano sem cenário cobrindo | gerar cenário, marcar `Source: auto`, set `Last sync` ao timestamp da operação |
| **PRESERVED** | Cenário existe; mtime do source (phase plan) ≤ `Last sync` do cenário | re-stamp Last sync (Edit cirúrgica substitui só a linha) — atualiza file mtime como side-effect |
| **MANUAL** | Cenário com `Source: manual` ou sem `Source` field | skip silently |
| **UPDATED** | Cenário com `Source: auto` E mtime do plano > `Last sync` | warning no delta report; user edita à mão |
| **DELETED** | Cenário com `Source: auto` cobrindo apenas ACs que sumiram do plano | warning no delta report |
| **ORPHAN** | `Covers AC: #N` aponta a AC inexistente no SI atual | warning no delta report |

**Crítico — PRESERVED e file mtime.** O preflight do `/implement` checa **file mtime** (`stat -c %Y`) vs plan mtime. Se PRESERVED skipasse silently, file mtime ficaria antigo e preflight falsamente abortaria STALE. Por isso PRESERVED **emite Edit** mesmo com conteúdo OK — o Edit naturalmente atualiza file mtime. Esta é a operação que torna a sequência canônica `/plan-build` (append) → `/plan-test-specs` → `/implement` funcional.

**MANUAL state — content untouched, but frontmatter bump still fires when ALL scenarios are MANUAL.** A skill respeita o user-as-owner-of-cenário: NÃO modifica corpo de cenário MANUAL nem adiciona/altera cenários adjacentes. **Mas** se TODOS os cenários do spec estão em MANUAL (i.e., zero NEW + zero PRESERVED Edits content-bearing fired), o no-op frontmatter Edit do Stage 3 Step 5 dispara mesmo assim — só pra bumpar file mtime e satisfazer `/implement` preflight. Isso elimina o deadlock onde all-MANUAL specs causariam loop infinito. Quando o spec tem mix de states (e.g., 2 NEW + 3 MANUAL), os NEW Edits naturalmente bumpam mtime; o no-op Step 5 só fire quando o set de Edits está vazio.

**Limitação conhecida — UPDATED state overdetectado por file mtime global.** `mtime do plan` é file-level. Se user edita um SI backend independente, mtime sobe e TODO spec auto cobrindo qualquer SI é classificado UPDATED. v1 trata todos os UPDATED via warning; v2 considera per-SI mtime via parsing de Revisions blocks por SI.

**CONFLICTED state** (auto-generated + user-edited + source changed) é deferido pra v2 — exige hash-based detection que adiciona complexidade não justificada no MVP.

## Discovery via `**Test Specs:**` field

The presence of `**Test Specs:**` field is the **trigger** (decides whether /plan-test-specs processes the SI). The **discriminator** is the SI_ID-shape + HAS_ROUTE combo, NOT `**Figma:**` (Xa-only field).

**Why NOT use `**Figma:**`:** the Xb template (`screen-si.md`) does NOT include `**Figma:**` — only Xa does. Using HAS_FIGMA would classify Xb (frontend genuine) as backend. Correct discriminator: shape do SI_ID (sufixo `b` = frontend Xb) + presence de `**Route:**` cujo valor **começa com um HTTP method** (regex `^\*\*Route:\*\* (GET|POST|PUT|PATCH|DELETE) /`) = backend controller wiring. **Importante:** SI-Xa também tem campo `**Route:**`, mas com apenas a URL path (e.g., `**Route:** /signup`) — sem HTTP method prefix. O regex acima não dispara em SI-Xa, então HAS_ROUTE=0 e Xa não é mal classificada como backend. SI-Xa também não recebe `**Test Specs:**` (HAS_TEST_SPECS=0), então é skipped no caso 1 da tabela ("Skip — não é screen/controller wiring").

**Cross-layer keyword é byte-verbatim binding (v1).** O cross-layer case casa o título via match literal de `(cross-layer)` (parêntese, lowercase, hífen, sem variantes). Variantes não suportadas em v1: `Cross-layer` capitalizado, `(Cross-Layer)`, sinônimos como "full-stack flow". Phase-b.md emit rules e este SKILL devem prescrever **literalmente** "use `(cross-layer)` lowercase em parênteses ao final do título do SI".

## Integration points

- **plan-pipeline overview** — `/plan-test-specs` é Stage 5 (linked back from `.claude/skills/plan-pipeline/SKILL.md`).
- **plan-build** — emits `**Test Specs:** _pending /plan-test-specs_` placeholder em Xb / controller wiring / cross-layer SIs (phase-b.md, phase-c.md, screen-si.md) e `test_specs_aware: true` no frontmatter (phase-a.md). Output contract B7/C7 emite hint condicional pra invocar /plan-test-specs. **Trigger discriminator** (the placeholder string itself) is canonical — `/plan-test-specs` preflight greps for `^\*\*Test Specs:\*\* _pending` to count placeholders; `/implement` preflight uses the same regex.
- **implement** — consome specs JIT no Step 3a (lê o spec, autora arquivo de teste via LLM single-pass; **1 spec → 1 file com N `test()` blocks**). Frontend: invoca `Skill playwright-cli` para carregar pattern references (test-generation.md, request-mocking.md, element-attributes.md) no contexto do LLM — NÃO invoca Section 2 interactive workflow nem `Bash playwright-cli generate` (subcomando inexistente). Backend: LLM-authored direto; o-que-testar e boas práticas por artefato vêm da Skill `testing-guide-{subproject}` (já carregada em `/implement` Step 2 para o subproject backend). Preflight modern aborta com `MISSING` / `STALE` / `PENDING TEST SPECS` (vide implement Skill § "Preflight").
- **plan-validate** — **NO CHANGE.** Plan-validate continua operando só sobre `context.md`. Nenhum check spec-related; gates spec-related vivem em /plan-test-specs (delta report) e /implement preflight. Documentado em `docs/plan-spec-driven-test-skill.md` § "NO CHANGE".

## Failure modes + abort messages

| Cenário | Detection | Mensagem |
|---|---|---|
| Plano não existe | stat fail | `Plano não existe em <path>. Verifique se /plan-build já rodou para <slug>.` |
| Plano legacy | `test_specs_aware` ausente do frontmatter | `Plano <slug> está em modo legacy. Para migrar: rode '/plan-build <slug> --rebuild' primeiro para regenerar no novo formato, então rerun /plan-test-specs.` |
| Modern plan sem **Test Specs:** SI | `grep -c "^\*\*Test Specs:\*\*"` = 0 | No-op exit silencioso. (Não é erro — fase backend pura ou foundations-only.) |
| SI Xb com `**Route:**` (impossível por construção) | discriminator caso 5 | `SI-NN.X termina em 'b' E tem **Route:**. Estado inválido por construção — Xb nunca tem Route. Investigar emissão em phase-b.md. Provavelmente bug.` |
| Fall-through (SI plain, sem Route, sem cross-layer) | discriminator FALL-THROUGH | `SI-NN.X tem **Test Specs:** mas não casa nenhum case válido. Run /plan-build <slug> --rebuild OR remova manualmente o **Test Specs:** field do SI antes de retry.` |
| Spec file malformed Covers AC | parse fail | `Cenário <id> em <spec-path> tem **Covers AC:** malformado: '<line>'. Esperado: '#<int>(, #<int>)*'. Edit manualmente e rerun.` |

## Coverage gate semantics (v1 reduzido)

Stage 1 step 7 monta dois conjuntos considerando os cenários em todos os specs referenciados pelo SI:

```
ACs_SI         = todas linhas Acceptance criteria do SI
ACs_in_spec    = união de **Covers AC:** de TODOS os cenários em TODOS os specs
                 referenciados pelo `**Test Specs:**` field do SI
ACs_no_spec    = ACs_SI \ ACs_in_spec
```

Para cross-layer especificamente: cada spec (frontend.plan.md, backend.plan.md) tem cenários cobrindo subset de ACs. Coverage do SI = união dos `**Covers AC:**` de ambos. Warning emite só se algum AC fica uncovered em AMBOS.

`ACs_no_spec ≠ ∅` → **warning** (não erro). Razão: muitas ACs cobertas legitimamente por linhas Unit/Integration na Tests section do SI; v1 não infere essa cobertura sem convenção de annotation.

**v1 explicitamente NÃO força:**
- Convenção `(cobre AC #N)` em rows da Tests section.
- Coverage cross-source (spec scenarios + Tests section rows).
- Abort em coverage incompleto — sempre warning, nunca abort.

**v2 (under demand)** pode adicionar `**Covers AC:** #N, #M` como column adicional na Tests section; coverage = união {Tests rows covers} ∪ {spec scenarios covers}.

## Out-of-scope (v1 vs v2)

**v1 implementa:** default mode (analyze + apply NEW + re-stamp PRESERVED), MANUAL skip (com no-op frontmatter bump quando ALL-MANUAL pra evitar STALE deadlock), UPDATED/DELETED/ORPHAN warnings, single + cross-layer specs, no-op bump for non-content-touching specs, legacy abort, no-op exit em modern sem Specs.

**v2 (under demand):**
- `--reconcile` mode com `AskUserQuestion` per delta (UPDATED/DELETED/ORPHAN).
- `--force-regen <scenario>` override.
- `--strict` flag (transforma warnings de coverage gate em abort hard).
- `--analyze` flag dedicado (v1: default mode já é analyze + apply NEW; user roda novamente após editar).
- Auto-deletion de cenários ORPHAN.
- CONFLICTED state detection (hash do auto-generated content).
- Tests section convention `(cobre AC #N)` para coverage cross-source.
- Heal phase (Microsoft Section 3) integration em /implement.
- App exploration durante /plan-test-specs via comandos Microsoft Section 1.3.
- Backend equivalente de `playwright-cli` (não existe; ficará manual indefinidamente).
- Cross-spec coverage reports.
- v2 marker estruturado `**Cross-layer:** true` field — eliminaria fragilidade do byte-verbatim `(cross-layer)` keyword.
- Per-SI mtime tracking via parsing de Revisions blocks (mitiga overdetecção UPDATED).
