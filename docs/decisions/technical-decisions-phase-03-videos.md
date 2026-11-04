---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-10-28
scope_description: "Backend foundation for video upload and processing: S3/MinIO object storage organization, BullMQ/Redis background queue, 10GB multipart presigned upload with atomic draft pre-registration, standalone FFmpeg/ffprobe video worker, video status lifecycle, unique URL slug generation, HTTP Range streaming, and video download."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend API and standalone `video-worker` process that deliver S3/MinIO object storage integration, up to 10GB multipart/presigned video uploads, automatic draft pre-registration, BullMQ background queue processing, FFmpeg/ffprobe metadata & thumbnail extraction, unique conflict-free video URLs (`slug`), HTTP Range (`206 Partial Content`) video streaming, and video download.
- `next-frontend/` — Frontend out of scope for this phase: Phase 03 capabilities in `docs/project-plan.md` are backend/infrastructure capabilities; video player and upload UI screens belong to Phase 04 (`Visualização e Gestão de Vídeos`).

---

## TD-01: Object Storage Client & Bucket Organization

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** Phase 03 requires storing raw video files (up to 10GB each) and generated JPEG thumbnails in S3-compatible object storage (MinIO in Docker for local/test environments, Amazon S3 in production, as defined in `docs/diagrams/software-arch.mermaid`). We need to choose the Node.js client SDK and the bucket/key organization layout.

**Options:**

### Option A: AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`) with Single Bucket and Prefix Keys
- Use the official modular AWS SDK v3 (`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`) configured with `forcePathStyle: true` and custom `endpoint` for MinIO compatibility. Store all media artifacts in a single bucket (`S3_BUCKET`, default `streamtube-videos`) partitioned by deterministic object key prefixes: `videos/<videoId>/original.<ext>` for raw video files and `thumbnails/<videoId>/thumb.jpg` for extracted thumbnails.
- **Pros:** First-party AWS SDK v3 with tree-shakable modular packages, native TypeScript types, built-in support for S3 Multipart Upload (`CreateMultipartUploadCommand`, `UploadPartCommand`, `CompleteMultipartUploadCommand`, `AbortMultipartUploadCommand`) and byte-range `GetObjectCommand`. Single bucket simplifies configuration, IAM policy management, and container initialization (`HeadBucketCommand` / `CreateBucketCommand` check on startup). Zero code change when switching from MinIO to AWS S3 in production.
- **Cons:** Requires `forcePathStyle: true` in `S3Client` config so MinIO resolves bucket paths without DNS wildcard subdomains. Slightly more verbose command-pattern API than legacy SDKs.

### Option B: MinIO JavaScript Client (`minio`) with Separate Buckets per Media Type
- Use the `minio` npm package and provision two separate buckets (`streamtube-videos` and `streamtube-thumbnails`).
- **Pros:** Higher-level helper methods for basic bucket operations. Physical bucket separation between raw videos and thumbnails.
- **Cons:** Less idiomatic when targeting AWS S3 in production. Lacks first-class modular TypeScript command patterns for fine-grained S3 Multipart Upload part signing compared to `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. Managing multiple buckets doubles bootstrap provisioning and environment variables.

**Recommendation:** **Option A (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` with single bucket and key prefixes)** — Official modular S3 SDK with first-class multipart upload, presigned URL generation, and byte-range streaming support. A single configurable bucket with `videos/<videoId>/...` and `thumbnails/<videoId>/...` prefixes keeps lifecycle rules and IAM policies clean while remaining 100% compatible with both MinIO and AWS S3.

**Decision:** A (AWS SDK v3 with single bucket and prefix-based keys)

---

## TD-02: Background Job Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** `docs/project-plan.md` leaves the queue technology explicitly open (`Fila de processamento: TBD`) while `docs/diagrams/software-arch.mermaid` illustrates a `Queue` broker between the NestJS API and the `VideoWorker` container, plus `Redis` in the infrastructure stack. Video metadata extraction and thumbnail generation are CPU- and IO-bound tasks that must run asynchronously after upload completion without blocking HTTP requests.

