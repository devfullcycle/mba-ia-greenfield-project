---
name: streamtube-quality-gate
description: "Run the automated quality gate for a StreamTube phase — Docker Compose health, migrations, full test suite (unit/integration/e2e, always --runInBand), TypeScript compilation, and a git sanity check — then classify the result CLEAN or DIRTY with evidence. Use when the user asks to validate, check, or gate a phase before manual testing or documentation — e.g. 'roda o quality gate da fase 03', 'a fase 02 está limpa?', 'confirma que os testes passam antes de documentar'. This is the automated half of validation; it does not exercise real endpoints (that's streamtube-manual-validation's job)."
disable-model-invocation: true
---

# StreamTube Quality Gate

Run every automated check that determines whether a phase's code is safe to hand to manual validation and documentation. This skill produces a verdict — CLEAN or DIRTY — backed by evidence, not an impression. "I ran the tests and they seemed fine" is not a verdict; the actual pass/fail counts and command output are.

This mirrors the environment-and-test validation done for phases 01/02 in this repo (Docker Compose fix, migration run, full suite, `tsc --noEmit`) — treat that as the reference shape for how thorough this check needs to be.

## Why `--runInBand` is non-negotiable here

Integration and e2e suites in this project share a single PostgreSQL instance and truncate/seed shared tables. Running them in parallel (`npm test` with default Jest parallelism, or `npm run test:e2e` without the flag) causes FK violations, deadlocks, and cross-suite contamination that look like real bugs but are actually a test-runner configuration mistake. Every test command in this skill that touches the database **must** include `--runInBand`. If a command in the target subproject's `package.json` doesn't already bake this in, add the flag explicitly rather than trusting the default.

## Checks — run in this order

Adapt exact commands to the target subproject's conventions (for `nestjs-project`, see its `CLAUDE.md` — commands always run inside the container via `docker compose exec nestjs-api ...`, never on the host).

### 1. Docker Compose

- `docker compose config` — confirms the compose file parses and env vars resolve as expected. Read the output; don't just check the exit code — a service silently missing an env var still exits 0.
- `docker compose ps` — every service must show a healthy/running status.
- `docker compose logs <service> --tail=200` for the application service — confirms it actually started (framework boot log, routes mapped), not just that the container is "Up". A container can be `Up` while its process crashloops or, as seen in this project before, sits idle because the Dockerfile's default `CMD` was never overridden with a real start command.

### 2. Migrations

Check whether the database schema is current before trusting any test result against it: `\dt` (or the subproject's equivalent) against the target database. If expected tables are missing, run the subproject's migration command (e.g. `npm run migration:run` inside the container for `nestjs-project`) — an empty schema produces cascading test/manual-validation failures that look like application bugs but are an environment setup gap. Record whether migrations were already applied or had to be run now.

### 3. Full automated test suite

Run every layer, each with `--runInBand`:

- Unit + integration: `npm test -- --runInBand` (or the subproject equivalent)
- Integration only, if the subproject separates it: `npm run test:integration`
- E2E: `npm run test:e2e -- --runInBand`

Record suite counts (`X suites / Y tests passed`) for each — not just "tests passed". A suite that reports 0 tests collected is not evidence of anything; catch that distinct failure mode.

### 4. TypeScript

`npx tsc --noEmit` inside the container. Exit code 0 is the bar — any error is a hard DIRTY, no exceptions, per this project's Definition of Done.

### 5. Regression check for previous phases

The full suite in step 3 already covers previous phases' automated tests (they don't get deleted) — confirm none of them started failing because of this phase's changes. If this phase modified a shared artifact (an entity, guard, filter, or module used by a previous phase), specifically call out which previous-phase tests exercise that artifact and confirm they're in the green count, not just that the aggregate number is unchanged.

### 6. Git sanity

- `git status` — flag any unexpected untracked/modified files outside what this phase's increments were supposed to touch.
- Confirm no destructive operation is needed or was silently performed (no `docker compose down -v`, no forced resets).

## Verdict

- **CLEAN**: Compose config valid, all services healthy, schema current, all test suites 100% passing, `tsc --noEmit` exits 0, no unexplained git changes.
- **DIRTY**: anything short of that. State exactly which check failed, with the actual command output (or a concise excerpt), not a paraphrase. A DIRTY verdict is not a failure of this skill — reporting it accurately is the point.

Never round DIRTY up to CLEAN because "it's probably just flaky" — rerun the specific failing check once to rule out flakiness, then report honestly either way.

## Global rules

- Never use `npm test` (or any DB-touching test command) without `--runInBand` in this project.
- Never use `--forceExit` to mask hanging handles — an open handle is a real bug (unclosed DB connection, dangling timer), not test-runner noise.
- Never run `npm audit fix --force`.
- Never run `docker compose down -v` or delete volumes without explicit user authorization — if the environment needs a hard reset, ask first.
- Never modify `package.json` / `package-lock.json` to make a check pass.
- Never commit.
- If a fix is needed to get from DIRTY to CLEAN and it's outside this skill's remit (e.g. a missing `command:`/`env_file:` in `compose.yaml`, an unrun migration), it's fine to apply the minimal fix and re-run the check — but call out exactly what was changed and why, the same way you'd report any other production change.
- Use paths relative to the repository root.
- Present evidence for every check, not just the final verdict — the next skill in the chain (`streamtube-manual-validation` or `streamtube-phase-documentation`) and the user both need to trust this without re-running everything themselves.
