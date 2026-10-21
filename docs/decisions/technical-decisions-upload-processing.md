---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-10-21
scope_description: "Video upload (up to 10GB, resumable), object storage, background processing queue and worker, unique video URL, streaming and download delivery."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — API (upload orchestration, video entity, signed URLs, job publishing) plus the video worker (FFmpeg) and the new infra services (object storage, queue) in `compose.yaml`.
- `next-frontend/` — no frontend-only TD. Phase 03 bullets name no screens; the frontend is constrained only by the Cross-layer TDs below (TD-02, TD-05, TD-06, TD-07). It inherits the strict-BFF decision (`next-frontend-config-base/TD-03`), which TD-02 and TD-06 take into account.

_Notes:_

- The architecture diagram says "S3 or MinIO", and `Message Queue` is `TBD`. TD-01 and TD-03 resolve both.
- Revision pass (same day): the first draft was written without Context7. This pass cross-checked the key facts with Context7 (AWS SDK v3) and web searches. Items still unverified against primary sources are marked; re-check them in `/plan-resolve` (which writes `library-refs.md`). Checked in this pass: the `next-frontend-config-base/TD-03` strict-BFF reference (correct, decided A); the MinIO status (confirmed by several secondary sources: repo archived 2026-04-25, official images frozen at the 2025 releases); presigned part URLs via `getSignedUrl` + `UploadPartCommand` (supported by the SDK; the part ETag is only readable by the browser if the bucket CORS exposes the `ETag` header).
- Installed baseline: NestJS 11, TypeORM 0.3.28, PostgreSQL 17, Node 25 (`nestjs-project/package.json`, `compose.yaml`, `Dockerfile.dev`). Frontend: Next 16.2.6, React 19.2.4.
- Fixed assumption, not a TD: the S3 API (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`) is the only storage interface used in code. This keeps the provider swappable.

---

## TD-01: Object Storage Backend (dev/prod parity)

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The diagram says "S3 or MinIO", and a concrete service must be added to `compose.yaml`. Per web sources (secondary, unverified against primary), MinIO Community Edition stopped publishing binaries and Docker images in Oct 2025, and its repo was archived in 2026. Choosing MinIO now means a frozen, unpatched image. The choice affects `compose.yaml`, env keys, and the browser-reachable endpoint used in signed URLs.

**Options:**

### Option A: SeaweedFS (S3 gateway)
- Apache-2.0 object store with an S3 API and an admin UI. It is multi-process (master, volume, filer, s3), so the compose setup is more involved than a single binary.
- **Pros:** most mature actively maintained open-source option. Production-capable, so dev and prod can match.
- **Cons:** heavier compose definition. Per its wiki (a mirror, not official docs), multipart, presigned URLs and Range are supported, but bucket lifecycle appears to be TTL-only, so abort-incomplete-multipart rules may not work (see TD-08). Verify before relying on it.

### Option B: Garage
- Lightweight Rust S3-compatible store, single binary. It is AGPL-3.0 (per one source) and needs a layout/bootstrap step.
- **Pros:** small footprint, simple topology.
- **Cons:** partial S3 feature coverage (check lifecycle and multipart edge cases). AGPL may matter for the project.

### Option C: RustFS
- Apache-2.0, single-binary, MinIO-style drop-in image.
- **Pros:** easiest swap from the MinIO setup shown in typical tutorials.
- **Cons:** its own docs reportedly say alpha and not for production, which breaks dev/prod parity.

### Option D: MinIO pinned to the last published image
- Keep the "S3 or MinIO" wording of the diagram and pin a last-known-good tag.
- **Pros:** zero learning curve and widest tutorial coverage.
- **Cons:** no security patches, no upstream, and risk of the image disappearing.

**Recommendation:** A (SeaweedFS) — it is the only option that is open-source, actively maintained and production-capable. Because code speaks plain S3, B is a cheap fallback if A's compose complexity is too high. Run a spike on multipart with Range and presigned URLs first.

**Decision:** A

**Revisions:**

- 2026-10-21 — Spike do SI-03.1 executado contra SeaweedFS 4.48 (`chrislusf/seaweedfs`, `weed mini`, gateway S3 em `:8333`, bucket `streamtube-videos`), com credenciais estáticas via `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` e path-style addressing. Resultados: (1) **Multipart com URLs presignadas de parte**: `CreateMultipartUpload` + `UploadPart` presignado (2 partes, 5MiB + 1MiB) + `ListParts` + `CompleteMultipartUpload` funcionam, e o objeto lido de volta tem o mesmo conteúdo (MD5 idêntico). (2) **GET presignado com Range**: `Range: bytes=0-99` retorna `206` com 100 bytes e `Content-Range: bytes 0-99/<total>`; `Accept-Ranges: bytes` presente; `ResponseContentDisposition` no GET presignado é respeitado (serve o download com nome). (3) **CORS por bucket**: `PutBucketCors` aceito; o preflight `OPTIONS` responde `Access-Control-Expose-Headers: ETag, Content-Range, Accept-Ranges, Content-Length` e libera `PUT, GET, HEAD`. (4) **Lifecycle**: `PutBucketLifecycleConfiguration` aceita tanto regra TTL (`Expiration.Days`) quanto `AbortIncompleteMultipartUpload` e as devolve em `GetBucketLifecycleConfiguration`, mas a aplicação efetiva da regra de abort não é observável no spike (exigiria esperar dias); a conclusão do TD-08 se mantém — o reaper é o mecanismo primário e a regra de lifecycle é só backstop não verificado. (5) `AbortMultipartUpload` e `ListMultipartUploads` funcionam (base do reaper). (6) `HEAD` sobre URL assinada para `GET` retorna 403 (assinatura é por método) — o cliente deve usar GET com Range, não HEAD. _Rationale:_ TD-01 recomendava o spike antes de depender do SeaweedFS; todos os recursos exigidos por TD-02, TD-06 e TD-08 estão presentes, então A permanece e o fallback Garage não é necessário. Aplicação do CORS é automatizada pelo serviço one-shot `storage-init` no Compose (`nestjs-project/storage/cors.json`).

---

## TD-02: Large-File Upload Protocol (resumable, 10GB)

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** The "Pontos de Atenção" require that the upload not block the system and be resumable after a connection failure. The protocol defines the handshake on both sides: the API that issues and completes the upload, and the browser client. The frontend is strict-BFF (`next-frontend-config-base/TD-03`, browser never calls the backend directly), so any option that lets the browser talk to another host must be an explicit exception. The architecture diagram already shows `Frontend → Object Storage` for streaming, so a browser-reachable storage endpoint exists regardless.

**Options:**

### Option A: S3 multipart with presigned part URLs (direct browser → storage)
- The API creates the multipart upload and the `videos` row, and signs one URL per part (e.g. 64 MiB parts: 10GB ≈ 160 parts; S3 limit is 10,000 parts, 5 MiB minimum). The browser PUTs parts in parallel. The API's `ListParts` is the resume source of truth. A complete call finalizes the upload and enqueues processing.
- **Pros:** no video bytes through NestJS, so no performance impact. Parts retry individually. No extra service.
- **Cons:** the client owns part/resume logic and signed-URL refresh. The storage endpoint must be browser-reachable and CORS-configured, with `ETag` in the exposed headers (otherwise the client cannot collect part ETags for the complete call); the presigned host must differ from the Docker-internal `storage:PORT` host). It is an explicit exception to "browser never reaches infra directly".

### Option B: tus via `@tus/server` + S3 store inside NestJS
- The browser uses the tus client against an API endpoint, and the server writes to S3 multipart internally. Parts and `Upload-Offset` give resume.
- **Pros:** standard resumable protocol with mature clients. Auth stays in one place.
- **Cons:** every byte passes through the API. Multi-instance needs a shared KV store. Part concurrency and memory need tuning. This works against "sem impacto na performance" at 10GB.

### Option C: tusd sidecar (Go) with S3 backend
- A dedicated tus server in compose writes to storage and sends hooks to the API.
- **Pros:** offloads bytes from NestJS. Standard protocol.
- **Cons:** extra service plus hook auth. A second place for upload authorization logic.

### Option D: API-proxied chunked upload (custom)
- The client sends numbered chunks to the API, which appends them to storage.
- **Pros:** full control, no CORS exposure.
- **Cons:** reinvents resume. All bytes go through the API.

**Recommendation:** A — it satisfies the performance requirement without a new service, and the storage endpoint is needed browser-side for streaming anyway (TD-06). Document the BFF exception, and keep the BFF Route Handler as the authenticated entry for init/sign/complete calls.

**Decision:** A

---

## TD-03: Background Job Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The diagram marks the queue `TBD`. Jobs are few and heavy (one or two per uploaded video), not high-throughput. The queue choice decides whether we add infra and whether job creation can be atomic with the DB write that marks the upload complete.

**Options:**

### Option A: pg-boss (PostgreSQL-backed)
- Queue on the existing PostgreSQL 17 via `SKIP LOCKED`. Supports retries, scheduling and cron.
- **Pros:** no new service. Enqueue can share a DB transaction with the video status update (no lost or phantom jobs). Cron lets TD-08's reaper job reuse it.
- **Cons:** no first-class `@nestjs/*` wrapper (thin custom provider). Lower ceiling than Redis queues, which is fine at this volume.

### Option B: BullMQ + Redis (`@nestjs/bullmq`)
- The NestJS-documented queue, with flows, rate limits and a rich ecosystem. Adds Redis to compose.
- **Pros:** official Nest integration, most examples.
- **Cons:** new infra to run. Enqueue is not transactional with Postgres, so a crash between commit and enqueue loses jobs unless an outbox is added.

### Option C: RabbitMQ
- Broker with acks and dead-letter exchanges.
- **Pros:** strong delivery semantics, language-agnostic worker.
- **Cons:** the heaviest infra for this volume, and the most code.

**Recommendation:** A (pg-boss) — the stack already has Postgres, and transactional enqueue removes the lost-job failure mode. Choose B if the team prioritizes the official Nest wrapper and accepts Redis plus an outbox.

**Decision:** A

---

## TD-04: Video Worker Packaging and FFmpeg Invocation

**Scope:** Repo-wide

**Capability:** Transversal — covers: Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** The diagram shows a separate `Video Worker (FFmpeg)` container. The decision covers where its code lives, how it is built (FFmpeg binary in the image), and how it reads multi-GB input without local disk pressure. Depends on TD-03 for how jobs are consumed.

**Options:**

### Option A: Second entrypoint in `nestjs-project/` (Nest standalone context), separate compose service
- `createApplicationContext` worker process reusing entities, config and storage service. A compose service runs it from an image that includes `ffmpeg`.
- **Pros:** shares the TypeORM entities and config modules (no contract drift). One lockfile, one test setup.
- **Cons:** the worker image carries the full API dependency set. A bad shared change affects both.

### Option B: Separate `video-worker/` subproject
- Own package, Dockerfile and manifest. Talks to Postgres and storage directly.
- **Pros:** hard isolation and independent scaling or stack.
- **Cons:** duplicates the video entity and config. Breaks the monorepo's "one feature, one scope" flow and adds a subproject to the pipeline.

### Option C: In-process worker inside the API
- Queue consumer runs in the API container.
- **Pros:** zero new containers.
- **Cons:** FFmpeg CPU load competes with request handling, contradicting the architecture and "sem impacto na performance".

**Recommendation:** A — it matches the diagram's separate container while reusing the entities and storage module. FFmpeg and ffprobe are called via `child_process` spawn, reading input from a presigned GET URL so a 10GB source is never fully downloaded locally. The wrapper library `fluent-ffmpeg` is not recommended until its maintenance status is confirmed (not verified here).

**Decision:** A

---

## TD-05: Unique Video URL Identifier

**Scope:** Cross-layer

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** "Pontos de Atenção" ask for a short URL that never conflicts. The ID appears in the DB, API paths and frontend routes (`/watch/:id`), so it is a contract across layers.

**Options:**

### Option A: Random short ID (nanoid, 11 URL-safe chars) with unique index and retry on conflict
- Generated at pre-registration. Collisions are handled by the unique constraint plus a bounded retry.
- **Pros:** short, non-enumerable, no coordination. Collision odds negligible at 64^11.
- **Cons:** needs a retry path and a second identifier (UUID PK internally) or a string PK.

### Option B: UUID v4/v7 as the public ID
- **Pros:** native Postgres type, no custom generator, no retry.
- **Cons:** 36 characters, not "curta" as the plan asks.

### Option C: Sequential integer encoded with hashids
- **Pros:** short, guaranteed unique by the sequence.
- **Cons:** reversible with the salt, enumerable if the salt leaks, and adds a dependency.

**Recommendation:** A — it meets "curta e única" with a DB-enforced guarantee, and keeps the internal UUID primary key independent of the public ID.

**Decision:** A

---

## TD-06: Playback Streaming and Download Delivery

**Scope:** Cross-layer

**Capability:** Transversal — covers: Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** Playback must start without downloading the whole file, and users must be able to download the original. The diagram shows `Frontend → Object Storage (streams)`. Phase 03 scope is metadata extraction and thumbnails; transcoding is not in the bullets. Depends on TD-01 (signing endpoint) and TD-02 (browser-reachable storage).

**Options:**

### Option A: Progressive file via short-lived presigned GET (storage serves Range requests)
- The API authorizes and returns a signed URL for a `<video>` element (or `Content-Disposition: attachment` for download). Storage handles HTTP Range.
- **Pros:** no bytes through the API. Simple. Works for anonymous viewing once the API authorizes visibility.
- **Cons:** needs browser-compatible codecs and a `moov` atom at the file start (otherwise seeking waits). Signed-URL expiry must outlast a viewing session. No adaptive bitrate.

### Option B: API proxy stream with Range
- NestJS pipes the object to the response with Range support.
- **Pros:** central auth and no browser-reachable storage needed.
- **Cons:** all playback bandwidth through the API, which defeats the decoupling in the diagram.

### Option C: HLS transcoding in the worker
- FFmpeg produces segmented HLS renditions.
- **Pros:** adaptive bitrate, best seeking and compatibility.
- **Cons:** large scope (transcode cost, storage multiplication, a player library). It goes beyond the Phase 03 bullets.

**Recommendation:** A — it follows the diagram and avoids transcoding. The worker (TD-04) can add `-movflags +faststart` only via a lightweight remux if non-faststart files prove a problem. HLS stays a future phase, and the accepted formats in TD-08 limit codec risk.

**Decision:** A

---

## TD-07: Video Status Model and Processing-Progress Notification

**Scope:** Cross-layer

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** The video row is created when the upload starts, as a draft. The frontend must know when processing finishes (thumbnail and duration available). Draft/public visibility belongs to Phase 04, so Phase 03 must not collide with it.

**Options:**

### Option A: Separate `status` (uploading, processing, ready, failed) from visibility; client polls
- The row is created with `status=uploading`, visibility draft. The client polls a status endpoint with backoff.
- **Pros:** Phase 04's visibility and publishing flow stays orthogonal. Polling needs no new transport and fits the BFF Route Handler model.
- **Cons:** polling latency and extra requests.

### Option B: Same model with SSE push
- **Pros:** immediate updates.
- **Cons:** a long-lived connection through the BFF, plus a pub/sub path from worker to API.

### Option C: Single combined status enum (draft/processing/published/…)
- **Pros:** one column.
- **Cons:** couples processing state with Phase 04's publication flow. The two change independently.

**Recommendation:** A — it keeps the two state machines separate and costs nothing in infra. SSE can be added later if polling proves wasteful.

**Decision:** A

---

## TD-08: Abandoned Upload Cleanup and Storage Growth Control

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** Resumable multipart uploads leave orphaned parts and `uploading` rows when users abandon them. At up to 10GB each, this is the "Armazenamento: planejar crescimento e custos" attention point. Limits to fix in the plan regardless of option: accepted formats (allowlist; confirmed by ffprobe in the worker), declared-size check against 10GB at init, and part size from TD-02.

**Options:**

### Option A: Storage lifecycle rule only (abort incomplete multipart after N days)
- **Pros:** zero code.
- **Cons:** the DB row stays `uploading` forever and the UI shows ghosts. Lifecycle support varies by emulator (TD-01); SeaweedFS appears to support TTL rules only.

### Option B: Lifecycle rule plus scheduled reaper job
- A scheduled job (TD-03 cron) aborts stale multipart uploads via the API and marks or removes the rows. It also fails jobs stuck in `processing`.
- **Pros:** DB and storage stay consistent. Works even if the emulator lacks lifecycle.
- **Cons:** one more job to build and test.

### Option C: No automated cleanup in this phase
- **Pros:** least work.
- **Cons:** silent storage leak, which contradicts the plan's cost warning.

**Recommendation:** B — it keeps rows and storage consistent and reuses the queue's scheduler, with the lifecycle rule as a backstop where the chosen storage supports it. If TD-01 lands on SeaweedFS, the reaper is the primary mechanism, not a complement.

**Decision:** B

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Object Storage Backend | A (SeaweedFS) | A |
| TD-02 | Cross-layer | Large-File Upload Protocol | A (S3 multipart, presigned parts) | A |
| TD-03 | Backend | Background Job Queue Technology | A (pg-boss) | A |
| TD-04 | Repo-wide | Video Worker Packaging and FFmpeg Invocation | A (second entrypoint, separate compose service) |A |
| TD-05 | Cross-layer | Unique Video URL Identifier | A (nanoid 11 chars) | A |
| TD-06 | Cross-layer | Playback Streaming and Download Delivery | A (presigned GET, Range) | A |
| TD-07 | Cross-layer | Video Status Model and Notification | A (separate status, polling) | A |
| TD-08 | Cross-layer | Abandoned Upload Cleanup | B (lifecycle + reaper job) | B |