**Options:**

### Option A: BullMQ (`@nestjs/bullmq` + `bullmq`) on Redis 7
- Use the official `@nestjs/bullmq` integration package backed by `bullmq` and a `redis:7-alpine` container in Docker Compose. The API enqueues jobs into the `video-processing` queue via `@InjectQueue('video-processing')`, and the worker consumes them via `@Processor('video-processing')` extending `WorkerHost`.
- **Pros:** Official `@nestjs/bullmq` package maintained by the NestJS core team with idiomatic decorators (`@Processor`, `@OnWorkerEvent`, `@InjectQueue`) and full NestJS DI support. Built-in job retries with exponential backoff, concurrency control, stalled-job recovery, and job deduplication (`jobId`). Redis 7 is lightweight in Docker and already anticipated in `docs/diagrams/software-arch.mermaid` for future phases (Phase 05 caching).
- **Cons:** Requires Redis persistence configuration (`appendonly yes`) if jobs must survive broker restarts. Only supports Redis-compatible brokers.

### Option B: RabbitMQ (`@golevelup/nestjs-rabbitmq` / `amqplib`)
- Use RabbitMQ (`rabbitmq:3-management-alpine`) with AMQP exchanges, queues, and dead-letter exchanges (DLX).
- **Pros:** Mature message broker with complex routing topologies (fanout, topic exchanges) and native AMQP acknowledgments.
- **Cons:** No first-party NestJS queue lifecycle abstraction matching `@nestjs/bullmq` for delayed retries and exponential backoff (requires manual DLX + TTL queue wiring). Adds a heavier broker container when Redis is already part of the target architecture.

### Option C: PostgreSQL-Backed Queue (`pg-boss`)
- Use `pg-boss` on top of the existing PostgreSQL 17 database using `SKIP LOCKED` polling.
- **Pros:** Reuses existing PostgreSQL container — no additional broker service needed. Transactional job enqueueing alongside entity writes.
- **Cons:** No official `@nestjs/*` module. Adds polling load to the primary relational database and diverges from `docs/diagrams/software-arch.mermaid`, which separates the `Queue` broker from `PostgreSQL`.

**Recommendation:** **Option A (`@nestjs/bullmq` + `bullmq` on Redis 7)** — Provides the best NestJS 11 integration via `@nestjs/bullmq`, native exponential backoff retry management, stalled-job recovery for long-running FFmpeg tasks, and introduces the Redis container already planned in the target architecture.

**Decision:** A (`@nestjs/bullmq` + `bullmq` on Redis 7)

---

## TD-03: 10GB Upload Strategy & Automatic Draft Pre-Registration

**Scope:** Backend

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload"

**Context:** Users can upload video files up to 10GB (`10 * 1024 * 1024 * 1024 = 10,737,418,240` bytes). Streaming multi-gigabyte payloads through the NestJS HTTP process would saturate Node.js memory, tie up connections, and degrade API latency for all concurrent users. Furthermore, the S3 protocol enforces a hard 5GB limit on a single `PUT` object request, meaning files between 5GB and 10GB require S3 Multipart Upload. At the same time, initiating an upload must automatically pre-register the video as a draft (`status = 'draft'`) linked to the user's channel.

**Options:**

