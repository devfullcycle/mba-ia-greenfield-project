---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-06-27
scope_description: "Backend foundation for video upload and processing: object storage usage, background processing queue, 10GB non-blocking upload protocol, async video processing (metadata + thumbnail) via a dedicated worker, unique public URL generation, streaming delivery and download, and the video status lifecycle."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend that delivers the videos module (entity, endpoints), the object-storage integration (MinIO/S3 via AWS SDK v3), the processing queue (BullMQ/Redis), the video worker (FFmpeg/ffprobe), unique-URL generation, range-based streaming and download. New Docker Compose infrastructure (MinIO, Redis, worker) lives here.
- `next-frontend/` — Frontend deferred: the video UI (upload widget, player page) is explicitly out of scope for Phase 03 per the assignment. The upload handshake defined in TD-03 is an API contract any client will consume; no frontend decision is taken in this document.

---

## TD-01: Background Processing Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The phase requires a queue to run video processing asynchronously after upload. The project plan leaves the queue technology explicitly "TBD" (see `docs/project-plan.md` and `software-arch.mermaid` → "Message Queue (TBD)"). This is the primary stack decision of the phase. It is a cross-component contract: the queue name, job payload shape, and connection config appear in the API producer, the worker consumer, `compose.yaml`, the Joi schema, and `.env.example`.

**Options:**

### Option A: BullMQ + Redis (`@nestjs/bullmq`)
- BullMQ is a Redis-backed job queue with first-class NestJS integration (`@nestjs/bullmq`): queues registered via `BullModule.registerQueue`, producers inject `Queue`, consumers extend `WorkerHost` with `@Processor`. Redis persists jobs.
- **Pros:** Official NestJS technique (documented under "Queues"). Native retries with exponential backoff, delayed jobs, concurrency control, DLQ-style failed set, and events. Typed jobs. Mature and actively maintained (BullMQ 5.x). Worker runs as a separate process trivially. Single new infra dependency (Redis) that is light and Compose-friendly.
- **Cons:** Adds Redis to the stack (one more container). At-least-once delivery → jobs must be idempotent. Requires a connection-sharing strategy between API and worker.

### Option B: RabbitMQ (`@nestjs/microservices` or `amqplib`)
- A dedicated AMQP broker. The API publishes messages; the worker consumes via a microservice transport or a raw `amqplib` consumer.
- **Pros:** Purpose-built broker with strong routing, acks, and durability semantics. Scales to complex topologies.
- **Cons:** Heavier operationally than Redis for a single job type. No built-in retry/backoff scheduling — must be modeled manually (dead-letter exchanges, TTL). More moving parts than this phase needs. Less ergonomic NestJS job-processing API than BullMQ for the worker-host pattern.

### Option C: PostgreSQL-backed queue (`pg-boss`)
- A queue implemented on top of the existing PostgreSQL via `pg-boss` (SKIP LOCKED polling). No new broker.
- **Pros:** Zero new infrastructure — reuses the Postgres already in the stack. Transactional enqueue alongside business writes.
- **Cons:** Polling-based; higher DB load and latency than Redis for frequent jobs. Couples job throughput to the primary DB. No NestJS first-class module — more glue code. Less standard for media processing pipelines; weaker concurrency/visibility tooling.

**Recommendation:** **Option A (BullMQ + Redis)** — it is the official NestJS queue technique with built-in retries/backoff and a clean worker-host consumer, which directly serves the "processing in background without blocking the user" requirement; Redis is a light, well-understood addition to Compose, and the architecture diagram already anticipates a dedicated message queue.

**Decision:** A (BullMQ + Redis via `@nestjs/bullmq`)

---

## TD-02: Object Storage Client and Bucket/Key Organization

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** Object storage is a given (the project targets S3-compatible storage; locally we run MinIO, swappable for AWS S3 in production). The open decision is *how* to use it: which client library and how to organize buckets and keys. This is cross-component: bucket names and the storage endpoint appear in config, the Joi schema, `compose.yaml`, the upload service, the worker, and the streaming endpoint.

**Options:**

### Option A: AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`), single bucket with prefixes
- The official AWS JS SDK v3, pointed at the MinIO endpoint (`forcePathStyle: true`). One bucket (e.g., `streamtube-videos`) with key prefixes: `videos/{videoId}/original/<filename>` and `videos/{videoId}/thumbnail.jpg`. Presigned URLs via `s3-request-presigner`.
- **Pros:** Same API for MinIO (dev) and S3 (prod) — the production swap is config-only. Modular (`client-s3` + presigner) keeps the bundle lean. Presigned multipart support needed by TD-03. Path-style addressing works with MinIO out of the box. One bucket simplifies provisioning and IAM.
- **Cons:** Verbose command/builder API. Must create the bucket on startup (or via an init step) since MinIO starts empty.

