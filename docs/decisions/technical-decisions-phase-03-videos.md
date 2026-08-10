---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-07-11
scope_description: "Technical decisions for Phase 03: Object Storage (MinIO), Message Queue (BullMQ), Multipart Presigned Uploads, Video Worker with FFmpeg, Video Status Lifecycle, and Unique URL generation."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — Backend NestJS API that handles pre-registration, presigned URL generation, streaming/download proxying, unique URL resolution, and the database schema. Includes a separate worker service running FFmpeg.
- `next-frontend/` — Frontend Next.js that interacts with the multipart presigned upload endpoints to upload chunks directly to MinIO, and displays/plays the videos.

---

## TD-01: Background Job Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** Video processing is CPU-heavy and asynchronous. We need a queue service to publish processing jobs from the API and consume them reliably in a worker process.

**Options:**

### Option A: BullMQ (Redis-based)
- The typescript-first, modern rewrite of Bull. Runs on Redis. Offers high performance, job priority, concurrency control, delay, retries, and parent-child dependencies.
- **Pros:** Official NestJS integration (`@nestjs/bullmq`). Extremely fast in-memory operations. Robust retry, delay, and concurrency control. Native TypeScript support.
- **Cons:** Introduces Redis as an additional infrastructure dependency in `compose.yaml`.

### Option B: PG-Boss (PostgreSQL-based)
- Queue manager for Node.js using PostgreSQL job queues. Uses Postgres JSONB and SKIP LOCKED features.
- **Pros:** No extra container needed (Postgres is already in the stack). Low infra footprint. Reliable transactional guarantees.
- **Cons:** Places job polling and processing load on the main relational database. Not natively integrated with NestJS module system.

### Option C: RabbitMQ
- Advanced Message Queuing Protocol (AMQP) message broker.
- **Pros:** Extremely powerful, standard message broker. Supports complex routing and multiple protocol bindings.
- **Cons:** High operational complexity, overkill for simple point-to-point worker queues. Adds a large container dependency.

**Recommendation:** **BullMQ (Redis-based)** — It is the industry standard for NestJS ecosystems, officially supported via `@nestjs/bullmq`, and provides excellent performance and job lifecycle management. Redis is lightweight and easy to add to `compose.yaml`.

**Decision:** A (BullMQ)

**Libraries:** `@nestjs/bullmq@^3.1.0, bullmq@^5.30.0`

---

## TD-02: 10GB Upload Strategy

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** Uploading large video files (up to 10GB) can exhaust API memory, lock event loops, and saturate network bandwidth on the NestJS container. We need a strategy to upload files directly and reliably.

**Options:**

### Option A: Direct Multipart Presigned URLs (MinIO/S3)
- The frontend requests an upload initialization. The backend initializes a multipart upload in MinIO/S3 and returns an upload ID and a set of presigned URLs (one per chunk). The frontend uploads chunks directly to MinIO, then requests completion from the backend.
- **Pros:** Completely bypasses the NestJS API for the file transfer (zero event-loop blocking). Supports parallel chunk uploads, resuming/retrying individual failed chunks, and handles files up to 5TB.
- **Cons:** Slightly more complex client-side upload coordination (chunking files, uploading, completing).

### Option B: Direct Single Put Presigned URL
- The frontend requests a single presigned PUT URL and uploads the entire file in one HTTP request.
- **Pros:** Simpler frontend and backend implementation.
- **Cons:** S3 Single PUT limit is 5GB (fails for 10GB). A network failure requires re-uploading the entire file from 0%.

### Option C: Streaming upload via NestJS API
- The frontend uploads the file to the backend NestJS API. The API streams the request body chunk-by-chunk to MinIO without loading the whole file in memory.
- **Pros:** Auth/validation is handled inline during upload. Frontend only needs a standard file upload input.
- **Cons:** NestJS API becomes the bottleneck. Consumes NestJS network bandwidth and holds connections open for a long time, degrading performance for other endpoints.

**Recommendation:** **Direct Multipart Presigned URLs (Option A)** — It is the only option that handles 10GB files reliably (S3 Single Put limit is 5GB) and guarantees zero impact on the NestJS API event loop.

**Decision:** A (Direct Multipart Presigned URLs)

**Libraries:** `@aws-sdk/client-s3@^3.1085.0, @aws-sdk/s3-request-presigner@^3.1085.0`

---

## TD-03: Video Worker and Processing Architecture

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas) / Processamento automático do vídeo após upload / Geração automática de thumbnail

**Context:** Processing uploaded videos (metadata extraction, thumbnail generation) requires FFmpeg/ffprobe. This is CPU-intensive and needs separate resource allocations.

**Options:**

### Option A: Separate NestJS Worker Container
- A separate service in `compose.yaml` (e.g. `video-worker`) that runs the same NestJS codebase but boots as a standalone NestJS application listening to the BullMQ queue. The image contains FFmpeg/ffprobe.
- **Pros:** Complete isolation of CPU/Memory consumption. Scales independently of the API. Reuses database entities and services.
- **Cons:** Adds another service to compile/run in Docker Compose.