### Option A: Direct-to-S3 Multipart Upload via Presigned URLs Orchestrated by API (with Atomic Draft Pre-Registration)
- Decouple control plane (NestJS API) from data plane (S3/MinIO):
  1. **Initiate (`POST /videos/uploads/init`):** Authenticated user sends `{ title, description?, original_filename, mime_type, size_bytes }`. API validates `size_bytes <= 10,737,418,240` (10GB) and allowed video MIME types (`video/mp4`, `video/webm`, `video/quicktime`, `video/x-matroska`), resolves the user's channel, generates a unique `slug`, initiates an S3 Multipart Upload (`CreateMultipartUploadCommand`) to obtain `upload_id`, persists the `Video` entity with `status = 'draft'`, computes the part count based on a configurable part size (e.g., 10MB–100MB, ensuring ≤ 10,000 parts), and returns `{ video_id, slug, status: 'draft', upload_id, storage_key, part_size, total_parts, presigned_urls }` (plus `POST /videos/:id/uploads/parts` to sign or re-sign specific part numbers on demand).
  2. **Data Transfer:** Client uploads parts directly to S3/MinIO using the presigned `UploadPartCommand` URLs (or uploads directly to `storage_key` in test/single-stream helpers) and collects each part's `ETag`. Zero video bytes pass through the NestJS API.
  3. **Complete (`POST /videos/:id/uploads/complete`):** Client sends `{ parts: [{ part_number, etag }] }`. API calls `CompleteMultipartUploadCommand` on S3, verifies the object exists in storage (`HeadObjectCommand`), updates `Video.status` from `'draft'` to `'processing'`, and enqueues a `process-video` job in BullMQ.
  4. **Abort (`DELETE /videos/:id/uploads/abort`):** Cancels the S3 multipart upload (`AbortMultipartUploadCommand`) and marks or deletes the draft.
- **Pros:** Zero memory or bandwidth pressure on `nestjs-api` regardless of file size or concurrency. Overcomes S3's 5GB single-PUT ceiling to natively support 10GB files with parallel chunk uploads and per-part retry. Atomically creates the `draft` record at upload initiation, fulfilling the pre-registration requirement immediately.
- **Cons:** Client must coordinate `init` → `PUT parts` → `complete` steps rather than a single `multipart/form-data` POST. When generating presigned URLs inside Docker, the signing client must use the configured public S3 endpoint or path-style host consistently.

### Option B: Chunked Stream Proxy Through NestJS (`multipart/form-data` / Busboy piped to S3 `@aws-sdk/lib-storage`)
- Client uploads the 10GB file directly to a NestJS endpoint, which pipes the incoming HTTP stream to S3 using `@aws-sdk/lib-storage` (`Upload`).
- **Pros:** Single HTTP request for the client.
- **Cons:** Every byte of a 10GB video traverses the NestJS Node.js event loop and network interface, holding an open HTTP connection for minutes or hours and directly impacting API performance under load — violating "sem impacto na performance".

### Option C: Single Presigned PUT URL Only
- API creates the `draft` video and returns a single presigned `PutObjectCommand` URL.
- **Pros:** Simpler than Multipart Upload (only one URL).
- **Cons:** AWS S3 and S3-compatible stores reject single `PUT` uploads larger than 5GB (`EntityTooLarge`), failing the 10GB requirement. Also lacks chunk-level retry on flaky connections.

**Recommendation:** **Option A (Direct-to-S3 Multipart Upload via Presigned URLs with Atomic Draft Pre-Registration)** — It is the only architecture that satisfies both the 10GB file size requirement (surpassing the 5GB single-PUT S3 limit) and the zero-API-impact requirement (data flows directly from client to object storage), while creating the `draft` video record atomically when the upload starts.

**Decision:** A (Direct-to-S3 Multipart Upload via Presigned URLs with Atomic Draft Pre-Registration)

---

## TD-04: Video Worker Execution Model, Metadata Extraction & Thumbnail Generation

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** Once a video finishes uploading to S3/MinIO, a background worker must inspect the video container to extract duration, resolution (`width`, `height`), and codec metadata, extract a visual frame as a JPEG thumbnail, upload the thumbnail to S3/MinIO (`thumbnails/<videoId>/thumb.jpg`), and update the `Video` record in PostgreSQL. We must decide how the worker process runs in Docker and how it invokes FFmpeg/ffprobe.

**Options:**

