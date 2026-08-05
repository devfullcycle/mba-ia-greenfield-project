---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-08-03
scope_description: "Backend architecture for video upload, object storage, background processing queue, video worker with FFmpeg, unique URL generation, HTTP Range streaming, and video download."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — Backend NestJS API, background worker, TypeORM entities, video service, streaming/download endpoints, queue producer/consumer, MinIO/S3 storage service, and FFmpeg integration.
- `next-frontend/` — Frontend deferred: video interface is outside the scope of Phase 03 as specified in the challenge description. No open decision in this document.

---

## TD-01: Background Queue Technology and System

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** Processing large videos (metadata extraction with ffprobe and thumbnail generation with ffmpeg) is CPU-intensive and must happen asynchronously out-of-band. We need a robust queue system to handle job creation, worker processing, retries, and state updates without blocking the NestJS HTTP API server.

**Options:**

### Option A: BullMQ + Redis (@nestjs/bullmq)
- Industry standard for Node.js / NestJS ecosystems. Uses Redis as a high-performance in-memory data store for job queueing, delayed jobs, retries with exponential backoff, and progress reporting.
- **Pros:** Official `@nestjs/bullmq` integration; robust concurrency and sandbox worker support; built-in job event listeners, exponential backoff retries, and job status tracking; low latency.
- **Cons:** Requires a Redis service container added to `compose.yaml`.

### Option B: PG Boss (Postgres-based queue)
- Uses existing PostgreSQL instance for queue management using Postgres SKIP LOCKED queues.
- **Pros:** No extra infrastructure container (reuses existing PostgreSQL database).
- **Cons:** Adds query churn and lock contention to the primary application database during heavy video workloads; lacks native NestJS module ecosystem comparable to `@nestjs/bullmq`; less granular worker control.

### Option C: RabbitMQ + AMQP (@nestjs/microservices)
- Advanced message broker using AMQP protocol for enterprise messaging.
- **Pros:** Highly flexible message routing (exchanges, topics, queues); decoupled broker.
- **Cons:** Significantly higher operational complexity; overkill for simple video processing jobs; lacks built-in delayed job retries out of the box without complex plugins.

**Recommendation:** **Option A (BullMQ + Redis)** — `@nestjs/bullmq` provides seamless integration with NestJS, built-in retry mechanisms, job progress reporting, and clean separation of worker tasks. Adding Redis to `compose.yaml` is lightweight and standard for background job processing.

**Decision:** A (BullMQ + Redis)

---

## TD-02: 10GB Video Upload Strategy and Storage Protocol

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** Uploading files up to 10GB through the NestJS API server would consume excessive server memory/CPU, bind Node.js HTTP event loop threads for prolonged periods, and create a bottleneck. We need a non-blocking upload architecture.

**Options:**

### Option A: Direct-to-Storage via Presigned URLs (S3 / MinIO Multipart Presigned Upload)
- API generates presigned upload URLs (or presigned multipart upload parts for 10GB files) via AWS SDK v3. The client sends the video binary directly to Object Storage (MinIO/S3). Upon completion, the client calls an API `/videos/:id/complete-upload` endpoint (or storage event trigger), which transitions status to `processing` and enqueues the video job in BullMQ.
- **Pros:** Completely bypasses NestJS API for heavy binary transfer; zero memory/bandwidth overhead on API server; scalable up to 10GB+ per file; leverages S3 native presigned PUT / multipart API.
- **Cons:** Requires client-to-storage direct connectivity; CORS configuration required on MinIO/S3 bucket.

### Option B: TUS Resumable Upload Server / Protocol
- Implements the TUS protocol for resumable uploads via custom middleware or a dedicated TUS server container.
- **Pros:** Native resume capability for interrupted connections on large files.
- **Cons:** Introduces extra server infrastructure or heavy custom protocol handling; higher complexity than standard S3 presigned URLs.

### Option C: Multipart Form-Data Streaming through NestJS API to Storage
- Client uploads file to NestJS API endpoint using `multer` or stream parsing; NestJS pipes the incoming HTTP stream to S3/MinIO.
- **Pros:** Single API domain for upload; client doesn't talk directly to storage.
- **Cons:** Proxies up to 10GB of network traffic through Node.js API process; holds HTTP sockets open for minutes/hours; risks API performance degradation.

**Recommendation:** **Option A (Direct-to-Storage via Presigned URLs)** — Maximizes performance and API availability by offloading file transfer directly to S3/MinIO storage. The NestJS API acts strictly as an orchestrator (creating draft records, generating presigned URLs, and handling completion events).

**Decision:** A (Direct-to-Storage via Presigned URLs)

