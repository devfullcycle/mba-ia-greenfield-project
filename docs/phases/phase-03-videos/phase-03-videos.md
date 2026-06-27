---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-04-08T14:58:57-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-06-27T00:00:00-03:00"
  docs/phases/phase-03-videos/context.md: "2026-06-27T00:00:00-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver large-file video upload (up to 10GB) without routing bytes through the API, automatic background processing (duration/metadata extraction and thumbnail generation) via a dedicated FFmpeg worker, a unique public URL per video, range-based streaming and download, and a `draft → processing → ready | error` status lifecycle — adding the object storage, processing queue, and video worker infrastructure to the Docker Compose stack.

---

## Step Implementations

### SI-03.1 — Dependencies, Config Namespaces, and Compose Infrastructure (MinIO + Redis + Worker)

**Description:** Install Phase 03 dependencies, add `storage` and `queue` config namespaces (`registerAs` pattern), extend the Joi schema and `.env.example`, and add MinIO, Redis, and the video-worker service to Docker Compose with a worker image carrying FFmpeg.

**Technical actions:**

- Install production dependencies in `nestjs-project`: `@nestjs/bullmq@^11`, `bullmq@^5`, `@aws-sdk/client-s3@^3`, `@aws-sdk/s3-request-presigner@^3`.
- Create `src/config/storage.config.ts` — `registerAs('storage', ...)` reading `STORAGE_ENDPOINT` (default `http://minio:9000`), `STORAGE_REGION` (default `us-east-1`), `STORAGE_ACCESS_KEY` (required), `STORAGE_SECRET_KEY` (required), `STORAGE_BUCKET` (default `streamtube-videos`), `STORAGE_FORCE_PATH_STYLE` (default `true`), `STORAGE_PRESIGN_EXPIRATION` (number, seconds, default `3600`), `UPLOAD_PART_SIZE` (number, bytes, default `10485760` = 10MB), `UPLOAD_MAX_SIZE` (number, bytes, default `10737418240` = 10GB).
- Create `src/config/queue.config.ts` — `registerAs('queue', ...)` reading `REDIS_HOST` (default `redis`), `REDIS_PORT` (number, default `6379`).
- Update `src/config/env.validation.ts` — add the new variables to the Joi schema (`STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` required, others with defaults). Update `.env.example` with Compose-compatible defaults (`STORAGE_ENDPOINT=http://minio:9000`, `REDIS_HOST=redis`, etc.).
- Add to `nestjs-project/compose.yaml`:
  - `minio` — image `minio/minio`, command `server /data --console-address ":9001"`, ports `9000:9000` + `9001:9001`, env `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, healthcheck `mc ready` / `curl -f http://localhost:9000/minio/health/live`, named volume `minio-data`.
  - `redis` — image `redis:7-alpine`, port `6379:6379`, healthcheck `redis-cli ping`.
  - `video-worker` — `build: { context: ., dockerfile: Dockerfile.worker }`, same volume mount as the API for dev, `command` running the worker entrypoint, `depends_on` db+redis+minio healthy, same `.env`.
  - `nestjs-api` `depends_on` extended with `minio` and `redis` (`condition: service_healthy`).
