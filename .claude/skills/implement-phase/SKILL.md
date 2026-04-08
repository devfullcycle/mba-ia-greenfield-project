---
name: implement-phase
description: "Execute a phase implementation plan step by step, respecting dependencies, running the relevant tests after each SI, and only advancing when tests pass. Use whenever the user asks to implement, execute, build, or deliver a planned phase — including variations like 'implement phase X', 'execute phase-02', 'build the auth phase', 'run the phase plan', 'implement the SIs', or any request to turn a phase plan document (docs/phases/phase-NN-*.md) into working code."
disable-model-invocation: true
---

# Implement Phase

Execute a phase implementation plan SI by SI. Each SI is only considered done when its implementation exists **and**, if the SI has a Tests section, the tests listed there pass. Move to the next SI only after the current one is complete (tests passing where the SI has a Tests section).

This skill is the execution counterpart of `plan-phase`. The plan document is the contract — this skill does not make technical decisions, it follows them.

## Inputs

The user either points to a phase document directly (e.g., `docs/phases/phase-02-auth.md`) or refers to it by number/name (e.g., "implement phase 02", "run the auth phase"). Resolve the path before proceeding:

- If the phase number is given, look for `docs/phases/phase-NN-*.md`.
- If multiple match, ask the user which one.
- If the file does not exist, stop and tell the user — they likely need to run `plan-phase` first.

The user may also request **continuous mode** at the start of the session with phrases like "execute tudo", "don't pause between SIs", "run all at once", "autopilot". The default mode pauses between SIs for confirmation.

## Context — read before implementing

1. **The phase document** — `docs/phases/phase-NN-*.md`. This is the primary source. Parse Objective, Step Implementations (each with Description, Technical actions, Tests, Dependencies, Acceptance criteria), Technical Specifications, Dependency Map, and Deliverables.
2. **Testing guide skill** — for each target subproject, use the Skill tool to load `testing-guide-{subproject}` if present. It defines how to write and run tests at each layer (Unit, Integration, E2E) for that subproject. The Tests section of each SI tells you **which** files to create; the testing guide tells you **how** to write them.

## Progress file — persistence across sessions

A progress file tracks which SIs are completed, their test results, and out-of-scope observations. It is the source of truth for resuming a phase across sessions and for generating the final completion report.

- **Location:** sibling of the phase document, with `.progress.md` suffix — e.g., `docs/phases/phase-02-auth.md` → `docs/phases/phase-02-auth.progress.md`
- **Created:** during "Set up the SI task list" (fresh start) or read during Preflight (resume)
- **Updated:** at step 6 of the per-SI loop, after each SI completes
- **Format:**

```markdown
# Phase NN — <name> — Progress

**Status:** in_progress | completed
**SIs:** X/Y completed

### SI-NN.X — <name>
- **Status:** completed | pending
- **Tests:** <result or "no tests">
- **Observations:** <out-of-scope notes or "none">
```

Each SI gets one section. Only `Status`, `Tests`, and `Observations` are updated — the structure is created once and entries are filled in as SIs complete.

## Preflight — run before touching code

Check these before starting implementation. Stop and surface any issue to the user rather than guessing:

