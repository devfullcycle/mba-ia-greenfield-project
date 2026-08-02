---
name: streamtube-phase-research
description: "Research a StreamTube project phase before any planning or implementation happens — extracts requirements and acceptance criteria from docs/project-plan.md, audits the existing codebase for what's already in place, compares technical alternatives for open questions, and records decisions not yet made. Use when the user asks to research, investigate, or scope a phase before planning it — e.g. 'pesquisa a fase 03 antes de planejar', 'o que precisamos decidir para o upload de vídeo', 'levanta os requisitos da fase 04'. Produces docs/phases/phase-NN-research.md. Read-only with respect to production code — never edits src/ or equivalent."
disable-model-invocation: true
---

# StreamTube Phase Research

Produce the research document that everything downstream (planning, implementation) depends on. This skill's output is the difference between a plan built on assumptions and one built on what the project actually says and what the code actually does.

**Hard constraint: this skill never edits production code.** It reads `docs/`, reads `src/` (or the equivalent source tree for the affected subproject), and writes exactly one file: `docs/phases/phase-NN-research.md`. If you find yourself about to `Edit` or `Write` anything under a subproject's source tree, stop — that's out of scope here.

## Sources — read only these

- `docs/project-plan.md` — the phase's capability list, section `### Fase NN — ...`. This is the primary source of *what* the phase must deliver.
- `docs/decisions/` — decisions already made in previous phases (read the Decisions Summary table of each; these are hard constraints, not open questions).
- `docs/phases/` — previously completed phases, for consistency of scope boundaries and to know what already exists.
- The relevant subproject's source code (e.g. `nestjs-project/src/`) — for the codebase audit (Step 2 below).
- Primary technical documentation for any library/framework/service the phase will need (official docs, RFCs) — via Context7 MCP if available, otherwise WebSearch. Do not rely on training-data memory for API details; libraries move fast and training data goes stale.

Do not read generic blog posts as a primary source for technical claims. Do not invent requirements that aren't in `docs/project-plan.md` — if something seems necessary but isn't stated there, flag it as a gap, don't silently assume it.

## Step 1 — Extract requirements, acceptance criteria, and constraints

Read the phase's section in `docs/project-plan.md` end to end. For each capability listed:

- Restate it as a concrete requirement (what must be true when this phase is done).
- Note any constraint stated or implied (size limits, formats, timing, security properties — e.g. Phase 03's "upload robusto: suporte a arquivos de até 10GB sem impactar a performance" is both a requirement and a hard constraint).
- Note dependencies on previous phases (what this phase assumes already exists and works).

Acceptance criteria at this stage are still coarse (they get refined into per-endpoint ACs during planning) — capture them as observable outcomes: "a video upload of up to 10GB succeeds", "processing failures are visible to the uploading user", not implementation detail.

## Step 2 — Audit the existing codebase

Before proposing anything new, establish what's already there. For the subproject(s) the phase touches:

- List existing modules, entities, and endpoints relevant to the phase's domain (e.g. for a video phase: is there already a `VideosModule`? A `Channel` entity the video will relate to? An existing upload mechanism from a previous phase?).
- Note existing patterns the phase should follow for consistency (error response shape, auth guard usage, migration conventions, module structure) — point to the actual file, don't restate the convention from memory.
- Note anything that will need to change to support the new phase (e.g. an entity that needs a new relation).

Use the Explore agent or direct Grep/Glob for this — it's read-only investigation, well suited to delegation when the codebase is large.

## Step 3 — Compare alternatives for open technical questions

Not every phase has open questions — check first: does this phase involve a real choice of library, pattern, or strategy with meaningful trade-offs (e.g. chunked vs. streaming vs. resumable upload; queue technology for video processing)? If every capability has an obvious, uncontested implementation given the existing stack, skip this step and say so in the document.

When there are real open questions, **do not duplicate the deep comparison methodology that already exists** — invoke the `research` skill (Skill tool) for the tech-decision comparison itself; it already knows how to produce a rigorous options/trade-offs/recommendation structure at `docs/decisions/technical-decisions-phase-NN-[slug].md`. Once it returns, fold its **Decisions Summary** table into this document's "Alternativas comparadas" section (link to the full decisions doc rather than re-deriving the comparison inline). This keeps the deep-comparison logic in one place instead of two skills disagreeing about how to weigh trade-offs.

If the `research` skill isn't available for some reason, or the open question is narrow enough not to warrant a full decisions document (e.g. a single config value), compare 2–4 options inline using the same honesty standard: concrete pros/cons, no forced recommendation when options are genuinely equivalent.

## Step 4 — Record decisions not yet made

Separate from Step 3's technical alternatives (which come with a recommendation), list anything that requires a **product or scope call the user must make**, not a technical trade-off — e.g. "should draft videos be visible to the uploader's subscribers?", "what happens to a video mid-processing if the uploader deletes their account?". These block planning until answered. Do not guess at these and do not let them silently default to whatever's easiest to implement.

## Output structure

Save to `docs/phases/phase-NN-research.md`:

```markdown
# Fase XX — [Nome] — Research

> **Status:** research_ok | blocked_on_decisions
> **Data:** YYYY-MM-DD

## 1. Requisitos e critérios de aceite

(one subsection per capability from project-plan.md, each with: requirement, constraints, dependencies on previous phases, coarse acceptance criteria)

## 2. Auditoria do código existente

(what exists today, relevant to this phase — modules, entities, endpoints, conventions to follow, what needs to change)

## 3. Alternativas comparadas

(either: "Nenhuma decisão técnica em aberto — implementação segue [padrão existente]" OR a summary per open question, linking to docs/decisions/technical-decisions-phase-NN-[slug].md when the `research` skill was used)

## 4. Decisões de produto/escopo ainda não tomadas

(list — or "Nenhuma" — each blocking planning until the user answers)

## 5. Gaps e riscos

(anything project-plan.md leaves ambiguous, or risks surfaced by the codebase audit)
```

## Global rules

- Never edit files under a subproject's source tree (`src/`, `test/`, migrations, etc.) — read-only.
- Never modify `package.json` / `package-lock.json`.
- Never commit.
- Use paths relative to the repository root.
- Record which files were read and which commands were run (Grep/Glob/Explore delegations, Context7/WebSearch queries) so the planning skill can trust the research without redoing it.
- If Step 4 finds blocking decisions, say so plainly in the Status line (`blocked_on_decisions`) — don't let the document read as "done" when it isn't.
