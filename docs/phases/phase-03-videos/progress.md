# phase-03-videos — Progress

**Status:** completed
**SIs:** 12/12 completed

### SI-03.1 — Dependências e configuração de storage e fila
- **Status:** completed
- **Tests:** 9 passing (env.validation.integration-spec); full suite 22/23 suites, auth.service.integration-spec timed out on default 5000 ms hook under load and passes 25/25 with --testTimeout=60000
- **Observations:**
  - `S3_*`/`QUEUE_*` keys appended to `.env.example` and `.env` already in this SI (plan placed this in SI-03.2) because they are required by Joi and would otherwise break every suite that boots `AppModule`; the `seaweedfs` host does not exist until SI-03.2.
  - `@nestjs/bullmq` installed as ^12.0.0 (peer deps accept Nest 11).
  - A stale `jest --runInBand` from a previous session was running in the container; killed with user approval.
  - `TaskCreate` is not available in this environment; progress tracked only in this file.

### SI-03.2 — Infra: Redis, object storage e video-worker no Docker Compose
- **Status:** completed
- **Tests:** no tests (Infra)
- **Observations:**
  - TD-13 spike passed on SeaweedFS (S3 gateway): CORS `ExposeHeaders: ETag` on OPTIONS, multipart with presigned `UploadPart` URL, complete + head (6000000 bytes), `Range` -> 206, `response-content-disposition` honored, lifecycle abort rule stored. Lifecycle abort *execution* (rule firing after the configured days) was not verified; MinIO fallback not needed.
  - **Required in SI-03.4:** the AWS SDK v3 signing client must be created with `requestChecksumCalculation: 'WHEN_REQUIRED'`. With the default, `getSignedUrl` for `UploadPartCommand` embeds `x-amz-checksum-crc32` of an empty body in the URL and SeaweedFS rejects the real part with `BadDigest`.
  - Lifecycle rule uses `DaysAfterInitiation: 2` (plan did not fix the number); the TD-10 application sweeper (24h) remains the primary cleanup.
  - `video-worker` idles with `tail -f /dev/null` like `nestjs-api` (the `start:worker` script arrives in SI-03.9); run it with `docker compose exec video-worker npm run start:worker`.
  - `Dockerfile.dev` is now multi-stage (`base`, `worker` with FFmpeg, `api` last); `nestjs-api` builds `target: api`. FFmpeg absent in api, present in worker (5.1.9).
  - Extra service `storage-init` (aws-cli one-shot) creates the bucket + CORS + lifecycle. SeaweedFS healthcheck probes the master on the container IP because it does not listen on localhost.
  - Credentials come from `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` in `.env` (dev values in `.env.example`); anonymous access is not enabled, so objects are reachable only through presigned URLs.
  - `.env`/`.env.example` keys were already added in SI-03.1.

### SI-03.3 — Entidade Video e migration
- **Status:** completed
- **Tests:** 65 passing across 14 affected suites (video.entity.integration-spec, videos.module.spec, migrations.integration-spec, plus channels/users/auth suites that build the shared entity list)
- **Observations:**
  - Entity properties are camelCase as in the plan's `### Data Model` (`publicId`, `processingStatus`, ...) with snake_case columns via `name:`; existing entities use snake_case property names (`user_id`, `created_at`). Deliberate: the Data Model spec is the verbatim contract; flagging the mismatch for later alignment.
  - `sizeBytes` and `durationSeconds` are typed `string` in TS because Postgres `bigint`/`numeric` come back as strings; consumers (SI-03.6, SI-03.9) must convert explicitly.
  - Migration `1793206802055-CreateVideos.ts` was generated with the TypeORM CLI and then reformatted by `eslint --fix` (prettier).
  - Adding `Channel.videos` made `Video` mandatory in every test DataSource entity list; added it to 10 existing spec files and `cleanAllTables` (now deletes `videos` first, FK order). `migrations.integration-spec` now covers 3 migrations and two undo steps.
  - Both `PublicationState` values exist, but only `DRAFT` is written in this phase (Phase 04 publishes).
  - `VideosModule` only registers/exports the entity for now; providers and controller arrive in SI-03.6+.

