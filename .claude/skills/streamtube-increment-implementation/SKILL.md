---
name: streamtube-increment-implementation
description: "Implement exactly one increment from a StreamTube phase's plan (docs/phases/phase-NN-plan.md) — confirms which increment, lists files to touch, implements it, runs its specific tests, shows the diff, and stops. Use when the user asks to implement, build, or code a specific increment or the next increment of a phase — e.g. 'implementa o INC-03.2', 'implementa o próximo incremento da fase 03', 'codifica o incremento de upload chunked'. Never implements more than one increment per invocation, never commits, and refuses to run without an approved plan."
disable-model-invocation: true
---

# StreamTube Increment Implementation

Implement **one** increment, fully, then stop. This skill is deliberately narrow — it is the execution counterpart of `streamtube-phase-planning`, the same way `implement-phase` is the execution counterpart of `plan-phase`. If you find yourself wanting to keep going into the next increment "since we're here," that's the failure mode this skill exists to prevent: small, reviewable, testable steps beat a big bang.

## Preflight — stop before touching anything if these aren't satisfied

1. **Plan exists and is approved.** `docs/phases/phase-NN-plan.md` must exist with `Status: planning_ok`. If it's missing, or its status shows it's still a draft, **stop** and tell the user to run `streamtube-phase-planning` (and get it approved) first. Do not infer a plan from the research document or from conversation — an unwritten plan is not a plan.
2. **The target increment is identifiable.** If the user named one (e.g. "INC-03.2"), find it in the plan's Incrementos section. If they said "the next one," read `docs/phases/phase-NN-progress.md`'s Incrementos table and pick the first `pending` increment whose dependencies (per the plan's execution order) are all `completed`. If no increment qualifies (all done, or the next one's dependencies aren't met), stop and say why.
3. **Dependency check.** Verify every increment this one depends on (per the plan) shows `completed` in the progress file. If not, stop — implementing out of order breaks the guarantee this whole family of skills provides.

## Step 1 — Confirm the increment

Before writing any code, state back to the user: the increment ID, its one-sentence description from the plan, which SI (if any) it maps to in the detailed technical plan (`docs/phases/phase-NN-[slug].md`), and its dependencies. This is a confirmation, not a question requiring a reply — proceed after stating it, unless something in the plan is ambiguous enough that you genuinely need the user to disambiguate (e.g. the plan references a technical decision left as `[DECIDE: ...]` and never resolved).

## Step 2 — List files you intend to change

Before editing, enumerate the files you expect to create or modify (source files, test files, migration files, config). Base this on the increment's mapped SI in the detailed plan if one exists (its Technical actions and Tests table already name most of them), otherwise derive it from the increment description and the codebase audit in the research document. Show this list to the user as part of your response before or alongside starting the edits — it's the cheapest way for them to catch scope creep before it happens.

Stay inside this list as you work. If you discover mid-implementation that another file genuinely must change, say so explicitly (and why) rather than silently expanding scope.

## Step 3 — Implement

Work through the increment's technical actions (from the mapped SI, or from the increment's own description if self-contained). Load relevant best-practices skills for the artifact types involved (e.g. `nestjs-best-practices` for modules/controllers/services, `typeorm` for entities/migrations) — only what this increment touches.

**Compatibility with previous phases is non-negotiable.** Before changing any shared artifact (an entity from a previous phase, a shared module, a common exception/filter), check how it's currently used elsewhere in the codebase (Grep for its usages) and confirm your change doesn't break those call sites. If a previous phase's behavior must change to accommodate this increment, that's a decision the user needs to explicitly make and justify — surface it, don't silently do it.

Follow the target subproject's conventions — read neighboring files before creating new ones.

## Step 4 — Write and run this increment's tests

Use the subproject's testing guide skill (`testing-guide-<subproject>`, if present) for how to structure each test layer. Write only the tests this increment's Tests section (in the mapped SI, or defined directly in the plan) calls for — cover its acceptance criteria, don't pad with unrelated tests.

Run **only** the test files for this increment, not the full suite — the full suite is `streamtube-quality-gate`'s job, after all increments are done. Follow the project's test-execution rules: integration/e2e suites share PostgreSQL, so any command touching them must use `--runInBand`, and never `--forceExit` to mask hanging handles — an open handle after tests means something (a connection, a timer) wasn't closed, and hiding it just moves the bug to production.

If tests fail: read the failure, diagnose the root cause, fix, re-run — up to 3 focused attempts. If still failing after 3, stop and report the failure, your hypothesis, and what you tried. Don't weaken the test or skip it to force a pass.

## Step 5 — Show the diff

Before finishing, show the user a diff (`git diff` scoped to the files you touched, or equivalent) of everything changed in this increment. This is the artifact the user actually reviews — the confirmation in Step 1 was about intent, this is about outcome.

## Step 6 — Stop

Do not commit. Do not start the next increment. Update `docs/phases/phase-NN-progress.md`'s Incrementos row for this increment (status, test result, files changed, any out-of-scope observations) as your last action, then report completion and wait. If the user wants the next increment, that's a new invocation of this skill (directly, or routed by `streamtube-phase-orchestrator`).

## Global rules

- One increment per run. Never implement two increments in the same invocation, even if they look trivially small.
- Never commit or push.
- Never run `npm audit fix --force`.
- Never modify `package.json` / `package-lock.json` without a demonstrated need — and call it out explicitly if you do.
- Never use `--forceExit` on tests.
- Never change previous phases' functionality without surfacing the reason and getting it acknowledged.
- Use paths relative to the repository root.
- Record files changed and commands run in the progress file, not just in chat.
