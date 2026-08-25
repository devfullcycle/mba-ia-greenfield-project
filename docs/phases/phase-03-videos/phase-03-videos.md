---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-08-21T13:21:44-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-08-21T13:11:33-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-08-18T09:44:18-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-08-18T09:44:18-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Implementar em `nestjs-project/` o módulo de vídeos: upload direto ao storage via presigned multipart (até 10GB), pré-cadastro automático do vídeo como rascunho, processamento assíncrono via fila (RabbitMQ) com extração de metadados e geração de thumbnail via FFmpeg, ciclo de status de 3 estados (rascunho → processando → pronto/erro), identificador público curto (nanoid) para URL única, e entrega via streaming/download por redirect a URL de leitura pré-assinada.

---

## Step Implementations

### SI-03.1 — Dependencies, Config Namespaces, and Docker Compose

**Description:** Install all Phase 03 production dependencies, create `storage` and `queue` config namespaces following the `registerAs` pattern from Phase 01, extend the Joi validation schema, and add MinIO and RabbitMQ to Docker Compose.

**Technical actions:**

1. Install production dependencies in nestjs-project: `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`, `nanoid@^5.x`, `@nestjs/microservices@^11.0.0`, `amqp-connection-manager@^4.x`, `amqplib@^0.10.x` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`, `phase-03-videos/TD-05`)
2. Create `src/config/storage.config.ts` — `registerAs('storage', ...)` reading `STORAGE_ENDPOINT` (string, required), `STORAGE_REGION` (string, default `'us-east-1'`), `STORAGE_ACCESS_KEY_ID` (string, required), `STORAGE_SECRET_ACCESS_KEY` (string, required), `STORAGE_BUCKET_VIDEOS` (string, required), `STORAGE_FORCE_PATH_STYLE` (boolean, default `true` — required by MinIO)
3. Create `src/config/queue.config.ts` — `registerAs('queue', ...)` reading `RABBITMQ_URL` (string, required), `RABBITMQ_VIDEO_PROCESSING_QUEUE` (string, default `'video_processing'`)
4. Update `src/config/env.validation.ts` — add all new environment variables to the Joi schema. Update `.env.example` with new variables and Docker Compose-compatible defaults
5. Add `minio` (image `minio/minio`, command `server /data --console-address ":9001"`, ports 9000/9001, healthcheck against `/minio/health/live`) and `rabbitmq` (image `rabbitmq:3-management`, ports 5672/15672, healthcheck via `rabbitmq-diagnostics -q ping`) services to `nestjs-project/compose.yaml` — `nestjs-api` depends on both with `condition: service_healthy`

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- Application starts without errors when all new environment variables are provided
- Starting the application without `STORAGE_ACCESS_KEY_ID` causes a Joi validation error at bootstrap — the app does not start
- MinIO console is reachable at `localhost:9001` and the S3 API responds on port 9000 inside the Docker network
- RabbitMQ management UI is reachable at `localhost:15672` and the AMQP port responds on 5672 inside the Docker network

---

### SI-03.2 — Video Entity and Migration

**Description:** Create the `Video` entity with the 3-state status lifecycle, the fields populated during upload and worker processing, and its relation to `Channel`. Generate the migration.

**Technical actions:**

1. Create `src/videos/entities/video.entity.ts` — `@Entity('videos')` with columns per `## Technical Specifications` → `### Data Model` → `#### Video`: `id` (uuid PK generated), `public_id` (varchar(12), unique, not null), `channel_id` (uuid, FK → channels.id, not null), `status` (enum: `'rascunho'`, `'processando'`, `'pronto'`, `'erro'`, default `'rascunho'`), `original_filename` (varchar, not null), `original_key` (varchar, nullable), `upload_id` (varchar, nullable), `thumbnail_key` (varchar, nullable), `duration_seconds` (integer, nullable), `width` (integer, nullable), `height` (integer, nullable), `codec` (varchar, nullable), `bitrate` (integer, nullable), `size_bytes` (bigint, nullable), `processing_error` (text, nullable), `created_at` (CreateDateColumn), `updated_at` (UpdateDateColumn). Define `@ManyToOne(() => Channel)` with `@JoinColumn({ name: 'channel_id' })`
2. Generate migration via `npm run migration:generate -- src/database/migrations/CreateVideos` and review the generated SQL for correct columns, constraints, and indexes
3. Create `src/videos/videos.module.ts` — `VideosModule` with `TypeOrmModule.forFeature([Video])` in imports, exports `TypeOrmModule`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/entities/video.entity.integration-spec.ts` | Integration | Unique `public_id` constraint, `status` defaults to `'rascunho'`, `status` enum rejects invalid values, FK to `channels`, nullable fields accept `null` |
| `src/videos/videos.module.spec.ts` | Unit | Module compiles with `TypeOrmModule.forFeature` wiring |

**Dependencies:** none

**Acceptance criteria:**

- `npm run migration:run` creates the `videos` table with all columns, constraints, and indexes
- Inserting a video with a duplicate `public_id` fails with a unique constraint violation
- A newly created video has `status = 'rascunho'` by default
- Inserting a video with an invalid `status` value is rejected by the enum constraint

---

### SI-03.3 — StorageService (Presigned Multipart Upload and Presigned GET)

**Description:** Create a `StorageModule` wrapping an `S3Client` configured for MinIO, exposing multipart-upload lifecycle methods and short-lived presigned GET URL generation.

**Technical actions:**

1. Create `src/storage/storage.module.ts` — `StorageModule` providing `StorageService`, injecting `storageConfig`
2. Create `src/storage/storage.service.ts` — construct `S3Client` from `storageConfig` (`endpoint`, `region`, `credentials`, `forcePathStyle`). Implement `createMultipartUpload(key: string, contentType: string): Promise<{ uploadId: string }>` via `CreateMultipartUploadCommand` (per `phase-03-videos/TD-02`)
3. Implement `getUploadPartUrls(key: string, uploadId: string, partCount: number): Promise<{ part_number: number; url: string }[]>` — one presigned `UploadPartCommand` URL per part via `getSignedUrl` (per `phase-03-videos/TD-02`)
4. Implement `completeMultipartUpload(key: string, uploadId: string, parts: { part_number: number; etag: string }[]): Promise<void>` via `CompleteMultipartUploadCommand`; implement `abortMultipartUpload(key: string, uploadId: string): Promise<void>` via `AbortMultipartUploadCommand`
5. Implement `getPresignedGetUrl(key: string, options: { expiresIn: number; responseContentDisposition?: string }): Promise<string>` via `GetObjectCommand` + `getSignedUrl` (per `phase-03-videos/TD-06`)

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/storage/storage.service.integration-spec.ts` | Integration | Full multipart round-trip against real MinIO (`createMultipartUpload` → `getUploadPartUrls` → upload → `completeMultipartUpload`); `abortMultipartUpload` removes the incomplete upload; `getPresignedGetUrl` returns a URL that resolves `206 Partial Content` on a `Range` request |
| `src/storage/storage.module.spec.ts` | Unit | Module compiles with `storageConfig` wiring |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `createMultipartUpload` against MinIO returns a valid `uploadId`
- `getUploadPartUrls` returns exactly `partCount` presigned URLs, each accepting a `PUT` of its chunk
- `completeMultipartUpload` finalizes the object — a subsequent `GetObjectCommand` confirms the object exists with the expected size
- `abortMultipartUpload` removes the incomplete upload — no orphaned parts remain in MinIO
- `getPresignedGetUrl` returns a URL that serves `206 Partial Content` when requested with a `Range` header

