---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-07-12
scope_description: "Background queue technology, large-file upload strategy, object storage usage (client + bucket/key layout), video worker architecture and FFmpeg integration, unique video URLs, streaming/download delivery, and video status lifecycle for Phase 03 — Upload e Processamento de Vídeos."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend delivers the queue, the video upload flow (pre-assigned draft + direct-to-storage transfer), the video worker (metadata + thumbnail extraction), streaming/download delivery, and the `videos` entity/migration tied to `channels`.
- `next-frontend/` — no open decision in this document. Phase 03's capability bullets in `docs/project-plan.md` contain no UI bullet (unlike Phase 02's "Telas de..."), and the DEMAND explicitly scopes this phase as backend-only ("a interface de vídeo não faz parte do escopo desta fase").

---

## TD-01: Background Processing Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** `docs/project-plan.md` and `docs/diagrams/software-arch.mermaid` both mark the Message Queue as `TBD` — this is the phase's principal open stack decision. The queue decouples the upload endpoint from the CPU-heavy FFmpeg work (metadata extraction + thumbnail generation), which must happen in the background without blocking the API (Ponto de Atenção: "a extração de informações do vídeo é pesada e deve acontecer em segundo plano, sem bloquear o usuário"). The chosen queue also has to support automatic retry/backoff to answer TD-08 (failure handling) without hand-rolled logic.

**Options:**

### Option A: BullMQ (Redis-backed) via `@nestjs/bullmq`
- Redis-backed job queue. NestJS-native integration through `@nestjs/bullmq`: `BullModule.forRootAsync({ useFactory: () => ({ connection: { host, port } }) })` for the connection, `@Processor(name)` + `class X extends WorkerHost { async process(job) {...} }` for consumers. Retries/backoff are native job options; `@OnWorkerEvent('completed'|'failed')` hooks report status back. Dead/stuck-worker detection is also native: a job's lock (`lockDuration`, default 30s) expires if its worker stops renewing it, the periodic `stalledInterval` check (default 30s) detects the resulting "stalled" job and requeues it, up to `maxStalledCount` (default 1) before it is marked failed — no custom liveness code needed.
- **Pros:** First-class, actively maintained NestJS module (official `nestjs/bull` org repo) — matches the project's existing pattern of using `@nestjs/*` wrappers over the underlying lib (as done for JWT, TypeORM, Throttler). Built-in retry/backoff/delay/concurrency options, verified against current docs. Optional `bull-board` dashboard for visual job inspection during development.
- **Cons:** Introduces Redis as an entirely new infra dependency — a fourth stateful service in `compose.yaml` (after `db`, `mailpit`, and the new storage), with its own container, healthcheck, and volume to manage. Critically, Redis durability is **not** the default: BullMQ's own "Going to production" guide states that *"manual persistence configuration is essential"* and recommends enabling AOF — without it, a Redis restart/crash silently drops queued and in-flight jobs. This is a real, extra piece of infra configuration this option owes on top of just adding the container.

### Option B: RabbitMQ via `@nestjs/microservices` (RMQ transport)
- AMQP broker. NestJS ships a built-in `Transport.RMQ` microservice transport (`amqplib` under the hood) for publish/consume patterns.
- **Pros:** Mature, battle-tested broker; matches the "Message Queue" terminology used in the architecture diagram literally. Good fit if the project later grows into multiple independent consumers/exchanges.
- **Cons:** `@nestjs/microservices`' RMQ transport is built for request/event microservice patterns, not job-queue semantics — retry/backoff/dead-lettering must be assembled manually (TTL + dead-letter exchange), unlike BullMQ's built-in job options. Also introduces a brand-new broker container, with more operational surface (exchanges, queues, bindings) than the phase needs.