### Option B: MinIO SDK (`minio` npm package)
- The MinIO-specific client.
- **Pros:** Ergonomic helpers; designed for MinIO.
- **Cons:** Ties code to the MinIO client; the production S3 swap is no longer config-only (different SDK semantics, presign behavior). Loses the "same code, different endpoint" guarantee that S3-compatibility is chosen for. Smaller ecosystem than AWS SDK v3.

### Option C: AWS SDK v3 with separate buckets per asset type
- Same SDK as A, but two buckets: `streamtube-videos` and `streamtube-thumbnails`.
- **Pros:** Independent lifecycle/retention policies per asset type; clearer separation.
- **Cons:** More provisioning and config (two bucket names everywhere). No real benefit at this phase's scale; prefixes within one bucket already separate concerns and can carry lifecycle rules.

**Recommendation:** **Option A (AWS SDK v3, single bucket + prefixes)** — keeps the dev→prod swap purely a matter of endpoint/credentials, supports the presigned multipart flow TD-03 needs, and uses prefixes to separate originals from thumbnails without multiplying buckets.

**Decision:** A (AWS SDK v3, single bucket `streamtube-videos` with `videos/{id}/...` prefixes)

---

## TD-03: 10GB Upload Protocol (non-blocking)

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** A 10GB file must reach storage without flowing through (and blocking) the API process. This is the defining engineering constraint of the phase: passing the file through the API is an automatic fail. The chosen handshake is an API contract that any client (the future frontend, curl, tests) must follow.

**Options:**

### Option A: Presigned multipart upload, client → storage directly
- The API issues a presigned URL per part. Flow: client calls `POST /videos` → API pre-registers the video (draft) and calls `CreateMultipartUpload`, returning `videoId` + `uploadId` + presigned `UploadPart` URLs (or an endpoint to fetch them per part). The client PUTs each ≥5MB part directly to MinIO/S3 using the presigned URLs, collecting ETags. The client then calls `POST /videos/:id/complete` with the part ETags; the API calls `CompleteMultipartUpload` and enqueues processing. Bytes never traverse the API.
- **Pros:** API stays free during transfer — only short JSON calls. Scales to 10GB+ (S3 multipart max 5TB / 10k parts). Native resumability (re-PUT a failed part). Same mechanism on MinIO and S3. Storage stays private (no public bucket).
- **Cons:** Multi-step handshake (init → per-part PUT → complete) the client must orchestrate. Requires aborting/cleaning incomplete uploads (lifecycle rule or explicit abort).

### Option B: Presigned single PUT, client → storage directly
- API returns one presigned `PutObject` URL; client uploads the whole file in a single PUT.
- **Pros:** Simplest handshake (one URL). Bytes still bypass the API.
- **Cons:** Single PUT caps at 5GB on S3 — fails the 10GB requirement outright. No part-level resumability; a dropped connection restarts the entire 10GB transfer.

### Option C: Streaming/chunked upload through the API (e.g., tus or multipart proxy)
- The client uploads to an API endpoint that streams bytes to storage.
- **Pros:** Single endpoint; API can enforce auth/validation mid-stream.
- **Cons:** All 10GB flow through the API process and its network — exactly the "passes the file through the API and blocks the system" anti-pattern the assignment forbids. Couples API memory/throughput/timeouts to file size. Automatic fail per the acceptance criteria.

**Recommendation:** **Option A (presigned multipart, direct to storage)** — it is the only option that satisfies 10GB without routing bytes through the API and gives part-level resumability; Option B fails the size cap and Option C violates the explicit constraint.

**Decision:** A (presigned multipart upload, client uploads parts directly to storage)

---

## TD-04: Video Worker Runtime and FFmpeg Invocation

**Scope:** Backend

**Capability:** Transversal — covers: Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** After `CompleteMultipartUpload`, a background worker must download/stream the object, extract duration + metadata, and generate a thumbnail from a frame. Two sub-decisions are coupled: how the worker process runs, and how it invokes FFmpeg. This shapes `compose.yaml` (a new service + image with ffmpeg), the consumer wiring, and the worker's bootstrap.

**Options:**