### SI-03.4 — StorageModule: cliente S3 e presign
- **Status:** completed
- **Tests:** 9 passing (storage.service.integration-spec against the Compose SeaweedFS + storage.module.spec)
- **Observations:**
  - Both S3 clients (internal and signing) use `requestChecksumCalculation: 'WHEN_REQUIRED'` (finding from SI-03.2); a test asserts the signed part URL carries no `x-amz-checksum` parameter.
  - Beyond the plan's list, `StorageService` exposes only what later SIs need: `createMultipartUpload`, `completeMultipartUpload` (sorts parts by number), `abortMultipartUpload`, `headObject` (returns `null` on NotFound), `putObject`, `getObjectToFile`, `presignUploadPart`, `presignGet`. No delete method was added; the spec deletes its own objects through the injected internal client.
  - `presignGet` strips `"` from `downloadFilename` before building the `Content-Disposition` header to avoid header-parameter injection; non-ASCII filenames are not RFC 5987-encoded (out of scope, possible follow-up for SI-03.11).
  - Integration spec signs with the internal endpoint in the "reachable" module because `localhost:8333` is not reachable from inside the test container; the public-host guarantee is asserted separately with a fake public host.
  - `StorageModule` exports only `StorageService` (clients stay private).

### SI-03.5 — QueueModule: fila video-processing e producer
- **Status:** completed
- **Tests:** 4 passing (video-processing.producer.integration-spec against the Compose Redis + queue.module.spec); eslint and tsc clean
- **Observations:**
  - **Version change vs. SI-03.1 / library-refs.md:** `@nestjs/bullmq` was downgraded from ^12.0.0 to ^11.0.5. v12 is ESM-only and the project's Jest (CommonJS ts-jest) fails with `Unexpected token 'export'`; v11 is CJS and supports Nest 11. `library-refs.md` still says ^12.0.0 (left untouched on purpose; its mtime is tracked by the pipeline artifacts) - API usage documented there is unchanged.
  - `ioredis` ^5 added as an explicit dependency: `bullmq` 6 treats it as an optional peer and fails at startup with "could not load the optional 'ioredis' package" otherwise. Not a new decision (it is the Redis client BullMQ requires).
  - Default job options fixed in `queue.constants.ts`: `attempts: 3`, exponential backoff 5000 ms, `removeOnFail: false` (failed set = DLQ) and, beyond what the plan says, `removeOnComplete: { age: 86400 }` so completed jobs keep deduplicating by `jobId` for 24h instead of being dropped immediately.
  - The retry-exhaustion test runs a real BullMQ `Worker` only inside that test (~15 s of backoff) so the other tests' jobs are not consumed; jobs created by the spec are removed in `afterAll`.
  - `QueueModule` exports `BullModule` (so the worker module in SI-03.9 can inject the queue and register `@Processor`) and `VideoProcessingProducer`.
  - `SWEEP_STALE_UPLOADS_JOB` constant is defined here for SI-03.12.