---

### SI-03.4 — Queue Producer (RabbitMQ)

**Description:** Wire a `ClientsModule` RMQ client and a thin producer service that emits video-processing jobs onto the queue.

**Technical actions:**

1. Create `src/queue/queue.module.ts` — `QueueModule` with `ClientsModule.registerAsync([{ name: 'VIDEO_PROCESSING_SERVICE', useFactory: (cfg) => ({ transport: Transport.RMQ, options: { urls: [cfg.rabbitmqUrl], queue: cfg.videoProcessingQueue, queueOptions: { durable: true } } }), inject: [queueConfig.KEY] }])`, exports `ClientsModule` (per `phase-03-videos/TD-01`)
2. Create `src/queue/video-processing.producer.ts` — `VideoProcessingProducer` injecting `@Inject('VIDEO_PROCESSING_SERVICE') client: ClientProxy`. Implement `emitProcessingJob(videoId: string, originalKey: string): Promise<void>` — `client.emit('video.processing', { videoId, originalKey })` (per `phase-03-videos/TD-01`)

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/queue/video-processing.producer.spec.ts` | Unit | `emitProcessingJob` calls `client.emit` with the `'video.processing'` pattern and the exact `{ videoId, originalKey }` payload |
| `src/queue/queue.module.spec.ts` | Unit | Module compiles with `ClientsModule.registerAsync` wiring |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `emitProcessingJob` emits a message on pattern `'video.processing'` carrying `{ videoId, originalKey }`
- `QueueModule` resolves `VIDEO_PROCESSING_SERVICE` via DI without errors

---

### SI-03.5 — POST /videos (Initiate Multipart Upload)

**Description:** Implement the endpoint that pre-registers a video as a draft and returns presigned multipart upload URLs for the client to upload directly to storage.

**Technical actions:**

1. Create `src/videos/dto/initiate-upload.dto.ts` — `InitiateUploadDto` with `@IsString() @IsNotEmpty()` `original_filename`, `@IsString() @IsNotEmpty()` `content_type`, `@IsInt() @Min(1)` `size_bytes`
2. Create `src/videos/exceptions/video.exceptions.ts` — `FileTooLargeException` (400, `FILE_TOO_LARGE`) extending the `DomainException` base class from `phase-02-auth/TD-07`
3. Implement `initiateUpload(channelId: string, dto: InitiateUploadDto): Promise<{ id, upload_id, parts }>` in `src/videos/videos.service.ts` — throw `FileTooLargeException` when `size_bytes` exceeds 10737418240 (per `phase-03-videos/TD-02`); compute `partCount = Math.ceil(size_bytes / (10 * 1024 * 1024))`; generate `public_id` via `nanoid()` (per `phase-03-videos/TD-05`); build storage key `videos/{channelId}/{videoId}/original.<ext>` (per `phase-03-videos/TD-02`); call `storageService.createMultipartUpload()`; save the `Video` row with `status: 'rascunho'`; call `storageService.getUploadPartUrls()`; return `{ id: public_id, upload_id, parts }`
4. Create `src/videos/videos.controller.ts` — `VideosController` with route prefix `'videos'`. Implement `@Post()` calling `videosService.initiateUpload()`, returning 201
5. Create `VideosModule` wiring: import `StorageModule` into `videos.module.ts`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | `initiateUpload`: computes correct `partCount`, builds the storage key, calls storage + `nanoid`, persists a `rascunho` row; throws `FileTooLargeException` over 10GB |
| `src/videos/videos.service.integration-spec.ts` | Integration | `initiateUpload` persists a `Video` row with correct fields and default status |
| `test/videos.e2e-spec.ts` | E2E | `POST /videos` 201 with `upload_id` + `parts` array, 400 `FILE_TOO_LARGE` over 10GB, 401 without authentication |

**Dependencies:** SI-03.2, SI-03.3

**Acceptance criteria:**

- `POST /videos` with a valid body returns 201 with `{ id, upload_id, parts }` where `parts.length` matches `ceil(size_bytes / 10MB)`
- `POST /videos` with `size_bytes` over 10GB returns 400 with `FILE_TOO_LARGE`
- `POST /videos` without an `Authorization` header returns 401
- A `Video` row is created with `status = 'rascunho'` immediately after the request succeeds

---

### SI-03.6 — POST /videos/:publicId/complete

**Description:** Implement the endpoint that finalizes the multipart upload with storage, transitions the video to `processando`, and emits the processing job onto the queue.

**Technical actions:**

1. Create `src/videos/dto/complete-upload.dto.ts` — `CompleteUploadDto` with `parts: { part_number: number; etag: string }[]`, validated via nested `class-validator` decorators (`@ValidateNested({ each: true }) @Type(() => UploadPartDto)`)
2. Add `VideoNotFoundException` (404, `VIDEO_NOT_FOUND`), `ForbiddenVideoAccessException` (403, `FORBIDDEN`), `UploadAlreadyCompletedException` (409, `UPLOAD_ALREADY_COMPLETED`), and `MultipartCompletionFailedException` (502, `MULTIPART_COMPLETION_FAILED`) to `src/videos/exceptions/video.exceptions.ts`
3. Implement `completeUpload(channelId: string, publicId: string, dto: CompleteUploadDto): Promise<Video>` in `VideosService` — look up by `public_id`, throw `VideoNotFoundException` if missing, throw `ForbiddenVideoAccessException` if `video.channel_id !== channelId`, throw `UploadAlreadyCompletedException` if `status !== 'rascunho'`; call `storageService.completeMultipartUpload()`, catching storage failures as `MultipartCompletionFailedException`; update the row to `status: 'processando'`, `upload_id: null`; call `videoProcessingProducer.emitProcessingJob(video.id, video.original_key)`
4. Add `@Post(':publicId/complete')` to `VideosController` — returns 200 with `{ id, status }`
5. Import `QueueModule` into `videos.module.ts`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | `completeUpload`: happy path transitions to `processando` and emits the job; throws `VideoNotFoundException`/`ForbiddenVideoAccessException`/`UploadAlreadyCompletedException`; wraps a storage failure as `MultipartCompletionFailedException` |
| `src/videos/videos.service.integration-spec.ts` | Integration | `completeUpload` persists `status = 'processando'` and clears `upload_id` |
| `test/videos.e2e-spec.ts` | E2E | `POST /videos/:publicId/complete` 200, 404 unknown id, 403 non-owner, 409 already completed |

**Dependencies:** SI-03.5, SI-03.4

**Acceptance criteria:**

- `POST /videos/:publicId/complete` with valid parts returns 200 with `status: 'processando'`
- `POST /videos/:publicId/complete` for a non-existent `publicId` returns 404 with `VIDEO_NOT_FOUND`
- `POST /videos/:publicId/complete` by a user who does not own the video's channel returns 403 with `FORBIDDEN`
- `POST /videos/:publicId/complete` on an already-completed video returns 409 with `UPLOAD_ALREADY_COMPLETED`
- Completing the upload emits exactly one `'video.processing'` message on the queue

---

### SI-03.7 — DELETE /videos/:publicId (Abort Upload)

**Description:** Implement the endpoint that aborts an in-progress multipart upload and removes the draft video row.

**Technical actions:**

1. Add `InvalidUploadStateException` (409, `INVALID_UPLOAD_STATE`) to `src/videos/exceptions/video.exceptions.ts`
2. Implement `abortUpload(channelId: string, publicId: string): Promise<void>` in `VideosService` — reuse the not-found/ownership checks from `completeUpload`; throw `InvalidUploadStateException` if `status !== 'rascunho'`; call `storageService.abortMultipartUpload()`; delete the video row (per `phase-03-videos/TD-02`)
3. Add `@Delete(':publicId')` to `VideosController` — returns 204

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | `abortUpload`: happy path calls storage abort and deletes the row; throws `VideoNotFoundException`/`ForbiddenVideoAccessException`/`InvalidUploadStateException` |
| `test/videos.e2e-spec.ts` | E2E | `DELETE /videos/:publicId` 204, 404 unknown id, 403 non-owner, 409 when not `rascunho` |

**Dependencies:** SI-03.6

**Acceptance criteria:**

- `DELETE /videos/:publicId` on a `rascunho` video returns 204 — the video row no longer exists
- `DELETE /videos/:publicId` for a non-existent `publicId` returns 404 with `VIDEO_NOT_FOUND`
- `DELETE /videos/:publicId` by a non-owner returns 403 with `FORBIDDEN`
- `DELETE /videos/:publicId` on a video already `processando` or `pronto` returns 409 with `INVALID_UPLOAD_STATE`

---

### SI-03.8 — Video Worker (FFmpeg Processing)

**Description:** Create the hybrid NestJS microservice that consumes video-processing jobs from RabbitMQ, extracts metadata and a thumbnail via `ffprobe`/`ffmpeg`, and updates the video's status accordingly.

**Technical actions:**

1. Create `src/worker/main.ts` — bootstrap via `NestFactory.createMicroservice(WorkerModule, { transport: Transport.RMQ, options: { urls: [queueConfig.rabbitmqUrl], queue: queueConfig.videoProcessingQueue, queueOptions: { durable: true }, noAck: false } })` then `app.listen()` (per `phase-03-videos/TD-01`)
2. Create `src/worker/worker.module.ts` — `WorkerModule` importing `ConfigModule`, `TypeOrmModule.forFeature([Video])`, `StorageModule`; providing `VideoProcessingConsumer` and `VideoProcessingService`
3. Create `src/worker/video-processing.consumer.ts` — `VideoProcessingConsumer` with `@EventPattern('video.processing')` handler `handleProcessing(@Payload() data: { videoId: string; originalKey: string }, @Ctx() context: RmqContext)` — delegates to `videoProcessingService.process()` and acks the message exactly once regardless of outcome (per `phase-03-videos/TD-04` — no automatic retry)
4. Create `src/worker/video-processing.service.ts` — `VideoProcessingService.process(videoId, originalKey)`: download the original from storage to a temp file; spawn `ffprobe -print_format json -show_format -show_streams <file>` via `child_process` and parse the JSON output for `duration_seconds`/`width`/`height`/`codec`/`bitrate`; spawn `ffmpeg -ss <timestamp> -frames:v 1 <file> <thumbnail>` to extract a frame (per `phase-03-videos/TD-03`); upload the thumbnail to `videos/{channelId}/{videoId}/thumbnail.jpg`; update the video row with the extracted metadata, `thumbnail_key`, and `status: 'pronto'`. On any failure (non-zero exit code, malformed JSON, storage error), catch it and set `status: 'erro'` with `processing_error` populated (per `phase-03-videos/TD-04`)
5. Add a `worker` service to `nestjs-project/compose.yaml` — reuses the existing Dockerfile, overrides the command to run the worker entrypoint, depends on `db`, `rabbitmq`, and `minio`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/worker/video-processing.service.spec.ts` | Unit | `process()`: `ffprobe` JSON parsed into the correct metadata fields; a spawn failure or malformed JSON sets `status: 'erro'` with `processing_error`; the happy path sets `status: 'pronto'` |
| `src/worker/video-processing.consumer.spec.ts` | Unit | `handleProcessing` delegates to the service and acks the message exactly once, regardless of outcome |
| `src/worker/worker.module.spec.ts` | Unit | Module compiles with `TypeOrmModule.forFeature` + `StorageModule` wiring |

