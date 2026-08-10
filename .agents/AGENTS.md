# AGENTS.md — StreamTube (Antigravity)

> This is the Antigravity AI foundation for the StreamTube project.
> It ports the content of `CLAUDE.md` (root) and `nestjs-project/CLAUDE.md` into Antigravity conventions.
> The original `CLAUDE.md` files remain in the repository as project artifacts and deliverables.

## Tool Name Mapping (Claude Code → Antigravity)

Skills migrated from Claude Code may reference tool names that don't exist in Antigravity. Use this mapping:

| Claude Code tool | Antigravity equivalent |
|---|---|
| `Read` / `bounded Read` | `view_file` (with `StartLine`/`EndLine`) |
| `Grep` / `Grep -n` | `grep_search` |
| `Glob` | `list_dir` or `grep_search` |
| `Bash` | `run_command` |
| `AskUserQuestion` | `ask_question` |
| `Agent` (subagent dispatch) | Execute directly in main thread |
| `Skill` tool | `view_file` on the SKILL.md file |
| `Write` / `Edit` | `write_to_file` / `replace_file_content` / `multi_replace_file_content` |

When a skill says "dispatch `decisions-correlator` subagent", read `.agents/skills/agents-as-skills/decisions-correlator/SKILL.md` and apply its instructions directly.

---

## Project Overview

StreamTube — a video sharing platform (YouTube-like). Users can upload, manage, and publish videos. Anonymous users can watch freely; social features (comments, subscriptions, likes) require authentication.

More info in the project overview: [docs/project-plan.md](../docs/project-plan.md)

---

## Repository Structure

This is a monorepo with two main areas:

- `nestjs-project/` — Backend API (NestJS 11, TypeScript, Express). Contains modules for users, channels, videos, comments, etc.
- `docs/` — Project documentation, architecture diagrams, and planning.
- `next-frontend/` — Frontend (Next.js)
- `.agents/` — Antigravity AI foundation (this directory: AGENTS.md, skills/, rules/)
- `.claude/` — Legacy Claude Code AI foundation (kept as project artifact)

---

## Architecture (C4 Container Diagram)

See `docs/diagrams/software-arch.mermaid` for the full diagram. Key containers:

- **Frontend** (Next.js) → calls API via REST, streams from Object Storage
- **API** (Nest.js) → business rules, auth, reads/writes DB, uploads to storage, publishes jobs to queue, sends emails
- **Video Worker** (FFmpeg) → consumes jobs from queue, processes videos, updates DB and storage
- **Database** (PostgreSQL) → users, channels, videos, comments, likes
- **Object Storage** (S3/MinIO) → video files and thumbnails
- **Message Queue** (BullMQ/Redis) → video processing job queue
- **Email Service** (SMTP) → account confirmation and password recovery

---

## Docker Networking

This project runs entirely in Docker containers. When configuring connections between services (database, cache, queue, etc.), **always use the Docker Compose service name** as the host — never `localhost` or `127.0.0.1`.

Inside a container, `localhost` refers to the container itself, not the host machine or other containers. Services communicate through the Docker Compose network using their service names (e.g., `db`, `nestjs-api`).

- **Correct:** `DB_HOST=db` (the Compose service name)
- **Wrong:** `DB_HOST=localhost`

This applies to all environment variables, configuration files, and code that references service hosts.

---

## Working Principles

- **Single Responsibility:** each module, service, and function should have a clear, focused responsibility. Re-evaluate adherence at every step — when a module starts owning logic or entities that are not its own (e.g., a service creating an entity from another domain), extract it immediately into the proper module instead of deferring to a later corrective task.
- **Type Safety:** Strict TypeScript usage across all layers.
- **Testing:** Strong emphasis on pyramid testing at all levels to ensure reliability and maintainability.
- **Code Quality:** Use ESLint and Prettier for consistent code style. Code reviews should focus on readability, maintainability, and adherence to best practices.
- **Documentation:** Comprehensive docs for architecture, setup, and troubleshooting in `docs/`.

---

## Definition of Done (Technical)

A change is only considered complete when **all** of the following pass:

1. The relevant test suite passes (unit + integration + e2e affected by the change).
2. The full test suite passes before finishing the task.
3. TypeScript compiles cleanly: `npx tsc --noEmit` exits with code 0. Compilation errors must never be left as debt for future tasks.
4. Lint passes: `npm run lint`.

If any of these fails, the task is not done — fix the underlying issue before declaring completion.

---

## Git Conventions

- **Main branch:** `main` — never commit directly to it
- Branches: `feature/*`, `bugfix/*`, `hotfix/*`, `docs/*`
- **Commits:** short, descriptive messages focused on the "why" of the change
- **Workflow:** Git Flow conventions. Two long-lived branches:
  - `main` — stable, production-ready code
  - `dev` — integration branch; all feature/bugfix/hotfix branches start from `dev` and merge back into `dev`
  - When `dev` is stable, it is merged into `main`

---

## Testing Policy

Every change must be tested. During development, run only the tests related to the modified code. Before finishing, always run the full test suite to ensure nothing is broken.

---

## Scope Limits

