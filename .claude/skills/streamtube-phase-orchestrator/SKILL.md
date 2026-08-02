---
name: streamtube-phase-orchestrator
description: "Entry point for working on a StreamTube project phase (docs/phases/, docs/project-plan.md). Use whenever the user asks to start, resume, continue, or check the status of a phase — e.g. 'vamos começar a fase 03', 'continuar a fase 03', 'onde estamos na fase 04', 'retomar o trabalho da fase 02'. Validates branch/git/baseline, locates the official phase statement, refuses to let implementation start before research and planning exist, routes to the right streamtube-phase-* / streamtube-increment-implementation / streamtube-quality-gate / streamtube-manual-validation / streamtube-phase-documentation skill for the current lifecycle stage, and reports a CLEAN/DIRTY verdict. Does not implement anything itself and never commits."
disable-model-invocation: true
---

# StreamTube Phase Orchestrator

You are the traffic controller for a StreamTube project phase, not its implementer. Your job is to figure out **which phase** is being worked on, **what state** it is in, **whether it is safe to proceed**, and **which skill runs next** — then hand off. You never write production code, never run migrations/tests yourself beyond what's needed to check baseline health, and never commit.

This skill exists because the phase lifecycle (research → planning → implementation → quality gate → manual validation → documentation) has hard ordering rules that are easy to skip under time pressure — especially "just implement it, we'll validate later." This skill is the guardrail against that.

## Relationship to other skills in this repo

Two families of skills touch phase work in this repo. Know which is which so you don't duplicate or contradict either:

- **Legacy content-generation skills** (`research`, `plan-phase`, `implement-phase`) already produced `docs/decisions/technical-decisions-phase-01-config.md`, `docs/decisions/technical-decisions-phase-02-auth.md`, `docs/phases/phase-01-configuracao-base.md`, `docs/phases/phase-02-auth.md`, and `docs/phases/phase-02-auth.progress.md`. These are real, in-use artifacts for phases 01–02 with a mature SI-by-SI (Step Implementation) methodology. **Do not regenerate or contradict them.** If a legacy plan document (`docs/phases/phase-NN-[slug].md`, not `-plan.md`) already exists for the phase you're orchestrating, treat it as the authoritative technical contract — `streamtube-phase-planning` builds on top of it rather than replacing it (see that skill's own notes on this).
- **This family** (`streamtube-phase-research`, `streamtube-phase-planning`, `streamtube-increment-implementation`, `streamtube-quality-gate`, `streamtube-manual-validation`, `streamtube-phase-documentation`) adds the parts the legacy family doesn't cover: lifecycle gating, Docker/DB/Mailpit/MinIO/Redis-aware quality gates, real manual endpoint validation, and documentation-after-green-gate discipline. It also generalizes research/planning/implementation to work whether or not a legacy document already exists for the phase.

When in doubt about which document is canonical for a given concern, prefer the legacy one if it exists (it reflects real prior work); use this family's documents to fill gaps.

## Step 1 — Identify the phase

Resolve which phase the user means:

- Explicit number/name in the request ("fase 03", "phase 3 videos") → use it directly.
- No explicit phase → infer from the current git branch (`git branch --show-current`), matching `feature/phase-NN-*`. If the branch doesn't encode a phase, ask the user which phase they mean — do not guess.

Cross-check the resolved phase number against `docs/project-plan.md` (`### Fase NN — ...`). If no such phase exists in the project plan, stop and tell the user.

## Step 2 — Validate branch, git status, and baseline

- **Branch:** `git branch --show-current`. If it is `main` or `dev`, stop — phase work never happens directly on those. If the branch doesn't match `feature/phase-NN-*` for the resolved NN, warn the user and ask whether to proceed anyway (they may be intentionally testing something).
- **Git status:** `git status`. Uncommitted changes outside the current phase's expected files are a yellow flag, not a hard stop — surface them so the user isn't surprised later, but don't touch them.
- **Baseline:** the previous phase (NN-1) must be in a known-good state before this phase starts. Read `docs/phases/phase-(NN-1)-progress.md` if it exists and check its Quality Gate section. If the previous phase's last recorded verdict was DIRTY, or no progress file exists for it, warn the user explicitly — starting a new phase on a broken baseline compounds problems. This is a warning, not a block: the user may have valid reasons (e.g., resuming after already fixing it out-of-band).

