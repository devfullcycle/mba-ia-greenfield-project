---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-07-12
scope_description: "Backend services for video upload, processing, and streaming: object storage SDK, message queue technology, worker architecture, upload strategy, streaming/download URL strategy, unique video slug, and FFmpeg integration."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — delivers all Phase 03 backend capabilities: storage service, queue service, Videos API endpoints (upload initiation, upload-complete notification, retrieval), and the Video Worker (separate entry point consuming queue jobs with FFmpeg processing).
- `next-frontend/` — upload and streaming UI deferred to Phase 05. Cross-layer TDs (TD-02, TD-04) define the API contracts that Phase 05 will implement client-side; no frontend code is written in Phase 03.

---

## TD-01: Message Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The C4 diagram marks the Message Queue container as "TBD". A queue is needed to decouple video upload from video processing: after a video arrives in storage, the API publishes a job; the Video Worker consumes it asynchronously. The queue choice determines the Docker service, the NestJS integration package, and the job lifecycle model (retries, delays, monitoring).

**Options:**

### Option A: BullMQ + Redis
- BullMQ (`bullmq` npm) is a Node.js queue library built on Redis. The official NestJS integration is `@nestjs/bullmq`, which provides `BullModule.registerQueue()`, `@Processor()`, and `@OnWorkerEvent()` decorators. Redis acts as the job store (persistence, retry tracking, delayed jobs). Video processing jobs are modelled as BullMQ jobs consumed by a Processor class.
- **Pros:** `@nestjs/bullmq` is the official first-class NestJS queue package — full DI integration, module system, typed. Redis adds a single lightweight container (alpine image ≈ 30MB). Built-in retry policies with backoff, job prioritization, rate limiting, and delay. BullMQ v5+ is pure TypeScript. Redis is also reusable for caching or rate-limiting in future phases.
- **Cons:** Two components to add (Redis container + BullMQ). Redis must be running for the API to enqueue jobs. Job data not persisted across Redis restarts unless Redis AOF/RDB persistence is enabled.

### Option B: RabbitMQ
- AMQP-based message broker. NestJS supports it via `@golevelup/nestjs-rabbitmq` or `@nestjs/microservices` AMQP transport. Producer sends messages to an exchange; consumer binds a queue.
- **Pros:** AMQP is a widely-adopted open standard. Excellent for complex routing (fanout, topic, direct exchanges). Independent message broker — can serve multiple producers and consumers across services.
- **Cons:** Heavier Docker image (~200MB+ RAM for the broker vs. Redis at ~30MB). AMQP exchange/queue/binding model is more complex than BullMQ for a single-consumer job queue. Not the primary NestJS recommendation — `@nestjs/bullmq` is first-class; RabbitMQ requires third-party adapters. Dead-letter queues must be configured manually for retries.

### Option C: AWS SQS (via LocalStack)
- Amazon's managed queue service, simulated locally with LocalStack. Uses `@aws-sdk/client-sqs` for producer/consumer code.
- **Pros:** Managed in production (no Redis/RabbitMQ to operate). Scales to any volume. Integrates natively with AWS S3 events.
- **Cons:** LocalStack adds a heavy dev dependency (Docker image ≈ 700MB+). Long-polling consumer model is more complex than BullMQ's event-driven approach. Vendor lock-in to AWS. Significant operational complexity for local dev. Free tier limits apply in production.

**Recommendation:** **Option A (BullMQ + Redis)** — `@nestjs/bullmq` is the official, first-class NestJS queue solution. Redis is a minimal addition (single alpine container). The built-in retry/backoff is essential for video processing jobs that can fail due to transient FFmpeg or storage errors. Redis is also a natural fit for future needs (rate limiting, caching). RabbitMQ and SQS introduce disproportionate complexity for a single-consumer job queue.

**Decision:** A

---

## TD-02: Upload Strategy for 10GB Files

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload"

**Context:** The project plan requires videos up to 10GB to upload "without impacting performance" and with the ability to "resume in case of connection failure" (Pontos de Atenção §4). The API must not hold the binary stream. This decision defines the upload protocol — the backend exposes one or more endpoints; the frontend (Phase 05) implements the corresponding upload flow.

