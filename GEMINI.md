# GEMINI.md

> **Nota:** Este arquivo é a adaptação do `CLAUDE.md` para uso com o **Antigravity (Gemini CLI/IDE)** como ferramenta de IA.
> O projeto original foi construído com Claude Code. A fundação de IA (skills, sub-agents, rules) está em `.claude/` e serve como referência para o workflow — executado manualmente nesta ferramenta.

---

## Project Overview

StreamTube — a video sharing platform (YouTube-like). Users can upload, manage, and publish videos. Anonymous users can watch freely; social features (comments, subscriptions, likes) require authentication.

More info in the project overview: [docs/project-plan.md](docs/project-plan.md)

## Repository Structure

This is a monorepo with two main areas:

- `nestjs-project/` — Backend API (NestJS 11, TypeScript, Express). Contains modules for users, channels, videos, comments, etc.
- `docs/` — Project documentation, architecture diagrams, and planning.
- `next-frontend/` (Next.js) — not yet initialized for Phase 03

## Architecture (C4 Container Diagram)

See `docs/diagrams/software-arch.mermaid` for the full diagram. Key containers:

- **Frontend** (Next.js) → calls API via REST, streams from Object Storage
- **API** (Nest.js) → business rules, auth, reads/writes DB, uploads to storage, publishes jobs to queue, sends emails
- **Video Worker** (FFmpeg) → consumes jobs from queue, processes videos, updates DB and storage
- **Database** (PostgreSQL) → users, channels, videos, comments, likes
- **Object Storage** (S3/MinIO) → video files and thumbnails
- **Message Queue** (TBD) → video processing job queue
- **Email Service** (SMTP) → account confirmation and password recovery

## Docker Networking

This project runs entirely in Docker containers. When configuring connections between services (database, cache, queue, etc.), **always use the Docker Compose service name** as the host — never `localhost` or `127.0.0.1`.

Inside a container, `localhost` refers to the container itself, not the host machine or other containers. Services communicate through the Docker Compose network using their service names (e.g., `db`, `nestjs-api`).

- **Correct:** `DB_HOST=db` (the Compose service name)
- **Wrong:** `DB_HOST=localhost`

This applies to all environment variables, configuration files, and code that references service hosts.

## Working Principles

- **Single Responsibility:** each module, service, and function should have a clear, focused responsibility. Re-evaluate adherence at every step — when a module starts owning logic or entities that are not its own (e.g., a service creating an entity from another domain), extract it immediately into the proper module instead of deferring to a later corrective task.
- **Type Safety:** Strict TypeScript usage across all layers.
- **Testing:** Strong emphasis on pyramid testing at all levels to ensure reliability and maintainability.
- **Code Quality:** Use ESLint and Prettier for consistent code style. Code reviews should focus on readability, maintainability, and adherence to best practices.
- **Documentation:** Comprehensive docs for architecture, setup, and troubleshooting in `docs/`.

## Definition of Done (Technical)

A change is only considered complete when **all** of the following pass:

1. The relevant test suite passes (unit + integration + e2e affected by the change).
2. The full test suite passes before finishing the task.
3. TypeScript compiles cleanly: `npx tsc --noEmit` exits with code 0. Compilation errors must never be left as debt for future tasks.
4. Lint passes: `npm run lint`.

If any of these fails, the task is not done — fix the underlying issue before declaring completion.

## Git Conventions

- **Main branch:** `main` — never commit directly to it
- Branches: `feature/*`, `bugfix/*`, `hotfix/*`, `docs/*`
- **Commits:** short, descriptive messages focused on the "why" of the change
- **Workflow:** Git Flow conventions. Two long-lived branches:
  - `main` — stable, production-ready code
  - `dev` — integration branch; all feature/bugfix/hotfix branches start from `dev` and merge back into `dev`
  - When `dev` is stable, it is merged into `main`

## Testing Policy

Every change must be tested. During development, run only the tests related to the modified code. Before finishing, always run the full test suite to ensure nothing is broken.

## Scope Limits

- Work on **one feature, fix, or refactoring at a time** — do not mix scopes
- Do not include cosmetic changes (formatting, renaming) alongside functional changes
- If something out of scope comes up during work, note it as a separate task instead of acting on it
- Focus on the defined scope for each task to ensure clarity and maintainability of the codebase.
- If you identify a necessary change that is out of scope, create a new issue or task for it instead of including it in the current work.

## AI Workflow (Antigravity Adaptation)

The original project uses Claude Code with its skill system (`.claude/skills/`). With Antigravity (Gemini), the same workflow is executed manually by reading each SKILL.md and following its instructions.

### Workflow Pipeline (Phase Development)

```
research → plan-context → plan-validate → plan-resolve → plan-phase → implement-phase
```

### Skills Mapping

| Claude Skill | Antigravity Equivalent |
|-------------|------------------------|
| `/research <phase>` | Read `.claude/skills/research/SKILL.md` and execute manually |
| `/plan-phase <phase>` | Read `.claude/skills/plan-phase/SKILL.md` and generate the document |
| `/implement-phase` | Read `.claude/skills/implement-phase/SKILL.md` and execute SI by SI |
| `/decide "..."` | Read `.claude/skills/decide/SKILL.md` and triage decisions |
| `nestjs-best-practices` | Load `.claude/skills/nestjs-best-practices/SKILL.md` as context |
| `typeorm` | Load `.claude/skills/typeorm/SKILL.md` as context |
| `testing-guide-nestjs-project` | Load `.claude/skills/testing-guide-nestjs-project/SKILL.md` |

### Agent Skill Usage

When working on any task (planning, implementing, debugging, refactoring, reviewing, etc.), decompose the request into its underlying subtasks and concerns, then identify which available skills (in `.claude/skills/`) match any of them and load those SKILL.md files as context before proceeding.

## Library Documentation Lookup

Before implementing any feature, you MUST look up the relevant library APIs and official documentation.

Always:

- Check the installed library version in the project manifest (`package.json`)
- Retrieve the corresponding documentation using web search or `search_web` tool
- Cross-reference APIs to avoid deprecated or incompatible patterns
- Follow the official documentation over training data

Skip documentation lookup only for trivial operations such as:

- Variable declarations
- Basic control flow
- Simple CRUD using established project patterns

If a library is involved and there is uncertainty, documentation lookup is mandatory.

---

## Fase 03 — Contexto Atual

**Status:** Em implementação  
**Branch:** `feature/phase-03-upload` (a partir de `dev`)  
**Artefatos:**
- `docs/decisions/technical-decisions-upload-processing.md` — decisões técnicas da fase
- `docs/phases/phase-03-upload/phase-03-upload.md` — plano de implementação
- `docs/phases/phase-03-upload/phase-03-upload.progress.md` — progresso

**Escopo:** Backend apenas (API + Worker + Infraestrutura Docker). Frontend fora do escopo.