**Dependencies:** SI-03.2, SI-03.3, SI-03.4

**Acceptance criteria:**

- A queued `'video.processing'` message for a valid file results in the video's `status` becoming `'pronto'` with `duration_seconds`, `width`, `height`, `codec`, `bitrate`, and `thumbnail_key` populated
- A queued message whose `ffprobe`/`ffmpeg` invocation fails results in `status: 'erro'` with `processing_error` populated — no automatic reprocessing is attempted
- The message is acknowledged exactly once per delivery, regardless of processing outcome
- `docker compose up -d worker` starts the worker process, which connects to RabbitMQ and consumes from the configured queue

---

### SI-03.9 — GET /videos/:publicId (Status and Metadata)

**Description:** Implement the endpoint that returns a video's current status and metadata, visible to anyone once the video is ready and to its owner at any status.

**Technical actions:**

1. Implement `findByPublicId(publicId: string, requesterChannelId?: string): Promise<Video>` in `VideosService` — throw `VideoNotFoundException` when the video does not exist, or when `status !== 'pronto'` and `video.channel_id !== requesterChannelId`
2. Add `@Public() @Get(':publicId')` to `VideosController` — returns 200 with `{ id, status, original_filename, duration_seconds, width, height, created_at }`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | `findByPublicId`: owner sees any status; non-owner/anonymous sees only `pronto`, else throws `VideoNotFoundException` |
| `test/videos.e2e-spec.ts` | E2E | `GET /videos/:publicId` 200 for a `pronto` video requested anonymously, 404 for a `rascunho` video requested anonymously, 200 for the owner regardless of status |