**Options:**

### Option A: Pre-signed PUT URL (single PUT, non-resumable)
- The frontend calls `POST /videos` to create a draft; the API generates a single pre-signed PUT URL for the object in MinIO (e.g., 24h expiry) and returns it alongside the video ID and slug. The frontend uploads the file directly to MinIO via HTTP PUT. After upload, the frontend calls `POST /videos/:id/upload-complete` to trigger processing.
- **Pros:** API never in the upload data path. Simple: one pre-signed URL per upload. Standard S3 pattern, well-documented. MinIO handles the PUT natively.
- **Cons:** Not resumable — a connection failure at 9GB forces a full re-upload. A very large file in one HTTP PUT may hit timeout limits depending on network or proxy configuration. Does not satisfy the "resume in case of failure" requirement from the project plan.

### Option B: S3 Multipart Upload with Pre-signed Part URLs (resumable)
- The frontend calls `POST /videos` to create a draft and initiate an S3 multipart upload session. The API calls MinIO's `CreateMultipartUpload` and returns the `uploadId` plus an array of pre-signed part URLs (one per chunk, e.g., 10MB chunks → 1024 URLs for a 10GB file). The frontend uploads parts in sequence or parallel. If a part fails, only that part is retried. When all parts are uploaded, the frontend calls `POST /videos/:id/upload-complete` with the list of `{partNumber, ETag}` pairs; the API calls `CompleteMultipartUpload` on MinIO to assemble the object.
- **Pros:** Resumable — only failed parts need to be retried. Parts can be uploaded in parallel (higher throughput). No single-PUT timeout issues. API is still not in the data path. Satisfies both the "no performance impact" and "resume in case of failure" requirements. S3 multipart is the industry standard for large file uploads; MinIO supports it natively.
- **Cons:** More complex API contract (uploadId + array of part URLs). Frontend must track uploaded parts and ETags. The part count must be pre-computed from the file size or fetched on demand. Stale incomplete multipart uploads must be cleaned up (MinIO lifecycle policy or API-side job).

### Option C: API Proxy (multipart/form-data)
- The frontend sends the file as multipart/form-data to the API. The API streams the body to MinIO using the S3 SDK.
- **Pros:** Single endpoint. Simple frontend implementation.
- **Cons:** API holds the 10GB stream — high memory/CPU/network usage per upload. Cannot scale horizontally without sticky sessions. Directly violates the "no performance impact" requirement. The C4 diagram shows `Rel(api, storage, "Uploads")` as a metadata-level operation, not a streaming path. Non-starter for 10GB files.

**Recommendation:** **Option B (S3 Multipart with pre-signed part URLs)** — The only option that satisfies both "no API performance impact" and "resumable in case of failure." MinIO supports the S3 multipart protocol natively. The added API complexity (uploadId + part ETags) is justified by the explicit project requirement for resumability.

**Decision:** B

---

## TD-03: Worker Architecture

**Scope:** Backend

**Capability:** Transversal — covers: "Serviço de processamento em segundo plano (filas)", "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The C4 diagram shows the Video Worker as a separate container that reads from the queue, processes videos with FFmpeg, updates the DB, and saves results to storage. The worker needs TypeORM access (to update video status and metadata), storage SDK access (to read the video via pre-signed URL and save the thumbnail), and a BullMQ consumer. The key question is whether to build the worker as a NestJS application (reusing the existing DI setup) or as a standalone Node.js script.

**Options:**

### Option A: NestJS ApplicationContext in `src/worker/main.ts`
- A secondary entry point in the same `nestjs-project/` codebase (`src/worker/main.ts`) that bootstraps a NestJS application context with no HTTP server using `NestFactory.createApplicationContext()`. Imports a `WorkerModule` that loads only the needed modules: `ConfigModule`, `TypeOrmModule`, `StorageModule`, `QueueModule`, and a `VideoProcessorModule` with the BullMQ Processor class.
- **Pros:** Reuses all existing NestJS infrastructure — TypeORM entities, repositories, config namespaces (`storage.config.ts`, `database.config.ts`), and any shared services. No code duplication. TypeScript consistency throughout. `@Processor()` decorator works natively. Unit and integration tests use `@nestjs/testing`. Single `nestjs-project/` codebase to maintain.
- **Cons:** NestJS bootstrap overhead (~1s cold start). The worker Docker image must install all `nestjs-project/` dependencies. Slightly heavier than a plain Node.js script.

