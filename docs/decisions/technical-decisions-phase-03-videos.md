---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-11-05
scope_description: "Backend foundation for video upload and processing: object storage, background queue and worker, 10GB presigned multipart upload, draft pre-registration and status lifecycle, FFmpeg metadata/thumbnail extraction, failure policy, collision-free public IDs, range-based streaming/download, authorization and test isolation."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend that delivers storage integration (MinIO/S3), the BullMQ queue, the `video-worker` process (same codebase, FFmpeg), the upload/stream/download endpoints, the `Video` entity and its status lifecycle; also owns the Compose services (`redis`, `minio`, `minio-init`, `video-worker`).
- `next-frontend/` — Frontend deferred: Phase 03 capabilities in `docs/project-plan.md` are delivered and proven through the API plus a Node upload client (TD-05). The upload/playback screens belong to later phases (Fase 04/05). No open decision in this document; the upload handshake (TD-04) is the cross-layer contract the frontend will consume.

_Library versions checked (2026-11-05):_ `bullmq` 6.7.0 (npm latest; Context7 docs available up to v6.5.3 — API used here — `UnrecoverableError`, `jobId`, `settings.backoffStrategy` — is unchanged in that range), `@nestjs/bullmq` 12.0.0 (peer: `bullmq` ^6, `@nestjs/core` ^11 — compatible with installed NestJS 11), `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 3.1163.0, `sqids` 0.3.0 (**discrepancy:** Context7 has no entry for the JS library, only the Python/PHP ports; API verified against the npm package README — `new Sqids({ alphabet, minLength }).encode([n])`), `@nestjs/schedule` 12.0.2 (reconciler, TD-09).

_Origin:_ the options below were discussed and a preferred path was agreed in the grill interview of 2026-11-05 (`docs/Desafio 5 — plano detalhado.md` § "Decisões fechadas"). Each TD cites the grill item it traces to (`Grill #N`); see the traceability table at the end. `**Decision:**` fields stay pending until confirmed by `/plan-resolve`.

---

## TD-01: Object Storage Backend and Endpoint Topology

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** Videos up to 10GB and thumbnails need durable storage reachable by the API, the worker and the upload client. Because uploads go straight to storage (TD-04), the storage host must be signed with an address the *client* can reach (host machine) while internal traffic uses the Docker network (`CLAUDE.md` Docker Networking rule). The env keys are a cross-component contract (Joi schema + `compose.yaml` + `.env.example` + test `.env`). Grill #13.

**Options:**

### Option A: MinIO in Compose + AWS SDK v3, two `S3Client`s (internal / public)
- `minio` service; `S3_ENDPOINT=http://minio:9000` for API/proxy/worker operations, `S3_PUBLIC_ENDPOINT=http://localhost:9000` used only to sign part PUT URLs (in the test `.env` the public endpoint is `minio:9000`, since tests run inside the network). Both clients `forcePathStyle: true`. A `minio-init` (`minio/mc`) one-shot creates bucket + lifecycle.
- **Pros:** S3-compatible — same code runs on AWS S3 later by swapping endpoints; supports multipart + presigned URLs + bucket lifecycle (needed by TD-04); respects the service-name rule internally.
- **Cons:** two clients/endpoints to keep consistent; signature is host-bound, so the public endpoint must match exactly what the client calls.

### Option B: Local filesystem volume served by the API
- Files written to a shared Docker volume; API streams them.
- **Pros:** zero extra service.
- **Cons:** no presigned/multipart — forces bytes through the API (conflicts with 10GB non-blocking requirement); no lifecycle; doesn't scale beyond one host.

### Option C: Real AWS S3 in development
- **Pros:** production parity.
- **Cons:** requires cloud credentials/cost for every dev and CI run; "storage must really run in Compose" is a delivery requirement.

**Recommendation:** **Option A** — the only option that runs fully in Compose while supporting presigned multipart upload; the dual-endpoint split is the minimal fix for host-bound signatures without breaking the Docker networking rule.

**Decision:** A (MinIO in Compose + AWS SDK v3, internal/public S3Clients)
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

---

## TD-02: Background Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** Processing (TD-07) is heavy and must run off the request path, with retries and deduplication. Adds a new infra service to Compose. Grill #4.

**Options:**