**Dependencies:** SI-03.6

**Acceptance criteria:**

- `GET /videos/:publicId` for a `'pronto'` video returns 200 with its metadata, with or without authentication
- `GET /videos/:publicId` for a non-`'pronto'` video requested by its owner returns 200 with its metadata
- `GET /videos/:publicId` for a non-`'pronto'` video requested anonymously or by a non-owner returns 404 with `VIDEO_NOT_FOUND`

---

### SI-03.10 — GET /videos/:publicId/stream and /download

**Description:** Implement the two delivery endpoints that redirect the client directly to storage via a short-lived presigned URL, reusing the storage layer's native Range/206 support.

**Technical actions:**

1. Add `VideoNotReadyException` (409, `VIDEO_NOT_READY`) to `src/videos/exceptions/video.exceptions.ts`
2. Implement `getStreamUrl(publicId, requesterChannelId?)` and `getDownloadUrl(publicId, requesterChannelId?)` in `VideosService` — reuse the visibility check from `findByPublicId`; throw `VideoNotReadyException` if `status !== 'pronto'`; call `storageService.getPresignedGetUrl(original_key, { expiresIn: 900 })` for streaming, and with `responseContentDisposition: 'attachment; filename="<original_filename>"'` for download (per `phase-03-videos/TD-06`)
3. Add `@Public() @Get(':publicId/stream')` and `@Public() @Get(':publicId/download')` to `VideosController` — each responds with a 302 redirect to the presigned URL

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | `getStreamUrl`/`getDownloadUrl`: throws `VideoNotFoundException` when invisible, `VideoNotReadyException` when not `pronto`, returns a presigned URL when `pronto`; the download URL carries the attachment disposition |
| `test/videos.e2e-spec.ts` | E2E | `GET /videos/:publicId/stream` 302 to a presigned URL when `pronto`, 409 when not ready; `GET /videos/:publicId/download` 302 with attachment disposition, 404 for an unknown id |

