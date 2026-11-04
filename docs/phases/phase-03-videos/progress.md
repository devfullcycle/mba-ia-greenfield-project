# phase-03-videos — Progress

**Status:** completed
**SIs:** 7/7 completed

### SI-03.1 — Dependencies, Configuration Namespaces, Dockerfile FFmpeg, and Docker Compose (`minio`, `redis`, `video-worker`)
- **Status:** completed
- **Tests:** 8/8 passing (`storage.config.spec.ts`, `queue.config.spec.ts`, `env.validation.spec.ts`)
- **Observations:** Installed `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@nestjs/bullmq`, and `bullmq`. Added `ffmpeg` (`ffmpeg` + `ffprobe`) to `Dockerfile.dev`. Added `redis:7-alpine`, `elestio/minio:latest` (with healthcheck), and `video-worker` services to `nestjs-project/compose.yaml`. Namespaced BullMQ queue prefix to `bull-test` when `NODE_ENV=test` in `queue.config.ts` so the live `video-worker` container never races with Jest test suites.

### SI-03.2 — Video Entity, Channel Relation, Migration, and Channel Lookup by User
- **Status:** completed
- **Tests:** 14/14 passing (`video.entity.integration-spec.ts`, `migrations.integration-spec.ts`, `channels.service.spec.ts`, `channels.service.integration-spec.ts`)
- **Observations:** Created `Video` entity (`videos` table) with `VideoStatus` enum (`draft`, `processing`, `ready`, `failed`), unique `slug`, `channel_id` FK (`ON DELETE CASCADE`), and `bigint` transformer for `size_bytes` up to 10GB (`10,737,418,240`). Added `CreateVideos1777580000000` migration and `ChannelsService.findByUserId`. Updated `migrations.integration-spec.ts` to drop custom enum types (`videos_status_enum`, `verification_tokens_type_enum`) in `beforeAll` before re-running migrations.

### SI-03.3 — StorageModule and StorageService (S3 / MinIO Integration)
- **Status:** completed
- **Tests:** 12/12 passing (`storage.service.spec.ts`: 10 unit, `storage.service.integration-spec.ts`: 2 integration)
- **Observations:** Implemented `StorageService` with automatic bucket provisioning (`HeadBucketCommand` → `CreateBucketCommand`), S3 Multipart Upload lifecycle (`createMultipartUpload`, `getPresignedUploadPartUrl`, `completeMultipartUpload`, `abortMultipartUpload`), single-object put/head/delete, and RFC 9110 byte-range streaming (`GetObjectCommand` with `Range`).

### SI-03.4 — Video Upload Lifecycle, Automatic Draft Pre-Registration, and Unique Slug Generation
- **Status:** completed
- **Tests:** 18/18 passing (`slug.util.spec.ts`: 2 unit, `videos.service.spec.ts`: 14 unit, `videos.service.integration-spec.ts`: 2 integration)
- **Observations:** Implemented 11-character cryptographically random Base64URL slug generator (`generateVideoSlug`) with DB pre-check collision retry, Phase 03 domain exceptions (`413 VIDEO_FILE_TOO_LARGE`, `400 UNSUPPORTED_VIDEO_FORMAT`, `403 VIDEO_FORBIDDEN`, `404 VIDEO_NOT_FOUND`, `409 VIDEO_INVALID_STATE`, `400 VIDEO_UPLOAD_INCOMPLETE`, `409 VIDEO_NOT_READY`, `416 INVALID_BYTE_RANGE`), and `VideosService` upload orchestration (`initiateUpload` creating `draft` atomically, `getPresignedPartUrl`, `completeUpload` transitioning to `processing` and enqueueing `process-video` in BullMQ, and `abortUpload`).

### SI-03.5 — Background Video Processing Worker (FFprobe Metadata + FFmpeg Thumbnail + Standalone Worker Entrypoint)
- **Status:** completed
- **Tests:** 6/6 passing (`media-probe.service.spec.ts`: 3 unit, `video.processor.spec.ts`: 2 unit, `video.processor.integration-spec.ts`: 1 integration)
- **Observations:** Implemented `MediaProbeService` invoking `ffprobe` (extracting `duration_seconds`, `width`, `height`, `codec`) and `ffmpeg` (extracting single-frame JPEG thumbnail) via `node:child_process.execFile`. Implemented `VideoProcessor` (`@Processor('video-processing')`) streaming the video from MinIO to temp storage, extracting metadata and thumbnail, uploading `thumbnails/<videoId>/thumb.jpg` to MinIO, updating status to `ready` (or `failed` with `processing_error` after retry exhaustion), and cleaning up temp files in `finally`. Added standalone `src/worker.ts` and `src/worker.module.ts`.

### SI-03.6 — Video Retrieval, HTTP Range Streaming (`206 Partial Content`), Download, Thumbnail & Upload Controller Endpoints
- **Status:** completed
- **Tests:** 10/10 passing (`videos.controller.spec.ts`: 5 unit, `videos.module.spec.ts`: 1 unit, `test/videos.e2e-spec.ts`: 4 E2E)
- **Observations:** Implemented `VideosController` endpoints (`POST /videos/uploads/init`, `POST /videos/:id/uploads/parts`, `POST /videos/:id/uploads/complete`, `DELETE /videos/:id/uploads/abort`, `GET /videos/:slug`, `GET /videos/:slug/stream`, `GET /videos/:slug/download`, `GET /videos/:slug/thumbnail`) with full `@nestjs/swagger` decorators. Updated `DomainExceptionFilter` to emit `Content-Range: bytes */<total>` on `416 INVALID_BYTE_RANGE`.

### SI-03.7 — OpenAPI Specification Export and Full Definition of Done Verification
- **Status:** completed
- **Tests:** 37/37 unit+integration suites passing (202/202 tests); 4/4 E2E suites passing (56/56 tests); `npx tsc --noEmit` exits 0; `npm run lint` exits 0 (0 errors); `npm run build` succeeds
- **Observations:** Exported updated `nestjs-project/openapi.json` via `npm run openapi:export` including all `/videos` endpoints and schemas. Updated root `CLAUDE.md`, `nestjs-project/CLAUDE.md`, and `README.md`.