### Option C: pg-boss (PostgreSQL-native)
- Queue implemented entirely on top of PostgreSQL tables (`SKIP LOCKED`-based polling via `boss.fetch()`). `boss.createQueue(name, { retryLimit, retryDelay, retryBackoff, deadLetter })` + `boss.send(name, payload, opts)` + `boss.work(name, opts, handler)`. Dead/stuck-worker detection is also native and requires no custom code: `expireInSeconds` caps how long a job may stay `active` before being auto-failed regardless of worker state, and for longer jobs `heartbeatSeconds` + `boss.touch(queue, jobId)` let the worker periodically signal it is still alive — if the heartbeat stops, the monitor fails/retries the job on its own. This is the same category of mechanism as BullMQ's lock/stalled-check, just polling-based instead of TTL-in-Redis.
- **Pros:** Zero new stateful infrastructure — reuses the `db` service already in `compose.yaml` since Phase 01, meaning no new container, healthcheck, volume, or persistence configuration to own for the queue itself. Native retry/backoff/dead-letter and heartbeat/expiration options verified against current docs, functionally comparable to BullMQ for this phase's needs. Durability is inherited "for free" from whatever persistence guarantee the `db` service already carries.
- **Cons:** No dedicated container in `compose.yaml` — less visually explicit as "new queue infra" even though the jobs table and polling worker are genuinely real (not mocked). Lower throughput ceiling than a dedicated broker (irrelevant at this phase's scale, but a real limitation if the platform grows significantly). Smaller ecosystem/tooling (no dashboard equivalent to Bull Board) than BullMQ. Its durability claim is only as strong as the underlying Postgres persistence setup — today the `db` service in `compose.yaml` declares no volume, so this is not yet a proven advantage in this repo as it stands (see Recommendation).

**Recommendation:** **Option C (pg-boss)** — both options are viable; BullMQ's stalled-job detection and pg-boss's heartbeat/expiration mechanism are equivalent in capability, so neither needs bespoke fallback code to detect a dead/stuck/slow job. The deciding factor is footprint: pg-boss adds zero new stateful services, while BullMQ requires standing up Redis *and* explicitly configuring AOF for durability (per BullMQ's own production guidance) — extra infra plus extra operational configuration for the same outcome. pg-boss's durability instead rides on PostgreSQL's own persistence, which is a baseline any production-grade deployment of this project must already guarantee for `users`/`channels`/`videos` regardless of the queue choice — it is not a cost specific to this decision, just a pre-existing assumption made explicit here. (Note: the current `compose.yaml` `db` service has no declared volume — this should be fixed as part of implementing this TD, or noted as a pre-existing gap to close, independent of which queue technology is chosen.)

**Decision:** C (pg-boss)

---

## TD-02: Large File Upload Strategy (up to 10GB)

**Scope:** Backend

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload"

**Context:** Files up to 10GB must not pass through the NestJS process buffered in memory or held on a single long connection — doing so is this challenge's explicit auto-fail condition. The upload must also be resumable across connection drops (Ponto de Atenção: "permita retomar em caso de falha de conexão"). Whichever strategy is chosen dictates the pre-registration handshake: the API must create the video as `draft` before the bytes start moving, so the client has a `videoId` to attach the upload to.

**Options:**

### Option A: S3/MinIO Multipart Upload via presigned URLs per part
- Client (or a test harness, since FE is out of scope) splits the file into parts (e.g., 8–16MB each). API: (1) creates the `draft` video row, (2) calls `CreateMultipartUpload` and returns a `presignedUrl` per part (`UploadPartCommand` signed via `getSignedUrl`, confirmed against current `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` docs), (3) client `PUT`s each part directly to MinIO/S3, (4) client calls a "complete" endpoint that finalizes the multipart upload and enqueues the processing job (TD-01).
- **Pros:** Bytes never transit the API process — matches the "no impact on performance" requirement literally. Natively resumable: any failed/dropped part is simply re-uploaded, the rest are untouched. Uses the same storage (MinIO/S3) already mandated by the project, no extra upload-protocol server. S3's own API *requires* multipart for objects over 5GB (a hard ceiling on single-PUT), so this is the only presigned-URL path that structurally supports the 10GB requirement.
- **Cons:** The client is responsible for chunking, tracking per-part completion, and calling "complete" — more orchestration logic than a single `PUT`. This is a smaller con than it first appears: the client here is `next-frontend/`, the project's own consumer (already under this team's control, even though its video UI is out of scope for this backend phase), not a third party — so this orchestration is work the project owns either way, not an external integration burden.

### Option B: tus resumable protocol (`@tus/server` + `@tus/s3-store`)
- Mounts a `tus` HTTP server (offset-based, resumable-by-design protocol) as Express middleware inside the Nest app (`app.all('/uploads/*', (req,res) => tusServer.handle(req,res))`), backed by `@tus/s3-store` which streams accepted chunks into an S3/MinIO multipart upload under the hood.
- **Pros:** Purpose-built resumable-upload protocol with an official S3-backed store, confirmed current via Context7. Protocol-level resumability (client asks "how much do you have?" and resumes from that offset) is more robust than manually tracking parts.
- **Cons:** Bytes for each chunk still flow through the Nest/Express process (the `tus` server sits in the request path, unlike a pure presigned-URL handoff) — a heavier footprint on the API container's CPU/network than Option A's direct-to-storage transfer. Under `@tus/s3-store`, this protocol's chunk/offset/resume orchestration is ultimately implemented **on top of** the same S3/MinIO multipart upload mechanism Option A uses directly — it re-derives, in application code, coordination that the storage API and its SDK already provide natively via `CreateMultipartUpload`/`UploadPart`/`CompleteMultipartUpload`. That is extra dependency surface (`@tus/server`, `@tus/s3-store`, `@tus/utils`) and code to maintain for a resumability guarantee Option A already gets from the storage layer itself. Multi-instance deployments need Redis for shared locking/cache (not a concern at this phase's single-instance scale, but a latent cost).

