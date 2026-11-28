# CLAUDE.md

## Project Overview

StreamTube — a video sharing platform (YouTube-like). Users can upload, manage, and publish videos. Anonymous users can watch freely; social features (comments, subscriptions, likes) require authentication.

More info in the project overview: [docs/project-plan.md](docs/project-plan.md)

## Repository Structure

This is a monorepo with two main areas:

- `nestjs-project/` — Backend API (NestJS 11, TypeScript, Express). Contains modules for users, channels, videos, comments, etc.
- `docs/` — Project documentation, architecture diagrams, and planning.
- `next-frontend/` (Next.js) — not yet initialized

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

A feature (or fix) is only considered done when **all** of the following are true:

1. **Green test suite:** the relevant tests (unit + integration + e2e affected by the change) pass during development, and the **full test suite passes with zero failures** before finishing.
2. **Clean build:** `npx tsc --noEmit` exits with code 0. Compilation errors must never be left as debt for future tasks.
3. **Clean lint:** `npm run lint` finishes with **no errors and no warnings**.

If any of these fails, the task is not done — fix the underlying issue before declaring completion, and never commit, open a PR, or merge into `dev` with any of them failing. Do not silence failures (skipped tests, `eslint-disable`, `@ts-ignore`) to get green.


## Git Conventions

### Branching (Git Flow)

- **Long-lived branches:**
  - `main` — stable, production-ready code. **Never commit directly to it** and **never create work branches from it**.
  - `dev` — integration branch. Receives all feature/bugfix/docs work via merge.
- **Work branches** must be created **only from `dev`** (update it first: `git checkout dev && git pull`), never from `main`, and merged back into `dev`:
  - `feature/<short-name>` — new features
  - `bugfix/<short-name>` — fixes for issues found in `dev`
  - `hotfix/<short-name>` — urgent fixes
  - `docs/<short-name>` — documentation-only changes
- **Release:** only when `dev` is stable (Definition of Done met, full suite green) is it merged into `main`.
- Never commit directly to `dev` or `main`; always go through a work branch.
- If the current branch is `main` when a task starts, switch to `dev` and branch from there before making any change.

### Commits

- Short, descriptive messages focused on the "why" of the change.
- One logical change per commit; do not mix scopes (see Scope Limits).
- Only commit when the Definition of Done checks above pass.

## Testing Policy

Every change must be tested. During development, run only the tests related to the modified code. Before finishing, always run the full test suite to ensure nothing is broken.

## Scope Limits

- Work on **one feature, fix, or refactoring at a time** — do not mix scopes
- Do not include cosmetic changes (formatting, renaming) alongside functional changes
- If something out of scope comes up during work, note it as a separate task instead of acting on it
- Focus on the defined scope for each task to ensure clarity and maintainability of the codebase.
- If you identify a necessary change that is out of scope, create a new issue or task for it instead of including it in the current work.

## Agent Skill Usage

When working on any task (planning, implementing, debugging, refactoring, 
reviewing, etc.), decompose the request into its underlying subtasks and 
concerns, then identify which available skills match any of them and activate 
those skills.

## Library Documentation Lookup

Before implementing any feature, you MUST use the **context7** MCP tool to look up the relevant library APIs and official documentation.

Always:

- Check the installed library version in the project manifest
- Retrieve the corresponding documentation using context7
- Cross-reference APIs to avoid deprecated or incompatible patterns
- Follow the official documentation over training data

Skip documentation lookup only for trivial operations such as:

- Variable declarations
- Basic control flow
- Simple CRUD using established project patterns

If a library is involved and there is uncertainty, documentation lookup is mandatory.
If the documentation returned does not match the installed version, flag the discrepancy before proceeding.