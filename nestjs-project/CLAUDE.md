# CLAUDE.md

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, etc.) — **never** start the NestJS application server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"
```

Then verify each infrastructure service is actually ready to accept connections — not just running:

- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`
- **Redis:** `docker compose exec redis redis-cli ping` — expect `PONG`
- **MinIO:** `docker compose exec minio curl -f http://localhost:9000/minio/health/live` — expect exit code 0

The `video-worker` service is infrastructure, not the API server — unlike `nestjs-api`, it starts automatically with `docker compose up -d` (see "Videos Module" below for why).

Only start the NestJS dev server (`npm run start:dev`) when the user **explicitly** asks to run the application — never as part of "start the environment".

## Development Environment

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
- `redis` — Redis 7, port `6379` — BullMQ job queue backend
- `minio` — MinIO, ports `9000` (S3 API) / `9001` (console) — S3-compatible object storage for video files and thumbnails
- `mailpit` — SMTP test server, ports `1025` (SMTP) / `8025` (web UI)
- `video-worker` — separate Nest process (no HTTP server) that consumes the video processing queue; starts automatically with `docker compose up -d`

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

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host. Running on the host causes env-var divergence (`DB_HOST` resolves to `localhost` instead of the Compose service), uses a different Node version, and produces results that do not reflect what runs in CI/prod.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build
npm run start:worker                     # Video worker with hot-reload (no HTTP server)
npm run start:worker:prod                # Run compiled worker build

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

During active development, run only the tests related to the file being changed (`npm test -- path/to/file.spec.ts`). Before declaring a task done, run the full suite — see the global `CLAUDE.md` → "Definition of Done (Technical)".

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `test:watch`, and any other persistent process.

## Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives. The suffix is a contract that drives Jest config (`testRegex`, parallelism), CI steps, and reader expectations.

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

Conventions for **how to write** each kind of test (mocking patterns, AAA structure, override strategies for global guards, etc.) live in `.claude/rules/nestjs-testing.md` and load when you edit a test file.

## Jest Configuration

These settings are required in `package.json` (jest config) and `test/jest-e2e.json` for the project's tests to work correctly:

- `setupFiles: ["dotenv/config"]` — without this, `.env` is not loaded inside the Jest process. `DB_HOST`, `JWT_SECRET`, etc. fall back to undefined or to the host's `localhost`, breaking container-to-container DNS.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit (`*.spec.ts`) and integration (`*.integration-spec.ts`) suffixes.

Do not add new test-file suffixes; if a new test type is needed, update the regex deliberately.

## Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted** or rewritten:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax and break parsing
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code (e.g., in `mail.config.ts`) so the file stays shell-safe.

## Build Assets

`tsc` (and therefore `nest build`) only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev). Without that, the file exists in `src/` but is missing in `dist/` and runtime fails only after build.

## Architecture

NestJS with standard module structure. Source lives in `src/`, compiled output in `dist/`.

- Each domain feature gets its own module (e.g., `UsersModule`, `VideosModule`) registered in `AppModule`
- Controllers handle HTTP routing; Services hold business logic; both are scoped to their module

## Videos Module (Upload, Processing, Storage)

The `videos/` module implements chunked upload, async processing, and read/streaming of videos up to 10GB, split across two separate processes:

- **`nestjs-api`** — exposes the HTTP endpoints below and owns the `Video` entity/repository.
- **`video-worker`** — a second, independent Nest process (`src/main-worker.ts`, bootstrapped via `NestFactory.createApplicationContext`, no HTTP server) that consumes the processing queue. It reuses the same `Video` entity/module conventions as the API (see `src/videos/worker.module.ts`) rather than duplicating data-access code.

### Upload flow (never proxies bytes through the API)

1. `POST /videos` — registers a `draft` video and starts a multipart upload directly against the storage (MinIO/S3), returning an `uploadId`. The API never receives the file bytes.
2. `POST /videos/:id/upload-part-url` — returns a presigned URL per part; the client `PUT`s each part directly to storage.
3. `POST /videos/:id/complete-upload` — finalizes the multipart upload, flips the video to `uploaded`, and enqueues a `process-video` job on the `video-processing` BullMQ queue.

### Processing (`video-worker`)

`VideoProcessor` (`src/videos/video.processor.ts`, `@Processor('video-processing')`) consumes the job: downloads the original file, extracts duration via `ffprobe` and a thumbnail via `ffmpeg` (both installed system-wide — `apt-get install ffmpeg`, wrapped by `fluent-ffmpeg`), uploads the thumbnail, and flips the video to `ready`. After exhausting the configured retry attempts, it flips to `failed` with a `failure_reason`. `ffmpeg` is installed in **both** `Dockerfile.worker` (runtime) and `Dockerfile.dev` (so `video.processor.integration-spec.ts` can run inside `nestjs-api`, per this project's convention that all tests run there).

### Video status lifecycle

`draft → uploaded → processing → ready | failed`

### Read authorization (`GET /videos/:id`, `/stream`, `/download`)

These three endpoints are `@Public()` but resolve an **optional** authenticated user (see `OptionalUser` decorator and the `JwtAuthGuard`'s public-route handling below) to apply: a video is visible to anonymous/non-owner requesters only when `status === 'ready'`; the owner can always read/stream/download their own video regardless of status. Non-visible videos return `404 VIDEO_NOT_FOUND` — never `403` — to avoid revealing existence to unauthorized requesters.

`stream`/`download` respond `302` with a `Location` pointing to a presigned storage read URL (`download` adds `response-content-disposition=attachment`); range requests for streaming are handled natively by the storage, not by the API.

### `JwtAuthGuard` optional-auth mode for `@Public()` routes

Because the read endpoints above need to know "is there a valid, authenticated owner?" without *requiring* authentication, `JwtAuthGuard` decodes an `Authorization` header when present even on `@Public()` routes — but never throws `401` on a `@Public()` route if the header is missing or the token is invalid; it just leaves `request.user` unset. Use `@CurrentUser()` when a route requires a user (guaranteed by the guard); use `@OptionalUser()` when a route is public but wants to special-case an authenticated owner.

### Storage and queue

- `StorageService` (`src/videos/storage.service.ts`) wraps `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`; every call goes through this adapter — no controller/service should import the S3 SDK directly.
- Queue: `@nestjs/bullmq` + `bullmq`, connected to the `redis` service. The queue name and job name live in `src/videos/videos.constants.ts` — never hardcode the string literals elsewhere.

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.