**Dependencies:** SI-03.9, SI-03.3

**Acceptance criteria:**

- `GET /videos/:publicId/stream` on a `'pronto'` video returns 302 with a `Location` header pointing to storage
- `GET /videos/:publicId/stream` on a non-`'pronto'` video returns 409 with `VIDEO_NOT_READY`
- `GET /videos/:publicId/download` on a `'pronto'` video returns 302 with a `Location` header whose URL carries an attachment content-disposition
- Both endpoints return 404 with `VIDEO_NOT_FOUND` for an unknown `publicId`

---

### SI-03.11 — End-to-End Upload-to-Playback Flow

**Description:** Add an end-to-end test exercising the full lifecycle — initiate, upload chunks directly to MinIO, complete, wait for the worker to process, then stream and download — against the real Docker Compose stack.

**Technical actions:**

1. Create `test/videos-flow.e2e-spec.ts` — `POST /videos` to initiate, `PUT` each returned presigned part URL directly against MinIO with a small fixture video file, `POST /videos/:publicId/complete` with the collected ETags, poll `GET /videos/:publicId` until `status` leaves `'processando'`, then assert `GET /videos/:publicId/stream` and `GET /videos/:publicId/download` both return 302

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `test/videos-flow.e2e-spec.ts` | E2E | Full upload → processing → playback flow transitions `rascunho` → `processando` → `pronto`, with a valid stream/download redirect at the end |