### Option B: Standalone Node.js BullMQ Worker
- A plain TypeScript file outside NestJS that creates a BullMQ `Worker` instance directly: `new Worker('video-processing', async (job) => { ... })`. DB access via raw TypeORM `DataSource`; storage via raw AWS SDK calls; config via `dotenv`.
- **Pros:** Minimal overhead — no DI, no decorators, no NestJS bootstrap. Fast cold start.
- **Cons:** Cannot reuse NestJS services, TypeORM repositories, or config namespaces — must duplicate the DB connection setup, storage SDK initialization, and env parsing. Code duplication grows as the project evolves (schema changes, config additions). No `@nestjs/testing` for worker unit tests. Diverges from the project's established patterns.

**Recommendation:** **Option A (NestJS ApplicationContext)** — Code reuse (TypeORM entities/repos, storage service, config namespaces) decisively outweighs the NestJS bootstrap cost. The worker runs continuously as a long-lived process, so cold start time is irrelevant. Code duplication in Option B would grow with each schema or config change. The team already knows NestJS patterns.

**Decision:** A

---

## TD-04: Streaming and Download URL Strategy

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** The platform must support video streaming (HTTP 206 range requests — partial content) so users can watch without downloading the full file, plus video download. The C4 diagram explicitly shows `Rel(frontend, storage, "Streams", "HTTPS")` — the frontend streams directly from storage, not through the API. The decision is how the API facilitates this access: by generating a direct-use URL or by proxying the data.

**Options:**

### Option A: Pre-signed GET URL (API generates, MinIO serves)
- The API exposes `GET /videos/:slug/stream-url` and `GET /videos/:slug/download-url` endpoints that generate time-limited pre-signed GET URLs pointing to the video object in MinIO (e.g., 6h TTL for streaming, 1h for download). The frontend uses these URLs directly as the HTML5 `<video src="...">` or as an anchor `href`. MinIO handles HTTP 206 range requests and `Content-Range` headers natively as part of its S3-compatible server.
- **Pros:** Matches the C4 architecture exactly. API is not in the streaming path — no resource consumption during playback. MinIO's S3-compatible server handles range requests out of the box (HTTP 206, `Accept-Ranges: bytes`). Pre-signed URLs support time-limited access control per video. Scales to any number of concurrent viewers with no API load increase.
- **Cons:** URLs expire — clients must request a fresh URL per session (one API call before playback). The video URL visible in the browser points to MinIO, not the API (not a security concern for public videos). Long-lived sessions may need URL renewal.

### Option B: API Proxies Range Requests
- The API exposes `GET /videos/:slug/stream` which reads the `Range` header, fetches the byte range from MinIO using the S3 SDK, and streams it to the client. The frontend points the `<video>` tag at the API endpoint.
- **Pros:** Single permanent URL per video. Full API-level access control per request.
- **Cons:** API is in the video streaming data path — enormous resource consumption (CPU, memory, network bandwidth) for concurrent viewers. Contradicts the C4 architecture diagram. A 10GB video proxied through the API = up to 10GB of traffic per view through the API server. Non-starter for a video platform.

**Recommendation:** **Option A (Pre-signed GET URL)** — The C4 architecture diagram explicitly shows `frontend → storage` for streaming. MinIO implements HTTP 206 range requests natively. The API generates short-lived pre-signed URLs, keeping video traffic entirely out of the API server. This is the only scalable architecture for a video streaming platform.

**Decision:** A

---

## TD-05: Unique Video Slug

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Each video needs a short, unique, URL-safe identifier (slug) that never conflicts with other videos and appears in the video's public URL (e.g., `/videos/:slug`). The slug is a separate concern from the database primary key (UUID). The choice affects URL length, collision probability, and implementation complexity.

**Options:**

