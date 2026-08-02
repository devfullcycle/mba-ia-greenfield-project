# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver the end-to-end video pipeline — direct-to-storage upload of files up to 10GB via presigned multipart URLs, automatic draft pre-registration, asynchronous background processing (duration/metadata extraction and thumbnail generation via a dedicated Video Worker), and presigned streaming/download delivery once a video is ready.

---

## Step Implementations

### SI-03.1 — Dependencies, Configuration Namespaces, and Docker Compose (MinIO + Redis)

**Description:** Install all Phase 03 production dependencies, create `storage` and `queue` config namespaces following the `registerAs` pattern established in Phase 01/02, extend the Joi validation schema, and add MinIO and Redis services to Docker Compose.

**Technical actions:**

- Install production dependencies in nestjs-project: `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`, `@nestjs/bullmq@^11.x`, `bullmq@^5.x`, `fluent-ffmpeg@^2.1.x`, `ffmpeg-static@^5.x`, `ffprobe-static@^3.x`, `@types/fluent-ffmpeg@^2.1.x` (dev)
- Create `src/config/storage.config.ts` — `registerAs('storage', ...)` reading `STORAGE_ENDPOINT` (string, default `'http://minio:9000'`), `STORAGE_REGION` (string, default `'us-east-1'`), `STORAGE_ACCESS_KEY` (string, required), `STORAGE_SECRET_KEY` (string, required), `STORAGE_BUCKET_VIDEOS` (string, default `'videos'`), `STORAGE_FORCE_PATH_STYLE` (boolean, default `true`), `STORAGE_MULTIPART_PART_SIZE_MB` (number, default `100`), `STORAGE_PRESIGNED_URL_EXPIRATION_SECONDS` (number, default `3600`)
- Create `src/config/queue.config.ts` — `registerAs('queue', ...)` reading `REDIS_HOST` (string, default `'redis'`), `REDIS_PORT` (number, default `6379`)
- Update `src/config/env.validation.ts` — add all new environment variables to the Joi schema (`STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` required, others with defaults). Update `.env.example` with all new variables and Docker Compose-compatible defaults
- Add `minio` service to `nestjs-project/compose.yaml` — image `minio/minio`, command `server /data --console-address ":9001"`, ports `9000` (S3 API) and `9001` (console), env `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` matching `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`, healthcheck via `mc ready local` or `curl -f http://localhost:9000/minio/health/live`. Add a one-shot `minio-init` service (image `minio/mc`) that runs after `minio` is healthy to create the `videos` bucket and apply a CORS configuration allowing `PUT`/`GET` from the frontend origin. Add `redis` service — image `redis:7-alpine`, port `6379`, healthcheck `redis-cli ping`. Update `nestjs-api` to `depends_on` both with `condition: service_healthy`

**Dependencies:** None

**Acceptance criteria:**

- Application starts without errors when all new environment variables are provided — existing `GET /` E2E test still passes
- Starting the application without `STORAGE_ACCESS_KEY` or `STORAGE_SECRET_KEY` causes a Joi validation error at bootstrap — the app does not start
- MinIO is reachable at `localhost:9000` (S3 API) and `localhost:9001` (console); the `videos` bucket exists after `minio-init` runs
- Redis is reachable on `localhost:6379` and responds to `PING`

---

### SI-03.2 — Nest CLI Monorepo Conversion and Video Worker App Scaffold

**Description:** Convert the project to Nest CLI monorepo mode and scaffold a second application, `video-worker`, that will host the BullMQ processor and FFmpeg processing logic in its own container — matching the architecture diagram's distinct "Video Worker" container.

**Technical actions:**