**Dependencies:** SI-03.6, SI-03.7, SI-03.8, SI-03.9, SI-03.10

**Acceptance criteria:**

- The full flow (initiate → upload parts → complete → worker processing → stream/download) succeeds end-to-end against a fixture video file
- After the worker finishes processing the fixture file, the video's `status` is `'pronto'` and its `duration_seconds` reflects the fixture's actual duration

---

## Technical Specifications

### Data Model

#### Video

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | Internal identifier — never exposed in URLs |
| public_id | varchar(12) | unique, not null | `nanoid()` URL-safe identifier — exposed in all public routes (phase-03-videos/TD-05) |
| channel_id | uuid | FK → channels.id, not null | Owning channel |
| status | enum | not null, default `'rascunho'`, values: `'rascunho'`, `'processando'`, `'pronto'`, `'erro'` | 3-state lifecycle, no automatic retry (phase-03-videos/TD-04) |
| original_filename | varchar | not null | Filename supplied by the client at upload initiation |
| original_key | varchar | nullable | Storage key of the uploaded original — set at initiation (phase-03-videos/TD-02) |
| upload_id | varchar | nullable | S3/MinIO multipart `UploadId` — cleared once `complete`/abort resolves (phase-03-videos/TD-02) |
| thumbnail_key | varchar | nullable | Storage key of the generated thumbnail — set by the worker on success (phase-03-videos/TD-03) |
| duration_seconds | integer | nullable | From `ffprobe` — set by the worker on success (phase-03-videos/TD-03) |
| width | integer | nullable | From `ffprobe` |
| height | integer | nullable | From `ffprobe` |
| codec | varchar | nullable | From `ffprobe` |
| bitrate | integer | nullable | From `ffprobe`, bits/sec |
| size_bytes | bigint | nullable | Confirmed at multipart completion |
| processing_error | text | nullable | Set when `status = 'erro'` — human-readable failure reason |
| created_at | timestamp | not null, auto-generated | |
| updated_at | timestamp | not null, auto-generated | |

