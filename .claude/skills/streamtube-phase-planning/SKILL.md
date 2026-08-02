---
name: streamtube-phase-planning
description: "Turn a StreamTube phase's research into an implementation plan broken into small increments — architecture, domain model, states, endpoints, infrastructure, and test strategy. Use when the user asks to plan a phase after research is done — e.g. 'planeja a fase 03 com base na pesquisa', 'divide a fase de upload em incrementos', 'monta o plano técnico da fase 04'. Produces docs/phases/phase-NN-plan.md. Never writes functional code — only planning documents."
disable-model-invocation: true
---

# StreamTube Phase Planning

Turn `docs/phases/phase-NN-research.md` plus the phase's statement in `docs/project-plan.md` into an actionable plan broken into small increments. This skill produces documents only — no functional code, no test files, no migrations.

## Relationship to `plan-phase`

The `plan-phase` skill already has a mature, battle-tested methodology for the *deep* technical contract of a phase — Data Model, API Contracts, Authorization Matrix, Error Catalog, Events/Messages, and rigorously-derived Acceptance Criteria per Step Implementation (SI), saved as `docs/phases/phase-NN-[slug].md`. Phases 01 and 02 already use it. Don't reinvent that machinery.

**Default flow:**

1. Check whether `docs/phases/phase-NN-[slug].md` already exists for this phase. If not, invoke the `plan-phase` skill (Skill tool) to produce it — this is where the heavy technical specification work happens (entities, contracts, error catalog, per-SI acceptance criteria).
2. Once that document exists (freshly generated or already present), write `docs/phases/phase-NN-plan.md` as the **increment layer** on top of it: a lighter document that (a) summarizes architecture/domain/states/endpoints/infra/tests at a glance, (b) maps each SI (or group of SIs) from the detailed plan to one **increment** — the unit `streamtube-increment-implementation` will execute — and (c) orders those increments.

This means `phase-NN-plan.md` is deliberately not a duplicate of `phase-NN-[slug].md` — it's an index and increment breakdown that always points back to the detailed doc for specifics (exact request/response shapes, exact error codes). Don't copy those details into `phase-NN-plan.md`; reference the section instead (e.g. "ver SI-03.4 em phase-03-videos.md").

**When `plan-phase` isn't warranted** (rare — e.g. a very small phase with one or two endpoints and no new entities), you may write `phase-NN-plan.md` as a self-contained plan covering architecture, domain, states, endpoints, infrastructure, and tests directly, using the same rigor `plan-phase` applies (see its SKILL.md for the AC-writing guide, REST conventions, and error catalog conventions — reuse those, don't redefine your own). State explicitly in the document that no separate SI-level document was generated and why.

## Inputs — read before planning

1. `docs/phases/phase-NN-research.md` — requirements, constraints, codebase audit, and any decisions already resolved. If this file doesn't exist or its Status is `blocked_on_decisions`, stop and tell the user to run `streamtube-phase-research` first (or resolve the open decisions) — planning on top of unresolved product decisions produces a plan that has to be redone.
2. `docs/project-plan.md`, the phase's section — cross-check the research didn't drop any capability.
3. `docs/decisions/` — any technical decisions relevant to this phase (from Step 3 of research, or previous phases).
4. Testing conventions for the target subproject — load `testing-guide-<subproject>` (Skill tool) if it exists, so the test strategy per increment is grounded in the project's real layering rules, not invented here.

## How to break the plan into increments

An increment is smaller or equal in scope to an SI — it is the unit `streamtube-increment-implementation` implements in a single run (one increment per run, tests included). Sizing heuristics:

- One increment = one cohesive, independently testable unit of behavior. If it can't be described in one sentence without "and also", it's probably two increments.
- Infrastructure (installing deps, wiring a module, adding config) is its own increment, separate from the behavior built on top of it — this mirrors `plan-phase`'s own SI-sizing rule and keeps diffs reviewable.
- Prefer more small increments over fewer large ones. `streamtube-increment-implementation` enforces one-at-a-time execution with a stop-and-confirm between each; long increments defeat the purpose of that checkpoint.
- Each increment lists its dependencies on other increments (by ID), so implementation order is derivable — mirror the Dependency Map convention from `plan-phase`.

## Output structure

Save to `docs/phases/phase-NN-plan.md`:

```markdown
# Fase XX — [Nome] — Plano de Incrementos

> **Status:** planning_ok
> **Data:** YYYY-MM-DD
> **Plano técnico detalhado:** docs/phases/phase-NN-[slug].md (se gerado via `plan-phase`) | "Nenhum — plano autocontido abaixo"

## 1. Arquitetura (resumo)

(one paragraph + bullet list: which subproject(s), new modules, how it connects to existing modules from previous phases)

## 2. Domínio e estados

(entities touched/created — name + one-line purpose, pointing to the detailed data model in phase-NN-[slug].md when it exists; state machines if the phase introduces any, e.g. video processing status)

## 3. Endpoints (resumo)

(table: method, route, one-line purpose, pointer to the SI/section with full contract — not the full contract itself)

## 4. Infraestrutura

(new services/containers/queues/buckets this phase needs in Docker Compose, env vars, external systems)

## 5. Estratégia de testes

(which layers apply per artifact type, referencing the subproject's testing guide skill; anything phase-specific, e.g. how to test a queue consumer)

## 6. Incrementos

### INC-XX.1 — [nome]
**Mapeia para:** SI-NN.1 (ou "definido diretamente nesta skill")
**Descrição:** uma frase
**Dependências:** INC-XX.N ou None
**Critério de pronto:** o que precisa ser observável para considerar o incremento concluído (não repita a AC completa do SI — resuma)

(repeat per increment)

## 7. Ordem de execução

(dependency tree, same format as plan-phase's Dependency Map)
```

## Rules

- Never write functional code, test files, migrations, or configuration during this skill — planning produces documents only.
- Do not duplicate the full API Contracts / Error Catalog / Data Model from `phase-NN-[slug].md` into `phase-NN-plan.md` — reference, don't copy, so the two documents can't drift out of sync.
- If research left open decisions, stop before planning (see Inputs, item 1).
- Keep increments small — see sizing heuristics above. If an increment exceeds what `plan-phase` would consider a reasonable SI, split it.
- Use paths relative to the repository root.
- Never commit.