- Run `nest generate app video-worker` to convert `nest-cli.json` to monorepo mode; this creates `apps/video-worker/src/main.ts`, `apps/video-worker/src/app.module.ts`, and `apps/video-worker/tsconfig.app.json`, registering both the default API project and `video-worker` in `nest-cli.json`'s `projects` map
- Configure `apps/video-worker/tsconfig.app.json` (and root `tsconfig.json` `paths`, if needed) so `video-worker`'s `AppModule` can import shared modules directly from the existing `src/` tree (`ConfigModule` namespaces, `DatabaseModule`/TypeORM entities, `VideosModule`'s entity) — no code duplication between the two apps
- `video-worker`'s `main.ts` bootstraps a NestJS **application context** (`NestFactory.createApplicationContext`), not an HTTP server — the worker has no HTTP surface, it only consumes queue jobs
- Add `video-worker` service to `nestjs-project/compose.yaml` — same build context/Dockerfile as `nestjs-api` (shared image), overriding `command: npm run start:dev -- video-worker` (or the equivalent Nest CLI monorepo start command targeting the `video-worker` project), `depends_on` `db`, `minio`, `redis` with `condition: service_healthy`. No exposed ports (no HTTP surface)
- Add `build`/`start`/`start:dev`/`start:prod` npm scripts variants targeting the `video-worker` project (Nest CLI monorepo supports `nest build video-worker` / `nest start video-worker --watch`) to `package.json`

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `docker compose up -d video-worker` starts a container running the `video-worker` NestJS application context without errors, connecting successfully to the database
- `nest build video-worker` compiles the worker app to `dist/apps/video-worker` without TypeScript errors
- The existing `nestjs-api` application still builds and starts unaffected by the monorepo conversion

---

### SI-03.3 — Video Entity, Status Enum, and Migration

**Description:** Create the `Video` entity representing a video owned by a `Channel`, tracking its lifecycle status, storage location, and processing outputs.

**Technical actions:**

- Create `src/videos/entities/video.entity.ts` — `@Entity('videos')` with columns: `id` (uuid PK generated), `channel_id` (uuid, FK → channels), `original_filename` (varchar), `mime_type` (varchar), `size_bytes` (bigint), `status` (enum: `'draft'`, `'processing'`, `'ready'`, `'failed'`, default `'draft'`), `storage_key` (varchar — object key of the original file in the videos bucket), `thumbnail_key` (varchar, nullable — populated by the worker), `duration_seconds` (float, nullable — populated by the worker), `upload_id` (varchar, nullable — S3 multipart `UploadId`, cleared once the upload completes), `failure_reason` (varchar, nullable — set when `status = 'failed'`), `created_at` (CreateDateColumn), `updated_at` (UpdateDateColumn). Define `@ManyToOne(() => Channel)` with `@JoinColumn({ name: 'channel_id' })`; add the inverse `@OneToMany(() => Video, video => video.channel)` on `Channel`
- Generate migration via `npm run migration:generate -- src/database/migrations/CreateVideos` and review the generated SQL for correct columns, enum type, FK, and indexes
- Add an index on `(channel_id)` and on `(status)` for future dashboard queries (Phase 04)
- Create `src/videos/videos.module.ts` — `VideosModule` with `TypeOrmModule.forFeature([Video])`, exports `TypeOrmModule` so `VideosService` and (later) the worker's data access can use the repository

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/entities/video.entity.integration-spec.ts` | Integration | `status` defaults to `'draft'`, enum rejects invalid values, `channel_id` FK constraint, nullable columns (`thumbnail_key`, `duration_seconds`, `upload_id`, `failure_reason`) accept null |
| `src/videos/videos.module.spec.ts` | Unit | Module compiles with `TypeOrmModule.forFeature` wiring |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `npm run migration:run` creates the `videos` table with all columns, the status enum, FK to `channels`, and indexes
- Inserting a video without an explicit `status` defaults to `'draft'`
- Inserting a video with a `channel_id` that doesn't exist in `channels` fails with a FK violation
- Inserting a video with a `status` value outside the enum fails with a constraint violation

---

### SI-03.4 — Storage Module: S3/MinIO Client Wrapper

**Description:** Create a `StorageModule`/`StorageService` wrapping `@aws-sdk/client-s3` that both the API (for initiating/completing multipart uploads and generating presigned GET URLs) and the Video Worker (for reading the original file and writing the generated thumbnail) depend on.

**Technical actions:**

- Create `src/storage/storage.module.ts` — `StorageModule`, global-scoped (`@Global()`) or explicitly imported by `VideosModule` and shared with `video-worker`'s `AppModule`. Provides `S3Client` configured via `new S3Client({ endpoint: storageConfig.endpoint, region: storageConfig.region, forcePathStyle: storageConfig.forcePathStyle, credentials: { accessKeyId: storageConfig.accessKey, secretAccessKey: storageConfig.secretKey } })`, injected via `@Inject(storageConfig.KEY)`
- Create `src/storage/storage.service.ts` — `StorageService` with methods: `createMultipartUpload(key: string, contentType: string): Promise<{ uploadId: string }>` (wraps `CreateMultipartUploadCommand`); `getUploadPartUrl(key: string, uploadId: string, partNumber: number): Promise<string>` (wraps `UploadPartCommand` + `getSignedUrl` from `@aws-sdk/s3-request-presigner`, expiring per `storageConfig.presignedUrlExpirationSeconds`); `completeMultipartUpload(key: string, uploadId: string, parts: { partNumber: number; eTag: string }[]): Promise<void>` (wraps `CompleteMultipartUploadCommand`, mapping `parts` to the `MultipartUpload.Parts` shape ordered by `PartNumber`); `abortMultipartUpload(key: string, uploadId: string): Promise<void>` (wraps `AbortMultipartUploadCommand`, used on completion failure cleanup); `getObjectPresignedUrl(key: string): Promise<string>` (wraps `GetObjectCommand` + `getSignedUrl`, used for both streaming and download delivery per TD-05); `putObject(key: string, body: Buffer, contentType: string): Promise<void>` (wraps `PutObjectCommand`, used by the worker to upload the generated thumbnail); `getObjectStream(key: string): Promise<Readable>` (wraps `GetObjectCommand`, used by the worker to read the original file into a temp path for FFmpeg processing)
- Compute the deterministic storage key for a video's original file as `videos/{videoId}/original` and for its thumbnail as `videos/{videoId}/thumbnail.jpg` — the video's UUID `id` guarantees no key collision (satisfies capability 1.7)

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/storage/storage.service.integration-spec.ts` | Integration | Each method against the real MinIO service (Docker): multipart create/upload-part-url/complete/abort round-trip an actual object; `getObjectPresignedUrl` returns a URL that resolves to real bytes; `putObject`/`getObjectStream` round-trip a buffer. Per `testing-guide-nestjs-project` (side-effect dependency — real capture service, not a mocked SDK client) |
| `src/storage/storage.module.spec.ts` | Unit | Module compiles with `S3Client` provider wiring |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `createMultipartUpload` against the real MinIO service (manual/integration check in SI-03.6) returns a valid `uploadId`
- `getObjectPresignedUrl` returns a URL that, when fetched directly (outside the API), returns the stored object's bytes
- `completeMultipartUpload` called with mismatched/invalid parts rejects with the underlying S3 error surfaced to the caller (not swallowed)