### SI-03.6 — Endpoint POST /videos
- **Status:** completed
- **Tests:** 26 passing (public-id.util.spec 3, videos.service.spec 12, videos.service.integration-spec 4, channels findByUserId integration 2, e2e videos-init-upload 5); eslint and tsc clean
- **Observations:**
  - E2E file `test/videos-init-upload.e2e-spec.ts` was authored from `nestjs-project/specs/videos-init-upload.plan.md` (5 scenarios, all passing against real Postgres + SeaweedFS). It leaves one open multipart upload in the dev bucket per run (cleaned by the bucket lifecycle rule).
  - `VideosService` picks the `Video.id` application-side (`randomUUID`) because `objectKey` (`videos/{id}/original.{ext}`) is NOT NULL and must contain it; `publicId` collisions retry up to 5 times.
  - If the storage refuses to open the multipart upload the draft row is deleted (compensation) and the error is rethrown, covered by unit and integration tests.
  - Allowlist is `video/mp4` -> `mp4` and `video/webm` -> `webm` (plan said "narrow", values not fixed); the file extension must match the declared content type, otherwise 415. Size check (413) runs before the type check.
  - `ChannelsService.findByUserId` added (plan action 4); the service throws a plain `Error` (500) if an authenticated user has no channel, which should be impossible since register creates the channel.
  - `sizeBytes` is accepted as a JSON number (`@IsInt @Min(1)`); 10GB is within `Number.MAX_SAFE_INTEGER`. The cap is enforced in the service (413) rather than in the DTO so the right status code is returned.
  - `VideosModule` now imports `ChannelsModule` and `StorageModule` and needs `storageConfig` from the global ConfigModule (module spec updated accordingly).
  - **Follow-up for final verification:** the new endpoint changes the OpenAPI contract; `openapi.json` and `src/metadata.ts` (Swagger plugin metadata) were not regenerated in this SI. Run `npm run openapi:export` and check `openapi-export.integration-spec` during final verification.
  - `.env`-dependent suites (auth/storage/queue) are slow on this machine (the e2e suite took ~500 s mostly in bootstrap); the earlier auth hook-timeout flake is the same cause.

### SI-03.7 — Endpoint POST /videos/{id}/parts
- **Status:** completed
- **Tests:** 17 new passing (10 unit in videos.service.spec.ts, 7 e2e in test/videos-sign-parts.e2e-spec.ts); the SI-03.6 e2e (5) still passes after the helper refactor; eslint and tsc clean
- **Observations:**
  - E2E file `test/videos-sign-parts.e2e-spec.ts` authored from `nestjs-project/specs/videos-sign-parts.plan.md` (5 scenarios) plus two extra cases (out-of-range part number, 401 without token).
  - Batch size per request fixed at `MAX_PARTS_PER_SIGN_REQUEST = 100` (plan left it to this SI); more than 100 part numbers returns 400 from the DTO.
  - Part numbers above the upload's `partCount` (derived from the stored `sizeBytes` and the configured part size) return 400 with `error: "VALIDATION_ERROR"` through a domain exception (`PartNumberOutOfRangeException`), matching the plan's "400 validation error"; repeated part numbers are signed once.
  - Order of checks: 404 (unknown publicId) before 403 (not the owner) before 409 (not in UPLOADING or no uploadId) before 400 (part range). A caller without a channel gets 403.
  - Extracted the register/confirm/login helper used by e2e specs into `src/test/e2e-auth.ts` (`registerConfirmAndLogin(app, email)`); `test/videos-init-upload.e2e-spec.ts` now uses it. SI-03.8 reuses it.
  - `getOwnedVideo` in `VideosService` is the shared ownership check; SI-03.8 (`complete`) reuses it.
  - Domain exceptions added: `VideoNotFoundException`, `VideoForbiddenException`, `UploadNotInProgressException`, `PartNumberOutOfRangeException`.
  - The part-count upper bound uses `Number(video.sizeBytes)`; safe up to 2^53 bytes (limit is 10GB).
  - OpenAPI contract changed again; `openapi.json`/`src/metadata.ts` still to be regenerated at final verification (see SI-03.6).