- Create `nestjs-project/Dockerfile.worker` — based on the dev image but `apt-get install -y ffmpeg`; default command runs the worker (`npm run worker:dev`).
- Add npm scripts: `worker:dev` (`nest start --watch --entryFile worker`), `worker:prod` (`node dist/worker`).

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/config/env.validation.integration-spec.ts` (extend) | Integration | New required storage vars cause a Joi error when missing; defaults applied when omitted |

**Dependencies:** None

**Acceptance criteria:**

- Application starts when all new env vars are provided — existing E2E (`GET /` 200) still passes.
- Starting without `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` causes a Joi validation error at bootstrap.
- `docker compose up -d` brings up `minio` (console at `localhost:9001`), `redis`, and `video-worker` alongside `nestjs-api` and `db`; all healthchecks pass.

---

### SI-03.2 — Video Entity and Migration

**Description:** Create the `Video` entity owned by a `Channel`, add the inverse relation on `Channel`, and generate the migration. The status enum and unique `public_id` are introduced here.

**Technical actions:**

- Create `src/videos/entities/video.entity.ts` — `@Entity('videos')` with columns per the Data Model below; `status` as a PostgreSQL enum (`draft`,`processing`,`ready`,`error`) defaulting to `draft`; `public_id` unique; `@ManyToOne(() => Channel)` with `@JoinColumn({ name: 'channel_id' })`.
- Add `@OneToMany(() => Video, (video) => video.channel) videos: Video[]` to `src/channels/entities/channel.entity.ts` (inverse side only — no new column).
- Create `src/videos/videos.constants.ts` — `VIDEO_PROCESSING_QUEUE = 'video-processing' as const`, `PROCESS_VIDEO_JOB = 'process-video' as const`, status enum, key-prefix helpers.
- Create `src/videos/videos.module.ts` — `TypeOrmModule.forFeature([Video])`; exports `TypeOrmModule`.
- Generate migration via `npm run migration:generate -- src/database/migrations/CreateVideos` and review the SQL (enum type, unique index on `public_id`, FK + index on `channel_id`).

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/entities/video.entity.integration-spec.ts` | Integration | Unique `public_id`; `status` defaults to `draft`; `channel` relation; nullable processing columns; timestamps auto-populated |
| `src/videos/videos.module.spec.ts` | Unit | Module compiles with `TypeOrmModule.forFeature` wiring |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `npm run migration:run` creates the `videos` table with the enum, unique `public_id`, and `channel_id` FK.
- Inserting a video with a duplicate `public_id` fails with a unique constraint violation.
- A new video defaults to `status = 'draft'`.
- A video cannot be inserted with a `channel_id` that does not exist (FK constraint).

---

### SI-03.3 — Storage Module and Service (MinIO/S3 via AWS SDK v3)

**Description:** Create a dedicated `StorageModule` exposing a `StorageService` that wraps the S3 client: bucket bootstrap, multipart lifecycle, presigned part URLs, ranged GET, head, and put (for thumbnails). Single responsibility: object storage only.

**Technical actions:**

- Create `src/storage/storage.module.ts` and `src/storage/storage.service.ts` — `StorageService` injecting `storageConfig`. Construct a single `S3Client` (`endpoint`, `region`, `forcePathStyle`, `credentials`).
- Implement methods: `ensureBucket(): Promise<void>` (`HeadBucketCommand`/`CreateBucketCommand`), `createMultipartUpload(key, contentType): Promise<string>` (returns `UploadId`), `getPresignedPartUrl(key, uploadId, partNumber): Promise<string>` (`getSignedUrl` over `UploadPartCommand`, `expiresIn` from config), `completeMultipartUpload(key, uploadId, parts): Promise<void>`, `abortMultipartUpload(key, uploadId): Promise<void>`, `getObjectRange(key, range?): Promise<{ stream, contentLength, contentRange?, contentType }>` (`GetObjectCommand` with optional `Range`), `headObject(key): Promise<{ contentLength, contentType }>`, `putObject(key, body, contentType): Promise<void>`, `deleteObject(key): Promise<void>`.
- Call `ensureBucket()` on module init (`OnModuleInit`) so the bucket exists on first boot.
- Export `StorageService`.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/storage/storage.service.integration-spec.ts` | Integration (real MinIO) | Bucket bootstrap idempotent; multipart create→presign→PUT part→complete round-trips an object; `getObjectRange` returns the requested byte range; `putObject`/`headObject` for a thumbnail; `abortMultipartUpload` cleans up |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- Against the running MinIO service, a small object can be uploaded via the multipart presigned flow and read back byte-for-byte.
- A ranged GET (`bytes=0-4`) returns exactly 5 bytes with a correct `Content-Range`.
- `ensureBucket()` is safe to call repeatedly (no error if the bucket already exists).

---

### SI-03.4 — Queue Wiring and Worker Bootstrap

**Description:** Register BullMQ against Redis, expose the producer queue, and create the standalone worker application context with a `VideoProcessor` consumer skeleton. End-to-end enqueue→consume is proven against the real Redis service.

**Technical actions:**

- Register `BullModule.forRootAsync` (Redis connection from `queueConfig`) in `VideosModule` (or a shared `QueueModule`), and `BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE })`.
- Create `src/videos/video-processor.ts` — `@Processor(VIDEO_PROCESSING_QUEUE) class VideoProcessor extends WorkerHost`, `process(job)` skeleton that will be filled in SI-03.6; inject `Video` repository + `StorageService`.
- Create `src/worker.ts` — worker entrypoint: `NestFactory.createApplicationContext(WorkerModule)` (no HTTP server), enabling graceful shutdown hooks.
- Create `src/worker.module.ts` — imports `ConfigModule` (global), `TypeOrmModule.forRootAsync`, `BullModule.forRootAsync` + `registerQueue`, `StorageModule`, `TypeOrmModule.forFeature([Video])`, and provides `VideoProcessor`. (The API process registers only the producer; the worker process registers the consumer.)
- Add `VideoQueueService` (producer) in `src/videos/` injecting `@InjectQueue(VIDEO_PROCESSING_QUEUE)`: `enqueueProcessing(videoId): Promise<void>` adding `PROCESS_VIDEO_JOB` with `{ attempts: 3, backoff: { type: 'exponential', delay: 5000 } }`.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/video-queue.service.integration-spec.ts` | Integration (real Redis) | A job added by the producer is received by a worker; payload shape `{ videoId }`; retry options applied |