### Option A: BullMQ + Redis (`@nestjs/bullmq`)
- Redis-backed queue; official NestJS integration (`BullModule.forRoot/registerQueue`, `@Processor` + `WorkerHost`). Custom `jobId` dedups, `UnrecoverableError` skips retries, `settings.backoffStrategy` allows capped exponential backoff.
- **Pros:** first-class Nest recipe; every failure-policy primitive needed by TD-09 is built in; `failed` set doubles as dead-letter store (no separate DLQ).
- **Cons:** new Redis dependency; jobs are lost if Redis has no persistence (mitigated by the reconciler in TD-09).

### Option B: pg-boss (PostgreSQL-backed)
- **Pros:** reuses existing Postgres; transactional enqueue with the status update.
- **Cons:** no official Nest module; polls the DB under load; less ecosystem for backoff/observability.

### Option C: RabbitMQ
- **Pros:** robust broker, native DLX.
- **Cons:** heavier ops; retry with delay requires plugins/DLX choreography; overkill for a single job type.

**Recommendation:** **Option A** — official NestJS 11 integration (`@nestjs/bullmq` 12 supports `bullmq` ^6) and native primitives for dedup, unrecoverable errors and custom backoff; the Redis-loss risk is covered by DB-as-source-of-truth + reconciler instead of a DLQ.

**Decision:** A (BullMQ + Redis via @nestjs/bullmq)
**Libraries:** bullmq, @nestjs/bullmq

---

## TD-03: Worker Process Topology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The worker needs FFmpeg/ffprobe, must not share CPU with HTTP handlers, and must really start in Compose. Choice affects Dockerfiles, Compose and module layout. Grill #5.

**Options:**

### Option A: Separate `video-worker` service, same codebase, standalone context
- Entry `src/worker.ts` with `NestFactory.createApplicationContext(WorkerModule)` (no HTTP); own `Dockerfile.worker` with FFmpeg and `npm ci` at build; anonymous volume on `node_modules`.
- **Pros:** isolates CPU-heavy work; reuses entities/config/storage modules; scales independently; starts with a single command.
- **Cons:** second image to build; module boundaries must keep HTTP-only providers out of `WorkerModule`.

### Option B: Processor inside the API process
- **Pros:** simplest wiring.
- **Cons:** FFmpeg contends with request handling (the "doesn't freeze the system" requirement); FFmpeg in the API image.

### Option C: Separate worker project/repo
- **Pros:** strongest isolation.
- **Cons:** duplicates entities/config; contract drift; more setup for a single job type.

**Recommendation:** **Option A** — isolation of Option C at the code-sharing cost of Option B.

**Decision:** A (separate video-worker service, same codebase, standalone context)

---

## TD-04: Upload Protocol and Handshake Contract (10GB)

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** 10GB must never pass through the API (automatic-failure criterion) and must be resumable (`Pontos de Atenção`). The handshake shape is consumed by the Node client now (TD-05) and by the frontend later. Grill #8.

**Options:**

### Option A: S3 presigned multipart upload, API orchestrates
- `POST /videos/uploads` (validates `video/*` and ≤ 10GB, creates `DRAFT`, returns all part URLs, 6h validity); `POST /videos/:id/uploads/parts` (renew URLs); `POST /videos/:id/uploads/complete` (client sends ETags); `DELETE /videos/:id/uploads` (abort). Part size computed between 5MB and 100MB (S3 limit 10,000 parts). Bucket lifecycle aborts incomplete multipart after 1 day.
- **Backend:** only signs and finalizes — O(1) memory. **Frontend/client:** slices the file, PUTs parts in parallel, retries/resumes per part.
- **Pros:** zero bytes through the API; resumable per part; native to S3/MinIO.
- **Cons:** client complexity (ETag bookkeeping, URL renewal); CORS on storage for the future browser client.

### Option B: tus protocol (tus-node-server in API)
- **Pros:** standard resumable protocol, mature clients.
- **Cons:** bytes flow through the API (or an extra tusd service); duplicate storage hop.

### Option C: Streaming single request through the API to S3
- **Pros:** simplest client.
- **Cons:** not resumable; ties an API connection for the whole 10GB transfer.

**Recommendation:** **Option A** — the only option meeting "no bytes through API" and resumability with the storage chosen in TD-01. Depends on TD-01 (public endpoint) and TD-06 (draft creation).

