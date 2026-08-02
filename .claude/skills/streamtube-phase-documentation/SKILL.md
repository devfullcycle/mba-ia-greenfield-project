---
name: streamtube-phase-documentation
description: "Update README and project documentation (architecture, env vars, commands, tests, troubleshooting) for a StreamTube phase, but only after that phase's quality gate is CLEAN. Use when the user asks to document a phase, update the README, or write up what was built — e.g. 'documenta a fase 02 no README', 'atualiza a documentação de troubleshooting da fase 03', 'escreve o que mudou no ambiente'. Refuses to run if the quality gate isn't recorded as CLEAN, and never documents functionality that doesn't actually exist in the code."
disable-model-invocation: true
---

# StreamTube Phase Documentation

Document what the phase actually shipped, after it's proven to work — not before. Documentation written against a plan instead of against verified reality tends to describe the phase that was intended rather than the one that exists, and readers trust docs more than they trust code, which makes a wrong doc more dangerous than no doc.

## Preflight — hard gate

Read `docs/phases/phase-NN-progress.md`, section 5 (Quality Gate). If the recorded verdict is not **CLEAN**, or the section is empty/pending, **stop** and tell the user: documentation runs after `streamtube-quality-gate` reports CLEAN, not before. Point them at that skill. Do not make an exception because "the docs part is unrelated to what's failing" — a DIRTY gate means the described behavior isn't verified yet, full stop.

If the gate is CLEAN but `streamtube-manual-validation`'s document (section 6 of the progress file) is missing or shows unvalidated endpoints, warn the user before proceeding — you can still document confirmed automated-test behavior, but flag which parts rest only on the quality gate and not on real manual exercise.

## What to document, and where

- **README** (repo root and/or subproject, whichever the change affects) — update only the sections that changed: new setup steps, new services in Docker Compose, new env vars, new commands. Don't rewrite unrelated sections.
- **Architecture docs** (`docs/` — diagrams, `docs/project-plan.md` if a phase's scope note needs correcting after the fact) — update only if this phase actually changed the architecture (new container, new external system, new module boundary). Cross-check against `docs/diagrams/software-arch.mermaid` if it exists — if the phase introduced a new container (e.g. Object Storage, Message Queue, Video Worker going from "TBD"/planned to real), update the diagram too, not just prose.
- **Environment variables** — document every new/changed var: name, purpose, example value (never a real secret), which service reads it.
- **Commands** — document new `npm`/`docker compose` commands the phase introduces (e.g. a new migration, a new worker start command), following the existing command-documentation style in the subproject's `CLAUDE.md` (container-only vs host-only distinction, if applicable).
- **Tests** — document new test commands or suites if the phase introduced a new test type/location, following existing conventions (don't invent a new suffix or convention without flagging it as a deliberate change).
- **Troubleshooting** — add entries only for problems actually hit and understood during this phase's quality gate or manual validation (e.g. "container shows Up but app doesn't start — check `command:`/`env_file:` in compose.yaml" is worth documenting precisely because it happened and was root-caused; a hypothetical problem that never occurred is not).

## Source of truth for what to write

Pull facts from, in order of trust:

1. `docs/phases/phase-NN-validation.md` — real, executed proof.
2. `docs/phases/phase-NN-progress.md` — quality gate evidence and increment list.
3. The actual code — for anything not covered by the above (e.g. exact env var names), read the source, don't paraphrase from the plan.

Do not pull descriptions from `docs/phases/phase-NN-plan.md` or `docs/phases/phase-NN-[slug].md` uncritically — a plan describes intent; only write into README/docs what the validation and quality gate actually confirmed exists and works. If the plan promised something that manual validation shows doesn't work yet or was descoped, document the real state and flag the discrepancy rather than documenting the plan's aspiration.

## Rules

- Never document functionality that isn't actually implemented and validated — no "coming soon" sections framed as if they exist, no documenting an endpoint that returned an error in manual validation as if it succeeds.
- Never touch unrelated sections of README/docs while updating this phase's — scope the diff to what this phase changed.
- Never commit.
- Never modify `package.json` / `package-lock.json` (this skill only touches documentation).
- Use paths relative to the repository root.
- Update `docs/phases/phase-NN-progress.md` section 7 (Documentação) as the last step: which files were changed, confirming the CLEAN-gate prerequisite was checked.