**Dependencies:** SI-03.1, SI-03.2, SI-03.3

**Acceptance criteria:**

- With Redis running, enqueuing a `process-video` job results in the consumer's `process()` being invoked with the correct payload.
- The worker application context boots without starting an HTTP listener.
- A job that throws is retried per the configured attempts/backoff.

---

### SI-03.5 — Upload Flow (Draft Pre-registration → Presigned Parts → Complete → Enqueue)

**Description:** Implement the non-blocking upload handshake: pre-register the video as `draft` and start a multipart upload, hand out presigned part URLs, then complete the upload, transition to `processing`, and enqueue processing. Includes the unique public-id generator and owner authorization.

**Technical actions:**

- Create `src/videos/public-id.util.ts` — `generatePublicId(): string` using `crypto.randomBytes(8).toString('base64url')`; pure function.
- Create DTOs: `src/videos/dto/init-upload.dto.ts` (`title` required non-empty ≤255, `filename` required, `contentType` required, `size` int 1..`UPLOAD_MAX_SIZE`), `src/videos/dto/complete-upload.dto.ts` (`parts: { partNumber: int≥1, etag: string }[]` non-empty).
- Create `src/videos/videos.service.ts`:
  - `initUpload(userId, dto)` — resolve the user's channel (via `ChannelsService`/repository); generate `public_id` with retry-on-collision; compute `storage_key = videos/{id}/original/{filename}`; `createMultipartUpload`; persist the `Video` row (`status: draft`, `upload_id`, `storage_key`, `original_filename`, `size_bytes`, `title`); compute `partSize`/`partCount`; return `{ videoId: public_id, uploadId, partSize, partCount }`.
  - `getPartUrl(userId, publicId, partNumber)` — load video, assert owner + `draft`, return presigned part URL.
  - `completeUpload(userId, publicId, dto)` — load video, assert owner + `draft`; `completeMultipartUpload`; set `status: processing`; enqueue processing job; return `{ videoId, status }`.
  - `findByPublicIdOrThrow`, ownership guard helper, status-guard helper.
