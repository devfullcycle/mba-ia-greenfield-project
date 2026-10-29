---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-10-27
scope_description: "Phase 03 — large-file video upload (10GB), object storage, background processing queue/worker, unique video URL, streaming and download"
---

# Technical Decisions — Phase 03: Video Upload and Processing

_Subprojects in scope:_

- `nestjs-project/` — API (init/sign/complete upload, streaming/download endpoints, video entity/migration) and the new Video Worker entrypoint (same codebase). Carries nearly every TD.
- `next-frontend/` — No UI bullet exists in Phase 03 of `docs/project-plan.md` (upload/playback screens arrive with Phases 04–05). The only frontend-facing decision is the upload protocol (TD-02, `Scope: Cross-layer`), which fixes the contract the frontend will consume later. No frontend-only TD.
- Repo-wide / infra — `compose.yaml` gains `redis` (or equivalent), the object-storage service and `video-worker`; covered in TD-01, TD-04 and TD-13 (not a separate TD).

**Inherited (not reopened):** `@nestjs/config` + Joi + `registerAs` namespaces (phase-01); class-validator, domain exception filter, `@nestjs/throttler`, custom JWT guards, opaque/JWT tokens (phase-02-auth); `@nestjs/swagger` + exported `openapi.json` (openapi-docs-nestjs); Docker Compose service names as hosts (root `CLAUDE.md`).

**Review notes (critical findings that shaped this document):**