- **Branch check**: `git status` and `git branch --show-current`. If the current branch is `main` or `dev`, or if there are uncommitted changes touching files outside the target subproject's directory (e.g., outside `nestjs-project/` when that is the target), stop and ask the user to set up the right branch first.
- **Subproject readiness**: the target subproject exists and its dependencies are installed (e.g., `nestjs-project/node_modules` present). If not, ask the user to set it up first.
- **Plan sanity**: the phase document has the expected structure (Step Implementations and Deliverables are required; Dependency Map is optional — if missing, the order will be derived from each SI's `Dependencies:` field). If the document looks malformed or incomplete, stop and report.
- **Resume check**: look for a progress file (`.progress.md` sibling of the phase document). If found, read it to determine which SIs are already completed. Inform the user: "Encontrado progress file com X/Y SIs completos. Retomando a partir de SI-NN.Z." If the progress file is malformed or inconsistent with the phase document, stop and report.

## Execution order

Implement SIs in the order defined by the **Dependency Map** in the phase document. If the Dependency Map is missing or contradicts the SIs' `Dependencies:` fields, derive the order from those fields using a topological sort — an SI can only start once all its dependencies are complete (tests passing where the SI has a Tests section).

Never skip ahead. Never implement two SIs in parallel in the same run. The guarantee "previous SI is complete (tests passing where the SI has a Tests section) before the next starts" is the core value this skill provides; violating it defeats the purpose.

## Set up the SI task list — before entering the per-SI loop

Before implementing the first SI, you **MUST** create a persistent task list that contains **one task per SI** in the phase, in the order they will be executed. Use the `TaskCreate` tool (one call per SI).

- Task subject format: `SI-NN.X — <SI name>` (e.g., `SI-02.1 — HTTP Infrastructure Foundations`).
- Task description: a one-line summary of what the SI delivers.
- Task activeForm: what you will be doing while the SI is in progress (e.g., `Implementing HTTP infrastructure`).
- All tasks start as `pending`.

This list is the visible plan the user can see before any code is written. It mirrors the phase document's SI sequence and serves as the execution contract for the session.

**Fresh start** (no progress file found): after creating the task list, create the progress file with all SIs as `pending`.

**Resume** (progress file found): after creating the task list, immediately mark already-completed SIs' tasks as `completed` (based on the progress file). The per-SI loop will skip completed SIs and start from the first `pending` one. If all SIs are already completed but the progress file's `Status` is still `in_progress`, skip the per-SI loop and proceed directly to final verification.

During the per-SI loop:
- Flip the current SI's task to `in_progress` when you start step 1 (Plan the SI).
- Flip it to `completed` at the beginning of step 6, **before** emitting the per-SI completion report and the "Seguir para SI-NN.X+1?" question. The `TaskUpdate` and progress file update are the last tool calls allowed before the mandatory STOP in default mode (in continuous mode, the per-SI completion report is emitted, then the next SI's `TaskUpdate → in_progress` follows).
- Never skip tasks, never batch updates — one SI's status is changed at a time.

Do **not** merge multiple SIs into one task. Do **not** add ad-hoc tasks for individual technical actions — those live in the per-SI working memory (step 1), not in the persistent task list.

## The per-SI loop

For each **pending** SI (completed SIs from a previous session are skipped), execute these steps in order. Do not batch them; each step's output informs the next.

### 1. Plan the SI

Re-read the SI section in full (Description, Technical actions, Tests, Dependencies, Acceptance criteria). Load relevant best-practices skills matching the artifacts this SI builds (e.g., `nestjs-best-practices` for modules/controllers/services, `typeorm` for entities/migrations) — load only what this SI needs, not all available skills. Keep a short internal checklist for this SI: one item per technical action; additionally, when the SI has a Tests section, one item per test file plus a "run tests" item. This is working memory to keep the SI on track — not a formal deliverable.

### 2. Implement the technical actions

Work through the technical actions in order. Stay within scope — only touch files required by **this** SI. If you notice unrelated issues (dead code, formatting, refactoring opportunities), note them for the user but do not act on them.

When the SI introduces new dependencies, install them with the exact version ranges listed in the SI's technical actions.

Follow the target subproject's conventions — read neighboring files before creating new ones so naming, structure, and style stay consistent.

### 3. Write the tests

If the SI has no Tests section, skip this step and steps 4–5, and go straight to step 6 (pause). Otherwise, continue below.

Create the test files listed in the SI's Tests section. Use the testing guide skill as the reference for how to structure each layer. Each test must verify something specific the SI introduces — do not write placeholder tests.

Cover the SI's Acceptance Criteria. Every AC owned by this SI should be observable from at least one of this SI's tests (the AC-to-test mapping is not always 1:1, but no AC should be untestable). Note: SIs with no testable artifacts (infrastructure SIs where behavior is exercised through other SIs' tests, pure-configuration SIs, or similar) may legitimately lack a Tests section — the "skip step 3" branch covers all such cases.

### 4. Run the tests for this SI

Run **only** the test files listed in the SI's Tests section — not the full suite.

### 5. Handle test failures (up to 3 fix attempts)

If tests pass on the first run, proceed to step 6 (pause).

If tests fail, enter the **fix loop**: read the failure output, diagnose the root cause, apply a focused fix, re-run the same tests. Do this at most **3 times**. Count attempts deliberately — do not lose count and loop indefinitely.

Fix-loop discipline:
- **Read the error.** Do not retry blindly. If the same fix is applied twice, that's a sign the diagnosis is wrong.
- **Fix the root cause.** Do not weaken tests to make them pass. Do not add skips, `.only`, or `xit`. Do not catch and swallow errors just to hide them.
- **Stay in scope.** If the failure reveals a problem in a previous SI's code, stop — that's a signal to escalate, not to quietly edit a completed SI.
- **No shortcuts.** Never disable hooks or bypass safety checks.

After 3 unsuccessful fix attempts, **stop**. Report to the user:
- Which SI is stuck.
- The current test failure output (concise).
- Your hypothesis about the root cause.
- What you've tried.

Wait for the user's guidance. Do not proceed to the next SI until the user unblocks you.

### 6. Pause for confirmation — STOP before the next SI

This step is a **hard stop**. After completing an SI you **MUST NOT** begin the next SI without the user's explicit approval (given per-SI in default mode, or upfront when the user requested continuous mode).

- **Default mode (pause — this is the default)**: First, make a `TaskUpdate` call marking the current SI's task as `completed`, then update the progress file (mark the SI as `completed`, record test results and any out-of-scope observations noted during this SI) — these are the final tool calls permitted in this step. Then emit the per-SI completion report (SI id, name, tests passing — or `no tests` if the SI had no Tests section) and emit exactly this question as the final line of your message: **"Seguir para SI-NN.X+1?"** (substitute the next SI's id). Then **STOP**. Do not call any further tools. Do not start reading files for the next SI. Do not update the next SI's task to `in_progress`. Wait for the user's reply in a new turn before doing anything else.
- **Continuous mode** (only when the user **explicitly** requested it at the start of the session with phrases like "execute tudo", "autopilot", "don't pause between SIs", or "run all at once"): Still perform the `TaskUpdate → completed` and progress file update, and emit the per-SI completion report (SI id, name, tests passing — or `no tests` if the SI had no Tests section), but **skip** the "Seguir para SI-NN.X+1?" question and the STOP. Then proceed directly to step 1 of the next SI. If you are unsure whether continuous mode was requested, assume default mode and pause.
- **Last SI of the phase**: Still perform the `TaskUpdate → completed` and progress file update (same as the other modes); the per-SI completion report is folded into the phase-level Completion report (see section below), so skip the per-SI report, the question, and the STOP, and go straight to final verification.

Violating this stop is the single most common failure mode of this skill. Treat "Seguir para SI-NN.X+1?" as a terminator, not a rhetorical question.

## Final verification — after all SIs are done

Once every SI in the phase has been implemented and tested, run the phase-level checks defined in the plan's **Deliverables** checklist. These typically include:

1. **Full test suite**: Run every test command listed in the plan's Deliverables (typically one for unit/integration tests and, when applicable, a separate one for E2E tests). The goal is to exercise every test in the phase together, not just the tests of a single SI.
2. **Type-check**: Run the type-check command defined in the plan's Deliverables (e.g., `npx tsc --noEmit` for TypeScript projects).
3. **Project build**: Run the build command defined in the project (e.g., `npm run build`) to verify the code compiles and bundles correctly.

Verify any additional deliverables listed in the plan (migrations, documentation updates, seed data, configuration files). These results are presented in the **Completion report** (see section below).

If the phase spans multiple subprojects, the plan's Deliverables checklist will list these checks per subproject (e.g., `All SI tests pass in nestjs-project` and `All SI tests pass in nextjs-project`) — run each subproject's commands independently, in the order implied by the checklist.

If any final check fails, apply the same fix-loop discipline as step 5: up to 3 focused fix attempts total (shared across all failing checks, not 3 per check), re-running the affected checks after each attempt. If still failing after 3 attempts, stop and report to the user.

## Completion report

When the phase is fully done, read the progress file and generate the report:
- Results of each deliverable check (from final verification — the only new information at this point).
- Out-of-scope observations aggregated from the progress file (as a list of follow-ups for the user, not as things to act on).

Mark the progress file's `Status` as `completed`. Git operations (add, commit, push, PR) are out of scope — the user owns version control.

## Rules

- The phase plan is the contract. Do not add SIs, drop SIs, or change SI boundaries mid-execution. If the plan is wrong, stop and ask the user to revise it via `plan-phase`.
- Before the first SI, create the SI task list (one `TaskCreate` per SI, in order) so the user sees the full plan. Flip each task's status exactly at the boundaries defined in step 1 (`in_progress`) and step 6 (`completed`).
- Respect dependency order — never implement an SI whose dependencies are not yet complete (tests passing where the SI has a Tests section).
- One SI at a time. No parallel implementation within the same phase run.
- Run only the SI's own tests during the loop. Save the full suite for final verification.
- Never weaken tests to make them pass. Never bypass hooks.
- Stay within the scope of the current SI — note unrelated issues, don't act on them.
- After each SI (except the last) in default mode, **STOP after emitting "Seguir para SI-NN.X+1?"** and wait for user approval before any further tool call. Continuous mode applies only when the user explicitly requested it at the start of the session.
- Stop and ask when the fix loop exhausts its 3 attempts, when a dependency is missing, or when the plan conflicts with reality.