### Option A: Standalone NestJS Worker Container (`video-worker` via `NestFactory.createApplicationContext`) + Direct `ffprobe`/`ffmpeg` CLI via `execFile`
- Run a dedicated `video-worker` service in `compose.yaml` built from the same `nestjs-project` image (with `ffmpeg` installed via `apk add --no-cache ffmpeg` in `Dockerfile.dev`), executing a headless NestJS application context (`src/worker.ts`) that registers `WorkerModule` / `@Processor('video-processing')`.
- For each job, the processor streams the video object from S3/MinIO to a temporary file in `os.tmpdir()`, runs `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name:format=duration -of json <tempFile>` via `node:child_process.execFile` (promisified), runs `ffmpeg -y -ss <seekSeconds> -i <tempFile> -frames:v 1 -q:v 2 <tempThumb.jpg>` (seeking to `min(1, duration / 2)` seconds so even sub-second videos succeed), uploads `<tempThumb.jpg>` to `thumbnails/<videoId>/thumb.jpg`, updates the `Video` row, and removes temporary files in a `finally` block.
- **Pros:** Complete process and CPU isolation between HTTP API (`nestjs-api`) and heavy FFmpeg child processes (`video-worker`), matching `docs/diagrams/software-arch.mermaid`. Shares TypeORM entities, `StorageService`, and config namespaces from the same codebase without code duplication. Calling `ffprobe`/`ffmpeg` via `execFile` avoids shell injection (`execFile` does not spawn a shell) and avoids the deprecated `fluent-ffmpeg` npm package (officially archived/unmaintained).
- **Cons:** Requires downloading/streaming the video to local scratch disk (`/tmp`) inside the worker container for reliable container formats (e.g., MP4 files with `moov` atom at the end of the file cannot be probed via non-seekable stdin pipes).

### Option B: In-Process Worker Inside `nestjs-api` Container Using `fluent-ffmpeg`
- Register the BullMQ processor directly inside the HTTP server bootstrap (`main.ts`) and use `fluent-ffmpeg` npm wrapper.
- **Pros:** One fewer container in `compose.yaml`.
- **Cons:** FFmpeg frame decoding competes for CPU and disk IO with the HTTP API container. `fluent-ffmpeg` is unmaintained/deprecated and adds an unnecessary wrapper layer over simple `ffprobe`/`ffmpeg` arguments.

**Recommendation:** **Option A (Standalone `video-worker` Container + Direct `ffprobe`/`ffmpeg` via `execFile`)** — Matches the target architecture diagram (`VideoWorker` container consuming `Queue`), guarantees zero CPU contention on the API container, and uses secure, dependency-free `execFile` invocation of `ffprobe` and `ffmpeg`. To keep integration and E2E tests ergonomic while allowing horizontal worker scaling in production, `VideosModule` can conditionally or directly register the processor while `video-worker` runs the dedicated headless worker entrypoint in Docker Compose.

**Decision:** A (Standalone `video-worker` Container + Direct `ffprobe`/`ffmpeg` via `execFile`)

---

## TD-05: Video Status Lifecycle & Failure Handling

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** Videos transition through distinct operational stages from upload initiation through asynchronous FFmpeg processing to public availability. Background jobs may fail transiently (e.g., network blip talking to MinIO) or permanently (e.g., corrupted video container).

**Options:**

### Option A: Four-State Enum (`draft` → `processing` → `ready` | `failed`) with BullMQ Retries and Error Recording
- Define `VideoStatus` enum with four states stored as a PostgreSQL `enum` (`videos_status_enum`):
  - `draft`: Created atomically at `POST /videos/uploads/init`. Not streamable or downloadable.
  - `processing`: Set atomically at `POST /videos/:id/uploads/complete` when the S3 upload is finalized and the `process-video` job is added to BullMQ (`attempts: 3`, exponential backoff `delay: 1000ms`).
  - `ready`: Set by `VideoProcessor` once `duration_seconds`, `width`, `height`, `codec`, and `thumbnail_key` are extracted and persisted. Video is now eligible for streaming and download.
  - `failed`: Set when processing fails on its final retry attempt (or encounters an unrecoverable corrupt media error) or when an upload is aborted. The error reason is recorded in `videos.processing_error` (`text`, nullable).