1. **MinIO is no longer a safe default.** The community repo went into maintenance mode (Dec 2025) and was later archived; no new releases or reviewed security fixes ([pinggy](https://pinggy.io/blog/minio_archived_self_hosted_s3_alternatives/), [glukhov](https://glukhov.org/data-infrastructure/object-storage/minio-dead/)). The architecture diagram says "S3 or MinIO", so the engine needs an explicit decision (TD-13). Everything else in this document is written against the **S3 API**, so the engine stays swappable.
2. **`DRAFT` is overloaded.** Phase 03 says "pré-cadastro como rascunho"; Phase 04 says "rascunho → publicação". The processing lifecycle (upload/process/ready/error) and the publication lifecycle (draft/published) are different axes — see TD-10.
3. **Presigned URLs and Docker networking.** A presigned URL embeds the host in its signature. The browser cannot reach `minio:9000`, and the API cannot sign for `localhost:9000` without being told to. A separate *public* endpoint (for signing) and *internal* endpoint (for API/worker I/O) is needed — see TD-02/TD-13.
4. **We stream the original file (no transcoding in scope).** Browsers only play H.264/AAC (MP4), VP8/VP9/AV1 (WebM) etc. and benefit from `moov` at the file start. Upload validation (TD-12) must therefore be stricter than "any video".

---

## TD-01: Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The project plan and architecture diagram leave the queue as "TBD". The queue carries `process-video` jobs from the API to the worker and needs retries/backoff and a failure sink. Volume is low (one job per upload) but jobs are long (ffprobe/ffmpeg over a ≤10GB object).

**Options:**

### Option A: BullMQ + Redis (`@nestjs/bullmq`)
- Official NestJS integration (`@nestjs/bullmq`, `@Processor`, `@InjectQueue`); attempts, exponential backoff, deduplicating `jobId`, stalled-job recovery, repeatable jobs (usable for the stale-upload cleanup in TD-10) and a failed set that acts as the DLQ.
- **Pros:** best documented Nest path; rich job lifecycle; Bull Board available for inspection; Redis can later serve throttler storage/cache.
- **Cons:** new infrastructure (Redis with AOF enabled so jobs survive restarts); enqueue is not transactional with the Postgres write (see TD-06); Redis server licensing churn (Valkey is a drop-in alternative at the compose level).

### Option B: pg-boss (PostgreSQL)
- Queue tables in the existing Postgres using `SKIP LOCKED`; supports retries, backoff, singleton keys, scheduling and dead-letter queues.
- **Pros:** zero new infrastructure; enqueue can share the **same transaction** as the video row update (removes the dual-write gap in TD-06); fewer containers in compose.
- **Cons:** no official Nest module (thin custom provider needed); queue churn on the primary DB; smaller ecosystem/tooling; Redis likely wanted later anyway (rate limit storage, cache).

### Option C: RabbitMQ
- Broker with ack/nack, DLX, per-message TTL; Nest microservices transport available.
- **Pros:** mature broker semantics, strong DLQ model.
- **Cons:** heaviest operational footprint for one job type; retries/backoff are hand-built (DLX + TTL topology); no job-state inspection API as convenient as BullMQ's.

### Option D: AWS SQS (ElasticMQ locally)
- Managed queue, local emulation via ElasticMQ.
- **Pros:** cloud-native, redrive policy for DLQ.
- **Cons:** visibility timeout max 12h and no native backoff; extra emulator in dev; couples to AWS; weakest Nest ergonomics of the four.

**Recommendation:** Option A (BullMQ + Redis) — first-class Nest integration with retry/backoff/stalled-job handling out of the box. B is a legitimate runner-up: choose it if minimizing infrastructure and getting a transactional enqueue matter more than ecosystem.

**Decision:** A
**Libraries:** `@nestjs/bullmq`, `bullmq`

---

## TD-02: Large-File Upload Strategy (up to 10GB)

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance; Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** The upload must not consume API bandwidth, memory or a request thread for hours. The handshake lives on both sides: the API issues credentials, the (future) frontend slices the file and uploads parts. The signing host issue (review note 3) applies here.

**Options:**

### Option A: S3 multipart upload with presigned URLs per part (direct to storage)
- `POST /videos/uploads` creates the video row (draft/uploading) and `CreateMultipartUpload`; client asks for part URLs (`UploadPart` presigned); browser PUTs parts directly to storage in parallel/with retry per part; `POST .../complete` sends `{partNumber, etag}` list and the API calls `CompleteMultipartUpload`. An `abort` endpoint calls `AbortMultipartUpload`.
- **Pros:** API never touches the bytes; resumable at part granularity (`ListParts` after a refresh); parallel parts; works against S3 and S3-compatible engines.
- **Cons:** the frontend must implement slicing, concurrency and retry; bucket CORS must `ExposeHeaders: ETag` or the browser cannot read part ETags; needs a public signing endpoint distinct from the internal one.

### Option B: Single presigned PUT
- One URL, one PUT.
- **Pros:** trivial contract.
- **Cons:** S3 single PUT is capped at 5GB — **fails the 10GB requirement**; no resume.

### Option C: Upload through the API (streaming / busboy → S3)
- Browser POSTs the file to Nest, which pipes it to storage.
- **Pros:** simple client; centralized validation.
- **Cons:** an API connection and bandwidth held for hours per upload (violates "sem impacto na performance"); no resume; proxy/body-size limits at every hop.

### Option D: tus resumable protocol (`@tus/server` + S3 store)
- Standard resumable protocol; the S3 store uses multipart underneath.
- **Pros:** mature client libs (`tus-js-client`), resumable by design.
- **Cons:** bytes still flow through a tus server (API or an extra service), reintroducing Option C's bandwidth cost; extra component; protocol layered on top of what S3 already offers natively.

**Recommendation:** Option A — the only option that satisfies 10GB without proxying bytes; the added frontend complexity is bounded (part loop) and the OpenAPI contract documents it. Part sizing and limits are in TD-12; signing/public endpoint in TD-13.

**Decision:** A

---

## TD-03: Storage Organization (Buckets and Key Scheme)

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** Keys, bucket layout and lifecycle rules are shared by the API (signing), the worker (read original, write thumbnail) and the bucket configuration (CORS, lifecycle). Phase 04 adds custom thumbnails to the same layout.

**Options:**

### Option A: Single bucket, per-video prefix
- Keys: `videos/{videoId}/original.{ext}`, `videos/{videoId}/thumbnail.jpg` (later `thumbnail-custom.*`). Lifecycle rule: abort incomplete multipart uploads after N days.
- **Pros:** one set of CORS/lifecycle/credentials; deleting a video is a prefix delete; keys use the internal id so they never change if the public id does.
- **Cons:** videos and thumbnails share an access policy.

### Option B: Separate buckets (`videos`, `thumbnails`)
- **Pros:** different policies per kind (e.g., thumbnails public-read/CDN-cached, videos signed only).
- **Cons:** double configuration; cross-bucket cleanup; nothing in this phase needs different policies.

**Recommendation:** Option A — thumbnails are served the same way as videos in this phase; split later only if a CDN policy demands it. Include the abort-incomplete-multipart lifecycle rule (verify support in the chosen engine, TD-13), backed by the application-level cleanup in TD-10.

**Decision:** A

---

## TD-04: Worker Runtime Model

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** The diagram shows a separate "Video Worker (FFmpeg)" container. The current dev image (`node:25.6.0-slim`) has no FFmpeg, and the repo layout is a single `nestjs-project`.

**Options:**

### Option A: Dedicated `video-worker` container, same codebase, standalone Nest entrypoint
- A second entrypoint (`NestFactory.createApplicationContext`) loading only config, TypeORM entities, storage and the queue processor; its own compose service and image target that includes `ffmpeg`.
- **Pros:** matches the architecture diagram; FFmpeg CPU/disk never competes with the API; scales independently; reuses entities/config/types.
- **Cons:** extra compose service and Docker image target; two entrypoints to keep building and testing.

### Option B: Processor inside the API process
- **Pros:** no new container; simplest.
- **Cons:** CPU-heavy FFmpeg can starve request handling; API image must ship FFmpeg; contradicts the diagram.

### Option C: Separate repository/package for the worker
- **Pros:** hard isolation.
- **Cons:** duplicates entities and config or forces a shared package; disproportionate for this monorepo.

**Recommendation:** Option A — it is what the diagram specifies and the cheap way to keep FFmpeg off the API. Install FFmpeg only in the worker image target.

**Decision:** A

---

## TD-05: Metadata and Thumbnail Extraction

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** Inputs can be up to 10GB. The worker must extract duration/resolution/codec and one frame, without needing 10GB of scratch disk per job.

**Options:**

### Option A: `ffprobe`/`ffmpeg` via `execFile`, reading a presigned URL
- Spawn binaries directly (no shell) with the object's presigned GET URL (internal endpoint) as input; `ffprobe -show_format -show_streams -of json`; thumbnail with `-ss <t> -i <url> -frames:v 1` (input seek), then upload the JPEG.
- **Pros:** no local copy; only the needed byte ranges are fetched (fast for `moov`-first files); no dependency.
- **Cons:** files with `moov` at the end cause extra range reads; presigned URL appears in the process args/logs (must be redacted); requires an FFmpeg build with HTTP(S) support and storage honoring `Range`.

### Option B: Download to a temp file, then process locally
- **Pros:** most robust, handles odd containers.
- **Cons:** up to 10GB disk and minutes of transfer per job; concurrency limited by disk.

### Option C: `fluent-ffmpeg` wrapper
- **Pros:** fluent API.
- **Cons:** wrapper over the same binaries and, to our knowledge, no longer actively maintained (verify on npm before adopting); adds little for two commands.

**Recommendation:** Option A, with the frame taken at ~10% of the duration (clamped for very short videos) and Option B as an automatic fallback if the URL read fails. The thumbnail timestamp percentage is a tunable, not a contract.

**Decision:** A

---

## TD-06: Job Trigger After Upload

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** Something must tell the worker the object is complete. Writing to Postgres and enqueueing in Redis are two systems, so a crash between them can leave a video that never gets processed.

**Options:**

### Option A: API publishes the job in `complete`
- `complete` → `CompleteMultipartUpload` → `HEAD` object (validate size, TD-12) → set `PROCESSING` → enqueue with `jobId = videoId` (dedupe). Make `complete` **idempotent**: if the upload is already completed, verify via `HEAD` and re-enqueue instead of failing, so a client retry heals an enqueue failure. Enqueue failure returns 503 and leaves the video in `UPLOADING`.
- **Pros:** explicit, easy to unit/e2e test; no storage-event plumbing; ties validation to the trigger.
- **Cons:** dual-write gap (mitigated by idempotent retry; fully removed only with a transactional queue, i.e., pg-boss in TD-01 Option B).

### Option B: Storage event notification → queue
- Engine publishes `ObjectCreated:CompleteMultipartUpload` to the queue/webhook.
- **Pros:** decoupled from the API.
- **Cons:** event support and formats vary by engine; hard to test locally; the DB still needs the status transition.

### Option C: Transactional outbox + relay
- **Pros:** no lost jobs.
- **Cons:** extra table and relay process; overbuilt for one job type per upload.

**Recommendation:** Option A with idempotent `complete` — simplest testable path, and the residual failure mode is recoverable by the client retry plus the stale-upload sweeper (TD-10).

**Decision:** A

---

## TD-07: Unique Public Video Identifier

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** The id appears in public URLs (`/watch/{id}`) and in Phase 05. It is assigned at pre-registration, when no title exists, and titles become editable in Phase 04.

**Options:**

### Option A: Short random id (11 chars, URL-safe alphabet) in a separate `UNIQUE` column
- Internal UUID primary key stays for FKs/storage keys; `publicId` is generated with a CSPRNG (`nanoid` or `crypto.randomBytes` + base64url); retry on unique violation (`23505`).
- **Pros:** short, unguessable (~2^66 space), stable when the title changes, independent of storage keys.
- **Cons:** needs a collision retry loop; one extra column/index.

### Option B: UUID as the public id
- **Pros:** zero extra code; collision-free in practice.
- **Cons:** 36-char URLs; no benefit over A.

### Option C: Slug from title
- **Pros:** readable URLs.
- **Cons:** the title is unknown at pre-registration and mutable; needs collision suffixes and redirects on rename.

**Recommendation:** Option A — stable, short and unguessable; the unique index is the actual guarantee, the retry loop only handles the rare collision. Check `nanoid` ESM/CJS compatibility with the project's build before choosing the library over `crypto`.

**Decision:** A

---

## TD-08: Streaming Delivery

**Scope:** Backend

**Capability:** Reprodução via streaming (sem necessidade de download completo)

**Context:** `<video>` needs HTTP `Range` (206) support. The diagram shows the frontend streaming directly from storage.

**Options:**

### Option A: `GET /videos/{id}/stream` → `302` to a presigned GET URL
- Storage serves `Range` natively; the API only authorizes and signs. Send `Cache-Control: no-store` on the redirect. Presigned TTL must exceed typical watch time (e.g., hours) because later range requests reuse the same URL; an expired URL mid-playback yields 403.
- **Pros:** zero byte traffic through the API; matches the diagram; trivial to add CDN later.
- **Cons:** URLs are bearer capabilities until they expire; needs bucket CORS for the web origin; requires the public signing endpoint (TD-13).

### Option B: API proxy with `Range`/`206`
- **Pros:** storage stays private; per-request authorization; stable URL.
- **Cons:** all video bytes through Node; scaling and bandwidth cost; must implement range semantics correctly.

### Option C: CDN in front of storage
- **Pros:** best viewer performance.
- **Cons:** infrastructure out of scope for a local-first project; can be layered on Option A later.

**Recommendation:** Option A — it is the only option that keeps the API out of the data path; revisit if Phase 04's visibility rules need per-byte authorization (they should not, since unlisted is link-based).

**Decision:** A

---

## TD-09: Download Delivery

**Scope:** Backend

**Capability:** Download do vídeo pelo usuário

**Context:** Same data-path question as TD-08, with a forced `attachment` disposition and a friendly filename.

**Options:**

### Option A: `GET /videos/{id}/download` → `302` to presigned URL with `response-content-disposition`
- **Pros:** reuses TD-08 machinery; no API bandwidth; filename controlled by signed query parameter.
- **Cons:** depends on the engine honoring `response-content-disposition` overrides (include in the TD-13 spike); filename in the signed URL must be sanitized/encoded.

### Option B: API proxy download
- **Pros:** full control, uniform headers.
- **Cons:** the same bandwidth problem, now for the largest transfers.

**Recommendation:** Option A, consistent with TD-08.

**Decision:** A

---

## TD-10: Video Status Lifecycle and Failure Handling

**Scope:** Backend

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload; Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** Phase 03 says the video is pre-registered as a draft; Phase 04 introduces "rascunho → publicação" and visibility. A single `DRAFT → PROCESSING → READY | ERROR` enum mixes the *processing* axis with the *publication* axis (what is a READY draft? a published video still processing?). Failure behavior must also be defined: retries, final error, abandoned uploads.

**Options:**

### Option A: Single status enum (`DRAFT → PROCESSING → READY | ERROR`)
- **Pros:** one column; matches the initial hypothesis.
- **Cons:** Phase 04 must either overload `DRAFT`/`READY` for publication or migrate the enum; "draft" would mean "not yet uploaded" now and "unpublished" later.

### Option B: Two orthogonal fields — `processingStatus` (`UPLOADING → PROCESSING → READY | FAILED`) + publication state introduced as `DRAFT` (default) now, `PUBLISHED` in Phase 04
- Transitions: `UPLOADING` on init; `PROCESSING` on `complete`+enqueue; `READY` when the worker stores duration/metadata/thumbnail; `FAILED` + `failureReason` only after **all** retries are exhausted (e.g., 3 attempts, exponential backoff; transient storage errors retry, invalid media fails fast). The worker is idempotent (writes derive from the object, safe to re-run). A repeatable sweeper aborts multipart uploads and marks videos stuck in `UPLOADING` beyond a TTL (e.g., 24–48h). Manual re-processing endpoint is optional/deferred.
- **Pros:** no semantic collision with Phase 04; clear UI states; failure and abandonment are explicit.
- **Cons:** two columns; the publication column is initially constant (`DRAFT`).

**Recommendation:** Option B — it satisfies "rascunho" literally while keeping Phase 04's publish flow a pure addition. Sweeper cadence and retry counts are parameters to fix at planning time.

**Decision:** B

---

## TD-11: Authorization for Upload, Stream and Download

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance; Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** Visibility (public/unlisted) is Phase 04; anonymous viewing is a core product rule. A `<video>` tag cannot attach an `Authorization` header, so owner-only streaming would depend on cookie-based token transport.

**Options:**

### Option A: Authenticated owner uploads; stream/download public by `publicId` for `READY` videos, behind a single access-policy seam
- Upload init/sign/complete/abort and status reads require the JWT guard and the caller's own channel. A `VideoAccessPolicy` (one place) decides stream/download access; Phase 04 tightens it for drafts.
- **Pros:** works with `<video>` and anonymous viewing today; one place to change in Phase 04.
- **Cons:** until Phase 04, any holder of the 11-char id can stream a `READY` video even though it is a "draft" (mitigated by id entropy; behaves like unlisted).

### Option B: Owner-only stream/download in this phase
- **Pros:** no draft exposure.
- **Cons:** blocks anonymous playback tests; forces cookie-based auth for media requests or per-request signed tokens.

**Recommendation:** Option A — unguessable-link semantics match the product's unlisted model, and the policy seam keeps the Phase 04 change small. Choose B if drafts must never be reachable by anyone but the owner.

**Decision:** A

---

## TD-12: Upload Limits and Validation

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** The API never sees the bytes, so it can only validate declared metadata at `init` and verify the stored object at `complete`; the frontend needs the same limits to slice and pre-validate. S3 constraints: parts 5 MiB–5 GiB (last part exempt), max 10,000 parts.

**Options:**

### Option A: Server-fixed part size, declared-metadata validation at init, object verification at complete, media verification in the worker
- Max size 10 GiB (10,737,418,240 bytes); allowlist by MIME **and** extension (e.g., `video/mp4`, `video/webm`, `video/quicktime`); part size fixed by the server (e.g., 64 MiB → ≤160 parts) and returned in the init response; at `complete`, `HEAD` must report exactly the declared size; the worker's ffprobe rejects non-video files and unsupported codecs/containers (→ `FAILED` with reason). Throttle `init` (existing `@nestjs/throttler`) and cap concurrent open uploads per user to bound storage abuse.
- **Pros:** the client cannot pick invalid part sizes; deterministic contract; real content check happens where bytes are readable.
- **Cons:** the worker is the first place a mislabeled file is caught (the user waits to see `FAILED`); fixed part size is less adaptive on very slow links.

### Option B: Client-chosen part size, validated within S3 bounds
- **Pros:** adaptive to network.
- **Cons:** more validation paths, more ways to hit the 10,000-part limit; no real benefit here.

**Recommendation:** Option A — simplest contract for both sides. Because the original is streamed as-is (review note 4), keep the allowlist narrow and surface a clear `failureReason` for unplayable codecs; transcoding is explicitly out of this phase.

**Decision:** A

---

## TD-13: Object Storage Engine and S3 Client Wiring

**Scope:** Repo-wide

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The diagram says "S3 or MinIO", but MinIO's community edition is archived (review note 1). Compose, `.env.example`, Joi schema and runtime config must agree on endpoints and credentials. Signing requires a **public** endpoint reachable by the browser, while API/worker I/O uses the **internal** Compose service name.

**Options:**

### Option A: SeaweedFS (S3 gateway) in compose; AWS SDK v3 client (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`)
- Apache-2.0, actively maintained; S3 API coverage is the broadest of the open alternatives.
- **Pros:** maintained; same code targets real S3 in production by changing config only.
- **Cons:** coverage of every feature we rely on is **not verified here**; operationally heavier than a single binary.

### Option B: Garage or RustFS
- Single-binary, S3-compatible.
- **Pros:** light to run.
- **Cons:** least-verified for our feature set (CORS `ExposeHeaders`, multipart presign, `response-content-disposition`, lifecycle abort, `Range`); RustFS is young.

### Option C: Keep MinIO (pinned image or community fork such as `pgsty/minio`)
- **Pros:** zero change from the assumed design; known-good for presigned multipart.
- **Cons:** upstream gets no security fixes; a fork is a third-party maintenance bet. Acceptable for a local dev-only environment, not as the documented target.

**Recommendation:** Option A, conditional on a short spike that validates the five features above against the chosen engine before the plan is built; if it fails, fall back to Option C for dev only. Define env keys for both endpoints (`S3_ENDPOINT` internal, `S3_PUBLIC_ENDPOINT` for signing), bucket, region, credentials and presign TTLs, validated in the Joi schema and mirrored in `compose.yaml`/`.env.example`.

**Decision:** A
**Libraries:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Queue technology | A — BullMQ + Redis (runner-up: pg-boss) | A |
| TD-02 | Cross-layer | Large-file upload strategy | A — S3 multipart, presigned per part | A |
| TD-03 | Backend | Storage organization | A — single bucket, per-video prefix | A |
| TD-04 | Backend | Worker runtime model | A — dedicated container, same codebase | A |
| TD-05 | Backend | Metadata and thumbnail extraction | A — ffprobe/ffmpeg via `execFile` on presigned URL | A |
| TD-06 | Backend | Job trigger after upload | A — API publishes in idempotent `complete` | A |
| TD-07 | Backend | Unique public video id | A — 11-char random id, `UNIQUE` column | A |
| TD-08 | Backend | Streaming delivery | A — 302 to presigned URL | A |
| TD-09 | Backend | Download delivery | A — 302 with `response-content-disposition` | A |
| TD-10 | Backend | Status lifecycle and failures | B — processing status separate from publication state | B |
| TD-11 | Backend | Authorization | A — owner uploads, public stream/download via policy seam | A |
| TD-12 | Cross-layer | Limits and validation | A — fixed part size, verify at complete + in worker | A |
| TD-13 | Repo-wide | Object storage engine and S3 wiring | A — SeaweedFS + AWS SDK v3 (after spike) | A |