- Create `src/videos/videos.controller.ts` — `POST /videos` (auth), `GET /videos/:publicId/upload-url?partNumber=N` (auth, owner), `POST /videos/:publicId/complete` (auth, owner).
- Wire `ChannelsModule` import into `VideosModule` to resolve the channel; register `VideosController`, `VideosService`, `VideoQueueService`.
- Add domain exceptions: `VideoNotFoundException` (404), `VideoForbiddenException` (403), `VideoInvalidStateException` (409), and use validation errors for bad input.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/public-id.util.spec.ts` | Unit | URL-safe charset, length, uniqueness across many calls |
| `src/videos/videos.service.spec.ts` | Unit | Draft creation flow, owner/status guards, collision retry (mocked repo/storage/queue) |
| `src/videos/videos.service.integration-spec.ts` | Integration | Real DB + MinIO: draft row persisted, multipart started, complete transitions to `processing`, job enqueued (Redis) |
| `test/videos-upload.e2e-spec.ts` | E2E | `POST /videos` → 201 draft; `GET upload-url` → presigned URL; PUT a small part to MinIO; `POST complete` → 200 processing; non-owner gets 403; unauthenticated gets 401 |

**Dependencies:** SI-03.2, SI-03.3, SI-03.4

**Acceptance criteria:**

- `POST /videos` pre-registers a `draft` and returns a `uploadId` + part plan without receiving any file bytes.
- A part can be uploaded directly to MinIO using the returned presigned URL (bytes never traverse the API).
- `POST /videos/:publicId/complete` transitions the video to `processing` and enqueues a processing job.
- Only the owning channel's user can request part URLs or complete the upload (403 otherwise); both require authentication (401 otherwise).
- Each created video has a unique `public_id`.

---

### SI-03.6 — Worker Video Processing (Metadata + Thumbnail, Status Transitions)

**Description:** Fill in `VideoProcessor.process`: pull the original from storage, extract duration/metadata with `ffprobe`, generate a thumbnail frame with `ffmpeg`, upload the thumbnail, and transition the video `processing → ready`; on failure after retries, transition to `error` with a reason.

**Technical actions:**

- Create `src/videos/processing/ffmpeg.service.ts` — `extractMetadata(inputPath): Promise<{ durationSeconds, width, height, codec, ... }>` (spawn `ffprobe -v quiet -print_format json -show_format -show_streams`, parse JSON) and `generateThumbnail(inputPath, outputPath, atSeconds): Promise<void>` (spawn `ffmpeg -ss <ts> -i <in> -frames:v 1 -q:v 2 <out>`). Use `child_process.execFile` with explicit args (no shell).
- In `VideoProcessor.process(job)` — load the `Video` by `videoId`; if already `ready`, return (idempotent); download the original from storage to a temp file (stream `getObjectRange` without range, or `getObject`); run `extractMetadata`; run `generateThumbnail`; `putObject` the thumbnail at `videos/{id}/thumbnail.jpg`; update the video (`duration_seconds`, `metadata`, `thumbnail_key`, `status: ready`); clean up temp files.
- Add an `@OnWorkerEvent('failed')` handler (or catch in `process`) that, when `job.attemptsMade` has reached `attempts`, sets `status: error` and `error_reason`.
- Guard transitions: only a `processing` (or re-entrant `processing`) video moves to `ready`/`error`.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/processing/ffmpeg.service.integration-spec.ts` | Integration (real ffmpeg) | `extractMetadata` returns a plausible duration for a tiny sample clip; `generateThumbnail` writes a non-empty JPEG |
| `src/videos/video-processor.integration-spec.ts` | Integration (DB + MinIO + Redis + ffmpeg) | End-to-end job: seed a `processing` video with a real uploaded sample, run the processor, assert `status = ready`, `duration_seconds` set, thumbnail object present; a corrupt input ends in `status = error` after retries |

**Dependencies:** SI-03.2, SI-03.3, SI-03.4

**Acceptance criteria:**

- After `complete`, the worker processes the video and sets `status = ready` with `duration_seconds`, `metadata`, and a thumbnail object in storage.
- A video that fails processing (e.g., corrupt file) ends in `status = error` with an `error_reason`, after the configured retries.
- Re-running a job for an already-`ready` video is a no-op (idempotent).

---

### SI-03.7 — Streaming, Download, Thumbnail, and Status Read Endpoints

**Description:** Expose the public delivery endpoints keyed by `public_id`: ranged streaming (`206`), full download (attachment), thumbnail, and video metadata/status for polling. Anonymous access is allowed; non-ready videos are not streamable.

**Technical actions:**

- Add to `VideosService`: `getPublicMetadata(publicId)`, `openStream(publicId, range)` (assert `ready`, delegate to `StorageService.getObjectRange`), `openDownload(publicId)`, `openThumbnail(publicId)`.
- Add to `VideosController` (all `@Public()`):
  - `GET /videos/:publicId` → `{ videoId, title, status, durationSeconds, hasThumbnail, createdAt }`.
  - `GET /videos/:publicId/stream` → read `Range` header; respond `206 Partial Content` with `Accept-Ranges: bytes`, `Content-Range`, `Content-Length`, `Content-Type`, piping the storage stream; full `200` when no `Range`.
  - `GET /videos/:publicId/download` → `200` with `Content-Disposition: attachment; filename="..."`, piping the full object.
  - `GET /videos/:publicId/thumbnail` → `200 image/jpeg` (or `404` if no thumbnail yet).