- **Pros:** Clear, deterministic state machine covering every requirement in the prompt (`rascunho → processando → pronto/erro`). Transient storage/network glitches self-heal via BullMQ retries before marking the video `failed`. Storing `processing_error` aids debugging and future UI feedback.
- **Cons:** Requires state-transition validation in service methods (e.g., only `draft` videos can complete or abort upload; only `ready` videos can be streamed or downloaded).

### Option B: Three-State Enum (`draft` → `ready` | `failed`) Without Explicit `processing` State
- Keep video in `draft` while queued and running in the worker, flipping directly to `ready` or `failed`.
- **Pros:** Fewer states.
- **Cons:** Cannot distinguish a video waiting for client upload chunks from a video whose upload finished and is currently being processed by the worker; prevents preventing duplicate `complete` calls.

**Recommendation:** **Option A (`draft` → `processing` → `ready` | `failed` with BullMQ retries and `processing_error`)** — Prevents duplicate upload completions, gives accurate lifecycle visibility, and handles both transient and permanent processing failures cleanly.

**Decision:** A (`draft` → `processing` → `ready` | `failed` state machine with retry handling)

---

## TD-06: Unique Conflict-Free Video URL Identifier (Slug)

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Every video requires a unique, permanent, conflict-free URL identifier (`URL única por vídeo, sem conflito com outros vídeos`) used to address the video (`GET /videos/:slug`, `GET /videos/:slug/stream`, `GET /videos/:slug/download`, `GET /videos/:slug/thumbnail`).

**Options:**

