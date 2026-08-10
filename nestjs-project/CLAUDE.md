# CLAUDE.md

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, etc.) — **never** start the NestJS application server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"
```

Then verify each infrastructure service is actually ready to accept connections — not just running:

- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`

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
- `db` — PostgreSQL 17, port `5432`, database `streamtube`, user/password `streamtube` — also backs the `pg-boss` job queue (no separate queue infra service)
- `mailpit` — SMTP capture for local email testing, ports `1025` (SMTP), `8025` (web UI)
- `minio` — S3-compatible object storage for video/thumbnail files, ports `9000` (API), `9001` (console); `minio-init` runs once to create the `streamtube-videos` bucket
- `video-worker` — consumes the `video-processing` pg-boss queue (ffprobe duration + thumbnail capture via `fluent-ffmpeg`), runs `npm run start:worker` against the **compiled** `dist/worker.main.js` — it does **not** hot-reload. After changing worker code, run `docker compose exec nestjs-api npm run build` then `docker compose restart video-worker` to pick up changes.

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

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.

## Videos Module (Phase 03)

### Overview

The videos module provides multipart upload, automated background processing, streaming, and download for video files up to 10 GB without blocking the API during the upload. Three new modules support it:

- `src/videos/` — controller, service, DTOs, entity (`Video`), registered in `AppModule`
- `src/storage/` — S3-compatible object storage wrapper targeting MinIO locally and real S3 in production
- `src/queue/` — pg-boss queue wrapper backed by the same PostgreSQL instance (no separate queue infra)
- `src/worker/` — standalone NestJS bootstrap (`worker.main.ts`) that consumes the `video-processing` pg-boss queue; compiled to `dist/worker.main.js` and run by the `video-worker` Compose service

### Upload flow

1. **Initiate** — `POST /videos` with `{ filename, mimeType, sizeBytes }`. API opens a multipart upload in MinIO and persists the video as `draft` in the DB. Returns `{ id, uploadId, key, status: 'draft' }`. The public `id` is an 11-char nanoid slug (unique-indexed); internal UUID is never exposed.
2. **Part URLs** — `POST /videos/:id/upload-part-urls` with `{ partNumbers: number[] }`. Returns presigned PUT URLs (1 h TTL). Client uploads each part directly to MinIO, collecting the `ETag` response header per part.
3. **Complete** — `POST /videos/:id/complete-upload` with `{ parts: [{ partNumber, eTag }] }`. Within a single DB transaction: completes the multipart upload in MinIO, sets status to `'processing'`, and enqueues a `video-processing` job in pg-boss. Returns `{ id, status: 'processing' }`.

### Processing flow (video-worker)

For each `video-processing` job the worker:
1. Runs `ffprobe` on the original object in MinIO to extract `duration_seconds` and `metadata` (format name, bit rate, per-stream codec/resolution).
2. Captures a thumbnail frame at ~10% of duration via `ffmpeg`, uploads it to MinIO as `videos/{channelId}/{videoId}/thumbnail.jpg`.
3. Updates the DB row to `status: 'ready'` with `duration_seconds`, `metadata`, and `thumbnail_key`.
4. On exhausted retries (dead-letter queue via pg-boss `deadLetter` option), marks the video `status: 'failed'` with `failure_reason`.

### API endpoints (all require `Authorization: Bearer <token>`)

| Method | Path | Status | Description |
|--------|------|--------|-------------|
| `POST` | `/videos` | 201 | Initiate upload — returns `{ id, uploadId, key, status }` |
| `POST` | `/videos/:id/upload-part-urls` | 200 | Presigned PUT URLs per part number |
| `POST` | `/videos/:id/complete-upload` | 200 | Finalize upload, enqueue processing |
| `GET`  | `/videos/:id` | 200 | Video metadata (owner only) |
| `GET`  | `/videos/:id/stream` | 302 | Redirect to presigned inline URL (video must be `ready`) |
| `GET`  | `/videos/:id/download` | 302 | Redirect to presigned attachment URL (video must be `ready`) |
| `POST` | `/videos/:id/reprocess` | 200 | Re-enqueue a `failed` video for processing |

Error codes: `FILE_TOO_LARGE` (400), `VIDEO_NOT_FOUND` (404), `VIDEO_NOT_OWNED` (403), `INVALID_VIDEO_STATUS` (409), `STORAGE_ERROR` (502).

### Storage layout

Bucket: `streamtube-videos`. Key pattern inside the bucket:

- `videos/{channelId}/{videoId}/original.<ext>` — original uploaded file
- `videos/{channelId}/{videoId}/thumbnail.jpg` — generated thumbnail

### Updating the video worker

The worker runs the compiled `dist/worker.main.js` and does **not** hot-reload. After changing worker code:

```bash
docker compose exec nestjs-api npm run build
docker compose restart video-worker
```