**Decision:** A (S3 presigned multipart upload, API orchestrates)

---

## TD-05: Upload Client for Delivery Proof

**Scope:** Repo-wide

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** Phase 03 has no UI, yet the 10GB upload must be demonstrated end to end and exercised in e2e. Grill #2.

**Options:**

### Option A: Node script `scripts/upload-video.ts` (own SI)
- Streams the file part by part, PUTs to presigned URLs, stores ETags, renews expired URLs, calls `complete`.
- **Pros:** reproducible 10GB proof with constant memory; reused by e2e; documents the TD-04 contract executable-ly.
- **Cons:** extra code that the future frontend will reimplement in the browser.

### Option B: Manual `curl`/`mc` steps
- **Pros:** no code.
- **Cons:** error-prone for hundreds of parts; not reusable in tests.

### Option C: Build the frontend upload screen now
- **Pros:** real UX.
- **Cons:** pulls frontend scope into a backend phase.

**Recommendation:** **Option A** — smallest artifact that makes the 10GB criterion verifiable and testable.

**Decision:** A (Node script scripts/upload-video.ts)

---

## TD-06: Video Entity and Draft Pre-registration

**Scope:** Backend

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** The video must exist as `DRAFT` from upload start. Its status set and columns are shared by API, worker, reconciler and Phase 04. Grill #6.

**Options:**

### Option A: Single `videos` table with status enum + processing columns
- `id` uuid, `seq` bigint (sequence, feeds TD-10), `public_id` unique, `channel_id` FK cascade, `title`, `status` (`DRAFT`/`PROCESSING`/`READY`/`ERROR`), `original_filename`, `mime_type`, `size_bytes` bigint (transformer → number), `storage_key`, `thumbnail_key`, `upload_id`, `duration_seconds`, `width`, `height`, `codec`, `error_reason`, timestamps. `description`/`visibility` deferred to Fase 04.
- **Pros:** one row is the source of truth for idempotency and reconciliation; simple queries.
- **Cons:** processing columns nullable until `READY`.

### Option B: `videos` + separate `video_uploads`/`video_assets` tables
- **Pros:** normalizes upload session and derived assets.
- **Cons:** joins and multi-row transitions for a 1:1 relationship; more migrations now.

**Recommendation:** **Option A** — 1:1 data doesn't justify extra tables; keeps the status machine in one row.

**Decision:** A (single videos table with status enum + processing columns)

---

## TD-07: Metadata Extraction Strategy

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** Reading 10GB to local disk before probing wastes I/O and space. Grill #9.

**Options:**

### Option A: ffprobe/ffmpeg read an internal presigned GET URL
- Child process (`child_process.spawn`) on the URL; 10-minute timeout per process; job idempotent (only processes videos in `PROCESSING`).
- **Pros:** no full download (ffprobe reads headers/ranges); no temp-disk sizing.
- **Cons:** depends on network to MinIO during processing (classified as infra failure, TD-09); `moov` at file end causes extra range reads.

### Option B: Download to temp file, then probe
- **Pros:** fully local, robust to network blips mid-probe.
- **Cons:** 10GB disk per concurrent job; longer processing.

### Option C: `fluent-ffmpeg` wrapper
- **Pros:** friendlier API.
- **Cons:** package deprecated/unmaintained; adds no capability over spawning binaries.

**Recommendation:** **Option A** — avoids per-job 10GB temp storage; network failures are retried by TD-09.

**Decision:** A (ffprobe/ffmpeg over internal presigned GET URL)

---

## TD-08: Thumbnail Frame Selection

**Scope:** Backend

**Capability:** Geração automática de thumbnail a partir de um frame do vídeo

**Context:** A fixed timestamp fails for very short videos; frame 0 is often black. Grill #9.

**Options:**

### Option A: `min(10% of duration, duration − 0.1s)`
- **Pros:** avoids intro black frame; safe for sub-second videos; deterministic (testable).
- **Cons:** not "best frame".

### Option B: First frame (`-ss 0`)
- **Pros:** trivial.
- **Cons:** frequently black/fade-in.

### Option C: FFmpeg `thumbnail` filter (scene analysis)
- **Pros:** better visual choice.
- **Cons:** decodes many frames — heavy on 10GB via network.

**Recommendation:** **Option A** — cheap single seek with a sensible frame; Fase 04 adds custom thumbnails anyway.