### Option B: Inline execution in NestJS API container
- The NestJS API container handles the BullMQ queue internally and spawns FFmpeg child processes locally.
- **Pros:** Simple setup, single container.
- **Cons:** Spawning FFmpeg processes inside the API container directly impacts REST response times for all users. High risk of container crash under heavy load.

**Recommendation:** **Separate NestJS Worker Container (Option A)** — Isolating CPU-heavy video processing in a dedicated worker container guarantees the API remains responsive and stable.

**Decision:** A (Separate NestJS Worker Container)

**Libraries:** `fluent-ffmpeg@^2.1.3`

---

## TD-04: Unique URL Identification

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Videos need unique public URLs (e.g., `streamtube.com/watch/ID`). The identifier should be short, URL-safe, non-sequential, and collision-resistant.

**Options:**

### Option A: NanoID / Short Unique ID (e.g. 10-12 chars)
- Generate a random, URL-safe ID using a custom alphabet (A-Z, a-z, 0-9, dashboard characters).
- **Pros:** Short and user-friendly (like YouTube). Prevents ID enumeration attacks (users cannot guess video URLs). Highly collision-resistant at 10+ characters.
- **Cons:** Requires checking for collisions upon insertion (negligible probability but technically possible).

### Option B: Auto-increment integer ID
- Use the database primary key (e.g. `1`, `2`, `3`).
- **Pros:** Zero generation overhead, guaranteed unique by database.
- **Cons:** Highly vulnerable to ID enumeration. Exposes total video count, and looks unprofessional.

### Option C: UUID v4 (36 chars)
- Standard UUID generation.
- **Pros:** Universally unique, zero collision risk, no DB check needed.
- **Cons:** Long (36 characters), ugly in browser URLs.

**Recommendation:** **NanoID / Short Unique ID (Option A)** — It provides short, user-friendly, YouTube-like URLs while securing the resource from enumeration.

**Decision:** A (NanoID / Short Unique ID)

**Libraries:** `nanoid@^3.3.8`

---

## TD-05: Streaming and Download Transport Strategy

**Scope:** Backend

**Capability:** Reprodução via streaming (sem necessidade de download completo) / Download do vídeo pelo usuário

**Context:** Users need to play videos in a web player (seeking through the timeline) and download them. We need to decide how to deliver the file contents from MinIO.

**Options:**

### Option A: HTTP Range Requests (206 Partial Content) via NestJS API
- The frontend requests the video via a NestJS route (e.g. `/videos/:id/stream`). The backend API handles the request, extracts the `Range` headers, queries the object storage for the specific bytes, and streams them back to the client.
- **Pros:** Abstracts the storage bucket structure completely. Allows performing auth checks before streaming (e.g., private or unlisted video visibility). Easily collects view analytics/metrics on playback.
- **Cons:** NestJS API acts as a proxy, consuming network bandwidth.

### Option B: Direct MinIO/S3 Signed URLs
- The backend generates a short-lived signed URL for the video, and the frontend plays/downloads directly from MinIO/S3.
- **Pros:** High performance and scalability. Zero network overhead on the NestJS API.
- **Cons:** Exposes storage URLs directly to the client. Auth checks are only performed at URL generation time, making link sharing harder to secure once the URL is signed.

**Recommendation:** **HTTP Range Requests via NestJS API (Option A)** — It provides superior security and architectural abstraction, allowing the backend to fully control access controls and view count analytics before bytes are served.

**Decision:** A (HTTP Range Requests via NestJS API)

**Libraries:** —

---

## TD-06: Video Status Lifecycle

**Scope:** Backend

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload / Ciclo de status do vídeo refletido no banco

**Context:** A video moves from initialization, through upload, processing, and completion. We need a clear state machine.

**Options:**

### Option A: Enum status field in database
- A database enum column `status` on the `Video` entity: `DRAFT` (created on upload start), `PROCESSING` (upload complete, enqueued in worker), `READY` (processed successfully), `FAILED` (processing failed). Include an optional nullable `failureReason` field.
- **Pros:** Simple, lightweight, direct representation of current state.
- **Cons:** Does not record a historic log of state transitions (though not required by the current scope).

### Option B: Status history table
- A separate `video_statuses` table to log every transition.
- **Pros:** Audit trail of when each phase started/ended.
- **Cons:** Unnecessary database complexity for this stage.

**Recommendation:** **Enum status field in database (Option A)** — It perfectly satisfies the requirements, keeps the schema clean, and is easy to query.

**Decision:** A (Enum status field in database)

**Libraries:** —

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | message-queue | BullMQ (Redis-based) | A |
| TD-02 | Cross-layer | upload-strategy | Direct Multipart Presigned URLs | A |
| TD-03 | Backend | worker-architecture | Separate NestJS Worker Container | A |
| TD-04 | Backend | unique-url | NanoID / Short Unique ID | A |
| TD-05 | Backend | streaming-download | HTTP Range Requests via API | A |
| TD-06 | Backend | video-lifecycle | Enum status field in database | A |