---

### SI-03.5 — Queue Module: BullMQ Registration Shared by API and Worker

**Description:** Configure `@nestjs/bullmq` with a shared `video-processing` queue definition — registered as a producer in the API (`VideosModule`) and as a consumer in the Video Worker.

**Technical actions:**

- Create `src/queue/queue.module.ts` — `QueueModule` importing `BullModule.forRootAsync({ inject: [queueConfig.KEY], useFactory: (config) => ({ connection: { host: config.redisHost, port: config.redisPort } }) })` and `BullModule.registerQueue({ name: 'video-processing' })`. Export `BullModule` so both `VideosModule` (producer) and `video-worker`'s `AppModule` (consumer) can inject the queue
- Import `QueueModule` in `src/app.module.ts` (API) and in `apps/video-worker/src/app.module.ts` (worker) — both share the same queue definition/connection config via the same `registerAs('queue', ...)` namespace from SI-03.1
- Define the job payload contract as a shared TypeScript interface `ProcessVideoJobData { videoId: string }` in `src/videos/interfaces/process-video-job.interface.ts`, imported by both the producer (API) and the consumer (worker)

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/queue/queue.module.spec.ts` | Unit | Module compiles with `BullModule.forRootAsync` + `registerQueue` wiring |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- The API application starts successfully with `QueueModule` imported and connects to Redis without errors
- A job enqueued via the injected `Queue<ProcessVideoJobData>` in a manual test is visible in Redis (verifiable via `redis-cli` or BullMQ's job inspection)

---

### SI-03.6 — POST /videos: Draft Pre-registration and Multipart Upload Initiation

**Description:** Implement the endpoint that pre-registers a video as a draft owned by the authenticated user's channel and initiates an S3/MinIO multipart upload, returning presigned part URLs the client uploads directly to.

**Technical actions:**

- Create `src/videos/dto/create-video.dto.ts` — `CreateVideoDto` with `originalFilename` (`@IsString() @MaxLength(255)`), `mimeType` (`@IsString() @Matches(/^video\//)` — must be a `video/*` MIME type), `sizeBytes` (`@IsInt() @Min(1) @Max(10 * 1024 * 1024 * 1024)` — enforces the 10GB ceiling from capability 1.3)
- Create `src/videos/videos.controller.ts` — `@Controller('videos')`. `POST /` (no `@Public()` — protected by the global `JwtAuthGuard`): resolves the caller's `Channel` via `@CurrentUser()`, delegates to `VideosService.initiateUpload(channelId, dto)`
- Create `src/videos/videos.service.ts` — `initiateUpload(channelId, dto)`: creates a `Video` row (`status: 'draft'`, `channel_id`, `original_filename`, `mime_type`, `size_bytes`, `storage_key: videos/{id}/original`); calls `StorageService.createMultipartUpload(storageKey, dto.mimeType)`, persists the returned `uploadId` on the row; computes `partCount = Math.ceil(dto.sizeBytes / (storageConfig.multipartPartSizeMb * 1024 * 1024))` (minimum 1); calls `StorageService.getUploadPartUrl` once per part number (`1..partCount`) in parallel; returns `{ id, status, uploadId, parts: [{ partNumber, url }] }`
- Response: `201 Created` with `Location: /videos/:id` header — the created video's `id` and `uploadId` are the only way (per the resolved product decision) the uploader learns the video's identity/URL, since this phase has no listing endpoint

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | `initiateUpload` creates the video row with correct defaults, computes the correct part count for boundary sizes (exactly one part size, one byte over, 10GB), calls `StorageService` with the expected arguments (`StorageService` mocked — it has its own integration tests per SI-03.4) |
| `src/videos/videos.service.integration-spec.ts` | Integration | A video row is persisted with `status = 'draft'` and the correct `channel_id`; `storage_key` follows the `videos/{id}/original` convention; against the real MinIO service, the returned part URLs are usable for an actual `PutObject` part upload |
| `test/videos.e2e-spec.ts` | E2E | `POST /videos` HTTP contract — 201/401/400 per acceptance criteria (controllers have no unit tests per `testing-guide-nestjs-project`) |

**Dependencies:** SI-03.3, SI-03.4

**Acceptance criteria:**

- `POST /videos` with a valid body from an authenticated user returns 201 with `{ id, status: 'draft', uploadId, parts: [...] }` and a `Location: /videos/:id` header
- `POST /videos` without a valid access token returns 401 (global guard, no `@Public()`)
- `POST /videos` with `sizeBytes` greater than 10GB returns 400 validation error
- `POST /videos` with `mimeType` not matching `video/*` returns 400 validation error
- `POST /videos` with `sizeBytes` equal to exactly one part size returns exactly 1 presigned part URL; a size just over one part size returns 2

---

### SI-03.7 — POST /videos/:id/complete-upload: Multipart Completion and Processing Job Enqueue

**Description:** Implement the endpoint the client calls after uploading all parts directly to storage, finalizing the multipart upload and enqueueing the background processing job.

**Technical actions:**

- Create `src/videos/dto/complete-upload.dto.ts` — `CompleteUploadDto` with `parts: { partNumber: number; eTag: string }[]` (`@IsArray() @ValidateNested({ each: true })` on a nested `UploadPartDto` with `@IsInt() @Min(1)` for `partNumber` and `@IsString()` for `eTag`)
- Add `POST /:id/complete-upload` to `VideosController` (protected by global guard, thin delegation only — no business logic per project convention): resolves the caller's channel id via `@CurrentUser()`, delegates to `VideosService.completeUpload(videoId, channelId, dto)`
- `VideosService.completeUpload`: loads the video, throws `VideoNotFoundException` if missing, throws `VideoNotOwnedException` if `video.channelId !== channelId` (ownership check lives in the service, not the controller), throws `VideoAlreadyUploadedException` if `status !== 'draft'` (idempotency guard — a second call is rejected, not silently repeated); calls `StorageService.completeMultipartUpload(storageKey, uploadId, dto.parts)`; on success, sets `status: 'processing'`, clears `upload_id`, saves; enqueues a `video-processing` job (`{ videoId }`) via the injected BullMQ `Queue`; on `StorageService` failure, leaves the video in `'draft'` so the client can retry `complete-upload`, and rethrows the storage error
- Response: `200 OK` with `{ id, status: 'processing' }`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | `completeUpload` transitions `draft → processing`, enqueues exactly one job with the correct `videoId`, rejects a video not in `draft` status, rejects a video the caller doesn't own (`StorageService` and `Queue` mocked) |
| `src/videos/videos.service.integration-spec.ts` | Integration | After completion, the persisted `status` is `'processing'` and `upload_id` is null; against the real Redis queue, exactly one `video-processing` job with the correct `videoId` is visible (per the `testing-guide-nestjs-project` queue pattern: `queue.getJobs(['waiting'])`) |
| `test/videos.e2e-spec.ts` | E2E | `POST /videos/:id/complete-upload` HTTP contract — 200/401/403/404/409 per acceptance criteria |

**Dependencies:** SI-03.5, SI-03.6

**Acceptance criteria:**

- `POST /videos/:id/complete-upload` with valid parts from the owning user returns 200 with `{ id, status: 'processing' }`, and a `video-processing` job for that `id` is enqueued
- `POST /videos/:id/complete-upload` for a video owned by a different channel returns 403 with `VIDEO_NOT_OWNED`
- `POST /videos/:id/complete-upload` for an unknown `id` returns 404 with `VIDEO_NOT_FOUND`
- `POST /videos/:id/complete-upload` called twice for the same video returns 409 with `VIDEO_ALREADY_UPLOADED` on the second call — no duplicate job is enqueued
- `POST /videos/:id/complete-upload` with parts that don't match what was actually uploaded to storage (S3 rejects `CompleteMultipartUpload`) returns the mapped storage error, and the video remains in `'draft'` status (retryable)

---

### SI-03.8 — GET /videos/:id: Video Metadata and Presigned Streaming/Download URLs

**Description:** Implement the public endpoint that returns a video's metadata and, only once the video is `ready`, presigned URLs for streaming and download — satisfying capabilities 1.8 and 1.9 and the resolved product decision that a non-ready video is not playable.

**Technical actions:**

- Add `GET /:id` to `VideosController`, decorated `@Public()` (per the resolved product decision: any holder of the video's UUID can watch a ready video, no ownership check)
- `VideosService.findForPlayback(videoId)`: loads the video, throws `VideoNotFoundException` if missing; builds the base response `{ id, status, originalFilename, durationSeconds, createdAt }`; when `status === 'ready'`, additionally calls `StorageService.getObjectPresignedUrl(storageKey)` for `streamUrl` and reuses the same presigned URL for `downloadUrl` (both streaming and download read the same original object per TD-05 — no separate download-specific object copy) and includes `thumbnailUrl` via `StorageService.getObjectPresignedUrl(thumbnailKey)`; when `status === 'failed'`, additionally includes `failureReason`; when `status` is `'draft'`/`'processing'`, `streamUrl`/`downloadUrl`/`thumbnailUrl` are omitted (undefined, not present in the JSON body)

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | Response shape differs correctly per status (`draft`/`processing` omit media URLs, `ready` includes all three URLs, `failed` includes `failureReason`); `StorageService` mocked |
| `test/videos.e2e-spec.ts` | E2E | `GET /videos/:id` reachable without `Authorization` header; full response shape per status; 404 for unknown id (per project convention, controllers have no unit tests — see `testing-guide-nestjs-project`) |

**Dependencies:** SI-03.4, SI-03.3

**Acceptance criteria:**

- `GET /videos/:id` with no `Authorization` header for a `ready` video returns 200 with `{ id, status: 'ready', streamUrl, downloadUrl, thumbnailUrl, durationSeconds, ... }`
- `GET /videos/:id` for a `draft` or `processing` video returns 200 with `{ id, status, ... }` and no `streamUrl`/`downloadUrl`/`thumbnailUrl` fields present
- `GET /videos/:id` for a `failed` video returns 200 with `{ id, status: 'failed', failureReason }`
- `GET /videos/:id` for an unknown `id` returns 404 with `VIDEO_NOT_FOUND`
- The `streamUrl` returned for a `ready` video, when requested directly with an HTTP `Range` header (outside the API), returns a `206 Partial Content` response from storage — confirming seek/scrubbing support

---

### SI-03.9 — Video Worker: BullMQ Processor Registration and Job Consumption Skeleton

**Description:** Register the `video-processing` queue consumer in the Video Worker application, wiring job pickup to a processing service without yet implementing the FFmpeg logic (kept separate per the infra/behavior split heuristic).

**Technical actions:**

- Create `apps/video-worker/src/app.module.ts` importing `ConfigModule` (namespaces: `database`, `storage`, `queue`), `TypeOrmModule.forRootAsync` (reusing the same `database.config.ts` factory as the API), `QueueModule` (SI-03.5), `StorageModule` (SI-03.4), and a new local `VideoProcessingModule`
- Create `apps/video-worker/src/video-processing/video-processing.module.ts` — imports `TypeOrmModule.forFeature([Video])`, registers `VideoProcessorService`
- Create `apps/video-worker/src/video-processing/video-processor.service.ts` — `@Processor('video-processing') class VideoProcessorService extends WorkerHost`: implements `async process(job: Job<ProcessVideoJobData>)`, loading the `Video` row by `job.data.videoId` and calling a (not-yet-implemented in this SI) `processVideo(video)` method — for this SI, `processVideo` is a stub that just logs receipt, to be completed in SI-03.10/SI-03.11
- No automatic BullMQ retry configuration is added (default `attempts: 1`) — consistent with the resolved product decision that processing failures are terminal (`'failed'` status) rather than auto-retried

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `apps/video-worker/src/video-processing/video-processor.service.spec.ts` | Unit | `process()` loads the correct video by `job.data.videoId` and invokes `processVideo` |

**Dependencies:** SI-03.2, SI-03.3, SI-03.5

**Acceptance criteria:**

- Enqueuing a `video-processing` job (via a manual test using the API's producer queue) is picked up by the running `video-worker` container within a few seconds, observable via a log line identifying the `videoId`

---

### SI-03.10 — Video Worker: FFmpeg Metadata Extraction and Thumbnail Generation

**Description:** Implement the actual FFmpeg-based processing: download the original file from storage to a temp path, extract duration/metadata via `ffprobe`, generate a thumbnail frame, and upload the thumbnail back to storage.

**Technical actions:**

- Configure `fluent-ffmpeg` at worker bootstrap: `ffmpeg.setFfmpegPath(ffmpegStatic)`, `ffmpeg.setFfprobePath(ffprobeStatic.path)` (from the `ffmpeg-static`/`ffprobe-static` packages installed in SI-03.1)
- Implement `VideoProcessorService.processVideo(video)`: streams the original object from `StorageService.getObjectStream(video.storageKey)` into a temp file under `os.tmpdir()` (unique per job, e.g. `<tmpdir>/<videoId>-original`); runs `ffmpeg(tempPath).ffprobe((err, data) => ...)` to extract `data.format.duration`; runs `ffmpeg(tempPath).screenshots({ count: 1, timemarks: ['10%'], filename: '<videoId>-thumbnail.jpg', folder: <tmpdir> })` to generate a single thumbnail frame at 10% of the video's duration; reads the generated thumbnail file and calls `StorageService.putObject(thumbnailKey, buffer, 'image/jpeg')`; deletes both temp files in a `finally` block regardless of outcome
- On success, `VideoProcessorService` updates the `Video` row: `status: 'ready'`, `duration_seconds`, `thumbnail_key`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `apps/video-worker/src/video-processing/video-processor.service.spec.ts` | Unit | `processVideo` orchestrates download → ffprobe → screenshot → upload → status update in the right order (ffmpeg/storage mocked) |
| `apps/video-worker/src/video-processing/video-processor.service.integration-spec.ts` | Integration | Given a small real sample video fixture and a real MinIO instance, `processVideo` produces a `ready` video row with a plausible `duration_seconds` and a retrievable thumbnail object |

**Dependencies:** SI-03.9, SI-03.4

**Acceptance criteria:**

- Processing a valid video file results in the video's `status` becoming `'ready'`, `duration_seconds` populated with a value within a reasonable tolerance of the file's real duration, and `thumbnail_key` pointing to a retrievable JPEG object in storage
- Temp files created during processing do not persist on disk after the job finishes (success or failure)

---

### SI-03.11 — Video Worker: Failure Handling

**Description:** Handle processing failures (corrupted file, unsupported format, FFmpeg errors) by marking the video `failed` with a human-readable reason, per the resolved product decision (no automatic retry).

**Technical actions:**

- Wrap the `processVideo` body (SI-03.10) in a `try/catch`: on any error (download failure, `ffprobe` error, `screenshots` error, storage upload failure), update the `Video` row to `status: 'failed'`, `failure_reason` set to a sanitized, human-readable summary of the error (not the raw stack trace); log the full error server-side for operator debugging
- `VideoProcessorService.process(job)` does not rethrow after handling the failure internally — the job completes (from BullMQ's perspective) rather than triggering BullMQ's own retry/backoff machinery, keeping the "no automatic retry" behavior explicit and owned by application logic rather than incidental to queue configuration

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `apps/video-worker/src/video-processing/video-processor.service.spec.ts` | Unit | A thrown error at each stage (download, ffprobe, screenshot, upload) results in `status: 'failed'` with a populated `failure_reason`, and the job does not throw out of `process()` |
| `apps/video-worker/src/video-processing/video-processor.service.integration-spec.ts` | Integration | Processing a corrupted/non-video fixture file results in a persisted `failed` video row |

**Dependencies:** SI-03.10

**Acceptance criteria:**

- Processing a corrupted or non-decodable file results in the video's `status` becoming `'failed'` with a non-empty `failure_reason`, and no thumbnail/duration is set
- A failed job does not cause BullMQ to schedule a retry (verifiable via job attempt count remaining 1)
- `GET /videos/:id` for the resulting video (SI-03.8) reflects `status: 'failed'` and the `failureReason`

---

### SI-03.12 — E2E Coverage for the Full Upload → Process → Ready Flow

**Description:** Add an end-to-end test exercising the complete pipeline against the real Docker Compose stack (Postgres, MinIO, Redis, and the video-worker container), from draft creation through to a `ready` video with a playable stream URL.

**Technical actions:**

- Create `test/videos.e2e-spec.ts` covering: `POST /videos` (authenticated) → upload each returned presigned part URL directly against MinIO using a small real video fixture (`test/fixtures/sample.mp4`) → `POST /videos/:id/complete-upload` with the resulting ETags → poll `GET /videos/:id` until `status` transitions from `processing` to `ready` (bounded retry loop with a timeout appropriate for a small fixture) → assert `streamUrl`/`thumbnailUrl` are present and resolve to real objects
- Add the small sample video fixture (a few seconds, low resolution, to keep the test fast and the repo light) under `test/fixtures/`

**Dependencies:** SI-03.6, SI-03.7, SI-03.8, SI-03.11

**Acceptance criteria:**

- The full upload → complete → process → ready flow passes end-to-end against the real Docker Compose stack, run with `--runInBand` alongside the existing E2E suite
- The E2E suite still passes for Phase 02's existing `auth.e2e-spec.ts` unaffected by the new video-worker container being present

---

## Technical Specifications

### Data Model

#### Video

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | Also serves as the video's unique public identifier (capability 1.7) |
| channel_id | uuid | FK → channels.id, not null | Owner of the video |
| original_filename | varchar(255) | not null | As declared by the client at upload initiation |
| mime_type | varchar | not null | Must match `video/*`, validated at initiation; not re-validated against actual file bytes in this phase |
| size_bytes | bigint | not null | Declared by client at initiation; used to compute multipart part count |
| status | enum | not null, default `'draft'` | `draft` \| `processing` \| `ready` \| `failed` |
| storage_key | varchar | not null | `videos/{id}/original` |
| thumbnail_key | varchar | nullable | `videos/{id}/thumbnail.jpg`; set on successful processing |
| duration_seconds | float | nullable | Set on successful processing |
| upload_id | varchar | nullable | S3 multipart `UploadId`; cleared once upload completes |
| failure_reason | varchar | nullable | Set when status = `failed` |
| created_at | timestamp | not null, auto | |
| updated_at | timestamp | not null, auto | |

**Relations:** Video → Channel (many-to-one, FK owned by `videos.channel_id`)
**Indexes:** `(channel_id)`; `(status)`

---

### API Contracts

#### POST /videos (SI-03.6)

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- originalFilename: string, required — max 255 chars
- mimeType: string, required — must match `video/*`
- sizeBytes: integer, required — 1 to 10,737,418,240 (10GB)

**Response 201:**
- id: string (uuid)
- status: string (`'draft'`)
- uploadId: string
- parts: array of `{ partNumber: number, url: string }`

**Response headers:**
- Location: /videos/:id

**Error responses:**
- 400 validation error: `sizeBytes` out of range, `mimeType` not `video/*`, missing/invalid fields

---

#### POST /videos/:id/complete-upload (SI-03.7)

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- parts: array of `{ partNumber: integer (required, ≥1), eTag: string (required) }`, required

**Response 200:**
- id: string (uuid)
- status: string (`'processing'`)

**Error responses:**
- 404 VIDEO_NOT_FOUND: `:id` does not correspond to an existing video
- 403 VIDEO_NOT_OWNED: the authenticated user's channel does not own the video
- 409 VIDEO_ALREADY_UPLOADED: video status is not `'draft'` (upload already completed)
- 400 validation error: malformed `parts` payload
- 502 UPLOAD_FINALIZATION_FAILED: the underlying storage rejects `CompleteMultipartUpload` (e.g., ETag/part mismatch) — video remains `'draft'`, retryable

---

#### GET /videos/:id (SI-03.8)

**Request headers:** none required (public endpoint)

**Response 200:**
- id: string (uuid)
- status: string (`'draft'` \| `'processing'` \| `'ready'` \| `'failed'`)
- originalFilename: string
- durationSeconds: number \| null
- createdAt: string (ISO 8601)
- streamUrl: string — **present only when status = `'ready'`**
- downloadUrl: string — **present only when status = `'ready'`**
- thumbnailUrl: string — **present only when status = `'ready'`**
- failureReason: string — **present only when status = `'failed'`**

**Error responses:**
- 404 VIDEO_NOT_FOUND: `:id` does not correspond to an existing video

---

### Authorization Matrix

| Endpoint | Public | Authenticated | Role |
|----------|--------|---------------|------|
| POST /videos | | ✓ | any authenticated user (acts on their own channel) |
| POST /videos/:id/complete-upload | | ✓ | OWNER (caller's channel must own the video) |
| GET /videos/:id | ✓ | | |

---

### Error Catalog

_Error response format `{ statusCode, error, message }` was defined in Phase 02 (`docs/phases/phase-02-auth.md`, SI-02.2) and is inherited unchanged — this phase only adds new catalog rows._

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| VIDEO_NOT_FOUND | 404 | Video not found | `GET /videos/:id` or `POST /videos/:id/complete-upload` with an `id` not present in `videos` |
| VIDEO_NOT_OWNED | 403 | You do not own this video | `POST /videos/:id/complete-upload` where the caller's channel does not match `video.channel_id` |
| VIDEO_ALREADY_UPLOADED | 409 | Video upload has already been completed | `POST /videos/:id/complete-upload` when `video.status !== 'draft'` |
| UPLOAD_FINALIZATION_FAILED | 502 | Failed to finalize the video upload | `POST /videos/:id/complete-upload` when the storage service rejects `CompleteMultipartUpload` |

---

### Events/Messages

| Event | Payload | Publisher | Consumer | Delivery |
|-------|---------|-----------|----------|----------|
| video-processing (BullMQ job) | `{ videoId: string }` | `VideosService` (API, on successful `complete-upload`) | `VideoProcessorService` (Video Worker) | Ack-required (BullMQ job completion); no automatic retry (`attempts: 1`) — failures are handled internally by marking the video `'failed'` (SI-03.11), not by queue-level retry |

---

## Dependency Map

```
SI-03.1 (no deps)
├── SI-03.2
├── SI-03.3
│   ├── SI-03.4
│   │   ├── SI-03.6 (also depends on SI-03.3)
│   │   │   └── SI-03.7 (also depends on SI-03.5)
│   │   ├── SI-03.8 (also depends on SI-03.3)
│   │   └── SI-03.9 (also depends on SI-03.2, SI-03.3, SI-03.5)
│   │       └── SI-03.10 (also depends on SI-03.4)
│   │           └── SI-03.11
│   │               └── SI-03.12 (also depends on SI-03.6, SI-03.7, SI-03.8)
└── SI-03.5
    ├── SI-03.7
    └── SI-03.9
```

## Deliverables

- [ ] MinIO and Redis running in Docker Compose, both healthy
- [ ] Video Worker running as its own container/process, connected to the database, MinIO, and Redis
- [ ] `POST /videos` creates a draft video and returns valid presigned multipart upload part URLs
- [ ] A file uploaded directly to the returned presigned URLs, then finalized via `POST /videos/:id/complete-upload`, transitions the video from `draft` to `processing` and enqueues a processing job
- [ ] The Video Worker consumes the job, extracts duration/metadata, generates a thumbnail, and transitions the video to `ready`
- [ ] A corrupted/invalid video file results in the video transitioning to `failed` with a reason, without crashing the worker
- [ ] `GET /videos/:id` returns presigned streaming/download/thumbnail URLs only once the video is `ready`, and the stream URL supports HTTP Range requests
- [ ] All SI tests pass in nestjs-project (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] Integration tests pass in nestjs-project (`docker compose exec nestjs-api npm run test:integration`)
- [ ] E2E tests pass in nestjs-project (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type-check passes (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`docker compose exec nestjs-api npm run lint`)
- [ ] Project builds successfully for both the API and the Video Worker (`docker compose exec nestjs-api npm run build` and the `video-worker` build target)

