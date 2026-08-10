# GEMINI.md

> **Ferramenta:** Gemini CLI (Antigravity). A fundação completa de IA deste projeto — skills, sub-agents, rules e convenções — vive em `.agents/AGENTS.md`. Este arquivo serve como ponto de entrada rápido; consulte `.agents/AGENTS.md` para o detalhamento completo.

## Project Overview

StreamTube — a video sharing platform (YouTube-like). Users can upload, manage, and publish videos. Anonymous users can watch freely; social features (comments, subscriptions, likes) require authentication.

More info in the project overview: [docs/project-plan.md](docs/project-plan.md)

## Repository Structure

This is a monorepo with two main areas:

- `nestjs-project/` — Backend API (NestJS 11, TypeScript, Express). Contains modules for users, channels, videos, comments, etc.
- `docs/` — Project documentation, architecture diagrams, and planning.
- `next-frontend/` (Next.js) — Frontend application
- `.agents/` — Gemini CLI AI foundation (AGENTS.md, skills/, rules/)

## Architecture (C4 Container Diagram)

See `docs/diagrams/software-arch.mermaid` for the full diagram. Key containers:

- **Frontend** (Next.js) → calls API via REST, streams from Object Storage
- **API** (Nest.js) → business rules, auth, reads/writes DB, uploads to storage, publishes jobs to queue, sends emails
- **Video Worker** (FFmpeg) → consumes jobs from queue, processes videos, updates DB and storage
- **Database** (PostgreSQL) → users, channels, videos, comments, likes
- **Object Storage** (S3/MinIO) → video files and thumbnails
- **Message Queue** (BullMQ/Redis) → video processing job queue
- **Email Service** (SMTP) → account confirmation and password recovery

## Docker Networking

This project runs entirely in Docker containers. When configuring connections between services (database, cache, queue, etc.), **always use the Docker Compose service name** as the host — never `localhost` or `127.0.0.1`.

Inside a container, `localhost` refers to the container itself, not the host machine or other containers. Services communicate through the Docker Compose network using their service names (e.g., `db`, `nestjs-api`).

- **Correct:** `DB_HOST=db` (the Compose service name)
- **Wrong:** `DB_HOST=localhost`

This applies to all environment variables, configuration files, and code that references service hosts.

## Working Principles

- **Single Responsibility:** each module, service, and function should have a clear, focused responsibility. Re-evaluate adherence at every step.
- **Type Safety:** Strict TypeScript usage across all layers.
- **Testing:** Strong emphasis on pyramid testing at all levels to ensure reliability and maintainability.
- **Code Quality:** Use ESLint and Prettier for consistent code style.
- **Documentation:** Comprehensive docs for architecture, setup, and troubleshooting in `docs/`.

## Definition of Done (Technical)

A change is only considered complete when **all** of the following pass:

1. The relevant test suite passes (unit + integration + e2e affected by the change).
2. The full test suite passes before finishing the task.
3. TypeScript compiles cleanly: `npx tsc --noEmit` exits with code 0.
4. Lint passes: `npm run lint`.

If any of these fails, the task is not done — fix the underlying issue before declaring completion.

## Git Conventions

- **Main branch:** `main` — never commit directly to it
- **Integration branch:** `dev` — all feature/bugfix/hotfix branches start from `dev` and merge back into `dev`
- Branches: `feature/*`, `bugfix/*`, `hotfix/*`, `docs/*`
- **Commits:** short, descriptive messages focused on the "why" of the change; prefer atomic commits per SI

## Testing Policy

Every change must be tested. During development, run only the tests related to the modified code. Before finishing, always run the full test suite to ensure nothing is broken.

All tests run **inside the container**:

```bash
docker compose exec nestjs-api npm test -- --runInBand      # unit + integration
docker compose exec nestjs-api npm run test:e2e              # e2e
docker compose exec nestjs-api npx tsc --noEmit              # type-check
docker compose exec nestjs-api npm run lint                  # lint
```

## Scope Limits

- Work on **one feature, fix, or refactoring at a time** — do not mix scopes
- Do not include cosmetic changes (formatting, renaming) alongside functional changes
- If something out of scope comes up during work, note it as a separate task instead of acting on it

## AI Skill Usage

