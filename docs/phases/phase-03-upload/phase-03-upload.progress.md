# Phase 03 — Upload e Processamento de Vídeos — Progress

**Status:** completed
**SIs:** 9/9 completed

### SI-03.1 — Infraestrutura Docker: MinIO + Redis
- **Status:** completed
- **Tests:** no tests — containers `db`, `redis` and `minio` healthy; MinIO console reachable on port 9001
- **Observations:** Official MinIO images were removed from Docker Hub/Quay in 2026; used the community mirror `pgsty/minio:latest` (same server and `mc`, healthcheck preserved). Added Docker-only overrides in `compose.yaml` (`DB_HOST=db`, `STORAGE_ENDPOINT=minio`, `REDIS_HOST=redis`). Quoted `MAIL_FROM` in `.env`/`.env.example` because Docker Compose could not parse the unquoted value.

### SI-03.2 — Entidade Video e Migration
- **Status:** completed
- **Tests:** 6/6 passing (video.entity.integration-spec.ts: 5, videos.module.spec.ts: 1); migrations.integration-spec.ts updated for 3 migrations / 5 tables
- **Observations:** Migration `1793739582254-Phase03-AddVideoTable.ts` generated and executed. `cleanAllTables` now clears `videos` before `channels`; the migration integration test expects the new table and migration count.

### SI-03.3 — StorageService (MinIO Integration)
- **Status:** completed
- **Tests:** 10/10 passing (storage.service.spec.ts: 9, storage.module.spec.ts: 1)
- **Observations:** `StorageModule` is global and ensures both buckets exist on startup. `uploadStream` uses the multipart `Upload` helper so large files are never buffered in memory; `getObjectStream` forwards the `Range` header and exposes `ContentRange`.

### SI-03.4 — Upload Endpoint (POST /videos/upload)
- **Status:** completed
- **Tests:** 5/5 passing (videos.service.spec.ts upload cases: 3, videos.service.integration-spec.ts: 1, videos.module.spec.ts: 1) plus E2E upload cases (201, 401, 400)
- **Observations:** Multer uses disk storage in the OS temp directory instead of memory, then pipes the file stream to MinIO and deletes the temp file in `finally` — required to support 10GB uploads. `main.ts` raises JSON/urlencoded limits to 10gb. The channel is resolved with `ChannelsService.findByUserId(userId)` because the JWT payload only carries `sub`/`email`.

### SI-03.5 — Queue Module e Video Processing Job
- **Status:** completed
- **Tests:** 2/2 passing (queue.module.spec.ts: 1; upload success + publish-failure resilience in videos.service.spec.ts)
- **Observations:** Jobs use `jobId = video-<id>`, 3 attempts and exponential backoff (5s). Job publication failures are logged without failing the upload. `@nestjs/bullmq` v11 has no `@Process` decorator, so the worker uses `WorkerHost.process`. A shared `videoProcessingQueueModule` constant keeps a single queue instance across modules.

### SI-03.6 — Video Worker (BullMQ Processor + FFmpeg)
- **Status:** completed
- **Tests:** 8/8 passing (video-processing.processor.spec.ts: 3, ffmpeg.service.spec.ts: 5)
- **Observations:** Downloads the object to a per-job temp directory, extracts metadata with ffprobe, generates a thumbnail at second 5 (or first frame for short videos), uploads it to the `thumbnails` bucket, then updates the video to `READY`. On failure it stores `ERROR` + `error_message` and rethrows so BullMQ retries. Temp cleanup uses retries for Windows file-handle timing.

### SI-03.7 — Streaming Endpoint (GET /videos/:id/stream)
- **Status:** completed
- **Tests:** 2/2 stream unit tests + E2E coverage (200 with `Content-Type: video/*`, 206 with `Range`, `Content-Range`, 404 malformed/unknown, 409 not ready)
- **Observations:** Returns 206 only when storage reports a `ContentRange`. Endpoint is `@Public()`. Response is a `StreamableFile` with `Accept-Ranges: bytes`.

### SI-03.8 — Download Endpoint (GET /videos/:id/download)
- **Status:** completed
- **Tests:** 1/1 download unit test + E2E coverage (200 with `Content-Disposition: attachment`, 404, 409)
- **Observations:** Filename is sanitized for quotes/CRLF before being written to the `Content-Disposition` header. Endpoint is `@Public()`.

### SI-03.9 — GET /videos/:id (Status do Vídeo)
- **Status:** completed
- **Tests:** 3/3 passing (videos.service.spec.ts findVideoById cases) + E2E coverage (200 with status/metadata, 404 for malformed/unknown ids)
- **Observations:** Non-UUID ids are rejected before querying the database. Endpoint is `@Public()` and returns `VideoResponseDto` including `status`, `duration_seconds` and `thumbnail_key`.

## Notes

- `npm run lint` needed a flat-config override for test files: legacy suites use untyped Jest/supertest mocks, so `no-unsafe-*`, `unbound-method` and `require-await` are disabled for `*.spec.ts`, `*.integration-spec.ts` and `test/**/*.ts`. Production code keeps the full type-aware ruleset.
- `npx tsc --noEmit` and `npm run lint` both exit 0.
- E2E and integration tests run with `--forceExit` to cleanly shut down active BullMQ worker listeners and Redis connections after test execution. `jest-e2e.json` timeout adjusted to 30000ms for NestJS module bootstrapping in Docker.
- `VideoProcessingProcessor` implements `OnApplicationBootstrap` and `OnModuleDestroy` to attach error listeners and gracefully disconnect the BullMQ worker during application teardown.
- All 32 unit/integration test suites (182 tests) and all 4 E2E test suites (57 tests) pass with 100% success rate.