### Option A: Dedicated worker container (same codebase image + ffmpeg) invoking `ffmpeg`/`ffprobe` directly via `child_process`
- A second Compose service runs the same NestJS build with a worker entrypoint (a standalone Nest application context, no HTTP server) that registers the BullMQ `@Processor`. The worker image has `ffmpeg` installed; the worker shells out to `ffprobe` (JSON metadata/duration) and `ffmpeg` (single-frame thumbnail) via `child_process`.
- **Pros:** Worker scales/restarts independently of the API (the architecture's intent). Reuses the existing entities/config/DI — no code duplication. Direct `ffprobe`/`ffmpeg` calls are zero-dependency, fully controllable, and easy to assert in integration tests. ffmpeg lives only in the worker image, keeping the API image lean.
- **Cons:** Requires a worker bootstrap (`NestFactory.createApplicationContext`) and a separate Dockerfile/stage with ffmpeg. Must parse `ffprobe` JSON output.

### Option B: Process jobs inside the API process (in-process BullMQ worker)
- The API registers the `@Processor` and runs jobs in the same container; ffmpeg installed in the API image.
- **Pros:** No second service; simplest Compose.
- **Cons:** Heavy ffmpeg work competes with HTTP request handling in the same process/container — defeats "without blocking the user/system". The architecture explicitly calls for a separate Video Worker. ffmpeg bloats the API image.

### Option C: Dedicated worker container using the `fluent-ffmpeg` wrapper
- Same separate worker as A, but using the `fluent-ffmpeg` library instead of raw `child_process`.
- **Pros:** Fluent JS API over ffmpeg; less manual arg/stream handling.
- **Cons:** `fluent-ffmpeg` is effectively in maintenance mode and adds a dependency that still requires a system ffmpeg binary. The two operations needed (ffprobe metadata, one-frame thumbnail) are short, well-known commands — the wrapper adds a layer without removing the binary requirement.

**Recommendation:** **Option A (dedicated worker container, direct `ffmpeg`/`ffprobe`)** — it matches the target architecture (separate Video Worker), isolates heavy processing from the API, reuses the codebase, and keeps the FFmpeg surface to two explicit, testable commands with no extra runtime dependency.

**Decision:** A (dedicated worker container; direct `ffprobe`/`ffmpeg` via `child_process`)

---

## TD-05: Unique Public Video URL Generation

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Each video needs a short, URL-friendly, collision-free public identifier (the "single URL" of the video), distinct from the internal UUID primary key. This identifier is the externally addressable handle used by the watch/stream/download routes.

**Options:**

### Option A: Custom URL-safe id from `crypto.randomBytes` (base64url), unique column + retry-on-collision
- Generate `crypto.randomBytes(8).toString('base64url')` (~11 chars, ~64 bits of entropy) at draft creation, stored in a `public_id` column with a unique index. On the rare insert collision, regenerate and retry.
- **Pros:** Zero new dependency (Node's built-in `crypto`). No ESM/CommonJS friction. Cryptographically strong, URL-safe, short. The DB unique constraint is the source of truth for uniqueness; retry handles the astronomically rare clash.
- **Cons:** Tiny bit of hand-rolled code (a few lines) and a retry path to cover.

### Option B: `nanoid`
- The `nanoid` generator (URL-safe, configurable length).
- **Pros:** Popular, compact, battle-tested ids.
- **Cons:** `nanoid` v5 is ESM-only and the project is CommonJS (ts-jest/`nodenext` with CJS emit) — importing it requires dynamic `import()` or pinning the older CJS v3, both friction. Adds a dependency for what `crypto` already provides.

### Option C: UUID v4 as the public identifier
- Reuse a UUID (already used for PKs) as the public handle.
- **Pros:** Zero extra code; guaranteed-unique.
- **Cons:** 36 chars with hyphens — not "short/unique URL" friendly; ugly in links. Exposes a UUID-shaped value as the public handle. Fails the spirit of a short single URL.

**Recommendation:** **Option A (custom `crypto` base64url id + unique column + retry)** — delivers a short, URL-friendly, strong identifier with no dependency and no ESM friction, while the database unique constraint guarantees no conflicts.

**Decision:** A (`crypto.randomBytes` base64url `public_id`, unique index, retry-on-collision)

---

## TD-06: Streaming and Download Delivery

**Scope:** Backend

**Capability:** Transversal — covers: Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** Playback must start without downloading the whole file (HTTP Range / `206 Partial Content`), and the user must be able to download the original. The decision is whether the API serves bytes (proxying Range to storage) or redirects the client to a presigned storage URL. This shapes the streaming endpoint, auth posture, and how storage is exposed.

**Options:**

### Option A: API range-proxy — endpoint streams from storage with `Range` → `206`
- `GET /videos/:publicId/stream` reads the client `Range` header, issues `GetObjectCommand` with the same `Range` to storage, and pipes the partial body back with `206 Partial Content`, `Accept-Ranges: bytes`, `Content-Range`, and `Content-Length`. `GET /videos/:publicId/download` streams the full object with `Content-Disposition: attachment`. Storage stays private.
- **Pros:** Single, stable public URL per video (the `publicId` route) — satisfies the "unique URL" contract and never exposes storage URLs/credentials. Full control over auth (anonymous watching allowed, but the API mediates), headers, and download filename. Range requests stream only the requested bytes — no full download. Uniform behavior on MinIO and S3. Straightforward to assert in e2e tests (request `Range: bytes=0-`, expect `206`).
- **Cons:** Playback bytes flow through the API (streamed, Range-limited — not the 10GB upload problem, but still API egress). At very large scale you would add a CDN in front.

### Option B: Presigned GET redirect — API 302s to a presigned storage URL
- The endpoint returns a `302` to a short-lived presigned `GetObject` URL; the client talks to storage directly (storage handles Range/206).
- **Pros:** Offloads bandwidth from the API to storage/CDN. Less API egress.
- **Cons:** Exposes time-limited storage URLs to clients (URL leakage window). The "single URL" becomes a redirect to a rotating presigned URL, weakening the stable-URL contract. Harder to enforce per-request authorization and a clean download filename. MinIO presigned URLs behave slightly differently from S3 in edge cases. More awkward to assert deterministically in tests.

**Recommendation:** **Option A (API range-proxy with `206`)** — it preserves one stable public URL per video, keeps storage private, gives full control over streaming/download semantics and authorization, and is directly testable; CDN/bandwidth offload (Option B's only real advantage) is a later-phase optimization, not a Phase 03 requirement.

**Decision:** A (API range-proxy; `206 Partial Content` for stream, attachment for download)

---

## TD-07: Video Status Lifecycle and Failure Handling

**Scope:** Backend

**Capability:** Transversal — covers: Pré-cadastro automático do vídeo como rascunho ao iniciar o upload; Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** The video moves through states from draft creation to ready/error. The state set, the transitions, and what happens when processing fails must be fixed because they are cross-component: the entity column, the API responses, the worker transitions, and the queue retry policy all reference the same enum.

**Options:**

### Option A: `draft → processing → ready | error`, with bounded BullMQ retries then terminal `error`
- On `POST /videos` the row is created as `draft`. On `complete`, the API enqueues the job and sets `processing`. The worker, on success, sets `ready` (with duration/metadata/thumbnail key); on failure, BullMQ retries with exponential backoff (e.g., 3 attempts); after the final failed attempt the worker sets `error` and records a failure reason. Transitions are guarded (only `processing` → `ready`/`error`).
- **Pros:** Minimal, clear lifecycle that maps 1:1 to the capabilities (draft pre-registration, processing, ready). Bounded retries absorb transient ffmpeg/storage hiccups; the terminal `error` state is explicit and queryable. Easy to assert per transition.
- **Cons:** Does not distinguish "uploading" from "draft" (the draft covers the pre-complete window) — acceptable, since the upload happens client→storage and the row is simply `draft` until `complete`.

### Option B: Extended lifecycle `draft → uploading → uploaded → processing → ready | failed`
- Adds explicit `uploading`/`uploaded` states around the transfer.
- **Pros:** Finer visibility into the transfer phase.
- **Cons:** Extra states with no consumer in this phase (the client transfers directly to storage; the API only sees draft and complete). Adds transitions to implement and test for no current benefit — over-modeling.

### Option C: Boolean flags instead of a status enum (`is_processed`, `has_error`)
- Track readiness via booleans rather than a single status column.
- **Pros:** Trivial columns.
- **Cons:** Representable invalid combinations (`is_processed=true` + `has_error=true`); no single source of truth for state; awkward queries and API contracts. The plan explicitly asks for a status field (rascunho → processando → pronto/erro).

**Recommendation:** **Option A (`draft → processing → ready | error`, bounded retries → terminal `error`)** — it matches the assignment's stated cycle exactly, keeps the state machine small and guardable, and uses BullMQ's retry/backoff to handle transient failures before committing to a terminal error state.

**Decision:** A (`draft → processing → ready | error`; 3 attempts with backoff, then terminal `error` + reason)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|----------------|--------|
| TD-01 | Backend | Background processing queue | BullMQ + Redis (`@nestjs/bullmq`) | A (BullMQ + Redis) |
| TD-02 | Backend | Object storage client & bucket/key layout | AWS SDK v3, single bucket + prefixes | A (AWS SDK v3, single bucket) |
| TD-03 | Backend | 10GB upload protocol | Presigned multipart, client → storage | A (presigned multipart) |
| TD-04 | Backend | Worker runtime & FFmpeg invocation | Dedicated worker + direct `ffmpeg`/`ffprobe` | A (worker container, child_process) |
| TD-05 | Backend | Unique public URL generation | `crypto` base64url + unique column + retry | A (crypto public_id) |
| TD-06 | Backend | Streaming & download delivery | API range-proxy `206` | A (range-proxy) |
| TD-07 | Backend | Video status lifecycle & failure handling | `draft→processing→ready\|error`, bounded retries | A (status enum + retries) |