---

## TD-03: Object Storage Client & Infrastructure Architecture

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** We need an object storage service to store raw video files, processed video assets, and generated thumbnails. For local development, MinIO runs in Docker Compose; in production, AWS S3 is used.

**Options:**

### Option A: AWS SDK v3 (@aws-sdk/client-s3 & @aws-sdk/s3-request-presigner) with MinIO in Compose
- Standard Node.js SDK for S3 compatibility. MinIO runs as a service in Docker Compose (`storage:9000`) and implements S3 API specs.
- **Pros:** Standard AWS SDK v3 is cloud-native and production-ready; seamless transition between local MinIO and AWS S3 via environment variables (`S3_ENDPOINT`, `S3_BUCKET`, `AWS_REGION`).
- **Cons:** MinIO container requires bucket auto-initialization script or healthcheck configuration in Docker Compose.

### Option B: Native `minio` Node.js SDK
- Uses `minio` npm package specifically tailored for MinIO.
- **Pros:** Simple API designed for MinIO.
- **Cons:** Couples code to MinIO client rather than universal AWS SDK v3; less idiomatic for AWS S3 production deployments.

**Recommendation:** **Option A (AWS SDK v3 with MinIO in Compose)** — Uses standard AWS SDK packages (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`), ensuring full compatibility with both local MinIO and AWS S3 in production.

**Decision:** A (AWS SDK v3 with MinIO in Compose)

---

## TD-04: Video Worker Architecture and Media Processing

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados) e Geração automática de thumbnail a partir de um frame do vídeo

**Context:** After a video is uploaded, metadatas (duration, resolution, format, bitrate, codec) must be extracted and a thumbnail image must be generated from a video frame.

**Options:**

### Option A: Dedicated Video Worker Service (NestJS Worker process in Docker with FFmpeg & FFprobe)
- A dedicated process/container (`video-worker`) running NestJS with `@nestjs/bullmq` worker processor. The container image includes `ffmpeg` and `ffprobe` binaries installed. The worker picks up completed upload jobs from BullMQ, downloads the raw video from MinIO to a temporary local disk location (or streams via pipe), executes `ffprobe` for metadata and `ffmpeg` for thumbnail snapshot, uploads thumbnail to MinIO, updates the Video entity in PostgreSQL, and cleans up local temp files.
- **Pros:** Isolates CPU-heavy media encoding/extraction from API HTTP server; containerized FFmpeg dependencies; scaleable independently from API.
- **Cons:** Requires adding a worker container service in `compose.yaml` (or running worker in dual mode).

### Option B: In-process NestJS API Queue Processor
- BullMQ worker runs inside the same `nestjs-api` process.
- **Pros:** Fewer Docker services to configure.
- **Cons:** Heavy FFmpeg execution consumes CPU and RAM on the main API process, directly impacting REST API response latency for other users.

**Recommendation:** **Option A (Dedicated Video Worker Service with FFmpeg in Docker)** — Isolates heavy media processing into a dedicated worker container, preventing API degradation during video processing.

**Decision:** A (Dedicated Video Worker Service with FFmpeg in Docker)

---

## TD-05: Unique Video Identifier Strategy (URL Unica)

**Scope:** Cross-layer

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Videos require a unique, short, URL-friendly identifier for public playback URLs (e.g. `/videos/watch/x7K9mX2pL4qW`), independent of internal auto-generated database primary keys (UUID).

**Options:**

### Option A: NanoID / Custom URL-Safe Alphanumeric Short Code (url_code)
- Generates a 12-character random URL-safe string (e.g. `nanoid` or `crypto.randomBytes`) stored in an indexed `url_code` column with a `UNIQUE` database constraint.
- **Pros:** Short, clean, YouTube-style public URLs (`watch?v=x7K9mX2pL4qW`); non-sequential to prevent video scraping/enumeration attacks; indexed for fast O(1) DB lookup.
- **Cons:** Requires collision handling on generation (infinitesimal collision probability with 12 chars).

### Option B: Public Database UUID v4
- Exposes internal DB `id` (UUID v4) directly in public URLs (`/videos/watch/123e4567-e89b-12d3-a456-426614174000`).
- **Pros:** No extra column or generation logic required.
- **Cons:** Long, cumbersome URLs; poor user experience.

**Recommendation:** **Option A (NanoID / Custom 12-character URL-Safe Short Code `url_code`)** — Provides concise, clean, non-predictable video URLs with guaranteed uniqueness via database constraint.

**Decision:** A (NanoID / Custom 12-character URL-Safe Short Code `url_code`)

---

## TD-06: Video Streaming and Download Strategy

**Scope:** Cross-layer

**Capability:** Reprodução via streaming (sem necessidade de download completo) e Download do vídeo pelo usuário

**Context:** Users must be able to stream videos immediately (seeking to arbitrary timestamps using HTTP Range 206 requests) without downloading the complete 10GB file first, and also download the raw video file.

**Options:**

### Option A: HTTP Range Requests (206 Partial Content) & Presigned Storage Redirect / Proxy Stream
- **Streaming:** API provides `/videos/:urlCode/stream` which supports HTTP `Range` headers (`bytes=start-end`), piping byte ranges directly from MinIO/S3 or issuing an HTTP 302 redirect / presigned GET stream supporting range requests. This enables standard HTML5 `<video>` player seeking.
- **Download:** API provides `/videos/:urlCode/download` returning an HTTP 302 redirect to a presigned GET URL with `ResponseContentDisposition: 'attachment; filename="..."'`, allowing direct high-speed browser download from MinIO/S3.
- **Pros:** Low complexity; native HTML5 video player support; immediate playback start; fast seeking; offloads full file download bandwidth to storage server.
- **Cons:** Does not provide multi-bitrate adaptive bitrate switching (which would require full HLS/DASH transcoding).

### Option B: Full HLS (HTTP Live Streaming) Transcoding Pipeline
- Video worker transcodes raw video into multiple HLS resolutions (1080p, 720p, 480p) with `.m3u8` playlists and `.ts` video chunks.
- **Pros:** Adaptive bitrate streaming for varying network conditions.
- **Cons:** Massive CPU and disk overhead for 10GB video processing; significantly delays video availability after upload; out of scope for Phase 03 requirements.

**Recommendation:** **Option A (HTTP 206 Partial Content Range Streaming & Presigned Download Endpoint)** — Fulfills all streaming and download requirements cleanly and efficiently without unnecessary HLS transcoding overhead in Phase 03.

**Decision:** A (HTTP 206 Partial Content Range Streaming & Presigned Download Endpoint)

---

## TD-07: Video Status Lifecycle & Failure Handling

**Scope:** Backend

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload e Ciclo de status do vídeo (rascunho → processando → pronto/erro) refletido no banco

**Context:** Videos transition through explicit lifecycle states: `draft` (initial record created when upload starts), `processing` (upload completed, media extraction queued/running in worker), `ready` (processing finished successfully, video available for playback), and `error` (processing failed after maximum retries).

**Options:**

### Option A: PostgreSQL Enum (`VideoStatus`) State Machine + Retries + Error Details Column
- Database column `status` using enum `'draft' | 'processing' | 'ready' | 'error'`.
- Upload init -> creates Video with status `draft`.
- Upload complete -> API updates status to `processing` and enqueues BullMQ job.
- Worker process -> updates status to `ready` with metadata (duration, width, height, format, thumbnail_key) upon success.
- If processing fails -> BullMQ retries up to 3 times with exponential backoff. If all retries fail, worker updates status to `error` and writes error message to `status_details` column.
- **Pros:** Deterministic state machine; observable DB status; automatic transient error recovery; explicit failure diagnostic tracking.
- **Cons:** Requires state transition validation in Video entity / service logic.

### Option B: Simple Boolean Flag (`is_processed: boolean`)
- Uses boolean column `is_processed`.
- **Pros:** Minimal DB schema.
- **Cons:** Cannot distinguish between `draft`, active `processing`, or processing `error`.

**Recommendation:** **Option A (PostgreSQL Enum `VideoStatus` State Machine + Retries + Error Details)** — Clear, robust status tracking that accurately reflects the video processing lifecycle.

**Decision:** A (PostgreSQL Enum `VideoStatus` State Machine + Retries + Error Details)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Background Queue Technology | Option A (BullMQ + Redis) | A |
| TD-02 | Cross-layer | 10GB Upload Strategy | Option A (Direct-to-Storage via Presigned URLs) | A |
| TD-03 | Backend | Object Storage Client & Architecture | Option A (AWS SDK v3 with MinIO) | A |
| TD-04 | Backend | Video Worker Architecture | Option A (Dedicated Worker Container with FFmpeg) | A |
| TD-05 | Cross-layer | Unique Video Identifier Strategy | Option A (NanoID / Custom 12-char url_code) | A |
| TD-06 | Cross-layer | Video Streaming & Download Strategy | Option A (HTTP 206 Range Streaming & Presigned Download) | A |
| TD-07 | Backend | Video Status Lifecycle & Failure Handling | Option A (PostgreSQL Enum VideoStatus State Machine) | A |