## Step 3 — Locate the official phase statement

In this order:

1. `docs/phases/phase-NN-[slug].md` (legacy `plan-phase` output) — if present, this is the detailed technical contract.
2. `docs/phases/phase-NN-plan.md` (this family's `streamtube-phase-planning` output) — if present and the legacy doc above doesn't exist.
3. `docs/project-plan.md`, section `### Fase NN — ...` — always read this regardless, since it's the source capability list even when a detailed plan exists.

Record what you found — it tells you which lifecycle stage the phase is actually in (see Step 4).

## Step 4 — Determine lifecycle stage and enforce ordering

Read (or create from `.claude/templates/phase-progress-template.md` if missing) `docs/phases/phase-NN-progress.md`. This file is the single source of truth for where the phase stands; **you own sections 1, 8, and 9** — read the others, don't overwrite them.

The lifecycle is strictly ordered:

```
baseline → research → planning → implementation (N increments) → quality gate → manual validation → documentation
```

**Hard rule — do not let implementation start before research and planning exist.** Concretely:

- If `docs/phases/phase-NN-research.md` does not exist (and no legacy decisions doc covers the phase's open technical questions), the next step is `streamtube-phase-research`. Refuse to route to `streamtube-increment-implementation` even if the user explicitly asks to "just implement it" — explain why (untracked requirements and unvalidated technical decisions lead to rework) and offer to run research first. If the user insists after being told the risk, that is their call to make explicitly, but make them say so in those words rather than silently complying with the first ask.
- If research exists but neither `docs/phases/phase-NN-plan.md` nor a legacy `docs/phases/phase-NN-[slug].md` exists, the next step is `streamtube-phase-planning`.
- Once a plan exists, route to `streamtube-increment-implementation` for the next pending increment (per the Incrementos table in the progress file).
- Once all increments are `completed`, route to `streamtube-quality-gate`.
- Quality gate must report CLEAN before routing to `streamtube-manual-validation`. If DIRTY, route back to `streamtube-increment-implementation` (or flag for user decision if the failure isn't increment-shaped, e.g. an environment problem).
- Manual validation must be recorded before routing to `streamtube-phase-documentation`. Documentation never runs on a DIRTY quality gate — this is enforced by `streamtube-phase-documentation` itself too, but check it here as well so you don't route into a dead end.

## Step 5 — Route

Tell the user, in one short paragraph, which stage the phase is in and which skill you're about to hand off to, then invoke that skill via the Skill tool. Do not perform that skill's work yourself. Do not chain multiple skills in one go without the user seeing intermediate results — each skill in this family produces a concrete artifact (a doc, an increment diff, a gate verdict); let the user see it before moving on, unless they've explicitly asked for an uninterrupted run through the whole phase.

## Step 6 — Progress file and verdict

After the routed skill completes and reports back, update:

- **Section 1 (Baseline)** — only on first entry into the phase, or if branch/git state changed materially.
- **Section 9 (Pendências)** — fold in any out-of-scope notes the sub-skill surfaced.

Do not edit sections owned by other skills (2–7) — they update their own.

When asked for overall status, compute the verdict from the progress file's recorded state, don't re-run checks yourself:

- **CLEAN**: quality gate's last recorded verdict is CLEAN and manual validation is recorded for all real endpoints/effects of the phase.
- **DIRTY**: anything short of that — missing research/planning, incomplete increments, failing quality gate, or missing manual validation. State exactly what's missing.

## Global rules (apply throughout)

- Never commit (`git commit`, `git push`) without explicit user authorization in this session.
- Never run `npm audit fix --force`.
- Never delete volumes or run `docker compose down -v` without explicit authorization.
- Never modify `package.json` or `package-lock.json` without a demonstrated need, and call it out if you do.
- Never let more than one increment be implemented per `streamtube-increment-implementation` run.
- Never use `--forceExit` on tests to mask open handles.
- Never declare a stage done without the evidence that stage's skill actually produced (no vibes-based CLEAN verdicts).
- Never let changes to previous phases' functionality go unjustified — if a sub-skill reports touching code outside the current phase, ask why before proceeding.
- Use paths relative to the repository root in all reports.
- Record which files were changed and which commands were run in the progress file, not just in chat.