**Decision:** A (min(10% of duration, duration − 0.1s))

---

## TD-09: Processing Status Lifecycle and Failure Policy

**Scope:** Backend

**Capability:** Transversal — covers: Processamento automático do vídeo após upload (extração de duração e metadados); Serviço de processamento em segundo plano (filas)

**Context:** Must distinguish "file is bad" from "infra hiccup" and never lose a job when Redis is down. Status values are a contract across API, worker and reconciler. Grill #10. Depends on TD-02, TD-06.

**Options:**

### Option A: Infra failures retry forever; only permanent failures go to `ERROR`; DB-driven reconciler
- Infra failure never sets `ERROR`: unlimited attempts, exponential backoff (30s doubling, 1h cap). Permanent failure (invalid file, no video stream, no duration) throws `UnrecoverableError` → `ERROR` + `error_reason`. Unknown → treated as infra. Classifier is a pure, unit-tested function. `complete` writes `PROCESSING` *before* enqueuing and returns `202` even with Redis down; a reconciler every 5 min re-enqueues `PROCESSING` videos with no job for >15 min (`jobId = videoId` prevents duplicates).
- **Pros:** user never sees `ERROR` for transient issues; no job lost; idempotent.
- **Cons:** a misclassified permanent error retries hourly forever (bounded cost, visible in `failed`/logs).

### Option B: Fixed N attempts, then `ERROR`
- **Pros:** simple, finite.
- **Cons:** a Redis/MinIO outage longer than N backoffs marks good videos as `ERROR`.

### Option C: Transactional outbox table
- **Pros:** strongest enqueue guarantee.
- **Cons:** extra table + relay process; the reconciler gives the same outcome using the existing `status` column.

**Recommendation:** **Option A** — correctness for users (no false `ERROR`) with the DB as source of truth, without an outbox.

**Decision:** A (infra failures retry forever; permanent → ERROR; DB-driven reconciler)
**Libraries:** @nestjs/schedule

---

## TD-10: Collision-free Public Video ID

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Each video needs a short URL that never collides (`Pontos de Atenção`). The format is consumed by routes now and frontend URLs later. Grill #7.

**Options:**

### Option A: `public_id = Sqids(seq)` with shuffled alphabet, min length 10
- **Pros:** bijective — uniqueness by construction, no retry loop; short and non-sequential-looking; unique index as safety net.
- **Cons:** obfuscation, not secrecy (decodable with the alphabet); alphabet is a permanent config value.

### Option B: Random nanoid + unique index + retry on conflict
- **Pros:** unguessable.
- **Cons:** collision handling path; uniqueness only probabilistic.

### Option C: Expose UUID
- **Pros:** zero code.
- **Cons:** 36 chars — fails "short URL".

**Recommendation:** **Option A** — guaranteed uniqueness with no conflict path; enumeration risk is acceptable because non-`READY` videos return 404 (TD-12).

**Decision:** A (public_id = Sqids(seq), shuffled alphabet, min length 10)
**Libraries:** sqids

---

## TD-11: Streaming and Download Delivery

**Scope:** Cross-layer

**Capability:** Transversal — covers: Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** Playback must start without full download; download is a separate capability. Choice defines what the player/link URL is. Grill #3.

**Options:**

### Option A: API proxy with `Range` pass-through
- API pipes the S3 `GetObject` stream (no buffering), forwarding `Range` and returning `206`; download uses the same path with `Content-Disposition: attachment`.
- **Backend:** authorization checked per request. **Frontend:** plain `<video src>` / link on the API URL.
- **Pros:** single place for authz (TD-12); storage never exposed; works with `localhost`/`minio` split.
- **Cons:** bytes flow through API (backpressure-safe stream, but API bandwidth).

### Option B: Redirect (302) to presigned GET URL
- **Pros:** offloads bandwidth to storage/CDN.
- **Cons:** URL shareable until expiry; needs public endpoint signing for reads.

### Option C: HLS/DASH transcoding
- **Pros:** adaptive bitrate.
- **Cons:** transcoding cost/time out of phase scope.

**Recommendation:** **Option A** — simplest correct streaming with centralized authz; Option B recorded as evolution once a CDN exists.

**Decision:** A (API proxy with Range pass-through)

---

## TD-12: Video Authorization Matrix

