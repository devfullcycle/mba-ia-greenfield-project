# AGENTS.md

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

## Codex compatibility

This repository uses `AGENTS.md`, `.agents/skills/`, and project configuration in `.codex/`. Read the applicable subproject `AGENTS.md` before working in that subproject, including when starting from the repository root.

### Scoped rules

Before reviewing or changing a file, read each matching rule below. Patterns are relative to the repository root; `**` matches zero or more directories. The rule files preserve their original `paths` metadata as scope documentation; Codex does not automatically load that metadata. Apply all matching rules.

| Paths | Rule |
| --- | --- |
| `nestjs-project/src/auth/**` | [.agents/rules/auth-jwt.md](.agents/rules/auth-jwt.md) |
| `nestjs-project/src/**/*.ts` | [.agents/rules/nestjs-common-conventions.md](.agents/rules/nestjs-common-conventions.md) |
| `nestjs-project/**/*.controller.ts` | [.agents/rules/nestjs-controllers.md](.agents/rules/nestjs-controllers.md) |
| `nestjs-project/**/*.dto.ts` | [.agents/rules/nestjs-dtos.md](.agents/rules/nestjs-dtos.md) |
| `nestjs-project/**/*.entity.ts` | [.agents/rules/nestjs-entities.md](.agents/rules/nestjs-entities.md) |
| `nestjs-project/**/*.controller.ts`, `nestjs-project/**/*.guard.ts`, `nestjs-project/**/*.interceptor.ts`, `nestjs-project/**/*.pipe.ts`, `nestjs-project/**/*.filter.ts` | [.agents/rules/nestjs-layer-separation.md](.agents/rules/nestjs-layer-separation.md) |
| `nestjs-project/src/**/*.module.ts` | [.agents/rules/nestjs-modules.md](.agents/rules/nestjs-modules.md) |
| `nestjs-project/**/*.service.ts` | [.agents/rules/nestjs-services.md](.agents/rules/nestjs-services.md) |
| `nestjs-project/**/*.spec.ts`, `nestjs-project/**/*.integration-spec.ts`, `nestjs-project/**/*.e2e-spec.ts`, `nestjs-project/test/**` | [.agents/rules/nestjs-testing.md](.agents/rules/nestjs-testing.md) |
| `next-frontend/app/api/**/route.ts`, `next-frontend/lib/api/**/*.ts` | [.agents/rules/next-frontend-bff-api.md](.agents/rules/next-frontend-bff-api.md) |
| `next-frontend/**/*.ts`, `next-frontend/**/*.tsx` | [.agents/rules/next-frontend-code-quality.md](.agents/rules/next-frontend-code-quality.md) |
| `next-frontend/mocks/**`, `next-frontend/**/*.integration.test.ts`, `next-frontend/**/*.integration.test.tsx` | [.agents/rules/next-frontend-msw-mocks.md](.agents/rules/next-frontend-msw-mocks.md) |
| `next-frontend/**/__tests__/**`, `next-frontend/tests/**`, `next-frontend/**/*.test.ts`, `next-frontend/**/*.test.tsx`, `next-frontend/**/*.integration.test.ts`, `next-frontend/**/*.integration.test.tsx`, `next-frontend/**/*.e2e-spec.ts` | [.agents/rules/next-frontend-testing.md](.agents/rules/next-frontend-testing.md) |
| `next-frontend/components/**/*.tsx`, `next-frontend/app/**/*.tsx`, `next-frontend/app/**/*.css` | [.agents/rules/next-frontend-ui.md](.agents/rules/next-frontend-ui.md) |
| `nestjs-project/**/migrations/**`, `nestjs-project/**/*data-source.ts` | [.agents/rules/typeorm-migrations.md](.agents/rules/typeorm-migrations.md) |
| `nestjs-project/src/**/*.service.ts`, `nestjs-project/src/**/*.repository.ts` | [.agents/rules/typeorm-queries.md](.agents/rules/typeorm-queries.md) |
| `nestjs-project/src/**/*.ts`, `nestjs-project/test/**/*.ts` | [.agents/rules/typescript-strict.md](.agents/rules/typescript-strict.md) |

### Workflow and tool compatibility

The preserved workflow documents use Claude tool labels. Interpret them as operations, using the tools available in the current Codex session:

- `Read`, `Grep`, `Glob`, `Bash`, `Write`, and `Edit`: filesystem reads, `rg`/file discovery, the current shell, and file edits. Preserve the documented Docker execution boundaries.
- `/skill-name` and the `Skill` tool: invoke the corresponding `$skill-name` skill, or read `.agents/skills/<skill-name>/SKILL.md` and follow it. Slash commands in these documents are workflow aliases, not built-in Codex commands.
- `AskUserQuestion`: use an available user-input tool or ask in chat, respecting its documented stop/approval conditions.
- `Agent`/`Task` with `subagent_type: <name>`: use the corresponding custom agent under `.codex/agents/`; its source contract is in `.agents/agents/`. `general-purpose` maps to a general Codex agent; `Explore` maps to a read-only exploration agent. If the session cannot select custom agent types, pass the source contract and task explicitly to an available subagent. If delegation is unavailable, execute the same read-only contract sequentially and report that limitation.
- Legacy assertions about Claude context inheritance do not describe Codex. Explicitly provide each delegated task with the applicable `AGENTS.md`, source contract, scope, and input/output requirements regardless of context inheritance. Legacy `tools: Read, Grep, Glob` metadata describes the role's read-only intent; it is not a Codex permission boundary.
- Skills previously marked `disable-model-invocation: true` retain explicit-only invocation through `agents/openai.yaml` with `allow_implicit_invocation: false`. When generating a new skill from an existing template, translate that legacy field to this Codex policy. Legacy `allowed-tools` restrictions describe intended command usage; current session permissions govern execution.
- Figma/plugin labels refer to the available Figma integration; do not assume Claude plugin commands exist in Codex.

`.codex/config.toml` registers the existing project MCP server configuration without changing global settings or permissions. Project trust and a new Codex session may be required before discovering project configuration, skills, and custom agents. `.mcp.json` and `.mcp.json.example` remain interoperability sources. `.codex/legacy/claude-settings.json` preserves the former hook/plugin settings as reference only; Codex does not execute it. Its skill-activation reminder is covered by the existing Agent Skill Usage section above. Plugin installation remains environment-specific.
