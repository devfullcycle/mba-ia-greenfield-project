# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

> **Phase:** 03 — Upload e Processamento de Vídeos
> **Status:** Decided
> **Date:** 2026-08-01

---

## TD-01: Object Storage Client Library

**Context:** `docs/diagrams/software-arch.mermaid` already fixes Object Storage as "S3 or MinIO" — that's a hard constraint, not open. What's open is which Node client library the API and worker use to talk to it, given local dev runs entirely in Docker Compose (no AWS account).

**Options:**

### Option A: `@aws-sdk/client-s3` (AWS SDK v3, modular)
- Official AWS SDK, S3 API client. Works against any S3-compatible endpoint (including MinIO) by overriding `endpoint` + `forcePathStyle: true`. Pairs with `@aws-sdk/s3-request-presigner` for presigned URLs and `@aws-sdk/lib-storage` for multipart upload helpers.
- **Pros:** Same client code works unchanged against MinIO in dev and real AWS S3 in prod — zero-cost migration path. Modular v3 packages (only import what's used). Huge ecosystem/documentation. First-party presigned-URL and multipart-upload helpers.
- **Cons:** More verbose API than MinIO's SDK for MinIO-only operations. One more package to keep pinned to a compatible version.

### Option B: `minio` (official MinIO JS SDK)
- MinIO-specific client with a simpler high-level API (`putObject`, `presignedGetObject`, etc.).
- **Pros:** Slightly simpler API for MinIO-only use cases. Official MinIO project.
- **Cons:** MinIO-specific — switching to real AWS S3 in production (as the architecture diagram allows) would require swapping the client library and re-testing storage code. No benefit over Option A given the architecture already keeps the S3/MinIO choice open.

**Recommendation:** **Option A (`@aws-sdk/client-s3`)** — the architecture diagram explicitly leaves "S3 or MinIO" open; a client written against the S3 API keeps that door open at zero extra cost, since MinIO is S3-API-compatible by design.

**Decision:** A (`@aws-sdk/client-s3`)

---

## TD-02: Upload Strategy for Files up to 10GB

**Context:** `docs/project-plan.md` states the constraint explicitly: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance." The API runs on `@nestjs/platform-express` (fixed in Phase 01 — not reopened here).

**Options:**

### Option A: Direct-to-storage upload via presigned URLs
- The API pre-registers the video as a draft and returns one or more presigned PUT URLs (single PUT for smaller files, presigned multipart parts for large ones). The frontend uploads bytes directly to MinIO/S3, bypassing the API entirely for the transfer itself, then calls the API to mark the upload complete (which enqueues processing).
- **Pros:** Zero video bytes pass through the NestJS process — directly satisfies "sem impacto na performance" regardless of concurrent upload count. Scales independently of API capacity. Parts can upload in parallel for speed. Consistent with the architecture diagram's existing pattern of the frontend talking directly to Object Storage for heavy transfer (today only for streaming, extended here to upload).
- **Cons:** More moving parts — needs endpoints to initiate/complete/abort a multipart upload and a cleanup mechanism for abandoned uploads. Frontend must implement multipart orchestration. Requires MinIO/S3 CORS and bucket policy configured for direct browser access.

### Option B: API-proxied streaming upload
- Client sends `multipart/form-data` to a NestJS endpoint; the API streams the incoming body directly into an S3/MinIO multipart upload (e.g. via `@aws-sdk/lib-storage`'s `Upload` helper), without buffering the whole file in memory or on disk.
- **Pros:** Single endpoint, simpler frontend integration. No CORS/bucket-policy exposure to the browser. Upload progress can be tracked server-side.
- **Cons:** The full byte stream (up to 10GB) still transits the NestJS process and its container's network link — this is in tension with "sem impacto na performance" under concurrent uploads. Express's default `multer` buffers each part to memory/disk; true zero-buffer streaming requires bypassing `multer` for raw `busboy` stream piping, adding implementation complexity. The API container becomes the upload bandwidth bottleneck and cannot scale upload capacity independently of HTTP capacity.

**Recommendation:** **Option A (Presigned direct-to-storage upload)** — most directly satisfies the explicit "no performance impact" constraint and reuses the same access pattern already established for streaming delivery.

**Decision:** A (Presigned direct-to-storage upload)

---

## TD-03: Background Processing Queue Technology

**Context:** `docs/project-plan.md` requires a "serviço de processamento em segundo plano (filas)"; the architecture diagram reserves a Message Queue container marked "TBD". This phase must pick the concrete technology.

**Options:**

### Option A: BullMQ + Redis (via `@nestjs/bullmq`)
- Redis-backed job queue with first-class NestJS integration (`BullModule`, `@Processor`/`@Process` decorators), retries with backoff, per-queue concurrency limits, job progress events, stalled-job recovery.
- **Pros:** Purpose-built for exactly this workload (long-running, CPU-heavy, needs retry/backoff/progress). Official NestJS package with strong documentation. Widely used for video-processing pipelines specifically. Progress events let the API report processing status back to the client without polling the DB.
- **Cons:** Introduces Redis as a new infrastructure dependency (new Docker Compose service) not present in the stack today.

### Option B: `pg-boss` (PostgreSQL-backed queue)
- Uses `SKIP LOCKED` row-level locking on a Postgres table for job dequeue. No new infrastructure — reuses the existing `db` service.
- **Pros:** Zero new infrastructure. Can enqueue a job in the same DB transaction as the video-draft insert (true atomicity). Simpler ops story — one less container to run/monitor.
- **Cons:** No first-party NestJS integration package — would need a hand-rolled wrapper module. Throughput ceiling is far lower than a Redis-backed queue under lock contention (largely irrelevant at this project's scale, but a real trade-off). Fewer built-in observability/retry primitives than BullMQ. Mixes OLTP query load and job-queue polling load on the same Postgres instance.

**Recommendation:** **Option A (BullMQ + Redis)** — video-processing jobs are exactly the long-running, CPU-heavy, retry-sensitive workload BullMQ is built for, and the architecture diagram already models a distinct "Video Worker" consumer, implying a proper queue rather than a lightweight DB-polling mechanism.

**Decision:** A (BullMQ + Redis)

---

## TD-04: Video Processing Library (Duration, Metadata, Thumbnail)

**Context:** The phase requires automatic extraction of duration/metadata after upload and automatic thumbnail generation from a video frame — both require shelling out to FFmpeg.

**Options:**

### Option A: `fluent-ffmpeg` + `ffmpeg-static`/`ffprobe-static`
- `fluent-ffmpeg` provides a chainable API over the FFmpeg CLI (`.screenshots()` for thumbnails, `.ffprobe()` for metadata/duration). `ffmpeg-static`/`ffprobe-static` bundle prebuilt binaries so the Docker image doesn't need a separate `apt-get install ffmpeg` step.
- **Pros:** Declarative API for exactly this phase's two needs (screenshot extraction, ffprobe metadata) — both are `fluent-ffmpeg`'s most battle-tested use cases. ~2M weekly downloads, extensive prior art in NestJS video-processing tutorials/boilerplates. No manual command-string or stdout-parsing code.
- **Cons:** The GitHub repo has low recent maintenance activity and a large open-issue backlog — obscure edge cases may go unpatched.

### Option B: Direct `child_process.spawn('ffmpeg', [...])`
- Hand-written FFmpeg CLI invocations, with manual `stdout`/`stderr` parsing (including parsing `ffprobe -print_format json` output for metadata).
- **Pros:** No wrapper dependency; full control over exact CLI flags.
- **Cons:** Must hand-write command construction, output parsing, and error handling that `fluent-ffmpeg` already provides — strictly more code and more test surface for the same two operations this phase needs.

**Recommendation:** **Option A (`fluent-ffmpeg`)** — the maintenance concern is real but low-risk here: this phase's needs (single-frame screenshot, ffprobe metadata) are the library's most common, well-exercised use cases. The FFmpeg binary itself still must be present in the worker's Docker image (via `ffmpeg-static`/`ffprobe-static`, keeping the Dockerfile simple).

**Decision:** A (`fluent-ffmpeg` + `ffmpeg-static`/`ffprobe-static`)

---

## TD-05: Video Delivery Strategy (Streaming & Download)

**Context:** The architecture diagram already fixes `frontend → storage: "Streams", "HTTPS"` as a direct relationship — the API is not a byte-proxy for playback, and this is not reopened here. What's open is how the frontend obtains a URL it's authorized to use for a given video, and whether that URL is time-limited or permanent.

**Options:**

### Option A: Presigned GET URLs issued by the API per request
- The API returns a short-lived presigned GET URL (for both streaming and download) when a client requests to watch/download a specific video. S3/MinIO natively supports HTTP Range requests against presigned GET URLs, so seeking/scrubbing during playback works transparently.
- **Pros:** Keeps the bucket private (no public bucket policy required). Uniform pattern with the presigned upload flow chosen in TD-02 — one mental model for all storage access. URL expiry limits link-sharing/hotlinking exposure. Leaves room for future access-control requirements (e.g. unlisted/private videos in later phases) without a storage-layer rework.
- **Cons:** Requires one API round-trip before playback/download can start. Long playback sessions may need the frontend to re-request a URL if it outlives the expiry window.

### Option B: Public bucket / public-read objects with a stable URL
- Video objects are world-readable at a fixed URL; the API just returns that URL once and it never expires.
- **Pros:** Simplest frontend integration — no expiry handling, trivially CDN-cacheable.
- **Cons:** No way to express "not ready yet" or any future access restriction at the storage layer — that logic would have to move into a CDN/proxy layer later, reworking this decision. Publicly exposes the bucket's object-naming scheme.

**Recommendation:** **Option A (Presigned GET URLs)** — consistent with the presigned-upload model (TD-02), keeps the storage layer private by default, and doesn't foreclose reasonable future requirements (e.g. a not-yet-processed video shouldn't be streamable) without redesign. This does not, on its own, resolve *whether* draft/processing videos should be blocked from viewing — see open product decision in the research document.

**Decision:** A (Presigned GET URLs). Confirmed alongside the product decision that draft/processing videos are blocked from playback/download until `ready` (see `docs/phases/phase-03-videos/context.md` §Decisões já resolvidas, item 1).

---

## TD-06: Worker Process Deployment Model

**Context:** The architecture diagram models "Video Worker (FFmpeg)" as a container distinct from "API (Nest.js)". This phase must decide whether the worker is a genuinely separate NestJS application (own entry point, own Docker Compose service) sharing code with the API, or a queue processor running inside the existing API process for now.

**Options:**

### Option A: Separate NestJS application (Nest CLI monorepo "apps"), own Docker Compose service
- `nest generate app video-worker` adds a second entry point (`apps/video-worker` or equivalent) inside the same repo, sharing entities/config/modules with the API project. A new `video-worker` service is added to `compose.yaml` running that entry point.
- **Pros:** Matches the architecture diagram literally — an independently deployable/scalable container. CPU-heavy FFmpeg jobs can't degrade the API's HTTP responsiveness or compete with it for the same container's CPU share. A worker crash from a malformed video doesn't take the HTTP API down with it.
- **Cons:** More Docker Compose/build surface (new service, new build target or shared image with a different `command:`). Nest's CLI monorepo mode requires restructuring `nest-cli.json` for multiple entry points sharing one `src/` (or a `libs/` split) — a one-time setup cost.

### Option B: In-process worker (BullMQ `@Processor` inside the existing `nestjs-api` container)
- The queue consumer runs as an injectable provider inside the same Nest application and container as the HTTP API.
- **Pros:** No new infrastructure or Docker Compose service needed for this phase. Simplest to implement and test — reuses all existing module wiring directly.
- **Cons:** Contradicts the already-approved architecture diagram (a single container doing both HTTP and FFmpeg CPU work). A long-running FFmpeg job can degrade HTTP request latency sharing the same process/container. Cannot scale processing capacity independently of API capacity — directly relevant given the phase's own "sem impacto na performance" concern extends naturally to processing, not just upload.

**Recommendation:** **Option A (Separate container)** — the architecture diagram is an already-approved artifact from prior phases, not something this research reopens; Nest's standard monorepo mode exists precisely for this shared-library/multiple-entry-point scenario, so this doesn't require a second repository.

**Decision:** A (Separate NestJS app, Nest CLI monorepo, own container)

---

## Decisions Summary

| ID | Decision | Recommendation | Choice |
|----|----------|---------------|--------|
| TD-01 | Object Storage Client Library | `@aws-sdk/client-s3` | A (`@aws-sdk/client-s3`) |
| TD-02 | Upload Strategy for Files up to 10GB | Presigned direct-to-storage upload | A (Presigned direct-to-storage upload) |
| TD-03 | Background Processing Queue Technology | BullMQ + Redis | A (BullMQ + Redis) |
| TD-04 | Video Processing Library | `fluent-ffmpeg` + `ffmpeg-static`/`ffprobe-static` | A (`fluent-ffmpeg`) |
| TD-05 | Video Delivery Strategy (Streaming & Download) | Presigned GET URLs | A (Presigned GET URLs) |
| TD-06 | Worker Process Deployment Model | Separate NestJS app (Nest CLI monorepo), own container | A (Separate container) |