### Option C: Buffered upload through the API (`multipart/form-data` to a single endpoint)
- Client sends the entire file in one request; the API buffers/streams it into a single object write.
- **Pros:** Simplest possible implementation — one endpoint, no client-side orchestration.
- **Cons:** This is the literal auto-fail path called out by the assignment ("Passar o arquivo de 10GB pela API de forma que trave o sistema") — it routes the heaviest flow in the whole system directly through the main service, which is a severe performance/scalability problem in itself, independent of any other consideration (every concurrent upload competes for the same API process's memory/connections). It also can't structurally satisfy the requirement on its own: S3-compatible storage rejects single-PUT objects over 5GB, so a 10GB file would need chunking regardless — meaning this option would still have to reimplement multipart internally, just with the API in the middle of every byte instead of the client talking to storage directly. Not resumable: any dropped connection restarts the whole 10GB transfer.

**Recommendation:** **Option A (S3/MinIO Multipart Upload via presigned URLs)** — it satisfies both hard constraints (never touching the API process, and structural resumability) using only the storage that is already mandated. Option B is discarded for effectively re-implementing, in application code, orchestration that the storage API/SDK already provides natively — extra code and a whole new dependency for no resumability gain over Option A. Option C is discarded outright: routing 10GB uploads through the main API service is a severe, self-inflicted performance/scalability problem, and it is the assignment's own explicit auto-fail criterion. Option A's one real con (client-side chunking/completion orchestration) is minor here since the client is `next-frontend/`, the project's own consumer already under this team's control — not third-party integration burden.

**Decision:** A (S3/MinIO Multipart Upload via presigned URLs)

---

## TD-03: Video Worker Runtime Architecture

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** `docs/diagrams/software-arch.mermaid` depicts "Video Worker (FFmpeg)" as a container distinct from the API. This decision fixes how that worker actually runs — same process as the API, a separate lightweight script, or a separate NestJS application context — which determines how much of the existing config/entity/repository code it can reuse and whether CPU-bound FFmpeg work can block API request handling.

**Options:**

### Option A: Separate NestJS application context, own container
- A second entrypoint (e.g., `worker.main.ts`) bootstraps a trimmed Nest application context (`NestFactory.createApplicationContext`) reusing the existing `ConfigModule`/Joi validation, TypeORM connection, and the `videos` entity/repository. Registered as a queue consumer (TD-01's `@Processor`/`work()` handler). Runs in its own `compose.yaml` service, sharing the same Dockerfile/image as `nestjs-api` but with a different `command`.
- **Pros:** Matches the architecture diagram's distinct "Video Worker" container. CPU-bound FFmpeg work never shares an event loop with API request handling — directly satisfies the Ponto de Atenção ("deve acontecer em segundo plano, sem bloquear o usuário"). Reuses existing config validation and TypeORM entities instead of duplicating them.
- **Cons:** A second Nest bootstrap path to maintain (two `main.ts`-equivalents), and a second container definition in `compose.yaml`.

### Option B: In-process consumer inside `nestjs-api`
- The queue consumer/processor is registered as a provider within the existing `AppModule`, running in the same container and process as the HTTP API.
- **Pros:** No new container, no second entrypoint — minimal infra footprint.
- **Cons:** FFmpeg processing (spawning `ffmpeg`/`ffprobe` child processes, waiting on their I/O) competes with the API's event loop and connection pool for the same process's resources, directly working against the "não travar o sistema" requirement this phase is graded on. Does not match the architecture diagram's separate Video Worker container.

### Option C: Standalone Node.js script (no NestJS bootstrap), own container
- A minimal script (queue client + `pg`/raw SQL + `child_process` calls to `ffmpeg`/`ffprobe`) with no Nest module system.
- **Pros:** Smallest possible runtime footprint and dependency surface for the worker container.
- **Cons:** Forfeits reuse of everything already validated in the API — `ConfigModule`/Joi env schema, TypeORM entities and repositories, the domain exception/status-update conventions — forcing that logic to be re-implemented or duplicated in a second, disconnected codebase.

**Recommendation:** **Option A (separate NestJS application context, own container)** — it is the only option that both matches the architecture diagram's distinct Video Worker container and avoids duplicating the config/entity layer already built and tested in Phases 01–02, while keeping FFmpeg's CPU-bound work off the API's event loop.

**Decision:** A (separate NestJS application context, own container)

---

## TD-04: FFmpeg Integration Library

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The worker (TD-03) needs to invoke the `ffmpeg`/`ffprobe` binaries to extract video duration/metadata and generate a thumbnail from a frame. This decision is how that invocation happens from Node.js — both required capabilities (metadata + thumbnail) are driven by the same choice.

**Options:**

### Option A: `fluent-ffmpeg` wrapper
- Chainable Node.js API over the `ffmpeg`/`ffprobe` CLI binaries. `ffmpeg.ffprobe(path, cb)` returns parsed `{ streams, format }` (duration lives in `format.duration`). `.screenshots({ timestamps: ['10%'], filename, folder, size })` extracts a frame as an image file.
- **Pros:** Purpose-built for exactly these two operations, with both APIs confirmed current via Context7. Handles argument construction/escaping and output parsing (ffprobe's JSON) internally, rather than the worker parsing raw CLI output.
- **Cons:** Adds a dependency (still requires the `ffmpeg`/`ffprobe` binaries to be present in the worker's Docker image regardless of this choice).

### Option B: Raw `child_process` invocation
- Spawn `ffprobe -print_format json -show_format -show_streams <file>` and `ffmpeg -i <file> -ss <ts> -frames:v 1 <out.jpg>` directly via `execFile`, parsing `ffprobe`'s JSON stdout manually.
- **Pros:** No wrapper dependency — direct control over the exact CLI flags invoked.
- **Cons:** Must hand-roll argument construction/escaping, JSON parsing, and error handling (non-zero exit codes, malformed output) for both operations — functionality `fluent-ffmpeg` already provides and this phase would otherwise reimplement from scratch.

**Recommendation:** **Option A (`fluent-ffmpeg`)** — both required operations (metadata extraction, thumbnail generation) map directly onto documented, current APIs (`ffprobe()`, `screenshots()`), removing the need to hand-roll process invocation and output parsing for either capability.

**Decision:** A (`fluent-ffmpeg`) — Option B's control-over-raw-flags advantage doesn't outweigh reimplementing error handling the wrapper already provides. If a future need for finer-grained control over the `ffmpeg`/`ffprobe` invocation arises, revisit via Supersede (new research + `/decide`) rather than reopening this TD now.

---

## TD-05: Object Storage Client & Bucket/Key Strategy

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The storage backend itself is not open (S3-compatible via MinIO locally, per the DEMAND) — what this TD fixes is which client library talks to it, since that same client is used by both the API (issuing presigned URLs for upload/download, per TD-02/TD-07) and the worker (writing the generated thumbnail, per TD-03), making it a cross-component contract. It also fixes the bucket/key layout: a single `videos` bucket, keyed by `{channelId}/{videoId}/original.<ext>` for the source file and `{channelId}/{videoId}/thumbnail.jpg` for the generated thumbnail — scoping keys under the owning channel mirrors the existing `channels`→`user_id` ownership pattern and avoids a second bucket to provision/lifecycle-manage for what is functionally one asset group per video.

**Options:**

### Option A: `minio` official JS SDK
- MinIO's own client. `presignedPutObject(bucket, object, expiry)` / `presignedGetObject(bucket, object, expiry, reqParams)` (confirmed current via Context7) cover the simple presigned cases directly; multipart part-URLs go through the lower-level generic `presignedUrl(method, bucket, object, expires, reqParams)`.
- **Pros:** Native MinIO client — most direct path for a MinIO-only target, smallest dependency footprint for the presigned-URL and multipart operations this phase needs.
- **Cons:** Multipart presigning uses the generic/lower-level `presignedUrl` method (manually building `uploadId`/`partNumber` query params) rather than dedicated per-operation commands. Migrating to real AWS S3 in production (explicitly the project's stated production path) means switching client libraries later.

### Option B: AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`) with custom endpoint
- Official AWS S3 client, pointed at MinIO via `new S3Client({ endpoint: 'http://minio:9000', forcePathStyle: true, credentials, region })` (pattern confirmed current via Context7). Presigning uses dedicated command objects: `getSignedUrl(client, new PutObjectCommand(...))`, `new GetObjectCommand(...)`, `new UploadPartCommand(...)` for multipart parts.
- **Pros:** This is literally the "swap MinIO for S3 in production" path the project plan already commits to ("na prática você roda MinIO localmente... trocaria por S3 em produção") — same client code, only `endpoint`/`forcePathStyle`/credentials change. Typed, per-operation commands (`PutObjectCommand`, `UploadPartCommand`, etc.) instead of a generic presign method for multipart.
- **Cons:** Heavier dependency (the AWS SDK v3 client-s3 package is larger than the single-purpose `minio` client) for a project that currently only targets MinIO.

**Recommendation:** **Option B (AWS SDK v3 with custom endpoint)** — the project's own storage framing already commits to "MinIO locally, S3 in production"; using the AWS SDK against MinIO now means zero client-code changes at that future swap, and the typed per-operation commands (in particular `UploadPartCommand`) map more directly onto TD-02's multipart upload flow than the generic presign method Option A would require for the same operation.

**Decision:** B (AWS SDK v3 with custom endpoint)

---

## TD-06: Unique Video URL Identifier

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Each video needs a public identifier that never collides with another video's. The project already establishes a convention: `users` and `channels` both use `@PrimaryGeneratedColumn('uuid')` as their public-facing identifier (see `channel.entity.ts`), with no separate "slug" column.

**Options:**

### Option A: Video entity's own UUID primary key as the public identifier
- `GET /videos/:id` where `:id` is the entity's `uuid` PK, generated the same way as `users.id`/`channels.id`.
- **Pros:** Zero new columns, indexes, or generation/collision logic — UUIDv4's collision probability is cryptographically negligible, satisfying "sem conflito" by construction. Consistent with the existing project-wide convention (`users`, `channels`).
- **Cons:** URLs are long (36-char UUIDs) rather than short/pretty.

### Option B: Separate short unique slug (nanoid/base62)
- A dedicated `slug` column (e.g., 11 characters, YouTube-style), generated at draft creation with a uniqueness check + regenerate-on-collision loop.
- **Pros:** Shorter, more shareable URLs.
- **Cons:** A second unique identifier to generate, index, and collision-check, on top of the PK the project doesn't use this way anywhere else — a new pattern introduced solely for this entity.

**Recommendation:** **Option A (UUID PK as the public identifier)** — reuses the exact convention already in place for `users` and `channels`, and UUIDv4 satisfies the "no conflict" requirement without any additional generation or collision-handling code.

**Decision:** A (UUID PK as the public identifier) — keeps the project's existing convention. If shorter/friendlier URLs become a real requirement later, a secondary identifier can be added on top of the UUID PK at that point rather than replacing it now.

---

## TD-07: Video Streaming & Download Delivery

**Scope:** Backend

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** Both playback (must start without a full download, i.e., HTTP Range / 206 support) and download need a way to serve the stored video bytes back to the client. This decision is coupled to TD-05's client choice, since presigned GET generation uses the same SDK.

**Options:**

### Option A: API proxies bytes with Range support (206 Partial Content)
- A Nest controller reads the incoming `Range` header, issues a `GetObjectCommand` with the matching `Range` parameter to storage, and pipes the resulting stream back to the client with `206`/`Content-Range`/`Accept-Ranges` headers for playback, or `200`/`Content-Disposition: attachment` for download.
- **Pros:** The API fully controls response headers and can layer in auth/authorization checks per byte-range request.
- **Cons:** Every playback second and every full download routes its bytes through the NestJS process — the same "don't put large transfers through the API" concern that shaped TD-02 for uploads, now applied to the read path, at potentially higher aggregate volume (many viewers vs. one uploader per video).

### Option B: Presigned GET URLs (direct client ↔ storage)
- The API issues a short-lived presigned GET URL (`presignedGetObject` or `getSignedUrl(GetObjectCommand)`, per TD-05's client). The client's `<video>` element or download link talks directly to MinIO/S3, which natively serves `Range` requests and accepts a `response-content-disposition` override (both confirmed current via Context7) — the same presigned-URL mechanism serves streaming (no override, browser sends its own `Range` headers) and download (`response-content-disposition: attachment`) without two separate code paths.
- **Pros:** Mirrors TD-02's upload decision — bytes never transit the API regardless of concurrent viewer count or file size. MinIO/S3 already implements Range handling and `Content-Disposition` override natively, so the API's only job is minting a URL.
- **Cons:** Authorization is checked only once, at URL-issuance time — the presigned URL itself is valid for its full expiry window without a further API check. Acceptable here since videos are either public/unlisted-by-link (Phase 04+ visibility model) rather than requiring per-request access control at this phase.

**Recommendation:** **Option B (Presigned GET URLs)** — consistent with TD-02's direct-to-storage principle, and avoids proxying every playback second and every download through the API when MinIO/S3 already serves Range requests and download-disposition natively.

**Decision:** B (Presigned GET URLs) — the platform's video visibility model (public / unlisted-by-link, per Fase 04) does not warrant per-request access control on the byte stream itself; URL-issuance-time authorization is sufficient for this content's nature.

---

## TD-08: Video Status Lifecycle & Failure Handling

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** The video entity needs a status field reflecting `draft → processing → ready | error`, and the project plan requires deciding what happens when background processing fails. This depends on TD-01, since the retry mechanics come from whichever queue is chosen.

**Options:**

### Option A: Enum status, no automatic retry
- Worker sets `processing` on job start, `ready` on success, `error` on any failure — permanently, until a future (out-of-scope) manual re-trigger capability.
- **Pros:** Simplest possible state machine — one write per terminal outcome.
- **Cons:** A single transient failure (e.g., a momentary storage hiccup) permanently strands the video in `error` with no recovery path, even though the queue technology chosen in TD-01 supports retries natively.

### Option B: Enum status + queue-native retry/backoff
- Same `draft → processing → ready | error` enum, but the video stays in `processing` across the queue's automatic retry attempts (TD-01's `retryLimit`/`retryBackoff` or BullMQ's job `attempts`/`backoff`); it only flips to `error` once retries are exhausted. The worker records the last error message on the entity (e.g., a nullable `processing_error` text column) for diagnosability.
- **Pros:** Answers "o que acontece em caso de falha" concretely and gives transient failures a real chance to self-heal, using retry infrastructure the queue already provides — no bespoke retry logic to build. The recorded error message makes failures diagnosable without log-diving.
- **Cons:** One additional nullable column (`processing_error`) on the `videos` entity.

**Recommendation:** **Option B** — reuses TD-01's queue-native retry/backoff instead of hand-rolling retry logic, and gives transient processing failures (the realistic majority of failure cases) a chance to recover automatically before surfacing `error` to the user.

**Decision:** B (Enum status + queue-native retry/backoff)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Background Processing Queue Technology | BullMQ (Redis-backed) via `@nestjs/bullmq` | C (pg-boss) |
| TD-02 | Backend | Large File Upload Strategy (up to 10GB) | S3/MinIO Multipart Upload via presigned URLs | A (S3/MinIO Multipart Upload via presigned URLs) |
| TD-03 | Backend | Video Worker Runtime Architecture | Separate NestJS application context, own container | A (separate NestJS application context, own container) |
| TD-04 | Backend | FFmpeg Integration Library | `fluent-ffmpeg` wrapper | A (`fluent-ffmpeg`) |
| TD-05 | Backend | Object Storage Client & Bucket/Key Strategy | AWS SDK v3 with custom endpoint (MinIO now, S3-ready) | B (AWS SDK v3 with custom endpoint) |
| TD-06 | Backend | Unique Video URL Identifier | Video entity's own UUID primary key | A (Video entity's own UUID primary key) |
| TD-07 | Backend | Video Streaming & Download Delivery | Presigned GET URLs (direct client ↔ storage) | B (Presigned GET URLs) |
| TD-08 | Backend | Video Status Lifecycle & Failure Handling | Enum status + queue-native retry/backoff | B (Enum status + queue-native retry/backoff) |
