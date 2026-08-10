---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-07-01
scope_description: "Object storage usage, background queue, upload/streaming/download strategy, video worker (FFmpeg) and status/failure lifecycle for Fase 03 — Upload e Processamento de Vídeos"
---

# Technical Decisions — Fase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — owns every TD below. The video module, migration, queue, worker and storage integration are all implemented here.
- `next-frontend/` — no open decision. `plan.txt` scopes Fase 03 explicitly as a backend challenge ("Este é um desafio de backend... a interface de vídeo não faz parte do escopo desta fase"); the video player/upload UI is deferred to Fase 04/05.

---

## TD-01: Background Job Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** `docs/diagrams/software-arch.mermaid` marks the Message Queue container as `"TBD"` — this is the one genuinely open stack decision the phase must close (per `plan.txt`, §"Decisões que você precisa tomar"). The queue decouples the API (which must return immediately after upload completion) from the Video Worker (which runs the heavy FFmpeg job). The chosen technology also has to reconcile with the "pré-cadastro automático do vídeo como rascunho" capability: the video row is written to Postgres at the same instant the processing job must be enqueued, so a dual-write hazard exists (DB commit succeeds, job publish fails, or vice-versa) unless the queue can participate in the same transaction as the write.

**Options:**

### Option A: pg-boss (PostgreSQL-backed queue)
- Job queue built directly on the already-running PostgreSQL instance, using `SKIP LOCKED` for safe concurrent consumption; no new infrastructure service beyond what `compose.yaml` already runs.
- **Pros:** enqueue and video-row insert can share one Postgres transaction (native transactional enqueue), eliminating the dual-write problem outright; zero new infra dependency (no Redis); ACID guarantees; one less container to operate and test in Compose.
- **Cons:** lower throughput ceiling than a dedicated broker; fewer built-in features (no priorities/rate-limiting UI); less mainstream in the NestJS ecosystem than BullMQ (no official `@nestjs/pg-boss` package — integration is a thin custom provider).

### Option B: BullMQ (Redis-backed queue)
- The de-facto standard Node.js job queue, with first-class `@nestjs/bullmq` integration, delayed jobs, configurable retry/backoff, concurrency control per worker, and the Bull Board UI for observability.
- **Pros:** richest feature set (backoff strategies, rate limiting, flows), best NestJS documentation/community support, easy to reason about worker concurrency for CPU-bound FFmpeg jobs.
- **Cons:** introduces Redis as a brand-new infrastructure dependency solely for this phase; enqueue-after-insert is two separate systems (Postgres + Redis) with no shared transaction, so a crash between "video row committed" and "job published" can leave a video stuck in `rascunho` forever unless mitigated with an outbox/reconciliation job (extra implementation cost not otherwise needed).

### Option C: RabbitMQ (AMQP broker via `amqplib`)
- General-purpose message broker with exchanges/routing, durable queues, and dead-letter queue support out of the box.
- **Pros:** battle-tested for durable async workloads; native DLQ semantics fit "processing failure" handling well.
- **Cons:** heaviest operational footprint of the three (dedicated broker + management UI), most infrastructure/config work for a single-purpose single-queue use case, no first-class NestJS microservice transport advantage here since we don't need pub/sub fan-out or routing keys — the extra power goes unused.

**Recommendation:** Option A (pg-boss) — the project already runs PostgreSQL and nothing else stateful; adding Redis (Option B) or RabbitMQ (Option C) purely to enqueue one job type is infrastructure not justified by the requirement, and pg-boss's transactional enqueue directly solves the "pré-cadastro automático" dual-write risk without an outbox pattern. BullMQ remains the stronger choice only if a future phase needs multi-queue orchestration, priorities, or a dashboard — worth revisiting then, not now.

**Decision:** Option A — pg-boss

---

## TD-02: Large File Upload Strategy (up to 10GB)

**Scope:** Backend

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload"

**Context:** The brief is explicit that piping a 10GB file through the NestJS API (buffering or holding the connection open) is an automatic-fail condition ("Passar o arquivo de 10GB pela API de forma que trave o sistema" → reprova automática). `docs/project-plan.md` §4 also flags that the upload must tolerate connection failures and be resumable. The strategy must also define when the video's `rascunho` row is created relative to the upload.