### Option A: 11-Character Cryptographically Random Base64URL Slug (`[A-Za-z0-9_-]{11}`) with Pre-Check & Unique Index
- Generate an 11-character URL-safe slug using Node's built-in `crypto.randomBytes(8).toString('base64url').slice(0, 11)` (66 bits of entropy, `64^11 ≈ 7.37 × 10^19` possible identifiers, matching YouTube's canonical video ID format). Enforce uniqueness via a PostgreSQL `UNIQUE` index on `videos.slug` (`varchar(16)`) and perform a pre-check query in `VideosService` (retrying up to 5 times with a fresh random slug if a collision ever occurs, analogous to `ChannelsService`'s nickname pre-check pattern from Phase 02).
- **Pros:** Zero external dependencies (uses `node:crypto`). Compact, opaque, URL-safe, and immutable even when the user edits the video title. Collision probability is astronomically low (`< 10^-12` at millions of videos) and guaranteed zero-conflict by the DB unique constraint + pre-check retry loop.
- **Cons:** Not human-readable from the title alone (though human-readable slugs can still be appended cosmetically on the frontend if desired later).

### Option B: Title-Derived Hyphenated Slug (`como-programar-em-nestjs-a1b2`)
- Normalize the video `title` into lowercase ASCII words joined by hyphens plus a short suffix.
- **Pros:** SEO-friendly words in URL.
- **Cons:** Draft videos often start with generic filenames or identical titles (`"Untitled"`, `"video.mp4"`), causing high collision rates. If the user renames the video in Phase 04, either the URL breaks or becomes out of sync with the title.

### Option C: Raw UUIDv4 (`550e8400-e29b-41d4-a716-446655440000`)
- Use the primary key `id` directly as the public URL identifier.
- **Pros:** Zero extra columns.
- **Cons:** 36-character UUIDs are verbose in shareable video links and expose internal primary key structure instead of a dedicated public URL identifier (`slug`) as required by the persistence specification.

**Recommendation:** **Option A (11-Character Cryptographically Random Base64URL Slug)** — Industry-standard video platform URL identifier (YouTube-style), URL-safe without percent-encoding, immutable across title edits, and conflict-free via pre-check + unique DB index.

**Decision:** A (11-Character Base64URL slug with DB unique constraint and collision retry)

---

## TD-07: Video Streaming (HTTP Range) & Download Strategy

**Scope:** Backend

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** Users must be able to watch ready videos via progressive HTTP streaming with instant seeking (`Reprodução via streaming (sem necessidade de download completo)`) and download the video file (`Download do vídeo pelo usuário`).

**Options:**

### Option A: API-Proxied S3 Byte-Range Streaming (`206 Partial Content`) + Dedicated Attachment Download Endpoint
- Expose public read endpoints keyed by the video's unique `slug` (available only when `video.status === 'ready'`):
  - **Stream (`GET /videos/:slug/stream`):** Inspects the incoming `Range` HTTP header (e.g., `Range: bytes=0-1048575`).
    - When `Range` is present: validates the byte range against `video.size_bytes` (returning `416 Range Not Satisfiable` with `Content-Range: bytes */<size>` if out of bounds), clamps open-ended ranges to a default chunk window (e.g., 5MB max or requested end), requests only that byte slice from S3/MinIO via `GetObjectCommand({ Bucket, Key, Range: 'bytes=start-end' })`, responds with HTTP `206 Partial Content`, headers `Accept-Ranges: bytes`, `Content-Range: bytes <start>-<end>/<total>`, `Content-Length: <end - start + 1>`, `Content-Type: <video.mime_type>`, and pipes the S3 readable stream directly to the HTTP response.
    - When `Range` is absent: responds with HTTP `200 OK`, `Accept-Ranges: bytes`, `Content-Length: <total>`, `Content-Type: <video.mime_type>`, and streams the object from S3 without buffering in memory.
  - **Download (`GET /videos/:slug/download`):** Responds with HTTP `200 OK`, `Content-Type: <video.mime_type>`, `Content-Length: <video.size_bytes>`, `Content-Disposition: attachment; filename="<sanitized_original_filename>"`, and pipes the S3 object stream to the client.
  - **Thumbnail (`GET /videos/:slug/thumbnail`):** Streams `video.thumbnail_key` from S3 with `Content-Type: image/jpeg`.
- **Pros:** Native RFC 9110 HTTP Range streaming (`206 Partial Content`) works seamlessly with HTML5 `<video>`, `curl`, and Supertest E2E tests without requiring clients outside Docker to resolve internal container hostnames (`minio:9000`). Node.js stream piping uses constant ~64KB memory buffers regardless of whether the video is 10MB or 10GB. Cleanly enforces domain rules (`409 VIDEO_NOT_READY` if video is still `draft`/`processing`/`failed`, `404 VIDEO_NOT_FOUND` if slug does not exist).
- **Cons:** Streaming bandwidth flows through `nestjs-api` (though with zero full-file buffering and minimal CPU overhead).

### Option B: HTTP 302 Redirect to Presigned S3 GET URLs
- `GET /videos/:slug/stream` and `GET /videos/:slug/download` return `302 Found` with `Location: <presigned S3 URL>`.
- **Pros:** Offloads egress bandwidth to S3/MinIO.
- **Cons:** Breaks in Dockerized local development and automated E2E tests whenever the S3 signing endpoint (`minio:9000` inside Docker network) differs from the client's reachable host (`localhost:9000` on the host machine), causing AWS Signature V4 `SignatureDoesNotMatch` errors. Also prevents direct assertion of `206 Partial Content`, `Content-Range`, and `Content-Disposition` headers on the API endpoints themselves.

### Option C: HLS / DASH Adaptive Bitrate Transcoding in Phase 03
- Transcode every video into multi-bitrate `.m3u8` playlists and `.ts` segments in the worker.
- **Pros:** Adaptive bitrate switching for varying network speeds.
- **Cons:** Massively increases FFmpeg processing time and storage footprint for 10GB files, and is not required by the Phase 03 scope (which specifies duration/metadata extraction, single-frame thumbnail generation, HTTP streaming without full download, and file download).

**Recommendation:** **Option A (API-Proxied S3 Byte-Range Streaming `206 Partial Content` + Attachment Download)** — Delivers standards-compliant RFC 9110 byte-range streaming (`206 Partial Content`, `Content-Range`, `Accept-Ranges: bytes`) and attachment downloads directly from S3 byte streams with constant memory usage, deterministic domain error handling, and zero Docker hostname mismatch issues.

**Decision:** A (API-Proxied S3 Byte-Range Streaming `206 Partial Content` + Attachment Download)