- Work on **one feature, fix, or refactoring at a time** — do not mix scopes
- Do not include cosmetic changes (formatting, renaming) alongside functional changes
- If something out of scope comes up during work, note it as a separate task instead of acting on it
- Focus on the defined scope for each task to ensure clarity and maintainability of the codebase.
- If you identify a necessary change that is out of scope, create a new issue or task for it instead of including it in the current work.

---

## Skill Usage

When working on any task (planning, implementing, debugging, refactoring, reviewing, etc.), decompose the request into its underlying subtasks and concerns, then identify which available skills (in `.agents/skills/`) match any of them and apply those skills.

Available skills (all in `.agents/skills/`):

### Planning Pipeline
- **research** — Research technical options; generate structured decisions documents. Use before planning any phase or ad-hoc topic.
- **plan-pipeline** — Overview and shared conventions for the full planning pipeline.
- **plan-context** — Stage 1: consolidate inputs into `context.md`.
- **plan-validate** — Stage 2: detect inconsistencies; emit `validation.md` (clean|dirty).
- **plan-resolve** — Stage 3: close open issues from validation; write `library-refs.md`.
- **plan-build** — Stage 4: generate executable plan with SIs, Technical Specs, Dependency Map, Deliverables.
- **plan-test-specs** — Stage 5 (optional): generate test spec files from the plan.
- **plan-phase** — Generate a technical implementation plan for a phase.
- **decide** — Front-door for free-text decision needs; triages to Revision/Supersede/Greenfield.
- **plan-rule-author** — Scaffold new validation/build/resolve rules.

### Implementation
- **implement** — Execute a phase or task plan SI by SI, running tests after each step.
- **implement-phase** — Execute a phase implementation plan SI by SI.

### NestJS / Backend
- **nestjs-best-practices** — NestJS architecture patterns. Activate when planning or implementing NestJS features.
- **typeorm** — TypeORM patterns and database guidelines. Activate when working with entities, repositories, migrations.
- **testing-guide-nestjs-project** — Testing guide for nestjs-project. Activate when writing or reviewing nestjs tests.

### Frontend
- **next-best-practices** — Next.js best practices (RSC, data patterns, routing, optimization).
- **vercel-react-best-practices** — React/Next.js performance optimization from Vercel Engineering.
- **testing-guide-next-frontend** — Testing guide for next-frontend.
- **playwright-cli** — Browser automation and Playwright tests.

### Figma / Design
- **screen-inventory** — Generate screen inventory from Figma for a phase or task.
- **figma-audit-tokens** — Audit drift between Figma variables and CSS variables.
- **figma-apply-tokens-tailwind-v4** — Apply Figma audit report to Tailwind v4 CSS.

### Meta
- **generate-test-guide** — Analyze a project's stack and generate a project-specific testing skill.

### Internal Support Skills (`.agents/skills/agents-as-skills/`)
These are not user-invocable — they are used internally by the planning pipeline:
- **decisions-correlator** — Rank-shortlist decisions docs by semantic correlation to a scope.
- **decisions-detail-reader** — Read and return TD body details for a set of decision docs.
- **decisions-reader** — Read and index all TD frontmatter in `docs/decisions/`.
- **inventory-digest-reader** — Read and digest screen inventory documents.
- **phases-reader** — Read and digest prior phase documents for context.
- **plan-reader** — Read and parse phase/task plan documents.

---

## Library Documentation Lookup

Before implementing any feature, use `search_web` or `read_url_content` to look up the relevant library APIs and official documentation.

Always:
- Check the installed library version in the project manifest (`package.json`)
- Retrieve the corresponding documentation (search web or read official docs URL)
- Cross-reference APIs to avoid deprecated or incompatible patterns
- Follow the official documentation over training data

Skip documentation lookup only for trivial operations such as variable declarations, basic control flow, or simple CRUD using established project patterns.

---

## nestjs-project — Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start containers
docker compose up -d

# Install dependencies (first time only)
docker compose exec nestjs-api npm install

# Run the dev server (watch mode)
docker compose exec nestjs-api npm run start:dev
```

Services:
- `nestjs-api` — NestJS API, port `3000`
- `db` — PostgreSQL 17, port `5432`, database `streamtube`, user/password `streamtube`

All verification and teardown commands run on the **host machine**:

```bash
# Verify NestJS is running (expect 200 + "Hello World!")
curl http://localhost:3000

# Verify PostgreSQL is ready (runs inside the db container)
docker compose exec db pg_isready -U streamtube

# Check container logs
docker compose logs nestjs-api
docker compose logs db

# Tear down the entire environment
docker compose down
```

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, etc.) — **never** start the NestJS application server unless explicitly asked.

---

## nestjs-project — Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build

npm test                                 # Unit tests
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (always with --runInBand)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint with auto-fix
npm run format                           # Prettier formatting
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs nestjs-api
docker compose exec db pg_isready -U streamtube
curl http://localhost:3000
```

### Test execution