**Options:**

### Option A: Presigned multipart upload direct-to-storage
- API exposes `POST /videos` (creates the `rascunho` row + initiates an S3/MinIO multipart upload, returns the video id + upload id) and `POST /videos/:id/upload-parts` (returns one presigned `UploadPart` URL per requested part). The client (or a future frontend) uploads each part directly to storage, then calls `POST /videos/:id/complete-upload` with the returned ETags; the API finalizes the multipart upload and enqueues the processing job.
- **Pros:** the API never touches file bytes — no memory/connection pressure regardless of file size; parts already uploaded survive client disconnects, so the client can resume by re-requesting only the missing parts (native resumability, satisfying the project-plan.md §4 point) without any extra protocol; S3/MinIO multipart is a first-class, well-documented capability.
- **Cons:** requires a small multi-step contract (initiate → per-part URLs → complete) instead of a single request; the caller (frontend or test harness) must implement the multipart client logic (chunking, ETag collection).

### Option B: Streaming proxy through the API
- Client sends the file as a single request body; the API pipes the incoming stream directly to storage without buffering to disk or memory (Node streams end-to-end).
- **Pros:** simplest client contract (one request); no multipart bookkeeping.
- **Cons:** the API process holds the HTTP connection open for the entire upload duration (minutes for 10GB), tying up a request handler/socket per upload and directly contradicting the brief's "sem segurar a API durante o envio" requirement; no native resume on connection drop — a failed upload must restart from byte zero; horizontal scaling of the API becomes coupled to upload concurrency.

### Option C: tus resumable upload protocol
- Open resumable-upload protocol (chunked PATCH requests with offset tracking), via a `tus` server component.
- **Pros:** purpose-built for resumability over flaky connections, well-specified client/server contract.
- **Cons:** introduces a new protocol and typically a dedicated tus server writing to local/network disk first — S3/MinIO has no native tus support, so a bridge (tus → storage) is extra infrastructure the phase doesn't otherwise need, when S3 multipart (Option A) already provides equivalent resumability using storage the project has already committed to.

**Recommendation:** Option A — presigned multipart direct-to-storage is the only option that satisfies both hard constraints simultaneously (API never blocked on transfer; upload survives connection failures) using infrastructure the project already has (S3/MinIO), without adding a new protocol (Option C) or violating the non-blocking requirement (Option B).

**Decision:** Option A — Presigned multipart upload direct-to-storage

---

## TD-03: Object Storage Client & Bucket/Key Strategy

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** `plan.txt` is explicit that the storage *technology* is not open (S3-compatible, MinIO locally in Docker, swappable for real S3 in production) — what is open is the client SDK and how buckets/keys are organized, since this directly determines whether swapping MinIO → AWS S3 in production is a config change or a rewrite, and feeds directly into TD-02's presigned-URL flow and TD-05's unique URL.

**Options:**

### Option A: AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`)
- Official AWS SDK, configured with `forcePathStyle: true` and a custom `endpoint` pointing at the `minio` Compose service; swapping to real AWS S3 in production is purely an env-var change (endpoint + credentials), no code change.
- **Pros:** the same client code runs unmodified against MinIO now and AWS S3 later — directly matching the brief's "trocaria por S3 em produção" expectation; is the standard, most-documented client for S3-shaped APIs; `s3-request-presigner` covers both the multipart presigned URLs (TD-02) and presigned GET URLs (TD-06).
- **Cons:** a known compatibility rough edge exists with MinIO presigned URLs on non-default ports (signature mismatch) if `forcePathStyle`/endpoint aren't configured precisely — mitigated by explicit path-style config and keeping the Compose-internal port aligned between signing and requests.

### Option B: Official MinIO JavaScript SDK (`minio` package)
- MinIO's own client, with built-in `presignedPutObject`/`presignedGetObject` helpers.
- **Pros:** avoids the AWS SDK v3 presigned-URL edge case entirely; slightly simpler API for basic object operations.
- **Cons:** couples the codebase to a MinIO-specific client; moving to real AWS S3 in production means re-validating (and likely adjusting) the client layer instead of a pure config swap, working against the project's own stated production path.

