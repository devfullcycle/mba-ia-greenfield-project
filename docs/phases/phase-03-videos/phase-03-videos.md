---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-10-28T16:49:56-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-28T17:01:56-03:00"
  docs/phases/phase-02-auth/phase-02-auth.md: "2026-10-28T16:49:56-03:00"
  docs/phases/phase-01-configuracao-base/phase-01-configuracao-base.md: "2026-10-28T16:49:56-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver the complete video upload, background processing, and playback backend infrastructure for StreamTube — supporting non-blocking uploads up to 10GB via S3/MinIO multipart presigned URLs, automatic draft pre-registration on upload initiation, asynchronous BullMQ/Redis job processing in a dedicated FFmpeg worker container (extracting duration, dimensions, codec, and a JPEG frame thumbnail), conflict-free unique video URLs (`slug`), RFC 9110 byte-range streaming (`206 Partial Content`), and video file download.

---

## Step Implementations

### SI-03.1 — Dependencies, Configuration Namespaces, Dockerfile FFmpeg, and Docker Compose (`minio`, `redis`, `video-worker`)

**Description:** Install Phase 03 production dependencies (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@nestjs/bullmq`, `bullmq`), add `ffmpeg` to `Dockerfile.dev`, create `storage` and `queue` configuration namespaces following the Phase 01 `registerAs` pattern, extend the Joi validation schema, and add `minio`, `redis`, and `video-worker` services to `nestjs-project/compose.yaml`.

**Technical actions:**

- Install production dependencies in `nestjs-project/`: `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`, `@nestjs/bullmq@^11.x`, `bullmq@^5.x`
- Update `nestjs-project/Dockerfile.dev` — install `ffmpeg` (which provides both `ffmpeg` and `ffprobe` binaries on Alpine Linux via `RUN apk add --no-cache ffmpeg`) so both `nestjs-api` and `video-worker` containers can execute media probing and frame extraction
- Create `src/config/storage.config.ts` — `registerAs('storage', ...)` reading `S3_ENDPOINT` (string, default `'http://minio:9000'`), `S3_REGION` (string, default `'us-east-1'`), `S3_ACCESS_KEY` (string, required), `S3_SECRET_KEY` (string, required), `S3_BUCKET` (string, default `'streamtube-videos'`), `S3_PRESIGNED_URL_EXPIRATION_SECONDS` (number, default `3600`), `UPLOAD_PART_SIZE_BYTES` (number, default `10485760` — 10MB), `MAX_UPLOAD_SIZE_BYTES` (number, default `10737418240` — 10GB)
- Create `src/config/queue.config.ts` — `registerAs('queue', ...)` reading `REDIS_HOST` (string, default `'redis'`), `REDIS_PORT` (number, default `6379`), `VIDEO_WORKER_CONCURRENCY` (number, default `2`)
- Update `src/config/env.validation.ts` — add all storage and queue environment variables to the Joi schema (`S3_ACCESS_KEY` and `S3_SECRET_KEY` required, others with Docker Compose defaults) and register `storageConfig` and `queueConfig` in `AppModule` (`src/app.module.ts`)
- Update `nestjs-project/.env.example` and `nestjs-project/.env` with `S3_ENDPOINT=http://minio:9000`, `S3_REGION=us-east-1`, `S3_ACCESS_KEY=minioadmin`, `S3_SECRET_KEY=minioadmin`, `S3_BUCKET=streamtube-videos`, `REDIS_HOST=redis`, `REDIS_PORT=6379`
- Update `nestjs-project/compose.yaml` to add:
  - `minio`: image `minio/minio:latest`, command `server /data --console-address ":9001"`, ports `9000:9000` and `9001:9001`, healthcheck via `mc ready local` / `curl -f http://localhost:9000/minio/health/live`
  - `redis`: image `redis:7-alpine`, command `redis-server --appendonly yes`, port `6379:6379`, healthcheck via `redis-cli ping`
  - `video-worker`: built from `Dockerfile.dev`, command `sh -c "npm install && npm run start:worker:dev"`, sharing environment and volume mounts with `nestjs-api`, depending on healthy `db`, `redis`, and `minio`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/config/storage.config.spec.ts` | Unit | Returns typed S3/upload configuration values and defaults |
| `src/config/queue.config.spec.ts` | Unit | Returns typed Redis/BullMQ configuration values and defaults |
| `src/config/env.validation.spec.ts` | Unit | Validates new `S3_*` and `REDIS_*` variables; rejects missing `S3_ACCESS_KEY` or `S3_SECRET_KEY` |

**Dependencies:** None

**Acceptance criteria:**

- `nestjs-api`, `video-worker`, `minio`, `redis`, `db`, and `mailpit` start cleanly via `docker compose up -d`
- `ffmpeg -version` and `ffprobe -version` execute with exit code 0 inside the container
- Missing `S3_ACCESS_KEY` or `S3_SECRET_KEY` fails Joi schema validation at startup

---

### SI-03.2 — Video Entity, Channel Relation, Migration, and Channel Lookup by User

**Description:** Create the `Video` TypeORM entity linked many-to-one to `Channel`, define the `VideoStatus` enum (`draft`, `processing`, `ready`, `failed`), generate the `CreateVideos` database migration, and expose `ChannelsService.findByUserId(userId)` so `VideosService` can resolve the authenticated user's channel.

**Technical actions:**

- Create `src/videos/entities/video.entity.ts` — `@Entity('videos')` with `VideoStatus` enum (`DRAFT = 'draft'`, `PROCESSING = 'processing'`, `READY = 'ready'`, `FAILED = 'failed'`) and columns:
  - `id` (`uuid`, PK generated)
  - `channel_id` (`uuid`, not null, FK → `channels.id` with `onDelete: 'CASCADE'`)
  - `slug` (`varchar(16)`, unique, not null)
  - `title` (`varchar(200)`, not null)
  - `description` (`text`, nullable)
  - `status` (`enum`, `VideoStatus`, default `VideoStatus.DRAFT`)
  - `storage_key` (`varchar(512)`, not null)
  - `thumbnail_key` (`varchar(512)`, nullable)
  - `upload_id` (`varchar(255)`, nullable)
  - `original_filename` (`varchar(255)`, not null)
  - `mime_type` (`varchar(100)`, not null)
  - `size_bytes` (`bigint`, not null, with numeric transformer converting PostgreSQL `bigint` string to JS `number`)
  - `duration_seconds` (`int`, nullable)
  - `width` (`int`, nullable)
  - `height` (`int`, nullable)
  - `codec` (`varchar(64)`, nullable)
  - `processing_error` (`text`, nullable)
  - `created_at` (`@CreateDateColumn()`)
  - `updated_at` (`@UpdateDateColumn()`)
- Update `src/channels/entities/channel.entity.ts` — add `@OneToMany(() => Video, (video) => video.channel)` property `videos: Video[]`
- Update `src/channels/channels.service.ts` — add `findByUserId(userId: string): Promise<Channel | null>` querying `channelRepository.findOne({ where: { user_id: userId } })`
- Create migration `src/database/migrations/1777580000000-CreateVideos.ts` — creates `videos_status_enum` (`'draft'`, `'processing'`, `'ready'`, `'failed'`), `videos` table, unique index on `slug`, index on `channel_id`, index on `status`, and FK constraint `videos.channel_id → channels.id (ON DELETE CASCADE)` with full `down()` reversal
- Update `src/test/create-test-data-source.ts` and `src/database/migrations.integration-spec.ts` to register `Video` and `CreateVideos1777580000000`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/entities/video.entity.integration-spec.ts` | Integration | Persists `Video` linked to `Channel`, enforces unique `slug`, defaults `status` to `draft`, cascades on channel delete, transforms `size_bytes` up to 10GB (`10737418240`) accurately |
| `src/database/migrations.integration-spec.ts` | Integration | Applies and reverts all migrations including `CreateVideos` cleanly |
| `src/channels/channels.service.spec.ts` | Unit | `findByUserId` returns channel or null |
| `src/channels/channels.service.integration-spec.ts` | Integration | `findByUserId` resolves persisted channel for user |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `npm run migration:run` creates the `videos` table with all columns, enum constraint, unique `slug` index, and `channel_id` foreign key
- Storing `size_bytes = 10737418240` (10GB) persists in PostgreSQL `bigint` and reads back as number `10737418240`
- Duplicate `slug` insertion fails with a PostgreSQL unique constraint violation

---

### SI-03.3 — StorageModule and StorageService (S3 / MinIO Integration)

**Description:** Implement `StorageModule` and `StorageService` wrapping `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` to manage bucket provisioning, S3 Multipart Upload lifecycle (initiate, presign parts, complete, abort), object uploads (thumbnails), metadata checks (`HeadObject`), and RFC 9110 byte-range object streaming (`GetObject`).

**Technical actions:**

- Create `src/storage/storage.service.ts` — `StorageService` implementing `OnModuleInit`:
  - Initializes `S3Client` with `endpoint`, `region`, `credentials`, and `forcePathStyle: true` from `storageConfig`
  - `ensureBucketExists(): Promise<void>` (called in `onModuleInit` when not in unit-test mock mode): checks `HeadBucketCommand`, creates bucket with `CreateBucketCommand` if not found
  - `createMultipartUpload(key: string, contentType: string): Promise<string>` — sends `CreateMultipartUploadCommand` and returns `UploadId`
  - `getPresignedUploadPartUrl(key: string, uploadId: string, partNumber: number, expiresInSeconds?: number): Promise<string>` — signs `UploadPartCommand` via `getSignedUrl`
  - `getPresignedPutUrl(key: string, contentType: string, expiresInSeconds?: number): Promise<string>` — signs `PutObjectCommand` via `getSignedUrl`
  - `completeMultipartUpload(key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<void>` — sorts parts by `PartNumber` ascending and sends `CompleteMultipartUploadCommand`
  - `abortMultipartUpload(key: string, uploadId: string): Promise<void>` — sends `AbortMultipartUploadCommand`
  - `putObject(key: string, body: Buffer | Readable, contentType: string): Promise<void>` — sends `PutObjectCommand`
  - `headObject(key: string): Promise<{ contentLength: number; contentType?: string } | null>` — sends `HeadObjectCommand`, returns `null` on `NotFound` / `404`
  - `getObjectStream(key: string, range?: { start: number; end: number }): Promise<{ stream: Readable; contentLength: number; contentRange?: string; contentType?: string }>` — sends `GetObjectCommand` with optional `Range: bytes=${range.start}-${range.end}` and returns the Node `Readable` stream
  - `deleteObject(key: string): Promise<void>` — sends `DeleteObjectCommand`
- Create `src/storage/storage.module.ts` — provides and exports `StorageService`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/storage/storage.service.spec.ts` | Unit | Commands and parameters passed to `S3Client.send` and `getSignedUrl` for multipart, put, head, range stream, and delete |
| `src/storage/storage.service.integration-spec.ts` | Integration | Real MinIO interaction: bucket creation, multipart upload via presigned part URL (`fetch(presignedUrl, { method: 'PUT' })`), `completeMultipartUpload`, `headObject`, byte-range `getObjectStream`, `putObject`, and `deleteObject` |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `StorageService` automatically creates `streamtube-videos` bucket in MinIO if absent
- A client can upload binary parts to MinIO using only the presigned URL returned by `getPresignedUploadPartUrl` and finalize the object via `completeMultipartUpload`
- `getObjectStream(key, { start: 0, end: 99 })` returns a stream yielding exactly 100 bytes from MinIO

---

### SI-03.4 — Video Upload Lifecycle, Automatic Draft Pre-Registration, and Unique Slug Generation

**Description:** Implement conflict-free 11-character Base64URL slug generation, Phase 03 domain exceptions, upload DTOs, and `VideosService` methods orchestrating 10GB multipart upload initiation (with atomic `draft` pre-registration), on-demand part URL signing, upload completion (transitioning to `processing` and enqueueing the BullMQ job), and upload abortion.

**Technical actions:**

- Create `src/videos/slug.util.ts` — export `generateVideoSlug(): string` returning an 11-character URL-safe slug (`crypto.randomBytes(8).toString('base64url').slice(0, 11)`) matching `/^[A-Za-z0-9_-]{11}$/`
- Extend `src/common/exceptions/domain.exception.ts` with Phase 03 domain exceptions:
  - `ChannelNotFoundException` (`404`, `'CHANNEL_NOT_FOUND'`, `'Channel not found for user'`)
  - `VideoNotFoundException` (`404`, `'VIDEO_NOT_FOUND'`, `'Video not found'`)
  - `VideoForbiddenException` (`403`, `'VIDEO_FORBIDDEN'`, `'You do not own this video'`)
  - `VideoFileTooLargeException` (`413`, `'VIDEO_FILE_TOO_LARGE'`, `'Video file exceeds the maximum allowed size of 10GB'`)
  - `UnsupportedVideoFormatException` (`400`, `'UNSUPPORTED_VIDEO_FORMAT'`, `'Unsupported video MIME type'`)
  - `VideoInvalidStateException` (`409`, `'VIDEO_INVALID_STATE'`)
  - `VideoUploadIncompleteException` (`400`, `'VIDEO_UPLOAD_INCOMPLETE'`, `'Uploaded video object was not found in storage'`)
  - `VideoNotReadyException` (`409`, `'VIDEO_NOT_READY'`, `'Video is not ready for playback or download'`)
  - `InvalidByteRangeException` (`416`, `'INVALID_BYTE_RANGE'`, `'Requested byte range is not satisfiable'`, with optional `totalSizeBytes?: number`)
- Create DTOs in `src/videos/dto/`:
  - `initiate-upload.dto.ts`: `title` (`@IsString() @IsNotEmpty() @MaxLength(200)`), `description?` (`@IsOptional() @IsString() @MaxLength(5000)`), `original_filename` (`@IsString() @IsNotEmpty() @MaxLength(255)`), `mime_type` (`@IsString() @IsIn(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'])`), `size_bytes` (`@IsInt() @Min(1) @Max(10737418240)`)
  - `presign-part.dto.ts`: `part_number` (`@IsInt() @Min(1) @Max(10000)`)
  - `complete-upload.dto.ts`: `parts?` (`@IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => UploadPartItemDto)` where `UploadPartItemDto` has `part_number: number` and `etag: string`)
- Create `src/videos/videos.service.ts`:
  - `initiateUpload(userId: string, dto: InitiateUploadDto)`: validates size and MIME type, looks up user's channel via `channelsService.findByUserId(userId)`, generates unique `slug` with DB collision pre-check (up to 5 attempts), computes `storage_key = videos/${videoId}/original.${ext}`, calls `storageService.createMultipartUpload`, saves `Video` with `status = VideoStatus.DRAFT`, calculates `part_size` (scaling up from `UPLOAD_PART_SIZE_BYTES` if needed so `total_parts <= 10000` even for 10GB files) and `total_parts = Math.ceil(size_bytes / part_size)`, generates presigned URLs for initial parts (up to first 100 parts on init; remaining parts signable via `getPresignedPartUrl`), and returns `{ id, slug, status: 'draft', upload_id, storage_key, part_size, total_parts, presigned_urls }`
  - `getPresignedPartUrl(userId: string, videoId: string, partNumber: number)`: verifies ownership and `status === VideoStatus.DRAFT`, returns `{ part_number, upload_url, expires_in }`
  - `completeUpload(userId: string, videoId: string, dto: CompleteUploadDto)`: verifies ownership and `status === VideoStatus.DRAFT`; if `dto.parts?.length`, completes multipart upload on S3; verifies object existence in S3 via `headObject` (throwing `VideoUploadIncompleteException` if absent); updates `status = VideoStatus.PROCESSING` and `upload_id = null`; enqueues `process-video` job (`{ videoId, storageKey }`) in BullMQ queue `video-processing`; returns updated video summary
  - `abortUpload(userId: string, videoId: string)`: verifies ownership and `status === VideoStatus.DRAFT`; aborts multipart upload in S3 if `upload_id` is set; deletes the draft `Video` row

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/slug.util.spec.ts` | Unit | Generates 11-char URL-safe Base64URL strings with high entropy and zero collisions across 10,000 samples |
| `src/videos/videos.service.spec.ts` | Unit | Upload init creates draft + multipart upload, handles slug collision retry, rejects >10GB (`VideoFileTooLargeException`), rejects non-owner (`VideoForbiddenException`), completes upload and enqueues BullMQ job, aborts draft |
| `src/videos/videos.service.integration-spec.ts` | Integration | Real DB + MinIO + Redis: `initiateUpload` persists `draft` row, `completeUpload` finalizes S3 multipart object, updates DB status to `processing`, and adds job to Redis `video-processing` queue |

**Dependencies:** SI-03.2, SI-03.3

**Acceptance criteria:**

- Initiating an upload for a 10GB file (`size_bytes = 10737418240`) immediately creates a `Video` row with `status = 'draft'` and a unique 11-character `slug`, without transferring file bytes through the API
- Initiating an upload with `size_bytes > 10737418240` fails with `413 VIDEO_FILE_TOO_LARGE`
- Completing an upload transitions the video to `status = 'processing'` and enqueues a `process-video` job in Redis

---

### SI-03.5 — Background Video Processing Worker (FFprobe Metadata + FFmpeg Thumbnail + Standalone Worker Entrypoint)

**Description:** Implement `MediaProbeService` (`ffprobe` + `ffmpeg` via `execFile`), `VideoProcessor` (`@Processor('video-processing')`), and the standalone worker entrypoint (`src/worker.ts` / `WorkerModule`) that consumes queued jobs, extracts video duration and dimensions, generates a JPEG thumbnail from a video frame, uploads the thumbnail to S3/MinIO, and transitions the video to `ready` (or `failed` on unrecoverable error).

**Technical actions:**

- Create `src/videos/processing/media-probe.service.ts` — `MediaProbeService`:
  - `extractMetadata(filePath: string): Promise<VideoMetadata>` — runs `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name,duration:format=duration -of json <filePath>` via `execFile` (promisified, timeout 120s), parses JSON output, extracts `durationSeconds` (rounded integer ≥ 0), `width`, `height`, and `codec` (`codec_name`); throws descriptive error if no video stream is present
  - `generateThumbnail(videoFilePath: string, outputThumbPath: string, durationSeconds: number): Promise<void>` — computes seek timestamp `seekSeconds = durationSeconds > 0 ? Math.min(1, durationSeconds / 2) : 0` and runs `ffmpeg -y -ss <seekSeconds> -i <videoFilePath> -frames:v 1 -q:v 2 <outputThumbPath>` via `execFile`
- Create `src/videos/processing/video.processor.ts` — `@Processor('video-processing')` extending `WorkerHost`:
  - Streams `storage_key` from `StorageService.getObjectStream(storageKey)` to a temporary file in `os.tmpdir()` via `stream/promises` `pipeline`
  - Invokes `mediaProbeService.extractMetadata(tempVideoPath)` and `mediaProbeService.generateThumbnail(tempVideoPath, tempThumbPath, metadata.durationSeconds)`
  - Reads `tempThumbPath` and uploads to S3 at `thumbnails/${video.id}/thumb.jpg` (`image/jpeg`) via `storageService.putObject`
  - Updates `Video` in DB: `status = VideoStatus.READY`, `duration_seconds`, `width`, `height`, `codec`, `thumbnail_key = thumbnails/${video.id}/thumb.jpg`, `processing_error = null`
  - Always deletes `tempVideoPath` and `tempThumbPath` in `finally`
  - On error: persists `processing_error = err.message`; if final retry attempt (`job.attemptsMade + 1 >= (job.opts.attempts ?? 1)`), sets `status = VideoStatus.FAILED` before rethrowing so BullMQ records the failed job state
- Create `src/worker.module.ts` and `src/worker.ts` — standalone NestJS application context (`NestFactory.createApplicationContext(WorkerModule)`) with graceful `SIGTERM`/`SIGINT` shutdown hooks for the `video-worker` Docker service
- Add `"start:worker": "node dist/worker"` and `"start:worker:dev": "nest start --entryFile worker --watch"` to `nestjs-project/package.json`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/processing/media-probe.service.spec.ts` | Unit | Parses `ffprobe` JSON output, computes thumbnail seek timestamp, handles missing video streams and CLI failures |
| `src/videos/processing/video.processor.spec.ts` | Unit | Orchestrates download → probe → thumbnail → upload → DB update (`ready`); marks `failed` with `processing_error` when retries exhausted; cleans up temp files |
| `src/videos/processing/video.processor.integration-spec.ts` | Integration | Real `ffmpeg`/`ffprobe` + MinIO + PostgreSQL: synthesizes a real H.264/MP4 test video via `ffmpeg`, runs `VideoProcessor`, verifies DB row is `ready` with accurate `duration_seconds`, `width`, `height`, `codec`, and verifies `thumbnails/<id>/thumb.jpg` in MinIO starts with JPEG magic bytes (`FF D8 FF`) |

**Dependencies:** SI-03.1, SI-03.2, SI-03.3, SI-03.4

**Acceptance criteria:**

- When a valid video is uploaded and completed, the worker extracts `duration_seconds`, `width`, `height`, and `codec`, generates a valid JPEG thumbnail in `thumbnails/<videoId>/thumb.jpg`, and sets `status = 'ready'`
- When an invalid/corrupted file is processed, the worker records `processing_error` and transitions `status` to `'failed'` after retry exhaustion
- Temporary files in `/tmp` are always removed after job completion or failure

---

### SI-03.6 — Video Retrieval, HTTP Range Streaming (`206 Partial Content`), Download, Thumbnail & Upload Controller Endpoints

**Description:** Expose all HTTP endpoints in `VideosController` for upload orchestration (`init`, `parts`, `complete`, `abort`), public video lookup by unique `slug`, RFC 9110 byte-range video streaming (`206 Partial Content`), file download (`Content-Disposition: attachment`), and thumbnail serving, complete with `@nestjs/swagger` OpenAPI decorators and E2E tests.

**Technical actions:**

- Implement read/playback methods in `VideosService`:
  - `findBySlug(slug: string)` — returns video details with channel info (`id`, `slug`, `title`, `description`, `status`, `duration_seconds`, `width`, `height`, `codec`, `size_bytes`, `mime_type`, `original_filename`, `channel`, `stream_url`, `download_url`, `thumbnail_url`, `created_at`, `updated_at`) or throws `VideoNotFoundException`
  - `parseByteRange(rangeHeader: string, totalSizeBytes: number): { start: number; end: number }` — parses `bytes=start-end`, `bytes=start-`, or `bytes=-suffixLength` per RFC 9110; throws `InvalidByteRangeException` (`416`) if malformed, `start >= totalSizeBytes`, or `start > end`
  - `streamVideoBySlug(slug: string, rangeHeader?: string)` — finds video by `slug`, throws `VideoNotReadyException` (`409`) if `status !== VideoStatus.READY`, resolves byte range (or full stream if no `Range` header), calls `storageService.getObjectStream`
  - `downloadVideoBySlug(slug: string)` — finds video by `slug`, throws `VideoNotReadyException` (`409`) if `status !== VideoStatus.READY`, returns full object stream, MIME type, size, and sanitized filename
  - `getThumbnailStreamBySlug(slug: string)` — finds video by `slug`, throws `VideoNotReadyException` (`409`) if `status !== VideoStatus.READY` or `!thumbnail_key`, returns thumbnail stream from S3
- Update `src/common/filters/domain-exception.filter.ts` — if the caught exception is `InvalidByteRangeException` with `totalSizeBytes`, set `Content-Range: bytes */${totalSizeBytes}` on the `416` response
- Create `src/videos/videos.controller.ts` (`@ApiTags('videos')`, `@Controller('videos')`):
  - `POST /videos/uploads/init` (Authenticated, `201`)
  - `POST /videos/:id/uploads/parts` (Authenticated, `@HttpCode(200)`)
  - `POST /videos/:id/uploads/complete` (Authenticated, `@HttpCode(202)`)
  - `DELETE /videos/:id/uploads/abort` (Authenticated, `@HttpCode(204)`)
  - `GET /videos/:slug` (`@Public()`, `200`)
  - `GET /videos/:slug/stream` (`@Public()`, `206` when `Range` header present, `200` when absent; sets `Accept-Ranges: bytes`, `Content-Range`, `Content-Length`, `Content-Type`)
  - `GET /videos/:slug/download` (`@Public()`, `200`; sets `Content-Disposition: attachment; filename="..."`, `Content-Type`, `Content-Length`)
  - `GET /videos/:slug/thumbnail` (`@Public()`, `200`; sets `Content-Type: image/jpeg`, `Content-Length`)
- Create `src/videos/videos.module.ts` and register `VideosModule` in `AppModule`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.controller.spec.ts` | Unit | Controller delegates to `VideosService` and sets HTTP status codes and streaming/download headers accurately |
| `src/videos/videos.module.spec.ts` | Unit | Module compiles with `TypeOrmModule`, `BullModule`, `StorageModule`, `ChannelsModule` wiring |
| `test/videos.e2e-spec.ts` | E2E | End-to-end flow: user registers/confirms/logs in → `POST /videos/uploads/init` (creates draft + unique slug, supports up to 10GB declaration) → uploads real MP4 bytes to MinIO via presigned URL → `POST /videos/:id/uploads/complete` → worker processes video → `GET /videos/:slug` returns `status: 'ready'`, `duration_seconds`, `width`, `height`, `codec` → `GET /videos/:slug/stream` with `Range: bytes=0-511` returns `206 Partial Content`, `Content-Range: bytes 0-511/<total>`, `Accept-Ranges: bytes`, and 512-byte body → `GET /videos/:slug/download` returns `200` with `Content-Disposition: attachment` and full video bytes → `GET /videos/:slug/thumbnail` returns `200` with `image/jpeg` body → verifies `401`, `403`, `404`, `409 VIDEO_NOT_READY`, `413 VIDEO_FILE_TOO_LARGE`, and `416 INVALID_BYTE_RANGE` |

**Dependencies:** SI-03.4, SI-03.5

**Acceptance criteria:**

- Full upload → background processing → metadata retrieval → HTTP Range streaming (`206 Partial Content`) → download → thumbnail retrieval works end-to-end
- Streaming with `Range: bytes=0-511` returns `206 Partial Content` with `Accept-Ranges: bytes`, `Content-Range: bytes 0-511/<size>`, and `Content-Length: 512` without downloading the full video
- Streaming with an out-of-range header (`Range: bytes=99999999-999999999`) returns `416` with `Content-Range: bytes */<size>`
- Streaming or downloading a `draft`, `processing`, or `failed` video returns `409 VIDEO_NOT_READY`

---

### SI-03.7 — OpenAPI Specification Export and Full Definition of Done Verification

**Description:** Export the updated OpenAPI specification (`nestjs-project/openapi.json`) including all `/videos` endpoints and schemas, and verify the complete Definition of Done across unit, integration, and E2E suites, TypeScript compiler check, ESLint, and production build.

**Technical actions:**

- Ensure `npm run openapi:export` (`src/swagger/export-openapi.ts`) cleanly generates `nestjs-project/openapi.json` with all `videos` tags, operations, request DTOs, and response schemas
- Execute inside `nestjs-api` container:
  - `npm run openapi:export`
  - `npm test -- --runInBand`
  - `npm run test:e2e`
  - `npx tsc --noEmit`
  - `npm run lint`
  - `npm run build`
- Update `CLAUDE.md` (root) and `nestjs-project/CLAUDE.md` with Phase 03 module architecture, endpoints, storage, queue, and worker documentation

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `test/openapi.e2e-spec.ts` | E2E | Runtime OpenAPI spec includes `/videos` endpoints and matches exported `openapi.json` |

**Dependencies:** SI-03.6

**Acceptance criteria:**

- `nestjs-project/openapi.json` is up-to-date and includes all `/videos` endpoints
- All unit, integration, and E2E tests pass (`0` failures)
- `npx tsc --noEmit` and `npm run lint` exit with code `0`

---

## Technical Specifications

### Data Model

#### Video (`videos`)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | |
| channel_id | uuid | FK → `channels.id` (`ON DELETE CASCADE`), not null | Owner channel of the video |
| slug | varchar(16) | unique, not null | 11-char Base64URL unique public identifier (`[A-Za-z0-9_-]{11}`) |
| title | varchar(200) | not null | Video title provided at upload init |
| description | text | nullable | Optional video description |
| status | enum (`videos_status_enum`) | not null, default `'draft'` | Values: `'draft'`, `'processing'`, `'ready'`, `'failed'` |
| storage_key | varchar(512) | not null | S3 object key: `videos/<id>/original.<ext>` |
| thumbnail_key | varchar(512) | nullable | S3 object key: `thumbnails/<id>/thumb.jpg` (set when `ready`) |
| upload_id | varchar(255) | nullable | Active S3 Multipart `UploadId` while in `'draft'`; cleared on completion |
| original_filename | varchar(255) | not null | Client's original file name |
| mime_type | varchar(100) | not null | Validated MIME type (`video/mp4`, `video/webm`, `video/quicktime`, `video/x-matroska`) |
| size_bytes | bigint | not null | Declared/verified byte size up to `10,737,418,240` (10GB) |
| duration_seconds | integer | nullable | Extracted by `ffprobe` in background worker |
| width | integer | nullable | Video width in pixels extracted by `ffprobe` |
| height | integer | nullable | Video height in pixels extracted by `ffprobe` |
| codec | varchar(64) | nullable | Primary video stream codec (e.g., `h264`, `vp9`) extracted by `ffprobe` |
| processing_error | text | nullable | Diagnostic message if worker processing fails |
| created_at | timestamp | not null, auto-generated | `@CreateDateColumn` |
| updated_at | timestamp | not null, auto-generated | `@UpdateDateColumn` |

**Relations:**
- `Video` → `Channel` (many-to-one via `channel_id`, `onDelete: 'CASCADE'`)
- `Channel` → `Video[]` (one-to-many)

**Indexes:**
- `UQ_videos_slug` on `(slug)` — unique
- `IDX_videos_channel_id` on `(channel_id)`
- `IDX_videos_status` on `(status)`

---

### API Contracts

#### POST /videos/uploads/init (SI-03.4, SI-03.6)

Initiates a direct-to-S3 multipart upload and atomically pre-registers the video as a `draft`.

**Request headers:**
- `Authorization: Bearer <access_token>`
- `Content-Type: application/json`

**Request body:**
- `title`: string, required — 1..200 characters
- `description`: string, optional — max 5000 characters
- `original_filename`: string, required — 1..255 characters
- `mime_type`: string, required — one of `video/mp4`, `video/webm`, `video/quicktime`, `video/x-matroska`
- `size_bytes`: integer, required — `1` to `10737418240` (10GB)

**Response 201:**
- `id`: string (uuid)
- `slug`: string (11-char Base64URL unique identifier)
- `status`: `'draft'`
- `upload_id`: string (S3 Multipart UploadId)
- `storage_key`: string
- `part_size`: number (bytes per part)
- `total_parts`: number
- `presigned_urls`: Array of `{ part_number: number, upload_url: string }` (initial batch up to 100 parts)

**Error responses:**
- `400 VALIDATION_ERROR`: when body fields fail validation or `mime_type` is unsupported
- `401`: when access token is missing or invalid
- `404 CHANNEL_NOT_FOUND`: when authenticated user has no channel
- `413 VIDEO_FILE_TOO_LARGE`: when `size_bytes > 10737418240`

---

#### POST /videos/:id/uploads/parts (SI-03.4, SI-03.6)

Generates a fresh presigned `PUT` URL for a specific multipart part number on an active `draft` upload.

**Request headers:**
- `Authorization: Bearer <access_token>`
- `Content-Type: application/json`

**Request body:**
- `part_number`: integer, required — `1..10000`

**Response 200:**
- `part_number`: number
- `upload_url`: string (presigned S3 `UploadPart` URL)
- `expires_in`: number (seconds)

**Error responses:**
- `401`: missing/invalid access token
- `403 VIDEO_FORBIDDEN`: authenticated user does not own the video
- `404 VIDEO_NOT_FOUND`: video does not exist
- `409 VIDEO_INVALID_STATE`: video is not in `'draft'` status

---

#### POST /videos/:id/uploads/complete (SI-03.4, SI-03.6)

Completes the S3 multipart upload, verifies object presence in storage, transitions the video status from `'draft'` to `'processing'`, and enqueues the background processing job.

**Request headers:**
- `Authorization: Bearer <access_token>`
- `Content-Type: application/json`

**Request body:**
- `parts`: Array of `{ part_number: number, etag: string }` (optional when single-stream object was uploaded directly, required to finalize S3 Multipart Upload parts)

**Response 202:**
- `id`: string (uuid)
- `slug`: string
- `status`: `'processing'`

**Error responses:**
- `400 VIDEO_UPLOAD_INCOMPLETE`: object not found in S3/MinIO storage
- `401`: missing/invalid access token
- `403 VIDEO_FORBIDDEN`: authenticated user does not own the video
- `404 VIDEO_NOT_FOUND`: video does not exist
- `409 VIDEO_INVALID_STATE`: video is not in `'draft'` status

---

#### DELETE /videos/:id/uploads/abort (SI-03.4, SI-03.6)

Aborts an in-progress multipart upload in S3 and deletes the `draft` record.

**Request headers:**
- `Authorization: Bearer <access_token>`

**Response 204:** No content.

**Error responses:**
- `401`: missing/invalid access token
- `403 VIDEO_FORBIDDEN`: authenticated user does not own the video
- `404 VIDEO_NOT_FOUND`: video does not exist
- `409 VIDEO_INVALID_STATE`: video is not in `'draft'` status

---

#### GET /videos/:slug (SI-03.6)

Returns public metadata, status, extracted technical specifications, and playback/download/thumbnail URLs for a video by its unique `slug`.

**Response 200:**
- `id`: string (uuid)
- `slug`: string
- `title`: string
- `description`: string | null
- `status`: `'draft' | 'processing' | 'ready' | 'failed'`
- `size_bytes`: number
- `mime_type`: string
- `original_filename`: string
- `duration_seconds`: number | null
- `width`: number | null
- `height`: number | null
- `codec`: string | null
- `channel_id`: string (uuid)
- `stream_url`: string (`/videos/:slug/stream`)
- `download_url`: string (`/videos/:slug/download`)
- `thumbnail_url`: string | null (`/videos/:slug/thumbnail` when ready)
- `created_at`: string (ISO 8601)
- `updated_at`: string (ISO 8601)

**Error responses:**
- `404 VIDEO_NOT_FOUND`: no video matches `:slug`

---

#### GET /videos/:slug/stream (SI-03.6)

Streams a `'ready'` video using RFC 9110 HTTP byte ranges without requiring full file download.

**Request headers:**
- `Range`: optional — e.g. `bytes=0-1048575`, `bytes=524288-`

**Response 206 (when `Range` header is present):**
- Headers:
  - `Accept-Ranges: bytes`
  - `Content-Range: bytes <start>-<end>/<total>`
  - `Content-Length: <end - start + 1>`
  - `Content-Type: <video.mime_type>`
- Body: binary byte stream for `[start, end]`

**Response 200 (when `Range` header is omitted):**
- Headers:
  - `Accept-Ranges: bytes`
  - `Content-Length: <total>`
  - `Content-Type: <video.mime_type>`
- Body: binary byte stream

**Error responses:**
- `404 VIDEO_NOT_FOUND`: no video matches `:slug`
- `409 VIDEO_NOT_READY`: video status is `'draft'`, `'processing'`, or `'failed'`
- `416 INVALID_BYTE_RANGE`: malformed or out-of-bounds `Range` header (includes `Content-Range: bytes */<total>`)

---

#### GET /videos/:slug/download (SI-03.6)

Downloads the full `'ready'` video file as a browser attachment.

**Response 200:**
- Headers:
  - `Content-Type: <video.mime_type>`
  - `Content-Length: <video.size_bytes>`
  - `Content-Disposition: attachment; filename="<original_filename>"`
- Body: binary stream of the video file

**Error responses:**
- `404 VIDEO_NOT_FOUND`: no video matches `:slug`
- `409 VIDEO_NOT_READY`: video status is not `'ready'`

---

#### GET /videos/:slug/thumbnail (SI-03.6)

Streams the automatically generated JPEG thumbnail for a `'ready'` video.

**Response 200:**
- Headers:
  - `Content-Type: image/jpeg`
  - `Content-Length: <thumbnail_size_bytes>`
- Body: JPEG binary stream

**Error responses:**
- `404 VIDEO_NOT_FOUND`: no video matches `:slug`
- `409 VIDEO_NOT_READY`: video is not `'ready'` or thumbnail is missing

---

### Authorization Matrix

| Endpoint | Public | Authenticated | Notes |
|----------|--------|---------------|-------|
| `POST /videos/uploads/init` | | ✓ | Creates draft under authenticated user's channel |
| `POST /videos/:id/uploads/parts` | | ✓ | Must own the video channel |
| `POST /videos/:id/uploads/complete` | | ✓ | Must own the video channel |
| `DELETE /videos/:id/uploads/abort` | | ✓ | Must own the video channel |
| `GET /videos/:slug` | ✓ | | Public video lookup by unique slug |
| `GET /videos/:slug/stream` | ✓ | | Public byte-range streaming (`status === 'ready'`) |
| `GET /videos/:slug/download` | ✓ | | Public attachment download (`status === 'ready'`) |
| `GET /videos/:slug/thumbnail` | ✓ | | Public JPEG thumbnail (`status === 'ready'`) |

---

### Error Catalog

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| `CHANNEL_NOT_FOUND` | 404 | Channel not found for user | Authenticated user has no associated channel |
| `VIDEO_NOT_FOUND` | 404 | Video not found | Video ID or `slug` does not exist |
| `VIDEO_FORBIDDEN` | 403 | You do not own this video | User attempts to sign parts, complete, or abort another user's video |
| `VIDEO_FILE_TOO_LARGE` | 413 | Video file exceeds the maximum allowed size of 10GB | `size_bytes > 10737418240` |
| `UNSUPPORTED_VIDEO_FORMAT` | 400 | Unsupported video MIME type | `mime_type` not in allowed video MIME list |
| `VIDEO_INVALID_STATE` | 409 | Video is not in a valid state for this operation | Calling parts/complete/abort when `status !== 'draft'` |
| `VIDEO_UPLOAD_INCOMPLETE` | 400 | Uploaded video object was not found in storage | Calling `complete` before uploading video data to S3/MinIO |
| `VIDEO_NOT_READY` | 409 | Video is not ready for playback or download | Calling stream/download/thumbnail when `status !== 'ready'` |
| `INVALID_BYTE_RANGE` | 416 | Requested byte range is not satisfiable | Malformed or out-of-bounds `Range` header on `/stream` |

---

### Events / Messages

#### Queue: `video-processing` (BullMQ on Redis 7)

- **Job name:** `process-video`
- **Job ID:** `video-${videoId}` (deduplicated per video)
- **Producer:** `VideosService.completeUpload()` inside `nestjs-api`
- **Consumer:** `VideoProcessor` (`@Processor('video-processing')`) inside `video-worker`
- **Payload schema (`ProcessVideoJobPayload`):**
  ```json
  {
    "videoId": "uuid",
    "storageKey": "videos/<videoId>/original.mp4"
  }
  ```
- **Retry & Backoff Policy:** `attempts: 3`, `backoff: { type: 'exponential', delay: 1000 }`
- **State transitions:**
  - On enqueue: `Video.status = 'processing'`
  - On job success: `Video.status = 'ready'`, `duration_seconds`, `width`, `height`, `codec`, `thumbnail_key` populated
  - On final retry failure: `Video.status = 'failed'`, `processing_error` populated with failure message

---

## Dependency Map

```
SI-03.1 (Dependencies, Config, Dockerfile FFmpeg, Docker Compose)
├── SI-03.2 (Video Entity, Channel Relation, Migration)
└── SI-03.3 (StorageModule & StorageService — S3/MinIO)

SI-03.2 + SI-03.3
└── SI-03.4 (Upload Lifecycle, Draft Pre-Registration, Unique Slug)
    └── SI-03.5 (VideoProcessor Worker, FFprobe Metadata, FFmpeg Thumbnail)
        └── SI-03.6 (VideosController: Upload, Metadata, Range Streaming, Download, Thumbnail)
            └── SI-03.7 (OpenAPI Export & Definition of Done Verification)
```

Linearized implementation order: `SI-03.1 → SI-03.2 → SI-03.3 → SI-03.4 → SI-03.5 → SI-03.6 → SI-03.7`

---

## Deliverables

- [x] S3/MinIO object storage service (`StorageModule` / `StorageService`) storing videos (`videos/<id>/...`) and thumbnails (`thumbnails/<id>/thumb.jpg`)
- [x] BullMQ/Redis background job queue (`video-processing`) and dedicated `video-worker` Docker service with FFmpeg/ffprobe
- [x] Support for video uploads up to 10GB (`10,737,418,240` bytes) via S3 Multipart Upload and presigned URLs without blocking or routing bytes through the NestJS API
- [x] Automatic pre-registration of the video in `draft` status upon upload initiation (`POST /videos/uploads/init`)
- [x] Automatic background processing after upload completion (`POST /videos/:id/uploads/complete`): `ffprobe` metadata extraction (`duration_seconds`, `width`, `height`, `codec`)
- [x] Automatic thumbnail generation (`ffmpeg` single-frame JPEG extraction uploaded to S3/MinIO and served via `GET /videos/:slug/thumbnail`)
- [x] Conflict-free unique URL identifier (`slug`, 11-char Base64URL with DB unique index and collision pre-check) per video
- [x] Video playback via HTTP Range streaming (`GET /videos/:slug/stream` returning `206 Partial Content`, `Accept-Ranges: bytes`, `Content-Range`) without requiring full download
- [x] Video file download by user (`GET /videos/:slug/download` with `Content-Disposition: attachment`)
- [x] Versioned TypeORM migration (`CreateVideos`) reversible via `migration:revert`
- [x] Updated `openapi.json` exported via `npm run openapi:export`
- [x] All unit and integration tests pass (`docker compose exec -T nestjs-api npm test -- --runInBand`)
- [x] All E2E tests pass (`docker compose exec -T nestjs-api npm run test:e2e`)
- [x] Zero TypeScript errors (`docker compose exec -T nestjs-api npx tsc --noEmit`)
- [x] Linter passes (`docker compose exec -T nestjs-api npm run lint`)