- Add `VideoNotReadyException` (409) for stream/download on non-`ready` videos; `VideoNotFoundException` (404) for unknown `public_id`.
- Set `@Res({ passthrough: false })` streaming with proper header management; ensure the response stream is destroyed on client abort.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` (extend) | Unit | Status guards for stream/download (non-ready → 409), metadata mapping |
| `test/videos-stream.e2e-spec.ts` | E2E | After a real upload+process, `GET /stream` with `Range: bytes=0-` returns `206` + `Content-Range`; `GET /download` returns the full body with `Content-Disposition`; `GET /thumbnail` returns a JPEG; streaming a non-ready video returns `409`; unknown id returns `404`; anonymous (no token) can stream a ready video |

**Dependencies:** SI-03.2, SI-03.3 (uses processed output from SI-03.6 in e2e)

**Acceptance criteria:**

- `GET /videos/:publicId/stream` with a `Range` header returns `206 Partial Content` and only the requested bytes — playback does not require a full download.
- `GET /videos/:publicId/download` streams the full original with an attachment disposition.
- A `ready` video is streamable anonymously; a `draft`/`processing` video returns `409`; an unknown `public_id` returns `404`.
- Storage credentials/URLs are never exposed to the client — the API mediates all byte delivery.

---

## Technical Specifications

### Data Model

#### Video

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | Internal identifier (queue payload, FKs) |
| public_id | varchar | unique, not null | Short URL-safe handle (`crypto` base64url) — the single public URL |
| channel_id | uuid | FK → channels.id, not null | Owning channel |
| title | varchar(255) | not null | Provided at upload init |
| status | enum | not null, default `'draft'` | `draft` \| `processing` \| `ready` \| `error` |
| storage_key | varchar | nullable | Key of the original object (`videos/{id}/original/{filename}`) |
| thumbnail_key | varchar | nullable | Key of the generated thumbnail (`videos/{id}/thumbnail.jpg`) |
| upload_id | varchar | nullable | S3 multipart `UploadId` (cleared after complete) |
| original_filename | varchar | nullable | Provided at upload init |
| size_bytes | bigint | nullable | Declared file size |
| duration_seconds | int | nullable | Set by the worker (ffprobe) |
| metadata | jsonb | nullable | ffprobe streams/format subset (width, height, codec, bitrate) |
| error_reason | text | nullable | Set when `status = error` |
| created_at | timestamp | not null, auto-generated | `@CreateDateColumn` |
| updated_at | timestamp | not null, auto-generated | `@UpdateDateColumn` |

**Relations:** Video → Channel (many-to-one via `channel_id`); Channel → Video (one-to-many, inverse).
**Indexes:** `(public_id)` — unique; `(channel_id)` — FK; `(status)` — for status queries.

### API Contracts

#### POST /videos (SI-03.5) — initiate upload

**Auth:** Bearer access token. **Body:** `title` (string, 1..255), `filename` (string), `contentType` (string), `size` (int, 1..`UPLOAD_MAX_SIZE`).
**Response 201:** `{ videoId: string, uploadId: string, partSize: number, partCount: number }`.
**Errors:** 401 (unauthenticated); 400 VALIDATION_ERROR (bad body, size over max); 404 CHANNEL_NOT_FOUND (user has no channel).

#### GET /videos/:publicId/upload-url?partNumber=N (SI-03.5)

**Auth:** Bearer. Owner only. **Response 200:** `{ partNumber: number, url: string }` (presigned `UploadPart` URL).
**Errors:** 401; 403 VIDEO_FORBIDDEN; 404 VIDEO_NOT_FOUND; 409 VIDEO_INVALID_STATE (not `draft`); 400 (bad `partNumber`).

#### POST /videos/:publicId/complete (SI-03.5)

**Auth:** Bearer. Owner only. **Body:** `{ parts: [{ partNumber: int, etag: string }] }` (non-empty).
**Response 200:** `{ videoId: string, status: 'processing' }`.
**Errors:** 401; 403 VIDEO_FORBIDDEN; 404 VIDEO_NOT_FOUND; 409 VIDEO_INVALID_STATE (not `draft`); 400 VALIDATION_ERROR (empty/invalid parts).

#### GET /videos/:publicId (SI-03.7) — metadata/status

**Auth:** Public. **Response 200:** `{ videoId, title, status, durationSeconds, hasThumbnail, createdAt }`.
**Errors:** 404 VIDEO_NOT_FOUND.

#### GET /videos/:publicId/stream (SI-03.7)

**Auth:** Public. **Request header:** `Range: bytes=...` (optional).
**Response 206:** Partial Content with `Accept-Ranges`, `Content-Range`, `Content-Length`, `Content-Type`. **Response 200:** full body when no `Range`.
**Errors:** 404 VIDEO_NOT_FOUND; 409 VIDEO_NOT_READY (status ≠ `ready`).

#### GET /videos/:publicId/download (SI-03.7)

**Auth:** Public. **Response 200:** full object with `Content-Disposition: attachment; filename="..."`.
**Errors:** 404 VIDEO_NOT_FOUND; 409 VIDEO_NOT_READY.

#### GET /videos/:publicId/thumbnail (SI-03.7)

**Auth:** Public. **Response 200:** `image/jpeg`. **Errors:** 404 VIDEO_NOT_FOUND (no thumbnail yet → 404).

### Authorization Matrix

| Endpoint | Public | Authenticated | Owner-only | Notes |
|----------|:------:|:-------------:|:----------:|-------|
| POST /videos | | ✓ | | Any authenticated user with a channel |
| GET /videos/:id/upload-url | | ✓ | ✓ | Owner of the video's channel |
| POST /videos/:id/complete | | ✓ | ✓ | Owner of the video's channel |
| GET /videos/:id | ✓ | | | Anonymous metadata/status |
| GET /videos/:id/stream | ✓ | | | Anonymous, `ready` only |
| GET /videos/:id/download | ✓ | | | Anonymous, `ready` only |
| GET /videos/:id/thumbnail | ✓ | | | Anonymous |

Ownership is `video.channel.user_id === currentUser.sub`, resolved by loading the video with its channel relation.

### Error Catalog

Error envelope (inherited from Fase 02 — TD-07): `{ statusCode, error, message }`; validation errors use `error: 'VALIDATION_ERROR'` with an array `message`.

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| VIDEO_NOT_FOUND | 404 | Video not found | Any endpoint with an unknown `public_id` |
| VIDEO_FORBIDDEN | 403 | You do not own this video | upload-url/complete on a video owned by another channel |
| VIDEO_INVALID_STATE | 409 | Video is not in a valid state for this operation | upload-url/complete when status ≠ `draft` |
| VIDEO_NOT_READY | 409 | Video is not ready for playback | stream/download when status ≠ `ready` |
| CHANNEL_NOT_FOUND | 404 | Channel not found for user | POST /videos when the user has no channel |

### Events / Messages (Queue)

**Transport:** BullMQ over Redis (TD-01). **Queue name:** `video-processing` (`VIDEO_PROCESSING_QUEUE`).

| Job | Producer | Consumer | Payload | Options | On failure |
|-----|----------|----------|---------|---------|-----------|
| `process-video` | `VideoQueueService.enqueueProcessing` (API, after `CompleteMultipartUpload`) | `VideoProcessor.process` (worker) | `{ videoId: string }` (internal uuid) | `attempts: 3`, `backoff: { type: 'exponential', delay: 5000 }`, `removeOnComplete: true`, `removeOnFail: false` | After final attempt → video `status = error` + `error_reason`; failed jobs retained for inspection |

**Delivery semantics:** at-least-once → the consumer is idempotent (keyed by `videoId`; already-`ready` videos are skipped; metadata/thumbnail are deterministically re-derivable). Producer and consumer share the queue name constant and the Redis connection (`queue.config.ts`, host = `redis`).

## Dependency Map

```
SI-03.1 (no deps)
├── SI-03.2
├── SI-03.3
└── SI-03.4   (also needs SI-03.2 + SI-03.3)