### Option A: UUID v4
- Standard UUID generated by `crypto.randomUUID()` or TypeORM's `PrimaryGeneratedColumn('uuid')`. Format: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` (36 chars with dashes).
- **Pros:** Collision probability is astronomically small (2^122 address space). Already available via Node.js and TypeORM. No new code needed.
- **Cons:** 36 characters is long for a public URL slug. Contains dashes — not a clean short identifier. Conflates internal DB identity with public URL identity; the slug should be a separate, independently generated value.

### Option B: nanoid
- Third-party library (`nanoid`) generating URL-safe random strings. Default: 21 chars using `[A-Za-z0-9_-]` alphabet.
- **Pros:** Short (21 chars), URL-safe by default. Well-known library, ~5.6M weekly downloads. Configurable alphabet and size.
- **Cons:** nanoid v4+ is ESM-only. This NestJS project has no `"type": "module"` in `package.json` and uses CommonJS output. Importing nanoid v4 requires dynamic `import()` or CJS interop shims. nanoid v3 is CJS-compatible but has been in maintenance-only mode since 2022.

### Option C: `crypto.randomBytes` base64url (Node.js built-in)
- `crypto.randomBytes(8).toString('base64url')` produces an 11-character URL-safe string with 64 bits of entropy. Uses Node.js's built-in `crypto` module — no external dependency. Alphabet: `[A-Za-z0-9_-]` (RFC 4648 §5 base64url).
- **Pros:** Zero external dependencies. No ESM/CJS compatibility concerns. 64 bits of entropy → collision probability < 1 in 18 quintillion (negligible at any realistic video platform scale). 11 characters is compact for a URL slug. URL-safe out of the box. One-liner implementation.
- **Cons:** Must add a `UNIQUE` constraint on the `slug` column and retry slug generation on the rare collision (correct practice). Slightly less human-readable than nanoid's alphabetic output.

**Recommendation:** **Option C (`crypto.randomBytes` base64url)** — Zero external dependencies, no ESM/CJS compatibility issues (a real concern given nanoid v4), and 64 bits of entropy is more than sufficient. The UUID option conflates primary key with public slug and produces unnecessarily long URLs. nanoid v3 is outdated; v4's ESM-only nature requires CJS workarounds in this project.

**Decision:** C

---

## TD-06: FFmpeg Integration in Worker

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The Video Worker must: (1) extract video metadata (duration, resolution, codec, bitrate) via ffprobe; (2) generate a thumbnail from a video frame at a given timestamp via ffmpeg. The video file is stored in MinIO and may be up to 10GB — downloading the full file before processing is impractical; ffprobe can read metadata from a URL without downloading the entire file. The decision is how to invoke FFmpeg binaries from Node.js.

**Options:**

### Option A: fluent-ffmpeg
- npm package (`fluent-ffmpeg`) providing a Node.js API wrapper around the `ffmpeg` and `ffprobe` CLI tools. Offers a fluent builder API for FFmpeg commands and a `ffprobe(url, callback)` function for metadata extraction. Accepts URL inputs — ffprobe reads metadata from a remote pre-signed MinIO URL without downloading the full file.
- **Pros:** URL-input support for `ffprobe` avoids downloading the 10GB video to extract metadata (reads headers and samples only). Typed, well-documented API. Builder pattern prevents argument injection errors. Stable and widely used in production. Compatible with `ffmpeg-static` (bundles the binary) or a system FFmpeg install in the Docker container.
- **Cons:** Callback-based API requires `util.promisify` or manual Promise wrapping. Adds a dependency. The library is in maintenance mode since ~2022, though its scope (wrapping ffprobe/ffmpeg CLI) is complete and stable.

### Option B: Raw `child_process` (ffprobe + ffmpeg)
- Spawn `ffprobe` and `ffmpeg` directly via Node.js's `child_process.exec()` or `spawn()`. Parse JSON metadata output from `ffprobe -v quiet -print_format json -show_streams <url>` manually. Construct FFmpeg thumbnail command as a string.
- **Pros:** No external npm dependency. Full control over every argument.
- **Cons:** Manual argument construction as strings (injection risk if not careful). JSON output must be parsed and typed manually. Error handling requires parsing exit codes and stderr. More boilerplate for the same outcome — duplicating what fluent-ffmpeg already solves correctly.

