---
name: research
description: "Research technical options and generate a structured decisions document. Use whenever the user needs to explore alternatives, understand trade-offs, or define technical paths — whether for a project phase or an ad-hoc topic. Trigger phrases include: 'research options for phase X', 'research how to do Y', 'technical decisions for Z', 'what are the options for...', 'explore alternatives for...', 'research the phase', 'investigate options for parallel DB testing', or any mention of exploring alternatives, trade-offs, or technical choices before planning or implementing."
disable-model-invocation: true
---

# Research

Research technical options and generate a structured decisions document for a defined scope — a project phase, an ad-hoc technical question, a bug investigation, or a refactoring exploration. This document identifies decisions that need to be made, presents alternatives with trade-offs, and recommends a path. The user reviews, decides, and the result feeds `plan-context`, or stands alone as a reference when no planning step follows.

## Related entry points

- **`/decide "<free-text>"`** — front-door for unstructured needs (when you don't know if a TD already covers the area, or if a change is a Revision vs Supersede). `/decide` triages and either applies a Revision inline OR sends you back here for greenfield research / superseding research.
- This skill (`/research`) is the right direct entry when you **know** it's a new TD: phase research kickoff, or an ad-hoc topic you've already decided to research formally.

## Input handling

The user provides the research scope in one of three ways:

1. **Phase reference:** the user names a phase (e.g., "research phase 03", "technical decisions for the upload phase"). The skill reads that phase's capabilities from `docs/project-plan.md` as the scope definition.
2. **Inline description:** the user describes the topic directly in the chat (e.g., "research how to run tests in parallel against the same database instance"). No phase is involved; the description IS the scope.
3. **External document:** the user points to a file containing the problem description, scope, and constraints (e.g., "research from docs/topics/parallel-db-testing.md").

If the user provides both a phase reference and an inline description, the phase capabilities define the scope boundary and the inline description narrows the focus. If the user provides both an inline description and an external document, the document takes precedence and the inline message adds context. If the user provides both a phase reference and an external document, the phase capabilities define the hard scope boundary (nothing outside the phase's bullets belongs in the document) and the external document supplies additional context, constraints, or detail within that boundary.

**Mode detection:** determine the mode from the user's input:
- If the input references a phase number or unambiguous phase name matching `docs/project-plan.md` → **phase mode**.
- Otherwise → **ad-hoc mode**.

The mode affects context gathering and output metadata. The **capability gate** (each TD traces to a phase bullet, via the **`Capability:` field** per TD) applies to phase mode **and** to ad-hoc mode when `related_phases` is non-empty. The research process, option analysis, and most rules apply identically in both modes. Aggregate capability coverage is not written here — it is assembled downstream by `plan-context`.

**If the input is too vague to identify technical decisions** (e.g., "research the database" — which aspect? performance? schema design? migration strategy?), ask the user to clarify before proceeding.

## Context — read before generating

1. **`docs/project-plan.md`** — general project plan.
   - **Phase mode:** read the target phase's description, capabilities, and the defined stack. The phase capabilities are the primary scope definition.
   - **Ad-hoc mode:** read only the **Stack** and **General Architecture** sections. These constrain which technologies are in play. The phase list may help identify whether the topic overlaps with a planned phase — if it does, record the overlap in the YAML frontmatter's `related_phases` field (see Output structure).
2. **`docs/decisions/`** — canonical source of prior technical decisions. These are hard constraints — do not reopen decisions already made, regardless of mode. In ad-hoc mode, read only decisions relevant to the topic area (not all files).
3. **`docs/phases/`** and **`docs/tasks/`** — already planned phases and tasks. Read for format and naming consistency reference only, not as a source of technical decisions. In ad-hoc mode, scan for overlap with the research topic — if a phase or task already covers the area, note it.
4. **User's scope description** _(ad-hoc mode only)_ — the primary input. Extract: what question needs answering, which modules/layers/areas are affected, what constraints exist.
5. **Current code** _(when the topic relates to existing code)_ — if the research concerns a bug, refactoring, or improvement to existing code, read the relevant source files to understand the current implementation. More common in ad-hoc mode.

### Scope detection

Before identifying decisions, determine what the scope spans — along two independent dimensions:

**Dimension 1 — Subprojects affected:**
- **Phase mode:** read the target phase in `docs/project-plan.md` and list every subproject directory referenced by its capabilities (e.g., the backend or frontend subproject).
- **Ad-hoc mode:** infer from the user's description which subprojects are affected. Database/persistence/server-side topics map to the backend subproject; rendering/UI/client-side topics map to the frontend subproject.

**Resolving subproject directory names** — discover them in this order:

1. `docs/project-plan.md`'s `### Subprojects` section, if present.
2. The repo root directory listing (subproject dirs are typically at the root, named after their stack/framework).
3. **If the role-to-directory mapping is still ambiguous** (e.g., multiple candidates for "backend", or unclear which dir is "frontend"), ask the user via `AskUserQuestion` before proceeding. Do not guess.

**Dimension 2 — Repository-transversal concerns:** independent of which subprojects are in play, decide whether the scope also touches monorepo tooling, Docker Compose structure, CI/CD, lint/format config, git hooks, shared TS config, or env management. If yes, the **Repo-wide / Infra & Tooling** category (see below) comes into play.

The two dimensions together drive which context sources to load and which decision categories (backend, frontend, cross-layer, repo-wide) to consider. If only one subproject is affected and no transversal concern applies, load only that subproject's sources; otherwise load all relevant sources — a single decisions document covers everything.

## When this skill is needed

Not every scope needs a formal research document. Use this checklist:

- Does the scope involve **choices of lib, framework, or service** with real alternatives? (e.g., bcrypt vs argon2, JWT vs session)
- Are there **competing implementation patterns** with relevant trade-offs? (e.g., refresh token rotation vs blacklist)
- Does the scope have **non-functional requirements** that impact technical choices? (e.g., 10GB upload → chunked vs streaming vs tus)
- Do you have a **real doubt** about which path to take?

If the answer is no to all:
- **Phase mode:** skipping is only valid when **every** capability bullet of the target phase can be mapped to either (i) a TD already decided in a prior phase and recorded in `docs/decisions/`, or (ii) a canonical stack pattern explicitly documented in `docs/decisions/` or `{subproject}/CLAUDE.md`. Before proposing the skip, produce the mapping in writing — one line per capability → source — and present it to the user. If a single capability is unmapped, proceed with research; "no real doubts" without a documented mapping is not a valid skip.
- **Ad-hoc mode:** tell the user there are no meaningful alternatives to research — the answer is straightforward and does not warrant a decisions document.

## What counts as a Technical Decision (and what doesn't)

A TD documents a **strategic choice** — one whose trade-offs and second-order effects the implementer cannot re-derive from best-practices alone at execution time. **Implementation details do NOT belong in a TD**; they are resolved by `implement` using best-practices skills (e.g., `typeorm`, `nestjs-best-practices`) and the neighboring code.

Apply this test before writing any TD:

- **(d) Best-practices resolution** — is the item's answer already documented in a best-practices skill, framework doc (fetch via `context7`), or canonical stack idiom? If yes, `implement` converges without a TD.
- **(a) Cross-component contract** (tie-breaker) — is the item cited in ≥2 files that must stay consistent (e.g., Joi schema + `compose.yaml` + `.env.example`)? If yes, strategic. If no, likely implementation.

**Drop the TD candidate when (d) holds AND (a) does not.** Examples to drop:

- Export form of a file (`export default` vs `export const`) — typeorm convention.
- Glob patterns for framework discovery (`*.entity.ts`, `*.migration.ts`) — framework docs.
- Directory names following stack conventions (`src/database/seeds/`) — stack idiom.
- npm script names (`migration:generate`, `seed`) — CLI tool convention.
- Framework module options with established defaults (`ConfigModule.isGlobal`, `TypeOrmModule.synchronize`).
- Container-level defaults (healthchecks, volume strategies, command idioms) — compose convention.

**Keep the TD when (d) fails (no skill covers it) OR (a) holds (genuinely cross-component).** Examples to keep:

- Token storage (cookie vs header) — cross-component contract backend↔frontend.
- Canonical set of environment variable keys — cross-component (schema + compose + runtime).
- Auth strategy (stateless vs stateful) — no single skill resolves.
- Upload protocol (tus vs multipart vs presigned) — cross-component + multiple viable options genuinely dominate each other.

Edge case — **skill silence**: if (d) holds in principle (the skill is in scope for the subproject) but the skill does not document the specific item, fall back to (a) alone. Cross-component → strategic, keep. Single-component → implementation-by-default; drop.

A TD that fails this test is extrapolation. Drop it — the implementer will resolve it with the skill + code context.

## How to identify technical decisions

Read each element of the defined scope — phase capabilities from `docs/project-plan.md` in phase mode, or the problem/question described by the user in ad-hoc mode — and ask: "is there more than one reasonable way to implement this with the project's stack?" If yes, it is a technical decision.

Technical decisions appear in recurring categories:

- **Strategy:** how to approach the problem (e.g., stateless vs stateful auth)
- **Lib/Service:** which tool to use (e.g., Passport.js vs manual implementation)
- **Pattern:** which pattern to follow (e.g., refresh token rotation vs blacklist)
- **Storage:** where and how to persist data (e.g., token in cookie vs localStorage)
- **Limits and policies:** values and technical business rules (e.g., token expiration, rate limit, max size)

Ignore decisions already made in project-plan.md or in previous phases. Also ignore trivial decisions that have an obvious answer in the context of the stack.

The categories above are a **thinking framework** — they help you ask "what kind of decision is this?". The lists below are **domain checklists** — they help you ask "where do decisions typically appear in this kind of work?". Use both lenses: the framework to classify, the checklists to not miss areas.

### Capability gate (phase mode and ad-hoc-linked-to-phase)

The checklists are a scanning aid, not a to-do list. A TD only belongs in the document if it traces back to at least one literal capability bullet of a target phase in `docs/project-plan.md`. The gate applies whenever the document is tied to a phase — i.e., in **phase mode**, and also in **ad-hoc mode when `related_phases` is non-empty** (the ad-hoc research explicitly constrains one or more phases).

**Slice-narrowed gate (when `covers_capabilities` is set):** under the slicing model, a phase-scope doc owns a SUBSET of its phase's bullets. If this doc's frontmatter declares `covers_capabilities`, the gate narrows accordingly:

- If `covers_capabilities` is populated → the TD's `**Capability:**` field MUST cite a bullet ∈ this slice's `covers_capabilities` (NOT any bullet of the phase). TDs whose capability belongs to a sibling slice's ownership cannot be accepted here.
- If `covers_capabilities` is omitted (monolithic phase) → the gate applies unchanged: any bullet of the target phase is valid.
- `Transversal — covers: ...` is still allowed but every listed bullet must belong to this slice when `covers_capabilities` is set.
- Rationale: prevents TDs from leaking across slices. A TD whose capability belongs to auth-backend's ownership cannot be accepted in a `/research auth-frontend` run.

Before including any TD:

1. Identify which phase capability (from which related phase) makes this decision necessary. If the doc declares `covers_capabilities`, the bullet must belong to that set.
2. If you cannot point to a specific capability (or the bullet is outside the slice's `covers_capabilities`), **drop the TD** — it belongs to a future phase, a sibling slice, or a truly global ad-hoc research (`related_phases: []`) if the user asks for it directly.
3. Record the mapping in each TD's `Capability:` field (see Output structure).

A TD that only exists because it appears in the checklist — with no capability to justify it — is extrapolation. Drop it.

The aggregate coverage table (every phase bullet → some TD) is **not** written in this document. It is assembled downstream by `plan-context` from all decision documents tied to the phase; completeness gating (each capability has at least one covering TD) is then enforced by `plan-validate`, which emits `MD-N` issues for uncovered capabilities. Your job here is per-TD traceability; the aggregate view is the pipeline's job.

### Backend-specific categories

When the scope includes back-end work, look for decisions in these areas:

- **Persistence & data access:** ORM patterns (Active Record vs Data Mapper), query strategy (builder vs raw SQL), transaction boundaries, migration approach.
- **Authentication & sessions:** stateless vs stateful, password hashing algorithm, token rotation strategy, session storage.
- **Authorization:** RBAC vs ABAC vs attribute-based; guards vs middleware vs decorators; per-resource vs per-role checks.
- **Validation & DTOs:** validation lib (class-validator, Zod, Joi); DTO pattern; whether to share schemas with the front-end.
- **Background jobs & workers:** queue lib (BullMQ, Bee, custom); retry strategy; idempotency; job scheduling vs event-driven.
- **File storage & uploads:** upload protocol (multipart vs streaming vs chunked vs tus); storage backend (S3, MinIO, local); signed URL strategy.
- **Rate limiting & abuse prevention:** algorithm (sliding window, token bucket); storage (in-memory, Redis, DB); scope (per-IP, per-user, per-endpoint).
- **Email & notifications:** transactional email service; template engine; delivery guarantees and retry.
- **Observability:** logging library; structured logs format; metrics and tracing; correlation IDs.
- **Testing strategy:** unit scope boundaries; integration test DB strategy (Testcontainers vs shared DB vs transactional rollback); e2e tooling (e.g., Supertest, Pactum, REST Assured, pytest+httpx — chosen per backend stack); factory vs fixture for test data; test data lifecycle between specs.

### Frontend-specific categories

When the scope includes front-end work, look for decisions in these areas:

- **Rendering strategy:** React Server Components vs Client Components vs hybrid; Server Actions vs Route Handlers for mutations; when to opt into `"use client"`.
- **Data fetching:** native `fetch` + Next cache vs React Query vs SWR; where to place Suspense boundaries; streaming vs full SSR.
- **State management:** server state vs client state; local component state vs global store (Zustand / Jotai / Redux); URL state (`searchParams`) vs in-memory state.
- **Forms & validation:** React Hook Form vs Conform vs native forms + Server Actions; Zod vs Valibot vs sharing `class-validator` schemas with the backend.
- **Auth boundary:** guard location — middleware vs layout-level vs per-page check; how the client knows it is authenticated. (Token transport/storage is a Cross-layer decision — do not duplicate it here.)
- **Routing patterns:** parallel routes, intercepting routes, route groups, dynamic segments — when each is the right tool.
- **Component strategy:** reuse existing design system primitives vs introducing new ones; cross-subproject component sharing.
- **Testing strategy:** unit/component test framework choice; e2e tooling choice; mocking strategy for contract-first dev (MSW vs manual stubs); rendering test scope (testing RSC vs client components); test data lifecycle.

### Cross-layer decisions

A cross-layer decision is one whose implementation directly constrains **both** backend and frontend. Typical examples:

- **Auth token transport:** cookie httpOnly vs `Authorization` header — changes response handling on the backend and client code on the frontend.
- **Error response shape:** backend returns it, frontend consumes it. One decision, two sides.
- **Pagination strategy:** cursor vs offset vs page — backend query shape and frontend UI behavior are coupled.
- **File upload protocol:** multipart vs tus vs presigned URLs — the handshake sequence lives on both sides.
- **Real-time updates:** SSE vs WebSocket vs polling — backend transport and frontend subscription differ completely per choice.

When you identify a cross-layer decision, mark it `Scope: Cross-layer` in the output and make the **Options** section describe impact on both sides explicitly. The **Recommendation** must justify the choice considering both subprojects' stacks and constraints. **Do not split one cross-layer decision into two per-layer TDs** — that produces contradictory choices and defeats the purpose of having a single contract between back and front.

### Repo-wide / Infra & Tooling categories

Some decisions are not about runtime code in a single subproject — they shape the repository, the development environment, or the pipelines used across subprojects. When the scope includes work of this kind, look for decisions in these areas:

- **Monorepo tooling:** workspace manager (npm/pnpm/yarn workspaces, Turborepo, Nx); whether to introduce `packages/*` for shared code.
- **Container & compose structure:** location of `compose.yaml`; split vs unified compose; use of `profiles` and `include`; image build strategy (multi-stage, cache mounts).
- **CI/CD:** pipeline platform (GitHub Actions, GitLab CI); which stages run per subproject; matrix strategy; cache and artifact strategy.
- **Linting & formatting:** shared config vs per-subproject; tool choice (ESLint, Biome, Prettier); pre-commit / pre-push hooks (husky, lefthook).
- **Shared TS config:** root `tsconfig.base.json` with project references vs per-subproject standalone configs.
- **Environment management:** `.env` layout (root vs per-subproject); secret handling in dev; schema validation location.
- **Commit & branching conventions:** Conventional Commits vs custom; commit lint; branch protection rules; commit hook automation.

Mark these decisions `Scope: Repo-wide`. Do not use `Repo-wide` for runtime concerns that happen to touch both subprojects — those are `Cross-layer` (they describe a contract at runtime, not a shared tool at build/dev time).

### Inherited decisions (both modes)

Regardless of mode, do not reopen decisions already captured in `docs/decisions/`. In phase mode, this includes decisions inherited from prior phases — if phase 02 picked React Query, phase 03 inherits it. In ad-hoc mode, check which prior decisions constrain the topic area.

## How to research options

For each identified decision:

1. **Check installed versions before evaluating options.** Identify which subproject in the monorepo is in scope (from the TD's `Scope:` field) and read its **dependency manifest** + lockfile to see the versions actually installed — the manifest pair varies by stack (e.g., `package.json` + `package-lock.json` for Node, `pyproject.toml` + `poetry.lock` for Python, `go.mod` + `go.sum` for Go, `Cargo.toml` + `Cargo.lock` for Rust, `pom.xml` for Maven, `build.gradle{.kts}` for Gradle). This constrains which documentation versions to fetch via Context7 and which alternatives are truly compatible with the existing stack. Mapping by Scope:
   - `Scope: Backend` → backend subproject's manifest.
   - `Scope: Frontend` → frontend subproject's manifest.
   - `Scope: Cross-layer` → **both** subprojects' manifests; the chosen option must be compatible with both stacks simultaneously (typical case: a validation schema shared backend ↔ frontend, possibly across different language stacks).
   - `Scope: Repo-wide` → the root-level manifest (if present) plus every affected subproject's manifest; use Context7 for tooling docs (workspace/monorepo runners, lint/format tooling, git hooks, container orchestration, etc.). Validate compatibility against every subproject currently in the repo.
2. **Research within stack context.** For each option being evaluated, use Context7 MCP to fetch documentation for the versions compatible with your project's installed dependencies. This gives accurate API details, version compatibility, and known limitations — better than relying on training data or latest versions.
3. **Search for up-to-date information on alternatives.** Use web search and Context7 to look up current documentation for competing libs, frameworks, and patterns. Versions change, libs get deprecated, new options emerge.
4. **Prioritize primary sources.** Official documentation, RFCs, lib repositories. Avoid generic blog posts as a primary source.
5. **Be honest about trade-offs.** Don't force a recommendation. If two options are equivalent in the context of your stack and constraints, say so.

## Coverage check — run before writing the document

After identifying all TDs and before emitting the document, run a **subproject coverage** check. This is a gate, not a suggestion.

For each subproject listed in Scope detection, enumerate which TDs cover it. If any subproject in scope has **zero TDs**, either:

- Add an explicit written justification in the `_Subprojects in scope:_` note right under the title (e.g., "Frontend in this phase is pure composition of UI primitives already decided in prior phases — no open technical choice"), **or**
- Go back to the identification step and re-scan the relevant capabilities focused on that subproject's checklist. Silence by omission is a failure mode — not an answer.

Only after the subproject pass is satisfied, emit the document.

**Capability coverage is NOT gated here.** The aggregate "every phase bullet → some TD" table is assembled by `plan-context` from all documents tied to the phase (this doc + any other `phase`-scope doc + any ad-hoc with the phase in `related_phases`). Gating — whether every capability actually has a covering TD — is then enforced by `plan-validate`, which emits `MD-N` issues for uncovered capabilities. A single document cannot decide capability coverage alone.

## Output structure

```markdown
---
scope_type: phase                                    # phase | ad-hoc
related_phases: [NN]                                 # array of ints; [] for None
status: pending                                      # pending | decided
date: YYYY-MM-DD
scope_description: "[One-line description of what this research covers]"
---

# Technical Decisions — [Descriptive Title]

_Subprojects in scope:_

- `<subproject-A>/` — {one-line note on this subproject's role in the document, or an explicit "no open decision" justification, e.g., "already initialized; receives config/migrations/seeds"}
- `<subproject-B>/` — {one-line note, or explicit justification such as "Frontend deferred to Fase 02+ — no TD in this document"}

(Substitute `<subproject-X>` with the actual subproject directory names — resolved per the same hierarchy used elsewhere in this skill: read project layout → cross-reference `docs/project-plan.md` § Subprojects → ask user via `AskUserQuestion` if ambiguous.)

---

## TD-01: [Decision name]

**Scope:** Backend | Frontend | Cross-layer | Repo-wide

Emit exactly **one** of the two lines below — pick based on the document's `related_phases` frontmatter:

- When `related_phases` is **non-empty** (phase mode, or ad-hoc linked to one or more phases):

  **Capability:** [literal capability bullet from project-plan.md, citing the bullet(s) from all listed `related_phases`. When a TD genuinely applies to multiple capabilities of the phase (cross-cutting conventions, repo-wide tooling that supports the whole phase), use `Transversal — covers: <list the specific capability bullets>`. `Transversal` is not a way to opt out of the capability gate: it still requires explicit mapping to the capabilities it supports.]

- When `related_phases: []` (purely global ad-hoc):

  **Trigger:** [one-sentence description of the user's question or the problem driving this TD.]

**Context:** Why this decision needs to be made. Which scope element depends on it. For `Cross-layer` decisions, briefly note why both subprojects are affected.

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

**Decision:** _[pending]_

**Renders in:** ui-contracts | frontend-runtime _(optional; omit unless this TD is FE-runtime architectural-transversal)_

---

(repeat for each decision)

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend / Frontend / Cross-layer / Repo-wide | [Name] | [Recommended option] | _[pending]_ |
| TD-02 | Backend / Frontend / Cross-layer / Repo-wide | [Name] | [Recommended option] | _[pending]_ |
```

**Constraints on the emitted output (producer rules, not literal output):**

- Under the `_Subprojects in scope:_` bullets, each subproject MUST appear either with at least one TD below that covers it, or with an explicit "no open decision" justification in its bullet. This is enforced by the Coverage check before emission.

## Renders in marker (optional — FE-runtime architectural-transversal opt-in)

Frontend TDs whose decision is **architectural-transversal** (one decision affects multiple screens / global pattern, not per-screen) opt into a dedicated Tech Specs subsection by adding a `**Renders in:** frontend-runtime` line to the TD body. The line is **optional** — most TDs omit it and inherit a default by inference.

**Position in the TD body:** between `**Decision:**` and the closing `---` separator. When `/plan-resolve` later adds `**Libraries:**`, it goes AFTER `**Renders in:**`, preserving the canonical source ordering `Recommendation → Decision → Renders in → Libraries → Revisions → ---`.

**Defaults (when the field is omitted):**

- `ui-contracts` — when the receiving phase has `ui_in_scope: true` (TDs render per-screen in `### UI Contracts`).
- `frontend-runtime` — when the receiving phase has `ui_in_scope: logic-only` (no UI surface; TDs render in `### Frontend Runtime`).

**When to set explicitly:** the TD is FE-runtime architectural transversal — examples: TanStack Query global setup, React Compiler adoption, universal Suspense boundary pattern, global Next.js cache strategy. The marker forces rendering in `### Frontend Runtime` regardless of `ui_in_scope`. **Cross-layer TDs** with `Renders in: frontend-runtime` render in BOTH `### API Contracts` (Cross-layer rule) AND `### Frontend Runtime` (marker) — same TD, two subsections, each serving a different SI. **Repo-wide TDs** never render in any runtime subsection (Scope filter precedence) and the marker is irrelevant.

**Revision via `/decide`:** the marker is part of the TD's metadata block, NOT a Revision. Toggling the marker post-decision (e.g., realizing a TD should be `frontend-runtime` after the fact) is a re-classification, not a parameter drift — the canonical path is manual edit + `/plan-context <scope>` + `/plan-build <scope> --rebuild` (Phase C delta detection does NOT detect marker changes; `--rebuild` forces fresh Phase A so A2 filter re-classifies the TD).

## Revisions block (history primitive — NOT emitted by /research)

After a TD has been **decided** (not pending), parameter-level changes that do not flip the chosen Option letter are recorded as a `**Revisions:**` block appended to the TD. This is part of the event-log model for decision history (Revision = same Option, parameter/prose changes; Supersede = different Option, marker in old TD pointing to a new TD elsewhere).

**Position in the TD:** between `**Libraries:**` and the `---` separator that closes the TD. When the block is the first revision, it is added below `**Decision:**` and `**Libraries:**` (in this order). The block is **append-only** — entries are never edited or deleted; new revisions are added as additional bullets.

**Format:**

```markdown
**Revisions:**
- YYYY-MM-DD — <one-liner describing what changed>. Rationale: <why the change was needed>.
- YYYY-MM-DD — <next change one-liner>. Rationale: <next motivation>.
```

Multi-line entries are permitted when the rationale needs elaboration; subsequent lines must be indented with two spaces to remain inside the bullet:

```markdown
**Revisions:**
- 2026-04-27 — Spec file path resolved to `<backend-subproject>/openapi.json`. Rationale: producing
  subproject owns its generated artifact; `docs/` is reserved for human-authored documentation.
  Affects 5 consumer files; see commit `<sha>`.
```

**Authorship:**

- `/research` produces TDs **without** this block on first emission. The block is created and appended **only** by:
  - `/decide` (the front-door skill) when the user chooses the Revision branch on an existing decided TD.
  - `/plan-resolve` when its Pass-2 action classification infers `append revision` (same letter chosen for an already-decided TD whose IC-N indicates parameter/prose drift).
  - Manual editor edits (the format is human-friendly and stable; users may add entries directly when the change is minor and well understood).

**Discriminator with Supersede (the other primitive):**

- **Revision** — `**Decision:**` field's Option letter stays the same. Use this block.
- **Supersede** — `**Decision:**` field's Option letter changes (or the TD is replaced by a different TD entirely). The supersede marker (`<!-- status: superseded-by: {slug}/TD-NN -->`) goes on the line immediately after `### TD-YY:` heading, NOT in this block.

The two primitives are mutually exclusive per change event: a single change is either a Revision or a Supersede, never both.

**Reader behavior:**

- `decisions-reader` agent surfaces the **most recent** revision entry as a one-line annotation under the TD's row in its tabular output.
- `decisions-detail-reader` agent emits the **full** block (all entries, chronological order) after `**Recommendation:**` prose, the optional `**Renders in:**` marker, and `**Libraries:**` line in its per-TD output. Order: `Recommendation → Renders in → Libraries → Revisions` (Renders in omitted from output when absent in source).
- `decisions-correlator` does NOT read the block (it operates on frontmatter only).

## How to write recommendations

The recommendation is a suggestion, not a decision. It must:

- Be justified by the project context, not by generic preference.
- Consider what was already decided in previous phases.
- Be explicit about what is gained and what is lost.
- Admit when there is no significant difference between options.

Back-end example:

Bad recommendations: "JWT is more modern." "Everyone uses bcrypt."
Good recommendations: "JWT + refresh in DB enables rotation (RFC 9700) without adding Redis as an auth dependency, since PostgreSQL is already in the stack."

Front-end examples, same pattern:

Bad: "React Query is more popular than SWR."
Good: "React Query aligns with Next.js 16's `revalidateTag` cache invalidation, reusing the App Router fetch cache instead of duplicating a client cache layer; SWR has no equivalent integration with Next 16's cache tags in the installed version."

Bad: "Use Zustand because it is simpler."
Good: "Zustand is sufficient because the identified client state is limited to transient UI flags (upload modal open, toast queue) — a global store is overkill; React's built-in `useState` + `useContext` covers it without adding a dependency to a Next 16 + React 19 project that already favors server state."

## Rules

- Present between 2 and 4 options per decision. Less than 2 is not a decision. More than 4 is noise.
- Do not include options that are clearly inadequate for the project's stack or scope.
- Do not make decisions for the user. Recommend, but leave the "Decision" field for them to fill.
- Do not go into implementation details. Apply the (d)+(a) test described in `## What counts as a Technical Decision (and what doesn't)`: drop any TD candidate that a best-practices skill resolves AND that is not cited cross-component. Those items are `implement`'s job, resolved at SI execution time via skills + neighboring code.
- If a decision depends on another (e.g., token storage choice depends on auth strategy), indicate the dependency.
- Keep each option concise. If the explanation of an option exceeds 5-6 lines, it's too detailed for this document.
- When the scope spans multiple subprojects (e.g., backend + frontend), a single decisions document covers all of them. Do not produce one file per subproject.
- Cross-layer decisions must be marked `Scope: Cross-layer` and decided once. Splitting one cross-layer concern into two layer-specific TDs is a validation error — it produces contradictory choices and breaks the contract-first guarantee between back and front.
- `Scope: Repo-wide` covers decisions whose effect is the repository, the dev environment, or the pipelines shared across subprojects (monorepo tooling, compose structure, CI/CD, lint/format/git hooks, shared TS config). Do not use it for runtime code concerns — those belong in `Backend`, `Frontend`, or `Cross-layer`.
- Frontmatter is the sole carrier of classification metadata. `scope_type` must be `phase` or `ad-hoc`. `related_phases` is an array of integers — use `[]` for "None". Cardinality: `scope_type: phase` requires exactly one entry in `related_phases`; `scope_type: ad-hoc` accepts zero or more. A `phase`-scoped document tied to zero or multiple phases is a convention error.
- **Multiple `scope_type: phase` docs per phase number ARE allowed (slicing model).** Each slice must have a distinct slug and exactly one integer in `related_phases`. Coverage gaps across slices are detected downstream by `plan-validate` (advisory, via `MC-cross-N`) and `plan-build` (hard gate on the last slice). To add complementary per-topic research that is NOT a slice, use `scope_type: ad-hoc` with the phase number in `related_phases`. See the **Phase slicing frontmatter** rules below for `covers_capabilities` and `depends_on_slices`.
- **Phase slicing frontmatter (optional fields on `scope_type: phase` docs):**
  - `covers_capabilities: [<bullet verbatim from project-plan.md>, ...]` — declares which phase capability bullets this slice owns. Omitted = "this slice covers all capabilities of its phase" (monolithic semantics preserved).
  - `depends_on_slices: [<sibling-slug>, ...]` — declares cross-slice DAG dependencies on sibling slice slugs of the same phase. Omitted or `[]` = no sibling dependency. Downstream maturity gate: a listed sibling must have all TDs `decided` OR a plan-build artifact present on disk before this slice can consume it as inheritance.
- Whenever `related_phases` is non-empty (phase mode or ad-hoc-linked-to-phase), every TD must carry a `Capability:` field citing the literal bullet(s) from `docs/project-plan.md` of the listed phase(s). For TDs that genuinely support multiple capabilities (cross-cutting conventions, repo-wide tooling that enables the whole phase), use `Transversal — covers: <list the specific bullets>`. `Transversal` is not an opt-out from the capability gate — the listed bullets are still required. A TD with no traceable capability is extrapolation — drop it.
- Aggregate capability coverage (every phase bullet → some TD) is **not** written in this document. `plan-context` builds it by aggregating all documents where the phase appears in `related_phases`. Individual documents only need per-TD `Capability:` fields.
- In ad-hoc mode with `related_phases: []` (purely global), TDs use `Trigger:` instead of `Capability:`. Organize the document around the user's question, not around phase capabilities.
- External references to a TD use the form `{slug}/TD-NN`, where `{slug}` is the descriptive-slug portion of the filename (after `technical-decisions-`) and `NN` is the TD's local number. Within a single document, keep the local `TD-NN` numbering — the `{slug}/` prefix is added only in references written in other documents or in pipeline artifacts.
- **Superseded TDs** are marked by `plan-resolve` with an HTML comment `<!-- status: superseded-by: {slug}/TD-NN -->` placed immediately after the TD heading. Do not write this marker manually during research — it is owned by the resolve stage and injected when a later decision replaces an earlier one. Downstream readers (the `decisions-reader` subagent used by `plan-context` and `plan-validate`) surface the marker in their output so consumers can exclude superseded TDs from active enumeration while still auditing history.
- **`**Scope:**` field is required** — downstream `/plan-build` filters Technical Specifications subsections by this field (Backend / Frontend / Cross-layer / Repo-wide). Never omit it in new TDs. `plan-validate` IC-N check also depends on this field to detect orphan Frontend TDs in backend-only phases (Check 1 / Scope-Subsection orphan in `plan-validate/SKILL.md`).
- **Shared-types TD naming convention (per Decisão #29 detection heuristic).** When creating a TD that covers FE↔BE contract sync strategy (shared types, codegen, OpenAPI, schema sharing, gRPC/protobuf, manual-transcription-accepted, etc.), include at least one keyword from the detection list in the TD heading (`## TD-NN: [Decision name]`) OR the first 500 chars of `**Recommendation:**` prose: `contract | shape | schema | sync | shared types | codegen | type generation | DTO | OpenAPI | protobuf | swagger | grpc | interface-sharing`. Keywords are case-insensitive. Without a keyword match, `plan-validate`'s MD-N shared-types sub-type will **fail to detect the TD as covering the concern** → false MD-N fires on subsequent phases → user is prompted to create another TD redundantly. This is not a semantic judgment (keywords don't mandate content) — it's a **naming convention** that keeps the pipeline's heuristic aligned with the researcher's intent. Scope of the TD should be `Cross-layer` or `Repo-wide` (the two Scopes the heuristic filters by).

## Output

Save to: `docs/decisions/technical-decisions-[descriptive-slug].md`

The slug is a short, descriptive kebab-case name derived from the research topic. No phase number or sequence counter in the filename.

**Examples:**
- Phase research: `docs/decisions/technical-decisions-auth.md`
- Phase research: `docs/decisions/technical-decisions-upload-processing.md`
- Ad-hoc research: `docs/decisions/technical-decisions-parallel-db-testing.md`
- Ad-hoc research: `docs/decisions/technical-decisions-refresh-token-rotation.md`

**Slug collision:** handling depends on whether the collision is with a sibling slice of the same phase or with any other doc:

- **Collision with a phase-scope doc of the same NN** (slicing case — the existing doc has `scope_type: phase` and `related_phases: [NN]` matching the target phase) → do NOT auto-suffix. Use `AskUserQuestion` with two options: (a) edit the existing slice (open it and add TDs there); (b) create a new slice with a distinct slug provided by the user. This preserves the slicing model's explicitness — a new slice is a conscious choice, not an accidental suffix.
- **Collision with any other doc** (ad-hoc, or phase-scope of a different NN) → keep the current auto-suffix behavior (e.g., `technical-decisions-auth-session-storage.md`). Do not overwrite existing decisions documents. This preserves UX for non-slicing users.

After the user fills in the decisions, this document serves as input for `plan-context`, or stands alone as a reference.

## Closing instructions (what to tell the user after the doc is written)

When this skill finishes generating the decisions doc, the next-step instruction emitted to the user MUST follow these rules — regardless of what other skills' templates appear in the session context:

- **Recommend `/plan-context <slug>` (NEVER `/plan-resolve`) as the first command.** The pipeline order is `plan-context → plan-validate → plan-resolve`; each stage requires the artifact produced by the previous one (`plan-resolve` aborts with "validation.md not found" if invoked directly; `plan-validate` aborts without `context.md`). Skipping ahead to `/plan-resolve` is always wrong.
- **The `<slug>` is the slug of the freshly-written doc**, not the slug of any prior/superseded doc, not a phase number, not a task slug from another scope. For phase-scope docs (`scope_type: phase`), the equivalent is the phase number `NN` shortcut. For ad-hoc docs with `related_phases: [NN, ...]`, either the doc's slug or any of the listed phase numbers works (both resolve to the same scope downstream).
- **Orphan ad-hoc docs (`related_phases: []`) ARE supported by the pipeline.** Per `plan-context/SKILL.md`'s task-mode handling of `scope_type: ad-hoc`, passing the doc's slug as the argument bootstraps `docs/tasks/task-{slug}/` automatically. The user does NOT need to manually create the task dir, and does NOT need to fall back to manual editing of `**Decision:** _[pending]_` fields. The pipeline handles orphan ad-hoc the same as any other ad-hoc doc.
- **Supersede marker injection is owned by `/plan-resolve`** (per `plan-resolve/SKILL.md` line 43, which authorizes cross-doc edits). Do NOT instruct the user to edit the superseded TD's marker manually. When the new doc's heading or Notes section explicitly cites `"supersedes <slug>/TD-NN"`, `/plan-resolve` reads that signal during its AskUserQuestion processing of the pending TD and injects the marker on the old TD automatically — even when the old doc is in a different decisions file or a different scope.
- **Session-context contamination warning.** Earlier turns in the same session may include `/decide` Supersede branch text or other templates that recommend running `/plan-resolve <scope>` directly post-research. Those instructions are bugs being phased out; do NOT echo them. Always emit the canonical `plan-context → plan-validate → plan-resolve` chain above.