SI-03.2 + SI-03.3 + SI-03.4
├── SI-03.5
└── SI-03.6

SI-03.2 + SI-03.3
└── SI-03.7   (e2e also exercises SI-03.6 output)
```

Linearized implementation order: SI-03.1 → SI-03.2 → SI-03.3 → SI-03.4 → SI-03.5 → SI-03.6 → SI-03.7.

## Deliverables

- [ ] MinIO (object storage), Redis (queue), and a dedicated video-worker service running via `docker compose` alongside the API and DB
- [ ] `Video` entity + migration creating the `videos` table, owned by a `Channel`
- [ ] 10GB-capable upload: presigned multipart, client → storage directly, never through the API; `draft` pre-registration on init
- [ ] Automatic processing after `complete`: duration/metadata extraction (`ffprobe`) and thumbnail generation (`ffmpeg`) in the worker
- [ ] Unique public URL per video (`public_id`, unique constraint, collision retry)
- [ ] Range-based streaming (`206 Partial Content`) without full download, plus full download (attachment)
- [ ] Status lifecycle `draft → processing → ready | error` reflected in the DB, with bounded retries and terminal `error` + reason
- [ ] Owner-only authorization on upload mutations; anonymous access to stream/download/metadata of ready videos
- [ ] Storage credentials never exposed to clients (API mediates delivery)
- [ ] Unit + integration (real MinIO/Redis/ffmpeg/DB) + e2e tests green (`npm test`, `npm run test:e2e`)
- [ ] `npx tsc --noEmit` exits 0; `npm run lint` passes; project builds
- [ ] `CLAUDE.md` updated with the videos module, endpoints, queue/worker, and storage