**Relations:** Video → Channel (many-to-one)
**Indexes:** `(public_id)` — unique, `(channel_id)` — FK

**Bucket/key convention** (phase-03-videos/TD-02): `videos/{channelId}/{videoId}/original.<ext>` for the original file, `videos/{channelId}/{videoId}/thumbnail.jpg` for the generated thumbnail — `{videoId}` is the internal uuid, `<ext>` derived from `original_filename`.

---

### API Contracts

#### POST /videos (SI-03.5)

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- original_filename: string, required
- content_type: string, required — MIME type of the video file
- size_bytes: number, required — must not exceed 10GB (phase-03-videos/TD-02)

**Response 201:**
- id: string (public_id)
- upload_id: string — S3/MinIO multipart `UploadId`
- parts: array of `{ part_number: number, url: string }` — one presigned `UploadPartCommand` URL per ~10MB chunk (phase-03-videos/TD-02)

**Error responses:**
- 400 FILE_TOO_LARGE: when `size_bytes` exceeds the 10GB limit
- 400 validation error: when the request body fails schema validation

---

#### POST /videos/:publicId/complete (SI-03.6)

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- parts: array of `{ part_number: number, etag: string }`, required — one entry per uploaded chunk, in order

**Response 200:**
- id: string (public_id)
- status: string (`'processando'`)

**Error responses:**
- 404 VIDEO_NOT_FOUND: when `publicId` does not exist
- 403 FORBIDDEN: when the authenticated user does not own the video's channel
- 409 UPLOAD_ALREADY_COMPLETED: when the video's `status` is not `'rascunho'`
- 400 validation error: when the request body fails schema validation

---

#### DELETE /videos/:publicId (SI-03.7)

**Request headers:**
- Authorization: Bearer <access_token>

**Response 204:** No content.

**Error responses:**
- 404 VIDEO_NOT_FOUND: when `publicId` does not exist
- 403 FORBIDDEN: when the authenticated user does not own the video's channel
- 409 INVALID_UPLOAD_STATE: when the video's `status` is not `'rascunho'`

---

#### GET /videos/:publicId (SI-03.9)

**Request headers:**
- Authorization: Bearer <access_token> (optional — see Authorization Matrix)

**Response 200:**
- id: string (public_id)
- status: string
- original_filename: string
- duration_seconds: number, nullable
- width: number, nullable
- height: number, nullable
- created_at: string (ISO timestamp)

**Error responses:**
- 404 VIDEO_NOT_FOUND: when `publicId` does not exist, or when it exists but its `status` is not `'pronto'` and the requester is not the owner

---

#### GET /videos/:publicId/stream (SI-03.10)

**Response 302:** `Location` header set to a short-lived presigned `GetObjectCommand` URL for `original_key` (phase-03-videos/TD-06). The client's `<video>` element issues the byte-range requests directly against storage, which serves `206 Partial Content` natively.

**Error responses:**
- 404 VIDEO_NOT_FOUND: when `publicId` does not exist
- 409 VIDEO_NOT_READY: when `status` is not `'pronto'`

---

#### GET /videos/:publicId/download (SI-03.10)

**Response 302:** `Location` header set to a short-lived presigned `GetObjectCommand` URL for `original_key`, with `response-content-disposition=attachment` embedded in the signed URL (phase-03-videos/TD-06).

**Error responses:**
- 404 VIDEO_NOT_FOUND: when `publicId` does not exist
- 409 VIDEO_NOT_READY: when `status` is not `'pronto'`

#### Validation Rules — Video Upload

| Field | Rule | Error message |
|-------|------|---------------|
| size_bytes | Must not exceed 10737418240 (10GB) | size_bytes must not exceed 10GB |
| original_filename | Required, non-empty string | original_filename should not be empty |
| content_type | Required, non-empty string | content_type should not be empty |

---

### Authorization Matrix

