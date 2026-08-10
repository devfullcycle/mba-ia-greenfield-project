---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-07-01T15:41:16-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-07-01T15:41:05-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-01T15:31:10-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver object storage, a background job queue, and a dedicated video-worker so channel owners can upload video files up to 10GB via direct-to-storage multipart upload, have them pre-registered as drafts, automatically processed (duration + metadata extraction + thumbnail generation) with queue-native retry and manual reprocessing, addressed by a permanent short unique URL, and served back via presigned streaming/download redirects.

---

## Step Implementations

### SI-03.1 — Dependencies, Config Namespaces, and Docker Compose (Storage + Worker)

**Description:** Install all Phase 03 production dependencies, create `storage` and `queue` config namespaces following the `registerAs` pattern from Phase 01/02, extend the Joi validation schema, add a MinIO object-storage service and a dedicated `video-worker` service to Docker Compose, and extend the shared Docker image with the `ffmpeg` binary.

**Technical actions:**

1. Install production dependencies in nestjs-project: `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x` (per `phase-03-videos/TD-03`), `pg-boss@^12.x` (per `phase-03-videos/TD-01`), `fluent-ffmpeg@^2.1.x` + `@types/fluent-ffmpeg` (per `phase-03-videos/TD-04`)
2. Create `src/config/storage.config.ts` — `registerAs('storage', ...)` reading `STORAGE_ENDPOINT` (string, required — e.g. `http://minio:9000`), `STORAGE_REGION` (string, default `'us-east-1'`), `STORAGE_BUCKET` (string, default `'streamtube-videos'`), `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` (string, required), `STORAGE_FORCE_PATH_STYLE` (boolean, default `true` — required for MinIO), `STORAGE_PRESIGN_EXPIRES_SECONDS` (number, default `3600`)
3. Create `src/config/queue.config.ts` — `registerAs('queue', ...)` reading `QUEUE_CONNECTION_STRING` (string, required — Postgres connection string consumed directly by `pg-boss`, pointed at the same `db` service per `phase-03-videos/TD-01`), `QUEUE_RETRY_LIMIT` (number, default `3`), `QUEUE_RETRY_DELAY_SECONDS` (number, default `30`)
4. Update `src/config/env.validation.ts` — add all new environment variables to the Joi schema (`STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `QUEUE_CONNECTION_STRING` required; others with defaults). Update `.env.example` with all new variables and Docker Compose-compatible defaults
5. Update `nestjs-project/compose.yaml` — add `minio` service (image `minio/minio`, command `server /data --console-address ":9001"`, ports `9000`/`9001`, volume for `/data`, healthcheck against `/minio/health/live`); add `video-worker` service (same `Dockerfile.dev` build context as `nestjs-api`, `command: npm run start:worker`, `depends_on: db (healthy), minio (healthy)`); extend `Dockerfile.dev` to `apt-get install -y ffmpeg` so both `nestjs-api` and `video-worker` share one image with the `ffmpeg`/`ffprobe` binaries on `PATH`

**Acceptance criteria:**

- Application starts without errors when all new environment variables are provided
- Starting the application without `STORAGE_ACCESS_KEY_ID` or `QUEUE_CONNECTION_STRING` causes a Joi validation error at bootstrap — the app does not start
- `minio` service is reachable at `localhost:9000` (S3 API) and `localhost:9001` (console); `video-worker` container starts and stays running (no immediate crash) once `db` and `minio` are healthy
- `docker compose exec video-worker ffprobe -version` and `docker compose exec nestjs-api ffprobe -version` both succeed

---

### SI-03.2 — Video Entity and Migration

**Description:** Create the `Video` entity holding upload/processing state plus the minimum fields `plan.txt` requires (`título`) and a public unique short URL id (deliberately excluding description/category/visibility, which are owned by Fase 04's video-management scope), and generate its migration.

**Technical actions:**

1. Create `src/videos/entities/video.entity.ts` — `@Entity('videos')` with columns: `id` (uuid PK generated — internal identifier only, used for storage keys/FK/queue payloads), `slug` (varchar(11), unique-indexed — public identifier per `phase-03-videos/TD-05`, generated via `nanoid`), `channel_id` (uuid, FK → channels.id, not null), `status` (enum: `'draft' | 'processing' | 'ready' | 'failed'`, default `'draft'`), `title` (varchar, not null — auto-derived from the uploaded filename, extension stripped, at `initiateUpload` time), `original_filename` (varchar, not null), `mime_type` (varchar, not null), `size_bytes` (bigint, not null), `original_key` (varchar, not null — object storage key per `phase-03-videos/TD-03`'s layout), `upload_id` (varchar, nullable — multipart upload id, cleared after `complete-upload`), `thumbnail_key` (varchar, nullable — set by the worker), `duration_seconds` (int, nullable — set by the worker), `metadata` (jsonb, nullable — broader ffprobe metadata set by the worker, per `phase-03-videos/TD-04`), `failure_reason` (varchar, nullable — last processing error), `created_at` (CreateDateColumn), `updated_at` (UpdateDateColumn). Define `@ManyToOne(() => Channel)` with `@JoinColumn({ name: 'channel_id' })`. Add index on `channel_id` and a unique index on `slug`
2. Generate migration via `npm run migration:generate -- src/database/migrations/CreateVideos` and review the generated SQL (enum type, FK constraint, indexes)
3. Create `src/videos/videos.module.ts` — `VideosModule` with `TypeOrmModule.forFeature([Video])` in imports, exports `TypeOrmModule` so `WorkerModule` can reuse the repository
4. Register `VideosModule` in `AppModule`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/entities/video.entity.integration-spec.ts` | Integration | `status` defaults to `'draft'`, enum rejects invalid values, FK to `channels` enforced, duplicate `slug` rejected, `thumbnail_key`/`duration_seconds`/`metadata`/`failure_reason`/`upload_id` nullable |
| `src/videos/videos.module.spec.ts` | Unit | Module compiles with `TypeOrmModule.forFeature` wiring |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `npm run migration:run` creates the `videos` table with all columns, the status enum, the FK to `channels`, the `channel_id` index, and the unique `slug` index
- Inserting a video without an explicit `status` defaults to `'draft'`
- Inserting a video with an invalid `status` value fails with an enum constraint violation
- Inserting a video with a non-existent `channel_id` fails with an FK violation
- Inserting a video with a `slug` that already exists fails with a unique constraint violation

---

### SI-03.3 — Object Storage Module (S3Client + Presigner Wrapper)

**Description:** Wrap the AWS SDK v3 S3 client and presigner behind a `StorageService` so the rest of the codebase never imports `@aws-sdk/*` directly — the same client, configured via env vars, targets MinIO locally and real S3/compatible storage in production (per `phase-03-videos/TD-03`).

**Technical actions:**

1. Create `src/storage/storage.module.ts` — `StorageModule` providing an `S3Client` instance via factory (`new S3Client({ region, endpoint, forcePathStyle, credentials })` sourced from `storage.config.ts`), exports `StorageService`
2. Create `src/storage/storage.service.ts` — `StorageService` injecting the `S3Client`. Implement `buildOriginalKey(channelId, videoId, ext)` / `buildThumbnailKey(channelId, videoId)` per the `videos/{channelId}/{videoId}/original.<ext>` and `videos/{channelId}/{videoId}/thumbnail.jpg` layout (per `phase-03-videos/TD-03`); `createMultipartUpload(key, mimeType): Promise<{ uploadId }>`; `presignUploadPart(key, uploadId, partNumber): Promise<string>` (per `phase-03-videos/TD-02`); `completeMultipartUpload(key, uploadId, parts: { partNumber, eTag }[]): Promise<void>`; `presignGetObject(key, disposition: 'inline' | 'attachment'): Promise<string>` (per `phase-03-videos/TD-06`); `putObject(key, body, contentType): Promise<void>` (used by the worker to upload the generated thumbnail)
3. Create `src/storage/exceptions/storage-error.exception.ts` — `StorageErrorException extends DomainException` (`errorCode: 'STORAGE_ERROR'`, `httpStatus: 502`). Wrap every SDK call in `StorageService` with a try/catch that rethrows unexpected SDK errors as `StorageErrorException`
4. Register `StorageModule` as importable (not `@Global`) by `VideosModule` and `WorkerModule`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/storage/storage.service.spec.ts` | Unit | Key-building matches the documented layout; each method issues the correct SDK command (mocked `S3Client.send`); SDK errors are wrapped into `StorageErrorException` |
| `src/storage/storage.service.integration-spec.ts` | Integration | Against the real `minio` Compose service: `createMultipartUpload` → `presignUploadPart` → upload a part via the presigned URL → `completeMultipartUpload` round-trips a small file; `presignGetObject` returns a URL that downloads the same bytes |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `presignGetObject(key, 'attachment')` returns a URL whose response includes a `Content-Disposition: attachment` header; `'inline'` includes `Content-Disposition: inline`
- A multipart upload created via `createMultipartUpload`, uploaded part-by-part via `presignUploadPart` URLs, and finalized via `completeMultipartUpload` results in the object being retrievable at `key`
- An underlying SDK failure (e.g., unreachable endpoint) surfaces as `StorageErrorException` with `errorCode: 'STORAGE_ERROR'`, never a raw SDK error

---

### SI-03.4 — Queue Module (pg-boss Wrapper + Transactional Enqueue)

**Description:** Wrap `pg-boss` behind a `QueueService` that starts/stops with the NestJS application lifecycle and supports enqueuing a job bound to an existing TypeORM transaction, so a video's status update and its processing job enqueue commit or roll back atomically (per `phase-03-videos/TD-01`).

**Technical actions:**

1. Create `src/queue/queue.constants.ts` — `export const QUEUE_NAMES = { VIDEO_PROCESSING: 'video-processing' } as const`
2. Create `src/queue/queue.module.ts` — `QueueModule` providing a `PgBoss` instance constructed from `queue.config.ts`'s `connectionString`, exports `QueueService`
3. Create `src/queue/queue.service.ts` — `QueueService implements OnModuleInit, OnApplicationShutdown` injecting the `PgBoss` instance. `onModuleInit()` calls `boss.start()`; `onApplicationShutdown()` calls `boss.stop()`. Implement `enqueueVideoProcessing(payload: { videoId: string; bucket: string; key: string }, queryRunner: QueryRunner): Promise<void>` calling `boss.send(QUEUE_NAMES.VIDEO_PROCESSING, payload, { retryLimit: queueConfig.retryLimit, retryDelay: queueConfig.retryDelaySeconds, retryBackoff: true, db: { executeSql: (sql, params) => queryRunner.query(sql, params) } })` — the `db.executeSql` override makes `boss.send` run its insert on the caller's transaction (per `phase-03-videos/TD-01`)
4. Register `QueueModule` as importable by `VideosModule` and `WorkerModule`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/queue/queue.service.spec.ts` | Unit | `enqueueVideoProcessing` calls `boss.send` with queue name `'video-processing'`, the given payload, `retryLimit`/`retryDelay`/`retryBackoff` from config, and a `db.executeSql` that delegates to the passed `QueryRunner.query` |
| `src/queue/queue.service.integration-spec.ts` | Integration | Against the real `db` service: `enqueueVideoProcessing` inside a rolled-back transaction leaves no job row behind; inside a committed transaction, the job becomes fetchable via `boss.fetch('video-processing')` |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- Calling `enqueueVideoProcessing` inside a transaction that is later rolled back does not leave a pg-boss job behind
- Calling `enqueueVideoProcessing` inside a transaction that commits results in a fetchable job with the given payload
- `QueueService` starts `pg-boss` on module init and stops it on application shutdown (no dangling connections after `app.close()`)

---

### SI-03.5 — Upload Initiation, Part URLs, and Complete-Upload Endpoints

**Description:** Implement the three endpoints that drive the direct-to-storage multipart upload lifecycle: pre-register the video as a draft and open the multipart upload, hand out presigned part URLs, and finalize the upload — which transactionally flips the video to `processing` and enqueues the processing job.

**Technical actions:**

1. Add `findByUserId(userId: string): Promise<Channel | null>` to `src/channels/channels.service.ts` (already exported by `ChannelsModule`) — used to resolve the authenticated user's own channel for ownership checks; import `ChannelsModule` in `VideosModule`
2. Create `src/videos/exceptions/` — `VideoNotFoundException` (404), `VideoNotOwnedException` (403), `InvalidVideoStatusException` (409), `FileTooLargeException` (400) — all extending `DomainException`
3. Create DTOs: `src/videos/dto/initiate-upload.dto.ts` (`filename: string`, `mimeType: string`, `sizeBytes: number` with `@Max(10 * 1024 * 1024 * 1024)`), `src/videos/dto/upload-part-urls.dto.ts` (`partNumbers: number[]`, each `@Min(1) @Max(10000)`), `src/videos/dto/complete-upload.dto.ts` (`parts: { partNumber: number; eTag: string }[]`)
4. Create `src/videos/videos.service.ts` — `initiateUpload(userId, dto)`: resolve channel via `ChannelsService.findByUserId`, reject `sizeBytes` over 10GB with `FileTooLargeException`, generate a unique `slug` (nanoid, 11 chars, retried up to 5 times against `findOneBy({ slug })` on collision, per `phase-03-videos/TD-05`), derive `title` from `dto.filename` with its extension stripped, build `original_key` via `StorageService.buildOriginalKey` (still keyed by the internal UUID, not the slug), call `storageService.createMultipartUpload`, save a `Video` row (`status: 'draft'`, `slug`, `title`, `upload_id`), return `{ id: video.slug, uploadId, key, status }` — every id returned to API callers is the `slug`, never the internal UUID; `getUploadPartUrls(userId, slug, partNumbers)`: ownership + `status === 'draft'` check (else `InvalidVideoStatusException`), presign each part via `storageService.presignUploadPart`; `completeUpload(userId, slug, parts)`: ownership + `status === 'draft'` check, then within `dataSource.transaction()`: call `storageService.completeMultipartUpload`, update the video row (`status: 'processing'`, `upload_id: null`), call `queueService.enqueueVideoProcessing({ videoId: video.id, bucket, key: original_key }, queryRunner)` bound to the same transaction's `QueryRunner` — the queue payload's `videoId` carries the internal UUID, not the public slug
5. Create `src/videos/videos.controller.ts` — `@Post()` (`initiateUpload`, 201), `@Post(':id/upload-part-urls')` (200), `@Post(':id/complete-upload')` (200) — all requiring authentication (no `@Public()`, per the inherited global `JwtAuthGuard`)

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | `initiateUpload` rejects `sizeBytes` over 10GB; `getUploadPartUrls`/`completeUpload` reject when the video is not owned by the caller or not in `'draft'` status; `completeUpload` calls `storageService` and `queueService` inside the same transaction |
| `src/videos/videos.service.integration-spec.ts` | Integration | `initiateUpload` persists a `'draft'` video row; `completeUpload` persists `status: 'processing'` and a fetchable queue job atomically; a `storageService` failure during `completeUpload` rolls back the status change (no job left behind) |
| `test/videos.e2e-spec.ts` | E2E | `POST /videos` 201 with `{ id, uploadId, key, status }`, 400 when `sizeBytes` exceeds 10GB; `POST /videos/:id/upload-part-urls` 200 with URLs, 403 for another channel's video, 409 when not `'draft'`; `POST /videos/:id/complete-upload` 200 with `status: 'processing'`, 409 when not `'draft'` |

**Dependencies:** SI-03.2, SI-03.3, SI-03.4

**Acceptance criteria:**

- `POST /videos` with a valid `{ filename, mimeType, sizeBytes }` returns 201 with `{ id, uploadId, key, status: 'draft' }` and a corresponding draft row is persisted
- `POST /videos` with `sizeBytes` above 10GB returns 400 with `errorCode: 'FILE_TOO_LARGE'`
- `POST /videos/:id/upload-part-urls` for a video the caller does not own returns 403 with `errorCode: 'VIDEO_NOT_OWNED'`
- `POST /videos/:id/complete-upload` with valid parts transitions the video to `status: 'processing'` and results in a fetchable `video-processing` job carrying the video's id, bucket, and key
- `POST /videos/:id/complete-upload` on a video that is not in `'draft'` status returns 409 with `errorCode: 'INVALID_VIDEO_STATUS'`

---

### SI-03.6 — Video Metadata, Streaming, and Download Endpoints

**Description:** Implement the read-side endpoints — fetching a video's current metadata/status, and redirecting to presigned URLs for streaming (inline) and download (attachment) once processing has completed.

**Technical actions:**

1. Implement `videosService.findById(userId, slug)` in `videos.service.ts` — ownership check (`VideoNotFoundException` if missing, `VideoNotOwnedException` if not the caller's channel), returns `{ id: video.slug, status, title, originalFilename, mimeType, sizeBytes, durationSeconds, metadata, createdAt, updatedAt }`
2. Implement `videosService.getStreamUrl(userId, slug)` / `getDownloadUrl(userId, slug)` — ownership check, require `status === 'ready'` (else `InvalidVideoStatusException`), call `storageService.presignGetObject(original_key, 'inline' | 'attachment')`
3. Add `@Get(':id')`, `@Get(':id/stream')`, `@Get(':id/download')` to `VideosController` — `stream`/`download` issue `res.redirect(HttpStatus.FOUND, url)` to the presigned URL

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | `findById` enforces ownership; `getStreamUrl`/`getDownloadUrl` reject when `status !== 'ready'` |
| `test/videos.e2e-spec.ts` | E2E | `GET /videos/:id` 200 with metadata, 403 for another channel's video, 404 for a non-existent id; `GET /videos/:id/stream` and `/download` return 302 to a presigned URL when `status: 'ready'`, 409 otherwise |

**Dependencies:** SI-03.5

**Acceptance criteria:**

- `GET /videos/:id` for the owning channel returns 200 with the video's current status and metadata
- `GET /videos/:id` for a video belonging to another channel returns 403 with `errorCode: 'VIDEO_NOT_OWNED'`
- `GET /videos/:id/stream` on a `'ready'` video returns 302 redirecting to a presigned URL with inline disposition
- `GET /videos/:id/download` on a `'ready'` video returns 302 redirecting to a presigned URL with attachment disposition
- `GET /videos/:id/stream` or `/download` on a video that is not yet `'ready'` returns 409 with `errorCode: 'INVALID_VIDEO_STATUS'`

---

### SI-03.7 — Reprocess Endpoint

**Description:** Implement the authenticated, owner-only manual reprocess endpoint that re-enqueues processing for a video stuck in `'failed'` status, per the queue-native retry + manual reprocess policy (`phase-03-videos/TD-07`).

**Technical actions:**

1. Implement `videosService.reprocess(userId, videoId)` in `videos.service.ts` — ownership check, require `status === 'failed'` (else `InvalidVideoStatusException`), within `dataSource.transaction()`: update the video row (`status: 'processing'`, `failure_reason: null`), call `queueService.enqueueVideoProcessing({ videoId, bucket, key: original_key }, queryRunner)` bound to the same transaction
2. Add `@Post(':id/reprocess')` to `VideosController` (200, requires authentication)

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | `reprocess` only transitions videos in `'failed'` status; rejects otherwise |
| `test/videos.e2e-spec.ts` | E2E | `POST /videos/:id/reprocess` 200 with `status: 'processing'` from a `'failed'` video; 409 from any other status; 403 for another channel's video |

**Dependencies:** SI-03.4, SI-03.5

**Acceptance criteria:**

- `POST /videos/:id/reprocess` on a `'failed'` video returns 200 with `status: 'processing'`, clears `failure_reason`, and results in a new fetchable `video-processing` job
- `POST /videos/:id/reprocess` on a video in any status other than `'failed'` returns 409 with `errorCode: 'INVALID_VIDEO_STATUS'`
- `POST /videos/:id/reprocess` for a video the caller does not own returns 403 with `errorCode: 'VIDEO_NOT_OWNED'`

---

### SI-03.8 — Video Worker Bootstrap and Processing Job Handler

**Description:** Bootstrap the dedicated `video-worker` process (per `phase-03-videos/TD-04`) that consumes `video-processing` jobs, extracts duration/metadata and a thumbnail via `fluent-ffmpeg`, uploads the thumbnail, and marks the video `'ready'` — or, once pg-boss exhausts its retries, marks it `'failed'` with the recorded error.

**Technical actions:**

1. Create `src/worker/worker.module.ts` — `WorkerModule` importing `ConfigModule`, `TypeOrmModule.forRootAsync` (same datasource config as `AppModule`), `TypeOrmModule.forFeature([Video])`, `StorageModule`, `QueueModule`
2. Create `src/worker/video-processing.consumer.ts` — `VideoProcessingConsumer` injecting `Repository<Video>`, `StorageService`, and the `PgBoss` instance. `register(): void` calls `boss.work(QUEUE_NAMES.VIDEO_PROCESSING, (job) => this.handle(job.data))`. `handle({ videoId, bucket, key })`: presign a GET URL for the original file, run `ffmpeg.ffprobe(url, cb)` via `probeMetadata()` to obtain `durationSeconds` plus a broader `metadata` object (container `format_name`/`bit_rate`, video stream `codec_name`/`width`/`height`, audio stream `codec_name` — per `phase-03-videos/TD-04`'s amendment satisfying `plan.txt`'s "duração e metadados"), run `ffmpeg(url).screenshots({ timestamps: ['10%'], filename: 'thumbnail.jpg', folder: tmpDir })` to produce a thumbnail file, `storageService.putObject(thumbnailKey, fileBuffer, 'image/jpeg')`, then update the video row (`status: 'ready'`, `duration_seconds`, `metadata`, `thumbnail_key`). Any thrown error propagates to pg-boss (which retries per `retryLimit`/`retryBackoff`, per `phase-03-videos/TD-07`); implement `boss.onFail(QUEUE_NAMES.VIDEO_PROCESSING, ...)` (fired once retries are exhausted) to update the video row (`status: 'failed'`, `failure_reason: <error message>`)
3. Create `src/worker.main.ts` — `NestFactory.createApplicationContext(WorkerModule)`, resolve `QueueService` (already started via `OnModuleInit`) and `VideoProcessingConsumer`, call `.register()`, keep the process alive
4. Add `"start:worker": "node dist/worker.main.js"` to `nestjs-project/package.json` scripts (consumed by the `video-worker` Compose service's `command`, per SI-03.1)

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/worker/video-processing.consumer.spec.ts` | Unit | Calls `handle()` directly with a synthetic `{ videoId, bucket, key }` payload (mocking `ffmpeg`, `StorageService`, and the `Video` repository) — asserts success path sets `status: 'ready'` with `duration_seconds`/`thumbnail_key`; asserts the `onFail` handler sets `status: 'failed'` with `failure_reason`. Per the testing guide's "Queue Consumers" guidance, the polling/`boss.work` loop itself is not tested |

**Dependencies:** SI-03.2, SI-03.3, SI-03.4

**Acceptance criteria:**

- A completed `'processing'` video whose job succeeds transitions to `status: 'ready'` with `duration_seconds` and `thumbnail_key` populated, and the thumbnail object exists in storage at the documented key layout
- A job that throws on every retry attempt (retries exhausted) results in the video transitioning to `status: 'failed'` with `failure_reason` populated
- The `video-worker` container, once started, registers a handler for the `video-processing` queue without requiring the `nestjs-api` process to be running

---

## Technical Specifications

### Data Model

#### Video

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | Internal identifier only — storage keys, FK relations, queue payloads. Never returned by the API (per TD-05) |
| slug | varchar(11) | unique, not null | Public, permanent video URL id (nanoid, per TD-05) — this is the `id` field in every API response |
| channel_id | uuid | FK → channels.id, not null | Owning channel |
| status | enum | not null, default `'draft'`, values: `'draft'`, `'processing'`, `'ready'`, `'failed'` | |
| title | varchar | not null | Auto-derived from the uploaded filename (extension stripped) at upload initiation; full title editing is Fase 04 scope |
| original_filename | varchar | not null | As supplied at upload initiation |
| mime_type | varchar | not null | As supplied at upload initiation |
| size_bytes | bigint | not null | Max 10GB, enforced at `POST /videos` |
| original_key | varchar | not null | Object storage key, `videos/{channelId}/{videoId}/original.<ext>` (keyed by the internal `id`, not the `slug`) |
| upload_id | varchar | nullable | Multipart upload id; cleared once `complete-upload` succeeds |
| thumbnail_key | varchar | nullable | `videos/{channelId}/{videoId}/thumbnail.jpg`; set by the worker |
| duration_seconds | int | nullable | Set by the worker after `ffprobe` |
| metadata | jsonb | nullable | Broader `ffprobe` metadata set by the worker: container `formatName`/`bitRate`, video `codec`/`width`/`height`, audio `codec` |
| failure_reason | varchar | nullable | Last processing error message; cleared on reprocess |
| created_at | timestamp | not null, auto-generated | `@CreateDateColumn` |
| updated_at | timestamp | not null, auto-generated | `@UpdateDateColumn` |

**Relations:** Video → Channel (many-to-one)
**Indexes:** `(channel_id)`, unique `(slug)`

**Out of scope for this phase (owned by Fase 04):** `description`, `category`, `visibility` (public/unlisted), title *editing*, and the draft→publication flow. `title` itself exists as a minimum field (per `plan.txt`) but is only auto-derived in this phase, not user-editable.

---

### API Contracts

#### POST /videos (SI-03.5)

**Request headers:** Authorization: Bearer <access_token>; Content-Type: application/json

**Request body:**
- filename: string, required
- mimeType: string, required
- sizeBytes: number, required — max 10 * 1024^3 (10GB)

**Response 201:**
- id: string (short slug, 11 chars — public identifier, not the internal uuid)
- uploadId: string
- key: string
- status: `'draft'`

**Error responses:**
- 400 FILE_TOO_LARGE: when `sizeBytes` exceeds 10GB
- 400 validation error: when the request body fails schema validation
- 401: when the access token is missing or invalid

---

#### POST /videos/:id/upload-part-urls (SI-03.5)

**Request headers:** Authorization: Bearer <access_token>; Content-Type: application/json

**Request body:**
- partNumbers: number[], required — each between 1 and 10000

**Response 200:**
- urls: `{ partNumber: number; url: string }[]`

**Error responses:**
- 404 VIDEO_NOT_FOUND
- 403 VIDEO_NOT_OWNED
- 409 INVALID_VIDEO_STATUS: when the video is not in `'draft'` status
- 400 validation error

---

#### POST /videos/:id/complete-upload (SI-03.5)

**Request headers:** Authorization: Bearer <access_token>; Content-Type: application/json

**Request body:**
- parts: `{ partNumber: number; eTag: string }[]`, required

**Response 200:**
- id: string (short slug)
- status: `'processing'`

**Error responses:**
- 404 VIDEO_NOT_FOUND
- 403 VIDEO_NOT_OWNED
- 409 INVALID_VIDEO_STATUS: when the video is not in `'draft'` status
- 502 STORAGE_ERROR: when the storage provider rejects the multipart completion
- 400 validation error

---

#### GET /videos/:id (SI-03.6)

**Request headers:** Authorization: Bearer <access_token>

**Response 200:**
- id (short slug), status, title, originalFilename, mimeType, sizeBytes, durationSeconds, metadata, createdAt, updatedAt

**Error responses:**
- 404 VIDEO_NOT_FOUND
- 403 VIDEO_NOT_OWNED

---

#### GET /videos/:id/stream (SI-03.6)

**Request headers:** Authorization: Bearer <access_token>

**Response 302:** Redirect to a presigned GET URL with `inline` disposition.

**Error responses:**
- 404 VIDEO_NOT_FOUND
- 403 VIDEO_NOT_OWNED
- 409 INVALID_VIDEO_STATUS: when the video is not `'ready'`

---

#### GET /videos/:id/download (SI-03.6)

**Request headers:** Authorization: Bearer <access_token>

**Response 302:** Redirect to a presigned GET URL with `attachment` disposition.

**Error responses:**
- 404 VIDEO_NOT_FOUND
- 403 VIDEO_NOT_OWNED
- 409 INVALID_VIDEO_STATUS: when the video is not `'ready'`

---

#### POST /videos/:id/reprocess (SI-03.7)

**Request headers:** Authorization: Bearer <access_token>

**Response 200:**
- id: string (short slug)
- status: `'processing'`

**Error responses:**
- 404 VIDEO_NOT_FOUND
- 403 VIDEO_NOT_OWNED
- 409 INVALID_VIDEO_STATUS: when the video is not `'failed'`

#### Validation Rules

| Field | Rule | Error message |
|-------|------|----------------|
| sizeBytes | Max 10 * 1024^3 bytes (10GB) | sizeBytes must not exceed 10737418240 |
| partNumbers[] | Each between 1 and 10000 | partNumber must be between 1 and 10000 |

---

### Authorization Matrix

| Endpoint | Public | Authenticated (owner-only) | Notes |
|----------|--------|------------------------------|-------|
| POST /videos | | ✓ | Creates a draft owned by the caller's channel |
| POST /videos/:id/upload-part-urls | | ✓ | |
| POST /videos/:id/complete-upload | | ✓ | |
| GET /videos/:id | | ✓ | No public/unlisted visibility exists yet (Fase 04 concern) — access is owner-only in this phase |
| GET /videos/:id/stream | | ✓ | |
| GET /videos/:id/download | | ✓ | |
| POST /videos/:id/reprocess | | ✓ | |

Ownership is resolved by comparing `video.channel_id` against the channel owned by the authenticated user (`ChannelsService.findByUserId(req.user.sub)`). Anonymous/public video access (Fase 05) and public/unlisted visibility (Fase 04) are explicitly out of scope here.

---

### Error Catalog

**Error response format:** inherited from Fase 02 — `{ statusCode: number, error: string, message: string }`

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| FILE_TOO_LARGE | 400 | File exceeds the 10GB upload limit | POST /videos with `sizeBytes` over 10GB |
| VIDEO_NOT_FOUND | 404 | Video not found | Any `/videos/:id*` endpoint with a non-existent id |
| VIDEO_NOT_OWNED | 403 | Video does not belong to your channel | Any `/videos/:id*` endpoint where `video.channel_id` does not match the caller's channel |
| INVALID_VIDEO_STATUS | 409 | Video is not in the required status for this operation | `upload-part-urls`/`complete-upload` when not `'draft'`; `stream`/`download` when not `'ready'`; `reprocess` when not `'failed'` |
| STORAGE_ERROR | 502 | Object storage operation failed | Any unexpected AWS SDK / MinIO failure surfaced by `StorageService` |

---

### Events/Messages

**Queue:** `video-processing` (pg-boss, per `phase-03-videos/TD-01`)

**Producers:**
- `POST /videos/:id/complete-upload` (SI-03.5) — enqueues transactionally with the `status: 'processing'` update
- `POST /videos/:id/reprocess` (SI-03.7) — enqueues transactionally with the `status: 'processing'` update, only from `'failed'`

**Payload:**
```
{ videoId: string; bucket: string; key: string }
```

**Consumer:** `video-worker` container's `VideoProcessingConsumer` (SI-03.8) — extracts duration via `ffprobe`, generates a thumbnail via `ffmpeg().screenshots()`, uploads the thumbnail, and updates the video row to `status: 'ready'`.

**Retry policy (per `phase-03-videos/TD-07`):** queue-native — `retryLimit` (default 3) and `retryBackoff: true` from `queue.config.ts`. Once retries are exhausted, pg-boss's failure hook sets the video to `status: 'failed'` with `failure_reason` recording the last error. Recovery is manual via `POST /videos/:id/reprocess` (owner-only) — there is no automatic re-enqueue beyond the configured retry limit.

---

## Dependency Map

```
SI-03.1 (no deps)
├── SI-03.2
├── SI-03.3
└── SI-03.4

SI-03.2 + SI-03.3 + SI-03.4
└── SI-03.5
    ├── SI-03.6
    └── SI-03.7

SI-03.2 + SI-03.3 + SI-03.4
└── SI-03.8
```

Linearized implementation order: SI-03.1 → SI-03.2, SI-03.3, SI-03.4 (parallel) → SI-03.5 → SI-03.6, SI-03.7, SI-03.8 (parallel)

## Deliverables

- [ ] Object storage service (MinIO locally / S3-compatible in prod) reachable and configured via env vars only
- [ ] `video-processing` queue backed by `pg-boss` on the existing PostgreSQL database — no separate broker
- [ ] Presigned multipart upload supporting files up to 10GB, direct client-to-storage (API never proxies file bytes)
- [ ] Video automatically pre-registered as `'draft'` when upload is initiated
- [ ] Automatic background processing on upload completion: duration + broader ffprobe metadata (format, bitrate, codecs, resolution) extraction + thumbnail generation
- [ ] Queue-native retry (configurable limit + backoff) with a manual, owner-only `POST /videos/:id/reprocess` recovery path
- [ ] Permanent, short, collision-free public video URL (`slug`, distinct from the internal UUID PK)
- [ ] Streaming via presigned GET redirect with `inline` disposition (native HTTP Range support from storage)
- [ ] Download via presigned GET redirect with `attachment` disposition
- [ ] Dedicated `video-worker` Docker Compose service running independently of `nestjs-api`
- [ ] Standardized error response format extended with `FILE_TOO_LARGE`, `VIDEO_NOT_FOUND`, `VIDEO_NOT_OWNED`, `INVALID_VIDEO_STATUS`, `STORAGE_ERROR`
- [ ] All SI tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation check passes (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`docker compose exec nestjs-api npm run lint`)
- [ ] Project builds successfully (`docker compose exec nestjs-api npm run build`) — `dist/worker.main.js` present alongside `dist/main.js`
