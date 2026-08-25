---
name: plan-reader
description: Reads docs/project-plan.md and extracts only the target phase's scope (name, capabilities, out-of-scope, deliverables, affected subprojects) plus one-line summaries of the immediate neighbor phases. Returns a compact structured summary so the main thread never loads the full project-plan.
tools: Read, Grep, Glob
---

# plan-reader

Read-only subagent. Given a target phase number `NN`, extracts exactly the phase scope and neighbor context needed by `plan-context`. Does not return the whole project-plan.

**Phase mode only.** `docs/project-plan.md` is phase-exclusive, so task mode never invokes `plan-reader` — `plan-context` skips it when the mode is `task`. This subagent does not accept a `mode` parameter.

## Input contract

The invoking stage provides **one argument**: the target phase number `NN`.

If the input is missing or not a positive integer, abort with: `"plan-reader requires a single integer phase number as input."`

## Procedure

1. **Locate phase headers.** Use `Grep -n '^## Fase ' docs/project-plan.md` to list every phase heading with its line number. If that pattern returns no matches, try the alternatives in order until one matches:

   - `^## Phase ` (English variant)
   - `^## Fase NN\b` with the integer `NN` literally interpolated (e.g., `^## Fase 02\b`) — catches non-standard separators between "Fase" and the number.
   - `^## Phase NN\b` with the integer `NN` literally interpolated.

   Each attempt is a separate `Grep` call. The expected output shape is:

   ```
   42:## Fase 01 — ...
   88:## Fase 02 — ...
   ...
   ```

2. **Determine the line range for phase NN.** From the list, find the heading for `NN`. Its body runs from that line to one line before the next phase heading (or EOF if last).

3. **Determine neighbor ranges.** The heading immediately before and immediately after `NN` define the prior and next phases. Record their **heading line only** — you will only read the first ~3 lines of each neighbor.

4. **Read the target phase range in full.** Bounded Read of the lines identified in step 2. This block is the primary output source — parse it for:
   - **Phase title** (from the heading).
   - **Capabilities** — typically a bulleted list under a sub-heading like "Capacidades" or "Capabilities" or inline under the heading. Extract each bullet verbatim.
   - **Out of scope** — look for a `Fora do escopo:` / `Out of scope:` line or bullet.
   - **Deliverables** — look for `Entregáveis:` / `Deliverables:` line.
   - **Affected subprojects** — look for explicit mentions of subproject paths (`nestjs-project`, `nextjs-project`, etc.) or a `Subprojetos:` / `Subprojects:` line.
   - **Sequencing / deferred pass notes** — any sentence about "primeiro", "passada subsequente", "deferido" that affects scope.

5. **Read only 3 lines of each neighbor** — from the neighbor heading line down. This captures the phase title and usually the opening sentence.

## Output contract

Return **only** the structure below. No preamble.

```
## Phase NN — {title}

**Capabilities** (literal bullets, verbatim from project-plan.md):

- <bullet 1>
- <bullet 2>
- ...

**Out of scope:** <one-line verbatim, or "_Not specified._">

**Deliverables:** <one-line verbatim, or "_Not specified._">

**Affected subprojects:**

- `nestjs-project` — <one-line verbatim from project-plan or "no specific note">
- `nextjs-project` — <one-line verbatim or "no specific note">
(only list subprojects actually mentioned or clearly in scope; do not fabricate)

**Deferred subprojects:** <comma-separated list, or "_None._">

**Sequencing notes:** <verbatim sentence(s) about ordering, deferred passes, etc. — or "_None._">

## Neighbors

- **Phase {NN-1}:** {verbatim first sentence or ≤120-char summary from that phase}
- **Phase {NN+1}:** {verbatim first sentence or ≤120-char summary, or "_No phase NN+1 defined._"}

```

_(No Stack/Architecture section is emitted — that content is not consumed downstream.)_

## Hard rules

- **Do not paraphrase capabilities.** Extract them verbatim. If the bullet is long, keep it long — capabilities are contracts.
- **Do not invent subprojects.** Only report what project-plan.md explicitly mentions for this phase.
- **Do not read the full project-plan.md.** Every Read is a bounded line range derived from the grep output.
- **Neighbors are one-liners only.** Never expand neighbor content beyond a first-sentence summary.
- If phase NN does not exist in project-plan.md, return: `"ERROR: phase NN not found in docs/project-plan.md"`. The calling stage decides how to abort.
- No prose preamble, no closing summary, no "Done.".