**Scope:** Cross-layer

**Capability:** Transversal — covers: Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance; Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** Anonymous users watch freely, but drafts must not leak. Status codes are a contract with clients. Grill #11. Depends on Phase 02 auth guard.

**Options:**

### Option A: Owner-only writes, `READY`-only reads, 404 for hidden
- Upload writes require auth + ownership (anonymous 401; someone else's video 404). Metadata: owner sees any status, others only `READY`. Stream/download/thumbnail: `READY` only, owner included. Hidden or foreign → 404, never 403. "My videos" listing deferred to Fase 04.
- **Pros:** no existence leak; uniform rule.
- **Cons:** owner can't preview before `READY` (no playable asset anyway).

### Option B: 403 for foreign/non-ready resources
- **Pros:** clearer errors.
- **Cons:** reveals existence of private drafts.

**Recommendation:** **Option A** — prevents enumeration (complements TD-10).

**Decision:** A (owner-only writes, READY-only reads, 404 for hidden)

---

## TD-13: Test Isolation for Storage, Queue and FFmpeg

**Scope:** Repo-wide

**Capability:** Transversal — covers: Serviço de armazenamento de arquivos (vídeos e thumbnails); Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** Tests must not pollute dev data and must exercise real FFmpeg. Affects test `.env`, npm scripts and Compose. Grill #12.

**Options:**

### Option A: Dedicated bucket/prefix + video e2e inside the worker container
- Bucket `streamtube-test`, BullMQ prefix `streamtube-test`; `npm run test:e2e:video` runs in the worker container, booting `WorkerModule` in the Jest process with real FFmpeg. Fixtures: ~1MB MP4 + fake `.mp4`. Compose smoke test and 10GB proof manual, logged in `progress.md`.
- **Pros:** real pipeline coverage; isolated data; no FFmpeg in API image.
- **Cons:** separate e2e command/container.

### Option B: Mock S3/queue/FFmpeg
- **Pros:** fast.
- **Cons:** doesn't prove the "really runs in Compose" criterion.

### Option C: Testcontainers per suite
- **Pros:** full isolation.
- **Cons:** Docker-in-Docker from inside the dev containers; slow.

**Recommendation:** **Option A** — real integration with cheap isolation.

**Decision:** A (dedicated bucket/prefix + video e2e inside worker container)

---

## Grill Traceability (2026-11-05)

| Grill # | Topic | Where |
|---|---|---|
| 1 | Repository/fork, `dev` branch | Process decision — not a TD (git workflow in `CLAUDE.md`) |
| 2 | Upload client script | TD-05 |
| 3 | Streaming/download proxy | TD-11 |
| 4 | BullMQ + Redis, no DLQ | TD-02 |
| 5 | `video-worker` service | TD-03 |
| 6 | `Video` entity | TD-06 |
| 7 | Sqids public ID | TD-10 |
| 8 | Upload contract | TD-04 |
| 9 | Processing via presigned URL, thumbnail, timeout, idempotency | TD-07, TD-08 |
| 10 | Failure policy, reconciler | TD-09 |
| 11 | Authorization matrix | TD-12 |
| 12 | Test isolation | TD-13 |
| 13 | MinIO endpoints | TD-01 |

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Object storage & endpoints | A (MinIO + 2 S3Clients) | A |
| TD-02 | Backend | Queue technology | A (BullMQ + Redis) | A |
| TD-03 | Backend | Worker topology | A (separate service, same codebase) | A |
| TD-04 | Cross-layer | Upload protocol | A (presigned multipart) | A |
| TD-05 | Repo-wide | Upload client | A (Node script) | A |
| TD-06 | Backend | Video entity / draft | A (single table) | A |
| TD-07 | Backend | Metadata extraction | A (ffprobe on presigned URL) | A |
| TD-08 | Backend | Thumbnail frame | A (min(10%, d−0.1s)) | A |
| TD-09 | Backend | Status lifecycle & failures | A (infra retries forever + reconciler) | A |
| TD-10 | Backend | Public video ID | A (Sqids(seq)) | A |
| TD-11 | Cross-layer | Streaming & download | A (API Range proxy) | A |
| TD-12 | Cross-layer | Authorization matrix | A (404 for hidden) | A |
| TD-13 | Repo-wide | Test isolation | A (test bucket/prefix, e2e in worker) | A |