| Endpoint | Anonymous | Authenticated (owner) | Authenticated (non-owner) |
|----------|-----------|------------------------|----------------------------|
| POST /videos | ✗ | ✓ | — |
| POST /videos/:publicId/complete | ✗ | ✓ | ✗ |
| DELETE /videos/:publicId | ✗ | ✓ | ✗ |
| GET /videos/:publicId | ✓ (only when `status = 'pronto'`) | ✓ (any status) | ✓ (only when `status = 'pronto'`) |
| GET /videos/:publicId/stream | ✓ (only when `status = 'pronto'`) | ✓ (only when `status = 'pronto'`) | ✓ (only when `status = 'pronto'`) |
| GET /videos/:publicId/download | ✓ (only when `status = 'pronto'`) | ✓ (only when `status = 'pronto'`) | ✓ (only when `status = 'pronto'`) |

---

### Error Catalog

**Error response format:** inherited from `phase-02-auth/TD-07` — `{ statusCode, error, message }`.

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| VIDEO_NOT_FOUND | 404 | Video not found | `publicId` does not exist, or exists but is not visible to the requester (not `pronto` and requester is not the owner) |
| FORBIDDEN | 403 | You do not own this video | Authenticated user's channel does not own the target video |
| UPLOAD_ALREADY_COMPLETED | 409 | Upload already completed | `POST /videos/:publicId/complete` when `status` is not `rascunho` |
| INVALID_UPLOAD_STATE | 409 | Video is not in an abortable state | `DELETE /videos/:publicId` when `status` is not `rascunho` |
| VIDEO_NOT_READY | 409 | Video is not ready for playback | `GET /videos/:publicId/stream` or `/download` when `status` is not `pronto` |
| FILE_TOO_LARGE | 400 | File exceeds the 10GB limit | `POST /videos` with `size_bytes` over 10GB |
| MULTIPART_COMPLETION_FAILED | 502 | Failed to finalize upload with storage | `CompleteMultipartUploadCommand` rejected by storage (e.g., ETag mismatch) |

---

### Events/Messages

#### video.processing

**Payload:**

```json
{ "videoId": "uuid", "originalKey": "string" }
```

**Producer:** `VideosService` (SI-03.6, via `VideoProcessingProducer` — SI-03.4) (per phase-03-videos/TD-01)
**Consumer:** Video Worker (`WorkerModule`, hybrid microservice — SI-03.8) (per phase-03-videos/TD-01)
**Trigger:** `POST /videos/:publicId/complete` succeeds — the video transitions to `status: 'processando'` and the job is emitted
**Delivery semantics:** at-least-once, no automatic retry on processing failure — a single failed attempt sets `status: 'erro'` with `processing_error` populated; reprocessing requires manual intervention (per phase-03-videos/TD-04, decision diverged from recommendation)

---

<!-- phase-a-complete -->

## Dependency Map

```
SI-03.1 (no deps)
├── SI-03.3
└── SI-03.4

SI-03.2 (no deps)

SI-03.2 + SI-03.3
└── SI-03.5

SI-03.4 + SI-03.5
└── SI-03.6
    ├── SI-03.7
    └── SI-03.9
        └── SI-03.10 (also depends on SI-03.3)

SI-03.2 + SI-03.3 + SI-03.4
└── SI-03.8

SI-03.6 + SI-03.7 + SI-03.8 + SI-03.9 + SI-03.10
└── SI-03.11
```

Linearized implementation order: SI-03.1, SI-03.2 (parallel) → SI-03.3, SI-03.4 (parallel) → SI-03.5 → SI-03.6 → SI-03.7, SI-03.8, SI-03.9 (parallel) → SI-03.10 → SI-03.11

---

## Deliverables

- [ ] SI-03.1 — Dependencies, Config Namespaces, and Docker Compose
- [ ] SI-03.2 — Video Entity and Migration
- [ ] SI-03.3 — StorageService (Presigned Multipart Upload and Presigned GET)
- [ ] SI-03.4 — Queue Producer (RabbitMQ)
- [ ] SI-03.5 — POST /videos (Initiate Multipart Upload)
- [ ] SI-03.6 — POST /videos/:publicId/complete
- [ ] SI-03.7 — DELETE /videos/:publicId (Abort Upload)
- [ ] SI-03.8 — Video Worker (FFmpeg Processing)
- [ ] SI-03.9 — GET /videos/:publicId (Status and Metadata)
- [ ] SI-03.10 — GET /videos/:publicId/stream and /download
- [ ] SI-03.11 — End-to-End Upload-to-Playback Flow

**Full test suites:**

- [ ] Backend tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation check passes (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`docker compose exec nestjs-api npm run lint`)
- [ ] Project builds successfully (`docker compose exec nestjs-api npm run build`)