Integration and e2e suites share a single test database. They **must** be run with `--runInBand`:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e   # already configured
```

Parallel execution causes FK violations, deadlocks, and cross-suite contamination because suites truncate or seed shared tables concurrently.

During active development, run only the tests related to the file being changed. Before declaring a task done, run the full suite.

---

## nestjs-project — Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives.

| Suffix | Purpose | DB / external I/O | Location |
|---|---|---|---|
| `*.spec.ts` | **Unit** — pure logic, all collaborators mocked | Forbidden | Next to the source file |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required | Next to the source file |
| `*.e2e-spec.ts` | **End-to-end** — full HTTP cycle via `supertest` | Required | `nestjs-project/test/` |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

---

## nestjs-project — Jest Configuration

Required in `package.json` (jest config) and `test/jest-e2e.json`:

- `setupFiles: ["dotenv/config"]` — without this, `.env` is not loaded inside the Jest process.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit and integration suffixes.

---

## nestjs-project — Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted**:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code.

---

## nestjs-project — Build Assets

`tsc` only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev).

---

## nestjs-project — Architecture

- Each domain feature gets its own module (e.g., `UsersModule`, `VideosModule`) registered in `AppModule`
- Controllers handle HTTP routing; Services hold business logic; both are scoped to their module

---

## nestjs-project — Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings

---

## nestjs-project — REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure.

---

## nestjs-project — Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `test:watch`, and any other persistent process.

---

## Rules Reference

Additional coding rules live in `.agents/rules/`. Key rules files:

- `nestjs-controllers.md` — REST controller conventions
- `nestjs-services.md` — Service layer patterns
- `nestjs-dtos.md` — DTO and validation conventions
- `nestjs-entities.md` — TypeORM entity conventions
- `nestjs-modules.md` — Module structure conventions
- `nestjs-layer-separation.md` — Layer separation enforcement
- `nestjs-testing.md` — Testing patterns (mocking, AAA, guard overrides)
- `nestjs-common-conventions.md` — General NestJS conventions
- `auth-jwt.md` — JWT auth implementation patterns
- `typeorm-migrations.md` — Migration authoring conventions
- `typeorm-queries.md` — TypeORM query patterns
- `typescript-strict.md` — TypeScript strictness rules
- `next-frontend-bff-api.md` — Next.js BFF/API patterns
- `next-frontend-code-quality.md` — Next.js code quality rules
- `next-frontend-msw-mocks.md` — MSW mocking patterns
- `next-frontend-testing.md` — Next.js testing conventions
- `next-frontend-ui.md` — Next.js UI conventions

---

## next-frontend — Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start container (from next-frontend/)
docker compose up -d

# Install dependencies (first time only)
docker compose exec next-frontend npm install

# Run the dev server (watch mode)
docker compose exec next-frontend npm run dev
```

Service:
- `next-frontend` — Next.js dev container, host port `3001` → container port `3000`. Browser accesses the app at `http://localhost:3001`.

---

## next-frontend — Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and shadcn command runs **inside the container**, never on the host.

### Container-only commands (always prefix with `docker compose exec next-frontend`)

```bash
npm run dev                              # Dev server with hot-reload (run in background)
npm run build                            # Production build (.next/)
npm run start                            # Serve the production build
npm run lint                             # ESLint (eslint-config-next)
npm test                                 # Vitest — unit + integration (run mode)
npm run test:watch                       # Vitest watch mode (run in background)
npx tsc --noEmit                         # Type-check (required before declaring a task done)
npx shadcn@latest add <component>        # Add a shadcn primitive — respects components.json
```

### Host-only commands (Docker / connectivity probes / Playwright E2E)

```bash
docker compose ps
docker compose logs next-frontend
curl -I http://localhost:3001
npx playwright test                      # Run E2E tests (Playwright runs on host)
npx playwright test tests/smoke.e2e-spec.ts
```

---

## next-frontend — E2E Test Prerequisites

Playwright runs on the host and targets the containerized dev server. Before running any `*.e2e-spec.ts`, the dev server must be running inside the container with `MSW_ENABLED=true`:

```bash
# Start dev server with MSW enabled in background
docker compose exec -d next-frontend sh -c "MSW_ENABLED=true npm run dev"

# Wait until the server is ready
curl --retry 15 --retry-delay 2 --retry-connrefused -I http://localhost:3001

# Run the E2E suite on host
npx playwright test
```

- E2E specs **MUST NOT** browser-intercept `/api/**` (e.g., `page.route()`).
- E2E specs **MUST NOT** reach a real NestJS API.

---

## next-frontend — Architecture & BFF Model

- Next.js 16 App Router with React Server Components, TypeScript strict, React 19, Tailwind CSS v4 (CSS-first config via `@theme inline` in `app/globals.css` — there is NO `tailwind.config.js`).
- **Strict BFF model:** the browser never talks to the NestJS API directly. All client traffic flows through same-origin Route Handlers under `app/api/**`, which proxy to the upstream NestJS API server-side.
- OpenAPI contract is the single source of truth for wire shapes: `openapi.json` → `lib/api/types.gen.ts` → `paths` → consumers.

---

## next-frontend — Build Gates

Before declaring any task done in next-frontend:
- `docker compose exec next-frontend npm run lint` exit 0.
- `docker compose exec next-frontend npx tsc --noEmit` exit 0.

