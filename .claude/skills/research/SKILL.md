---
name: research
description: "Research technical options and generate a decisions document for a project phase. Use whenever the user needs to explore alternatives, understand trade-offs, or define technical paths before planning a phase — including variations like 'research options for phase X', 'what technologies to use in the phase', 'phase trade-offs', 'technical decisions for the phase', 'research the phase', or any mention of exploring alternatives before planning."
disable-model-invocation: true
---

# Research

Research technical options and generate a structured decisions document for a project phase. This document sits between the general plan and the implementation plan — it identifies decisions that need to be made, presents alternatives with trade-offs, and recommends a path. The user reviews, decides, and the result feeds the `plan-phase` skill.

## Context — read before generating

1. **`docs/project-plan.md`** — general project plan. Contains the phase description, its capabilities, and the defined stack.
2. **`docs/decisions/`** — canonical source of technical decisions from previous phases. These are hard constraints — do not reopen decisions already made.
3. **`docs/phases/`** — already planned phases. Read for format and naming consistency reference only, not as a source of technical decisions.

## When this skill is needed

Not every phase needs research. Use this checklist:

- Does the phase involve **choices of lib, framework, or service** with real alternatives? (e.g., bcrypt vs argon2, JWT vs session)
- Are there **competing implementation patterns** with relevant trade-offs? (e.g., refresh token rotation vs blacklist)
- Does the phase have **non-functional requirements** that impact technical choices? (e.g., 10GB upload → chunked vs streaming vs tus)
- Do you have a **real doubt** about which path to take?

If the answer is no to all, skip the research and go straight to `plan-phase`. The user (the professional using the agent) must then provide technical decisions directly alongside the planning request.

## How to identify technical decisions

Read each capability of the phase in project-plan.md and ask: "is there more than one reasonable way to implement this with the project's stack?" If yes, it's a technical decision.

Technical decisions appear in recurring categories:

- **Strategy:** how to approach the problem (e.g., stateless vs stateful auth)
- **Lib/Service:** which tool to use (e.g., Passport.js vs manual implementation)
- **Pattern:** which pattern to follow (e.g., refresh token rotation vs blacklist)
- **Storage:** where and how to persist data (e.g., token in cookie vs localStorage)
- **Limits and policies:** values and technical business rules (e.g., token expiration, rate limit, max size)

Ignore decisions already made in project-plan.md or in previous phases. Also ignore trivial decisions that have an obvious answer in the context of the stack.

## How to research options

For each identified decision:

1. **Check the relevant project's installed versions first.** Identify which project in the monorepo is in scope (e.g., nestjs-project, nextjs-project, or other) and check its `package.json` / `package-lock.json` to see the versions already installed. This constrains which documentation versions to fetch and which alternatives are truly compatible with the existing stack.
2. **Research within stack context.** For each option being evaluated, use Context7 MCP to fetch documentation for the versions compatible with your project's installed dependencies. This gives accurate API details, version compatibility, and known limitations — better than relying on training data or latest versions.
3. **Search for up-to-date information on alternatives.** Use web search and Context7 to look up current documentation for competing libs, frameworks, and patterns. Versions change, libs get deprecated, new options emerge.
4. **Prioritize primary sources.** Official documentation, RFCs, lib repositories. Avoid generic blog posts as a primary source.
5. **Be honest about trade-offs.** Don't force a recommendation. If two options are equivalent in the context of your stack and constraints, say so.

## Output structure

```markdown
# Technical Decisions — Phase NN: [Name]

> **Phase:** [Phase name]
> **Status:** Pending | Decided
> **Date:** [YYYY-MM-DD]

---

## TD-01: [Decision name]

**Context:** Why this decision needs to be made. Which phase capability depends on it.

**Options:**

### Option A: [Name]
- How it works (2-3 sentences)
- **Pros:** concrete advantages
- **Cons:** concrete disadvantages

### Option B: [Name]
- How it works (2-3 sentences)
- **Pros:** concrete advantages
- **Cons:** concrete disadvantages

### Option C: [Name] _(if applicable)_
- How it works (2-3 sentences)
- **Pros:** concrete advantages
- **Cons:** concrete disadvantages

**Recommendation:** [Recommended option] — one-sentence justification considering the stack and project context.

**Decision:** _[to be filled by user]_

---

(repeat for each decision)

## Decisions Summary

| ID | Decision | Recommendation | Choice |
|----|----------|---------------|--------|
| TD-01 | [Name] | [Recommended option] | _[pending]_ |
| TD-02 | [Name] | [Recommended option] | _[pending]_ |
```

## How to write recommendations

The recommendation is a suggestion, not a decision. It must:

- Be justified by the project context, not by generic preference.
- Consider what was already decided in previous phases.
- Be explicit about what is gained and what is lost.
- Admit when there is no significant difference between options.

Bad recommendations: "JWT is more modern." "Everyone uses bcrypt."
Good recommendations: "JWT + refresh in DB enables rotation (RFC 9700) without adding Redis as an auth dependency, since PostgreSQL is already in the stack."

## Rules

- Present between 2 and 4 options per decision. Less than 2 is not a decision. More than 4 is noise.
- Do not include options that are clearly inadequate for the project's stack or scope.
- Do not make decisions for the user. Recommend, but leave the "Decision" field for them to fill.
- Do not go into implementation details. That's the job of `plan-phase`.
- If a decision depends on another (e.g., token storage choice depends on auth strategy), indicate the dependency.
- Keep each option concise. If the explanation of an option exceeds 5-6 lines, it's too detailed for this document.

## Output

Save to: `docs/decisions/technical-decisions-phase-NN-[name-slug].md`

Example: `docs/decisions/technical-decisions-phase-02-auth.md`

After the user fills in the decisions, this document serves as input for the `plan-phase` skill.