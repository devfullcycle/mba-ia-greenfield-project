# CLAUDE.md

## Project Overview

StreamTube — a video sharing platform (YouTube-like). Users can upload, manage, and publish videos. Anonymous users can watch freely; social features (comments, subscriptions, likes) require authentication.

More info in the project overview: [docs/project-plan.md](docs/project-plan.md)

## Repository Structure

This is a monorepo with three main areas:

- `nestjs-project/` — Backend API and Background Worker (NestJS 11, TypeScript, Express, TypeORM, BullMQ). Contains modules for `auth/`, `users/`, `channels/`, `videos/`, `storage/`, `mail/`, `common/`, `config/`, `database/`, and `swagger/`.
- `next-frontend/` — Frontend application (Next.js 16, App Router, BFF Route Handlers).
- `docs/` — Project documentation, architecture diagrams (`docs/diagrams/`), technical decisions (`docs/decisions/`), and phase artifacts (`docs/phases/`).

## Architecture (C4 Container Diagram)

See `docs/diagrams/software-arch.mermaid` for the full diagram. Key containers:

- **Frontend** (Next.js) → calls API via REST, streams from API / Object Storage
- **API** (`nestjs-api` — NestJS 11) → business rules, auth, reads/writes DB, orchestrates S3 multipart uploads, publishes jobs to BullMQ queue, streams byte ranges, sends emails
- **Video Worker** (`video-worker` — NestJS headless context + FFmpeg/ffprobe) → consumes `process-video` jobs from BullMQ queue, probes video duration/dimensions/codec via `ffprobe`, extracts JPEG frame thumbnail via `ffmpeg`, uploads thumbnail to S3/MinIO, and updates video status in PostgreSQL
- **Database** (`db` — PostgreSQL 17) → `users`, `channels`, `refresh_tokens`, `verification_tokens`, `videos`
- **Object Storage** (`minio` — S3-compatible / MinIO) → bucket `streamtube-videos` storing raw videos (`videos/<videoId>/original.<ext>`) and thumbnails (`thumbnails/<videoId>/thumb.jpg`)
- **Message Queue** (`redis` — Redis 7 + BullMQ) → `video-processing` job queue with exponential backoff retries
- **Email Service** (`mailpit` — SMTP) → account confirmation and password recovery

## Phase 03 — Video Upload, Processing & Streaming (`VideosModule`)

- **Upload up to 10GB (Non-blocking):** Uses S3 Multipart Upload + presigned part URLs (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`). File bytes transfer directly between client and S3/MinIO without passing through the NestJS API process.
- **Automatic Draft Pre-Registration:** `POST /videos/uploads/init` atomically creates a `Video` row with `status = 'draft'` linked to the authenticated user's `Channel`, assigns a conflict-free 11-character Base64URL `slug` (`[A-Za-z0-9_-]{11}`), initiates the S3 multipart upload, and returns presigned part URLs.
- **Background Processing (`video-processing` queue):** `POST /videos/:id/uploads/complete` finalizes the S3 multipart object, transitions the video to `status = 'processing'`, and enqueues a `process-video` job in BullMQ (`attempts: 3`, exponential backoff). `VideoProcessor` (`src/videos/processing/video.processor.ts`) streams the file to scratch storage, runs `ffprobe` for `duration_seconds`, `width`, `height`, and `codec`, runs `ffmpeg` to extract a JPEG thumbnail frame uploaded to `thumbnails/<videoId>/thumb.jpg`, and transitions the video to `ready` (or `failed` with `processing_error` after retry exhaustion).
- **Streaming & Download:**
  - `GET /videos/:slug` — public video metadata, status, and URLs
  - `GET /videos/:slug/stream` — RFC 9110 byte-range streaming (`206 Partial Content`, `Accept-Ranges: bytes`, `Content-Range`) without full file download
  - `GET /videos/:slug/download` — full video download (`Content-Disposition: attachment`)
  - `GET /videos/:slug/thumbnail` — JPEG thumbnail stream

## Docker Networking

This project runs entirely in Docker containers. When configuring connections between services (database, cache, queue, object storage, etc.), **always use the Docker Compose service name** as the host — never `localhost` or `127.0.0.1`.

Inside a container, `localhost` refers to the container itself, not the host machine or other containers. Services communicate through the Docker Compose network using their service names (`db`, `redis`, `minio`, `mailpit`, `nestjs-api`, `video-worker`).

- **Correct:** `DB_HOST=db`, `REDIS_HOST=redis`, `S3_ENDPOINT=http://minio:9000`
- **Wrong:** `DB_HOST=localhost`, `REDIS_HOST=localhost`, `S3_ENDPOINT=http://localhost:9000`

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