When working on any task, decompose the request into its underlying subtasks and concerns, then identify which available skills (in `.agents/skills/`) match any of them and activate those skills. See `.agents/AGENTS.md` for the full skill catalog.

## Library Documentation Lookup

Before implementing any feature, use `search_web` or `read_url_content` to look up the relevant library APIs and official documentation. Always check the installed library version in `package.json` and cross-reference APIs to avoid deprecated or incompatible patterns.

## Videos Module (Phase 03)

Phase 03 implements the complete video lifecycle: upload, processing, streaming, and download.

### Infrastructure (nestjs-project/compose.yaml)

New services added alongside the existing `nestjs-api`, `db`, and `mailpit`:
- `redis` — Redis 7, port `6379`. BullMQ job queue backing store.
- `minio` — MinIO object storage, ports `9000` (S3 API) and `9001` (console). Stores video files (`videos` bucket) and thumbnails (`thumbnails` bucket).
- `createbuckets` — One-shot MinIO client container that creates `videos` and `thumbnails` buckets on first start.
- `video-worker` — Same Docker image as `nestjs-api` but started with `IS_WORKER=true`. Loads the BullMQ processor that runs FFmpeg.

### Module Location

`nestjs-project/src/videos/` — structure:
- `videos.module.ts` — Registers `Video` entity, `video-processing` BullMQ queue, and conditionally loads `VideoProcessor` (only when `IS_WORKER=true`).
- `videos.service.ts` — Business logic: initiate upload, generate presigned part URLs, complete upload, get video details, find by URL ID.
- `videos.controller.ts` — REST endpoints (see API Contracts below).
- `entities/video.entity.ts` — TypeORM entity with `DRAFT → PROCESSING → READY/FAILED` status lifecycle.
- `services/storage.service.ts` — S3Client wrapper for MinIO (multipart upload, presigned URLs, object streaming, buffer upload).
- `processors/video.processor.ts` — BullMQ WorkerHost consuming `process-video` jobs with FFmpeg.

### API Contracts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/videos/upload/initiate` | JWT | Pre-registers video as DRAFT; initializes S3 multipart upload; returns `videoId`, `uploadId`, `key` |
| `POST` | `/videos/:id/upload/part-url` | JWT (owner) | Returns a presigned URL for a single chunk |
| `POST` | `/videos/:id/upload/complete` | JWT (owner) | Completes multipart upload on MinIO; transitions to PROCESSING; enqueues `process-video` job |
| `GET` | `/videos/:unique_url_id` | Public | Returns video metadata and status |
| `GET` | `/videos/:unique_url_id/stream` | Public | Streams video via HTTP Range Requests (206 Partial Content) |
| `GET` | `/videos/:unique_url_id/download` | Public | Downloads full video file as attachment |

### Upload Strategy

Large files (up to 10GB) bypass the NestJS API entirely:
1. Client calls `POST /videos/upload/initiate` → backend creates DB record (DRAFT) and initialises S3 multipart upload.
2. Client splits file into chunks; calls `POST /videos/:id/upload/part-url` per chunk → backend returns presigned MinIO URL.
3. Client PUTs each chunk directly to MinIO using the presigned URL (no NestJS involvement).
4. Client calls `POST /videos/:id/upload/complete` with all ETags → backend completes multipart assembly on MinIO, transitions status to PROCESSING, and enqueues job.

### Video Processing Worker

`VideoProcessor` (BullMQ `WorkerHost`) handles `process-video` jobs:
1. Downloads video file from MinIO to a temp file.
2. Runs `ffprobe` to extract duration and full format/stream metadata.
3. Runs `ffmpeg` to capture a screenshot at 10% of duration (1280×720 JPEG).
4. Uploads thumbnail to `thumbnails` bucket.
5. Updates DB record: `status = READY`, `duration`, `thumbnail_key`, `metadata`.
6. On failure: sets `status = FAILED` with `failure_reason`; re-throws for BullMQ retry (3 attempts, exponential backoff).

### Configuration

New environment variables (all have defaults for Docker Compose):
```dotenv
STORAGE_ENDPOINT=http://minio:9000
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
STORAGE_BUCKET_VIDEOS=videos
STORAGE_BUCKET_THUMBNAILS=thumbnails
REDIS_HOST=redis
REDIS_PORT=6379
```