### Option C: @ffmpeg/ffmpeg (WebAssembly)
- FFmpeg compiled to WASM, runs in-process without a system binary.
- **Pros:** No system FFmpeg installation required. Portable.
- **Cons:** WASM FFmpeg is significantly slower than native binaries. Limited codec support compared to native builds. Not designed for server-side processing of large files (may attempt to load full file into WASM memory). Inappropriate for production video processing at any meaningful scale.

**Recommendation:** **Option A (fluent-ffmpeg)** — The URL-input support for `ffprobe` is the decisive factor: metadata can be extracted from a MinIO pre-signed URL without downloading the full 10GB video. The maintenance-mode status is not a concern for this scope (metadata extraction + thumbnail generation are stable, fully-exercised code paths). Pair with `@types/fluent-ffmpeg` for TypeScript types and `ffmpeg-static` for the binary in the worker container.

**Decision:** A

---

## TD-07: Object Storage SDK

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The project uses MinIO for local development and S3 for production (per CLAUDE.md: "S3 or MinIO"). The backend needs an SDK to: initiate S3 multipart uploads (TD-02 Option B), generate pre-signed PUT part URLs, call `CompleteMultipartUpload`, generate pre-signed GET URLs (TD-04 Option A), and save thumbnail objects from the worker. The choice of SDK determines portability between MinIO (dev) and S3 (prod).

**Options:**

### Option A: @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner
- AWS SDK v3 for JavaScript. Supports S3-compatible endpoints (MinIO) via the `endpoint` configuration option and `forcePathStyle: true` (MinIO uses path-style addressing by default, unlike virtual-hosted-style S3). All S3 API operations — `CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`, `PutObject`, `GetObject` — map directly to MinIO's S3-compatible API. The `@aws-sdk/s3-request-presigner` package provides `getSignedUrl()` for generating pre-signed PUT and GET URLs.
- **Pros:** Production-portable — the exact same code works with MinIO (dev) and AWS S3 (prod) by changing `endpoint` and `forcePathStyle` env vars. De-facto standard for S3-compatible storage in Node.js. Comprehensive TypeScript types. Active maintenance by AWS. Full S3 Multipart Upload support.
- **Cons:** Two packages required (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`). MinIO configuration requires `endpoint` and `forcePathStyle: true` overrides — not the default S3 configuration.

### Option B: minio (official MinIO JavaScript SDK)
- First-party SDK from the MinIO team. Purpose-built for MinIO, with MinIO-specific management APIs (bucket notifications, ILM policies, etc.).
- **Pros:** Official MinIO client. Full MinIO-specific API coverage.
- **Cons:** MinIO-specific — code must be replaced or adapted when migrating to AWS S3 in production. The project architecture explicitly states "S3 or MinIO" implying portability is a goal. The minio SDK API surface differs from the AWS SDK; production S3 deployments universally use AWS SDK patterns. No feature advantage for the operations this project needs (pre-signed URLs, multipart upload, PutObject).

**Recommendation:** **Option A (@aws-sdk/client-s3 + @aws-sdk/s3-request-presigner)** — The project explicitly targets both MinIO (dev) and S3 (prod). The AWS SDK means zero code changes when deploying to production — only env vars change (`endpoint` is omitted; `forcePathStyle` is set to false). Adopting the MinIO SDK now would require an SDK migration at production deployment, which adds risk.

**Decision:** A
---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Message Queue Technology | BullMQ + Redis | A |
| TD-02 | Cross-layer | Upload Strategy for 10GB Files | S3 Multipart Upload with pre-signed part URLs | B |
| TD-03 | Backend | Worker Architecture | NestJS ApplicationContext | A |
| TD-04 | Cross-layer | Streaming and Download URL Strategy | Pre-signed GET URL (MinIO serves) | A |
| TD-05 | Backend | Unique Video Slug | `crypto.randomBytes(8).toString('base64url')` | C |
| TD-06 | Backend | FFmpeg Integration in Worker | fluent-ffmpeg | A |
| TD-07 | Backend | Object Storage SDK | @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner | A |