### SI-03.8 — Endpoint POST /videos/{id}/complete
- **Status:** completed
- **Tests:** 63 passing in the videos+storage suites (7 suites) and 20 passing in the 3 videos e2e suites (8 new in test/videos-complete-upload.e2e-spec.ts); eslint and tsc clean
- **Observations:**
  - E2E file `test/videos-complete-upload.e2e-spec.ts` authored from `nestjs-project/specs/videos-complete-upload.plan.md` (4 scenarios) plus extra cases: rejected ETag, 404, 400 empty parts, 401. It uploads a real 1 MiB part to SeaweedFS and inspects the real BullMQ queue (no worker running, jobs stay `waiting` and are removed in `afterAll`). Because the presigned part URL is signed with the public endpoint and `localhost:8333` is unreachable from the test container, the spec sets `process.env.S3_PUBLIC_ENDPOINT = process.env.S3_ENDPOINT` at the top before the app reads its config (reuse this in the stream/download e2e specs).
  - **Idempotency is broader than the plan says:** `complete` on a video already in `PROCESSING` re-publishes the job (the `jobId` is the video id, so no second job appears while the first exists). This is what makes "client retry" recover from a failed enqueue (TD-06's residual failure mode): the DB is saved as `PROCESSING` first, then the job is enqueued; if Redis is down the call fails with the video left `PROCESSING` and the retry republishes. For `READY`/`FAILED` the current state is returned and nothing is enqueued.
  - **Size mismatch (TD-12):** after `completeMultipartUpload`, `headObject` is compared to `sizeBytes`; on mismatch (or missing object) the video is saved as `FAILED` with `failureReason = 'Uploaded size does not match the declared size'`, `uploadId` cleared, and the call returns 409 `UPLOAD_INCOMPLETE`. The orphaned object is NOT deleted from storage (no delete method in `StorageService`); the bucket has no rule for it. Possible follow-up.
  - **Storage rejection of the part list** (wrong ETag, unknown upload, part too small): `StorageService.completeMultipartUpload` now maps any 4xx S3 error to a new `MultipartUploadRejectedError` (new file `src/storage/storage.errors.ts`); `VideosService` maps it to 409 `UPLOAD_INCOMPLETE` and leaves the video `UPLOADING` so the client can correct and retry. Covered by two new storage integration tests against SeaweedFS (wrong ETag and non-existent upload both produce the typed error).
  - Request body: `parts[]` with `partNumber` (int >= 1) and `etag` (non-empty string), non-empty and at most 10000 entries (S3's multipart limit, `MAX_UPLOAD_PARTS`); the ETag is forwarded as the client sent it (with or without quotes).
  - `VideosService` constructor gained `VideoProcessingProducer` (4th argument, before the storage config); `VideosModule` imports `QueueModule`, so any test module that loads `VideosModule` must also load `queueConfig` (module spec updated).
  - Enqueued payload is `{ videoId: <Video.id uuid> }` (internal id), jobId = same uuid.
  - These suites ran in ~50 s total after the stale-jest cleanup (earlier SIs took several minutes for the same kind of suites).
  - OpenAPI contract changed again; regenerate `openapi.json`/`src/metadata.ts` in final verification.

### SI-03.9 — Video worker: entrypoint e processamento do vídeo
- **Status:** completed
- **Tests:** 39 in the worker+storage suites: 36 passing in the API container (media-probe.service.spec, video.processor.spec, worker.module.spec, storage specs) + 3 passing in the `video-worker` container (video.processor.integration-spec with real FFmpeg); eslint and tsc clean
- **Observations:**
  - **Run the processor integration spec in the worker container:** `docker compose exec video-worker npx jest src/worker/video.processor.integration-spec.ts`. FFmpeg exists only there (TD-04), so the suite detects a missing `ffmpeg`/`ffprobe` and is `describe.skip`ped in the API container (shows as "1 skipped"). The final full-suite verification must run the suite in BOTH containers or that coverage is silently missing.
  - Verified end to end beyond the unit/integration specs: started the real worker process in `video-worker` (`nest start --entryFile worker/worker`), enqueued a `process-video` job through the real producer, and the BullMQ consumer set the video `READY` (duration 2, 8166-byte thumbnail in storage) in ~1.6 s. The log shows `Video worker started`; the only listening TCP port was Docker's embedded DNS (127.0.0.11), i.e. no HTTP port. The throwaway smoke spec was deleted and the test objects removed from the bucket.
  - **New `StorageService.presignGetInternal(key)`** (not in the plan): the worker runs inside the Compose network and cannot reach the browser-facing public endpoint, so ffprobe/ffmpeg read a URL signed with the INTERNAL endpoint. Covered by a storage integration test.
  - Failure semantics follow TD-10 literally: errors are plain exceptions, BullMQ retries 3 times (5 s exponential backoff), and only `onFailed` with `attemptsMade >= attempts` sets `FAILED` + `failureReason` (truncated to 255 chars). An invalid file is therefore retried before failing; no `UnrecoverableError` shortcut.
  - ffprobe/ffmpeg errors are sanitized (`https?://...` replaced by `<url>`) because execFile's message embeds the command line, i.e. the presigned URL and its signature, which would otherwise end up in logs and in `failureReason`.
  - Thumbnail: one frame at 10% of the duration (clamped to `duration - 0.1`, never negative), scaled to at most 640 px wide, JPEG at `videos/{id}/thumbnail.jpg` (new helper `thumbnailKey`). Metadata stored as `{container, bitRate, video{codec,width,height,frameRate}, audio{codec}|null}`.
  - Fallback is "presigned URL first, then download to a temp dir and retry on disk"; the temp dir is always removed. An already `READY`, `FAILED` or `UPLOADING` video (or a deleted one) is skipped, so re-delivered jobs are harmless.
  - `WorkerModule` duplicates the TypeORM `forRootAsync` factory from `AppModule` (small, deliberately not refactored here) and registers `User, Channel, RefreshToken, VerificationToken, Video` via `forFeature` because `Video -> Channel -> User` relations must all be known to the DataSource.
  - New scripts: `start:worker` (`nest start --watch --entryFile worker/worker`) and `start:worker:prod` (`node dist/worker/worker`). Running `nest start` rebuilds `dist/` (`deleteOutDir`).
  - `Job` names other than `process-video` are rejected by `process()`; SI-03.12 adds the `sweep-stale-uploads` case there.
  - Cleanup note: the smoke run and integration specs call `cleanAllTables`, which empties the shared dev database (same as the other specs do).

### SI-03.10 — Endpoint GET /videos/{id}/stream e VideoAccessPolicy
- **Status:** completed
- **Tests:** 62 passing in the 6 `src/videos` suites (policy 4, service getStreamUrl 7 new) + 4 passing in test/videos-stream.e2e-spec.ts; eslint and tsc clean
- **Observations:**
  - E2E file `test/videos-stream.e2e-spec.ts` authored from `nestjs-project/specs/videos-stream.plan.md` (4 scenarios, against real Postgres + SeaweedFS). Like the complete e2e it sets `S3_PUBLIC_ENDPOINT = S3_ENDPOINT` at the top (public host unreachable from the test container). Its objects under `test/` in the bucket are deleted in `afterAll` through the internal S3 client.
  - `VideoAccessPolicy.canAccess(video)` is the single seam: only `READY` is accessible, for everyone (unlisted model, TD-11). It is its own provider; `VideosService` receives it as the 5th constructor argument (before the storage config), so every `new VideosService(...)` in specs gained one argument. SI-03.11 reuses it.
  - Streaming: `@Public() @Get(':id/stream') @Redirect()` returns `302` to `StorageService.presignGet(objectKey)` signed with the PUBLIC endpoint; TTL is `S3_PRESIGN_READ_TTL_SECONDS` (default 14400 s = 4 h, configurable) which covers typical watch time. The browser's Range requests go straight to storage (206 verified).
  - Error order: 404 `VIDEO_NOT_FOUND` (unknown `publicId`) then 409 `VIDEO_NOT_READY` (any status other than READY, including FAILED). Added `VideoNotReadyException`.
  - Private helper `getAccessibleVideo(publicId)` in `VideosService` (lookup + policy) is meant to be reused by `getDownloadUrl` in SI-03.11.
  - No `@ApiBearerAuth` on the endpoint (public); OpenAPI documents the 302 with a `Location` header. The OpenAPI contract changed again (regenerate `openapi.json`/`src/metadata.ts` in final verification).
  - The playback URL is valid for the whole TTL and shareable by anyone holding it; acceptable for the unlisted model, to be reconsidered when Phase 04 tightens `VideoAccessPolicy`.

### SI-03.11 — Endpoint GET /videos/{id}/download
- **Status:** completed
- **Tests:** 85 passing across the 9 `src/videos` + `src/storage` suites (4 new service unit tests, 6 new content-disposition unit tests) and 4 passing in test/videos-download.e2e-spec.ts; eslint and tsc clean
- **Observations:**
  - E2E file `test/videos-download.e2e-spec.ts` authored from `nestjs-project/specs/videos-download.plan.md` (3 scenarios) plus a non-ASCII filename case. It uses the same `S3_PUBLIC_ENDPOINT = S3_ENDPOINT` override and deletes its bucket objects in `afterAll` (bucket left clean).
  - **Resolves the follow-up flagged in SI-03.4:** non-ASCII original file names. New `attachmentDisposition(filename)` in `src/storage/content-disposition.util.ts` is now what `StorageService.presignGet` uses: plain ASCII names keep `attachment; filename="clip.mp4"`; control characters, `"`, `\` and `/` become `_` (prevents header splitting); non-ASCII names get an ASCII fallback plus an RFC 5987 `filename*=UTF-8''...`. Verified end to end against SeaweedFS (`vídeo férias.mp4` -> `filename*=UTF-8''v%C3%ADdeo%20f%C3%A9rias.mp4`).
  - Behaviour change in `presignGet`: a `"` in the file name used to be removed and is now replaced by `_`.
  - `getDownloadUrl` reuses `getAccessibleVideo` + `VideoAccessPolicy` from SI-03.10, so 404/409 behave exactly like stream and the policy remains the single seam.
  - Public endpoint (`@Public()`), no `@ApiBearerAuth`; OpenAPI documents the 302 with `Location`. The OpenAPI contract changed again (regenerate `openapi.json`/`src/metadata.ts` in final verification).
  - The download redirect URL is valid for `S3_PRESIGN_READ_TTL_SECONDS` (default 4 h) and is shareable while valid, same as the stream URL.

### SI-03.12 — Sweeper de uploads travados
- **Status:** completed
- **Tests:** 57 passing + 3 skipped in the worker+storage suites of the API container (sweeper unit 5, sweeper integration 4, scheduler unit 2, scheduler integration 1, processor unit incl. 2 new routing tests, storage integration incl. 1 new idempotent-abort test) and 3 passing in the `video-worker` container (processor integration with real FFmpeg, after the constructor change); eslint and tsc clean
- **Observations:**
  - Split into two classes (single responsibility): `StaleUploadSweeper` (what to fail) and `StaleUploadScheduler` (registers the repeatable job on `OnApplicationBootstrap` via `queue.upsertJobScheduler`). `VideoProcessor` routes `sweep-stale-uploads` jobs to the sweeper and now takes it as a 4th constructor argument.
  - Constants (fixed here as TD-10 delegates them to planning): sweep every 15 min (`SWEEP_INTERVAL_MS`), threshold 24 h of `updatedAt` inactivity (`STALE_UPLOAD_MAX_AGE_MS`), `failureReason` "Upload was not completed within 24 hours". The scheduler's job template uses `attempts: 1`, keeps the last 5 completed and 20 failed runs so the queue does not grow forever.
  - **Failure policy (background job rule):** a video whose multipart abort fails stays `UPLOADING` and is retried on the next run (marking it FAILED would orphan its open multipart upload); other videos in the same run still get swept; the run itself does not fail. `sweep(now)` accepts a clock for tests and returns `{ swept, skipped }`.
  - `StorageService.abortMultipartUpload` is now idempotent (a `NoSuchUpload` response is success), which also makes the sweeper safe to re-run; covered by a storage integration test. The sweeper integration spec proves against SeaweedFS that a swept upload's part URL stops working while a recent upload's keeps working.
  - Verified with the real worker process: after start-up Redis holds exactly one scheduler (`bull:video-processing:repeat` zcard = 1, `every` = 900000 ms) and the first sweep job ran and scheduled the next one 15 minutes later. A second start was attempted but `nest start` failed with `EACCES: unlink dist/swagger/swagger-document.d.ts` (a root-owned/locked file under the Windows bind mount while it cleans `dist/` via `deleteOutDir`); restart idempotency is covered by the scheduler integration test (3 bootstraps -> 1 scheduler). **`dist/` (gitignored) is currently half-deleted** (only `dist/swagger` remains) - it is regenerated by `npm run build` in the final verification.
  - The scheduler left in the dev Redis is the intended steady state: any worker start re-upserts the same one.
  - No HTTP endpoint is added by this SI, so the OpenAPI contract is unchanged by it.

## Final verification

Run on 2026-10-29 against the Compose stack (Postgres, Redis, SeaweedFS), `nestjs-project/`:

- `npm run build` - OK (also regenerated the half-deleted `dist/`).
- `npx tsc --noEmit` - OK, no errors.
- `eslint "{src,apps,libs,test}/**/*.ts"` (same rules as `npm run lint`, without `--fix`) - OK, no findings.
- `npm test -- --runInBand` (API container): 41 suites passed, 280 tests passed; 1 suite skipped (3 tests) = `video.processor.integration-spec.ts`, which needs FFmpeg.
- `npm run test:e2e -- --runInBand` (API container): 8 suites, 80 tests passed (auth, app, swagger and the 5 videos specs).
- `docker compose exec video-worker npx jest src/worker/video.processor.integration-spec.ts` (real FFmpeg): 3 tests passed. Together with the API run, nothing is skipped.
- `npm run openapi:export` regenerated `nestjs-project/openapi.json`: only additions (the five `/videos` paths and their schemas, +490 lines). `src/metadata.ts` is a stub and needs no regeneration (earlier SI notes that mention regenerating it are superseded by this line).

### Follow-ups noticed during the phase (not acted on, out of scope)

- Size-mismatch at `complete` (SI-03.8) marks the video FAILED but leaves the already-completed object in storage; `StorageService` has no delete method and there is no cleanup for such objects.
- `docs/phases/phase-03-videos/library-refs.md` still lists `@nestjs/bullmq` ^12.0.0 while the project uses ^11.0.5 (v12 is ESM-only and breaks the CommonJS Jest setup); `ioredis` is an extra explicit dependency. The pipeline artifact was left untouched on purpose.
- `Video` entity properties are camelCase (as in the plan's Data Model) while the older entities use snake_case properties; align when convenient.
- `WorkerModule` duplicates the TypeORM `forRootAsync` factory from `AppModule`.
- The stream/download redirect URLs stay valid for `S3_PRESIGN_READ_TTL_SECONDS` (default 4 h) and are shareable; revisit when Phase 04 tightens `VideoAccessPolicy`.
- The bucket lifecycle rule for abandoned multipart uploads (2 days) was stored but its execution after the configured days was not verified; the 24 h application sweeper is the effective cleanup.
- Full-suite runs depend on the test database being shared: suites must run `--runInBand` and no stale `jest` process may be left in the containers (one was found and stopped in SI-03.1).
- Nothing was committed; all changes of the phase are in the working tree of `feature/phase-03-videos`.