**Recommendation:** Option A — the brief explicitly frames MinIO as a local stand-in for a production AWS S3 target; the AWS SDK v3 is the only option where that transition requires no client-code changes. Bucket/key layout: two logical prefixes in a single bucket, `videos/{channelId}/{videoId}/original.<ext>` and `videos/{channelId}/{videoId}/thumbnail.jpg`, keyed by the video's own unique id (TD-05) so no separate collision check is needed for storage keys.

**Decision:** Option A — AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`)

---

## TD-04: Video Worker Runtime & Metadata/Thumbnail Extraction

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The worker must run FFmpeg/ffprobe against files that can be up to 10GB without blocking the API's event loop or request handling — per this project's all-Docker architecture (see root `CLAUDE.md` Docker Networking section) and `docs/diagrams/software-arch.mermaid` (dedicated `Video Worker` container), this already settles the "separate process/container" half of the question: FFmpeg transcoding is CPU-bound and long-running, incompatible with sharing the API's Node process, so the worker ships as its own Compose service consuming TD-01's queue. What remains genuinely open is the FFmpeg wrapper used to extract metadata and generate the thumbnail.

**Options:**

### Option A: `fluent-ffmpeg`
- Chainable Node.js wrapper over the `ffmpeg`/`ffprobe` binaries; exposes `.ffprobe()` for metadata (duration, codec, resolution) and `.screenshots()` / seek-and-capture for thumbnail frames.
- **Pros:** most widely used FFmpeg wrapper in the Node ecosystem, mature API for exactly the two operations this phase needs (probe metadata, extract a frame), well-documented examples for both use cases.
- **Cons:** requires the `ffmpeg`/`ffprobe` binaries installed in the worker image (extra Dockerfile step); the wrapper itself has slowed in release cadence, though it remains the standard choice and the underlying binaries carry the actual codec support.

### Option B: `@ffmpeg/ffmpeg` (WebAssembly build)
- Runs FFmpeg compiled to WASM in-process, no external binary.
- **Pros:** no OS-level binary dependency to install/maintain in the worker image.
- **Cons:** significantly slower than native FFmpeg and memory-bound in ways that make it impractical for files up to 10GB; primarily aimed at browser/lightweight use cases, not a match for this phase's scale.

### Option C: Shell out directly via `child_process.execFile`
- Call the `ffmpeg`/`ffprobe` binaries directly without a wrapper library.
- **Pros:** zero extra dependency; full control over exact CLI invocation.
- **Cons:** reinvents argument-building and ffprobe JSON-output parsing that `fluent-ffmpeg` already provides tested and documented — pure boilerplate cost with no offsetting benefit for this phase's needs.

**Recommendation:** Option A — `fluent-ffmpeg`, run inside a dedicated `video-worker` Compose service (its own Dockerfile installing `ffmpeg`), consuming TD-01's queue. It is the only option that comfortably handles 10GB inputs while giving a documented, tested API for both required operations (metadata probe + thumbnail frame capture).

**Decision:** Option A — fluent-ffmpeg, in a dedicated `video-worker` container

**Amendment (metadata scope):** Both `plan.txt` and `docs/project-plan.md` phrase this capability as "extração de duração **e metadados**" — duration plus a broader set of metadata, not duration alone. An earlier implementation only persisted `duration_seconds`. The worker's `probeMetadata()` now also captures, from the same `ffprobe` call already being made: container `format_name` and `bit_rate` (from `data.format`), and per-stream `codec_name`/`width`/`height` for the video stream and `codec_name` for the audio stream (from `data.streams`), stored as a nullable `jsonb` column (`videos.metadata`). No new dependency or worker call was needed — `fluent-ffmpeg`'s existing `.ffprobe()` response already exposes all of this.

---

## TD-05: Unique Video URL Strategy

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** `.claude/rules/nestjs-entities.md` already mandates UUID primary keys for every entity in this project ("Use UUID as primary key: `@PrimaryGeneratedColumn('uuid')`") — that part is an inherited convention, not a fresh decision. What is open is whether the video's public URL identifier should be that same UUID, or a separate, shorter, purpose-built identifier. **This matters because `docs/project-plan.md` §4 "Pontos de Atenção" states the requirement literally as "URL curta e única"** (short **and** unique) — "unique" alone is not the full requirement; "short" is an explicit second criterion.

**Options:**

### Option A: Use the UUID primary key directly as the public URL segment
- `GET /videos/:id` where `:id` is the entity's own UUID.
- **Pros:** zero extra mechanism — UUIDs are globally unique by construction, so the "unique" half of the requirement is satisfied with no additional column, generation logic, or collision handling; consistent with the project's existing convention (channels/users already expose their UUID `id` this way).
- **Cons:** a 36-character UUID does not satisfy "URL **curta**" (short) — `project-plan.md` §4 asks for both properties together, and this option only delivers one of them.

### Option B: Separate short slug (`nanoid`) as the public identifier
- A dedicated `slug` column (11-char nanoid, unique-indexed) generated at creation time, distinct from the internal UUID PK, exposed in the public URL instead of the id. Generation retries up to 5 times (checking `findOneBy({ slug })` before insert) on the astronomically rare collision.
- **Pros:** satisfies both stated properties at once — short (11 chars vs. 36) **and** unique (checked at insert time, enforced by a unique index as a second guarantee); the internal UUID PK is retained unchanged for storage keys, FK relations, and queue payloads, so no other TD is disturbed.
- **Cons:** requires a uniqueness check + retry-on-collision at insert time and an extra unique-indexed column — marginal extra code, but necessary to meet the literal brief.

**Recommendation:** ~~Option A~~ **Option B** — an earlier version of this document recommended Option A on the claim that "no bullet asks for short/pretty URLs." That claim was incorrect: `docs/project-plan.md` §4 explicitly requires "URL curta e única" per video, which a bare UUID does not satisfy (it is unique but not short). Option B is the only option that satisfies both stated properties simultaneously, so it is required by the brief, not merely a UX preference.

**Decision:** Option B — Separate short slug (`nanoid`, 11 chars) as the public identifier; the UUID primary key remains the internal identifier for storage/FK/queue purposes.

**Amendment (título field):** `plan.txt` (line 90) lists `título` among the minimum fields of the Video entity, while `docs/project-plan.md` assigns title *editing* to Fase 04 and does not list the field explicitly for Fase 03's data model. These are not actually in conflict once "the field exists" is separated from "the field is user-editable in this phase": the `Video` entity now has a `title` column, auto-derived from the uploaded filename (extension stripped, e.g. `movie.mp4` → `movie`) at `initiateUpload` time and returned in `GET /videos/:id`. This satisfies `plan.txt`'s minimum-field requirement without adding a title-editing endpoint, which `project-plan.md` still correctly scopes to Fase 04.

---

## TD-06: Video Delivery Strategy (Streaming & Download)

**Scope:** Backend

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** Both capabilities are about how bytes reach the client once a video is `pronto`; they share the same underlying mechanism (serving a `Range`-capable response from the stored file) and differ only in intent (`inline` playback vs `attachment` download), so they are decided together to avoid two contradictory delivery mechanisms for the same object. The project already has a `@Public()` decorator (`nestjs-project/src/auth/decorators/public.decorator.ts`) to bypass the global JWT guard where anonymous access is required, so either option below can be exposed without auth if needed.

**Options:**

### Option A: Presigned GET redirect
- `GET /videos/:id/stream` and `GET /videos/:id/download` validate the video is `pronto` and respond with a `302` to a short-lived presigned GET URL from storage (`response-content-disposition=inline` vs `attachment` query param). S3/MinIO's native GET already honors `Range` headers and returns `206 Partial Content` without any extra code.
- **Pros:** consistent with TD-02's "storage does the heavy lifting, API never touches file bytes" design; no API bandwidth/connections held open for the transfer duration, at any file size; Range/206 support comes for free from the storage layer.
- **Cons:** authorization is checked once at redirect-issuance time, not per byte-range request (acceptable here since Fase 03 has no per-video visibility rules yet — those arrive in Fase 04); the storage endpoint becomes visible to the client (mitigated by the URL being short-lived and signed).

### Option B: API-proxied streaming
- The controller reads the object from storage as a stream and pipes it to the response, manually parsing the `Range` header and setting `Content-Range`/`Accept-Ranges`/`206` (NestJS `StreamableFile`).
- **Pros:** every byte request passes through the API, allowing per-request authorization, analytics, or watermarking hooks if ever needed.
- **Cons:** ties up an API connection/process for the full playback or download duration — directly working against the same non-blocking principle the brief mandates for uploads; requires hand-rolling Range-header parsing and edge cases (multi-range requests, malformed ranges) that the storage layer already implements correctly.

**Recommendation:** Option A — presigned GET redirect keeps the same architectural principle used for upload (API orchestrates, storage moves bytes), avoids reimplementing Range/206 handling that S3/MinIO already provides, and does not block API capacity on playback/download traffic. If per-request access control beyond "video is ready" becomes necessary (e.g., private/unlisted videos in Fase 04), it can be layered on top of Option A by shortening presigned URL TTLs and re-checking authorization at each redirect issuance — no architecture change required.

**Decision:** Option A — Presigned GET redirect (`inline` for streaming, `attachment` for download)

---

## TD-07: Processing Failure & Retry Policy

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** `docs/project-plan.md` already names the status cycle itself (`rascunho → processando → pronto/erro`), so the state names are given, not a decision. What both `plan.txt` ("o que acontece em caso de falha no processamento") and `docs/project-plan.md` §4 leave open is the retry/recovery policy when the worker job fails (corrupted upload, transient FFmpeg crash, storage hiccup mid-read).

**Options:**

### Option A: Queue-native retry only, no manual recovery
- Rely on the chosen queue's built-in retry/backoff (pg-boss `retryLimit`/`retryDelay`, per TD-01) for a fixed number of attempts; once exhausted, persist an error message and set the video to `erro`. Recovering from `erro` requires the user to re-upload the video from scratch (new `rascunho`).
- **Pros:** simplest to implement — zero extra endpoint, entirely delegated to the queue library's existing retry mechanism.
- **Cons:** forces a full re-upload (up to 10GB) even for transient, already-resolved failures (e.g., worker container restarted mid-job), which is an expensive remediation for the user.

### Option B: Queue-native retry + authenticated manual reprocess endpoint
- Same automatic retry as Option A, plus `POST /videos/:id/reprocess` (owner-only) that re-enqueues the processing job for a video stuck in `erro`, reusing the already-uploaded file — no re-upload needed.
- **Pros:** automatic retries still absorb most transient failures for free; the manual endpoint turns permanent-looking failures into a one-click recovery instead of a costly re-upload, at the cost of one small endpoint reusing the existing enqueue logic from TD-01/TD-02.
- **Cons:** slightly more surface area (one more authorized endpoint + state transition to validate: only from `erro`, only by the owning channel).

### Option C: No retry, fail-fast on first error
- Any processing exception immediately marks the video `erro`; no automatic retry, no manual reprocess.
- **Pros:** simplest possible behavior, easiest to reason about and test.
- **Cons:** poor resilience — a single transient blip (worker restart, brief storage unavailability) permanently fails a video that a retry would have resolved; contradicts the spirit of "processamento automático" being dependable.

**Recommendation:** Option B — automatic retry (queue-native, effectively free given TD-01's library already provides it) handles the common transient case, and the manual reprocess endpoint avoids making a full 10GB re-upload the only remediation path for a recoverable failure, which is disproportionately expensive given this phase's own upload-size requirement.

**Decision:** Option B — Queue-native retry + authenticated manual reprocess endpoint

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Background Job Queue Technology | pg-boss (Option A) | Option A — pg-boss |
| TD-02 | Backend | Large File Upload Strategy (up to 10GB) | Presigned multipart direct-to-storage (Option A) | Option A — Presigned multipart direct-to-storage |
| TD-03 | Backend | Object Storage Client & Bucket/Key Strategy | AWS SDK v3 (Option A) | Option A — AWS SDK v3 |
| TD-04 | Backend | Video Worker Runtime & Metadata/Thumbnail Extraction | fluent-ffmpeg (Option A) | Option A — fluent-ffmpeg |
| TD-05 | Backend | Unique Video URL Strategy | Short slug, nanoid (Option B) | Option B — Short slug (`nanoid`) as public id |
| TD-06 | Backend | Video Delivery Strategy (Streaming & Download) | Presigned GET redirect (Option A) | Option A — Presigned GET redirect |
| TD-07 | Backend | Processing Failure & Retry Policy | Queue-native retry + manual reprocess (Option B) | Option B — Retry + manual reprocess |
