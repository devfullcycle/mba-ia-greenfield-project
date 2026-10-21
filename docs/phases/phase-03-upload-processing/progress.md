# phase-03-upload-processing — Progress

**Status:** completed
**SIs:** 19/19 completed

### SI-03.1 — Infra: serviço de object storage no Compose
- **Status:** completed
- **Tests:** no tests (infra; validated by spike)
- **Observations:**
  - Used `weed mini` (single container) instead of separate master/volume/filer/s3 processes; credentials and bucket come from `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`S3_BUCKET` env vars.
  - Healthcheck uses `curl -s` without `-f` because the anonymous S3 root returns 403 while the service is healthy.
  - CORS is applied by one-shot `storage-init` service (aws-cli) from `nestjs-project/storage/cors.json`; added storage env vars to `.env.example` and `.env`.
  - `nestjs-project/nestjs-api` depends on `storage` healthy. Spike result recorded as Revision of TD-01 in `docs/decisions/technical-decisions-upload-processing.md`; lifecycle abort-MPU rule is accepted but enforcement is unverified (reaper stays primary).
  - Branch was created from `main` (no local `dev`; `upstream/dev` lacked the plan), per user confirmation.

### SI-03.2 — Infra: cliente S3 e configuração de storage
- **Status:** completed
- **Tests:** 13 passing (env.validation.integration-spec.ts)
- **Observations:**
  - Installed `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (^3.1154.0) via `docker compose run --rm nestjs-api` (API server not started).
  - Added optional `STORAGE_FORCE_PATH_STYLE` (default `true`) to cover the plan's "path-style" config field; not in `.env.example` (default applies).
  - `tsc --noEmit` clean.

### SI-03.3 — Criar StorageService (adaptador S3)
- **Status:** completed
- **Tests:** 7 passing (storage.service.integration-spec.ts, storage.module.spec.ts)
- **Observations:**
  - Two S3 clients: internal endpoint for operations, public endpoint for presigning (SigV4 binds the Host). Integration test overrides `STORAGE_PUBLIC_ENDPOINT` to the internal host because the browser-facing `localhost:8333` is unreachable inside the container.
  - Clients use `requestChecksumCalculation/responseChecksumValidation: 'WHEN_REQUIRED'` so presigned URLs carry no flexible-checksum params a browser PUT would have to reproduce.
  - Added `listMultipartUploads(prefix?)` (not listed in the plan's action 2) because the abort acceptance criterion and the reaper (SI-03.19) need it; `headObject` returns `null` when missing.
  - `tsc --noEmit` and eslint clean on touched files.

### SI-03.4 — Criar entidade Video e migration
- **Status:** completed
- **Tests:** 11 passing in src/videos + src/database (video.entity.integration-spec.ts, migrations.integration-spec.ts); full `jest src --runInBand` 169 passing (26 suites) twice; e2e 52 passing
- **Observations:**
  - Fixed values for the plan's `_undetermined_` enums: status `uploading|processing|ready|failed`, visibility `draft|published` (published reserved for Phase 04). `size_bytes`/`duration_seconds` use a numeric transformer (bigint/numeric come back as strings otherwise).
  - Migration `1792595000000-CreateVideos` hand-written with explicit constraint/index names (not the TypeORM-hashed names).
  - `Channel` now references `Video`, so `Video` was added to the entity lists of 11 existing test files; `cleanAllTables` now also clears `videos` (guarded with `to_regclass`).
  - `migrations.integration-spec.ts` now covers 3 migrations and drops the leftover `verification_tokens_type_enum` before migrating (DROP TABLE leaves the enum behind, which made the suite fail on a DB previously synced by other suites).
  - (at that time) `npm run lint` reported 193 problems in untouched files; resolved before phase close, see Final verification (e.g. test/auth.e2e-spec.ts, auth.service.spec.ts); out of scope here, but the Definition of Done requires lint to pass, so it needs a separate task. Files I touched introduce no new lint errors.
  - A `git stash` baseline check hung (compose services removed by the stash) and a prettier run reformatted two `.hbs` templates; both reverted/restored, tree intact.

### SI-03.5 — Gerar identificador público do vídeo
- **Status:** completed
- **Tests:** 3 passing (public-id.util.spec.ts)
- **Observations:**
  - Installed `nanoid@3` (^3.3.20, the CommonJS line): the project is CommonJS and nanoid 6 is ESM-only and Jest runs the code as CommonJS (the container is Node 25, so the old 'Node 20' reasoning in an earlier draft was wrong; the ESM/Jest risk is what matters). Same 11-char URL-safe output.
  - `tsc --noEmit` and eslint clean.

### SI-03.6 — Infra: fila de processamento com pg-boss
- **Status:** completed
- **Tests:** 4 passing (queue.service.integration-spec.ts, queue.module.spec.ts)
- **Observations:**
  - Pinned `pg-boss@10.4.2` (exact, CommonJS maintenance line) instead of latest 12.x: v12 is ESM-only (`"type": "module"`, `.ts` imports in its typings) and this project/Jest compile to CommonJS.
  - Transactional enqueue adapts the TypeORM `EntityManager` to pg-boss's `db.executeSql` option; queues are created lazily (`createQueue`, cached) by `enqueue`/`work`/`schedule`, so tests can use ad-hoc queue names.
  - `work` handlers receive one job at a time (wrapper iterates pg-boss v10's job array). `QueueModule` is not yet registered in `AppModule`: no SI-03.6 action asks for it; it is imported by the modules that use it (SI-03.8 onwards).
  - Pg-boss creates its `pgboss` schema on `start()` (verified).
  - `tsc --noEmit` and eslint clean on `src/queue`.

### SI-03.7 — Pré-cadastrar vídeo e iniciar o upload
- **Status:** completed
- **Tests:** 10 passing (videos.service.spec.ts 8, videos.service.integration-spec.ts 2); full `jest src --runInBand` 186 passing (31 suites), e2e 52 passing, `tsc` clean
- **Observations:**
  - Fixed values for the plan's open items: accepted formats `video/mp4`, `video/quicktime`, `video/webm`, `video/x-matroska`, `video/x-msvideo` (content type matched case-insensitively, params ignored); `PART_SIZE_BYTES` = 100 MiB (~103 parts for 10 GB, min 5 MiB, max 10,000 parts); public_id retries capped at 5. All in `videos.constants.ts`.
  - All 7 Error Catalog exceptions were added to `domain.exception.ts` now (only FILE_TOO_LARGE/UNSUPPORTED_VIDEO_FORMAT are used yet). Added `ChannelsService.findByUserId`.
  - `startUpload` inserts the draft first (needs `public_id` for `storage_key = videos/{publicId}/original`), then opens the multipart and saves `upload_id`; if the storage call fails the draft is deleted (compensation).
  - `VideosModule` now imports `ChannelsModule` + `StorageModule` and provides/exports `VideosService`.
  - Test-suite hygiene: `migrations.integration-spec.ts` now drops tables sequentially — with the new `videos→channels→users` FK chain the previous concurrent `Promise.all` of `DROP TABLE CASCADE` deadlocked. The new integration spec cleans its rows in `afterAll`. After several failed runs the shared DB had dirty state and one full run failed spuriously before passing twice; if a full run fails with FK/deadlock errors, rerun it once.
  - `npm run lint` per-file: files I created/changed are clean; `channels.service.ts` lines 12–16 (`err as any`) and the other 193-problem backlog are pre-existing.

### SI-03.8 — Assinar partes e concluir upload com enfileiramento transacional
- **Status:** completed
- **Tests:** 23 new passing in src/videos (videos.service.spec.ts + videos.service.integration-spec.ts, 33 total in the folder); full `jest src --runInBand` 198 passing (31 suites), e2e 52 passing, `tsc` clean, eslint clean on touched files
- **Observations:**
  - `signParts`/`completeUpload` share `loadOpenUpload` (404 → 403 → 409 order); an upload counts as closed when `status != uploading` or `upload_id` is null.
  - Storage refusals map to `UPLOAD_INCOMPLETE` only when the S3 error is a 4xx; 5xx/other errors propagate. The completing transaction updates `WHERE status = 'uploading'` and throws `UPLOAD_ALREADY_COMPLETED` if nothing was affected (concurrent completion), before enqueuing.
  - Known edge: the storage multipart is completed *before* the DB transaction (it cannot join it). If the transaction fails, the video stays `uploading` with the old `upload_id` but the multipart is already closed, so a retry of `complete` will be refused by the storage (→ `UPLOAD_INCOMPLETE`) instead of recovering; the reaper (SI-03.19) cleans such rows. Not covered by the plan; worth a follow-up if automatic recovery is wanted.
  - `VideosService` now also depends on `QueueService` and `DataSource`; `VideosModule` imports `QueueModule`, so pg-boss starts wherever `VideosModule` is loaded (AppModule from SI-03.9 on).
  - DTOs: `part_numbers` unique 1..10000 (max 10000 items); `parts[]` nested `{part_number, etag}`.

### SI-03.9 — Endpoint POST /videos
- **Status:** completed
- **Tests:** 5 e2e passing (`test/videos-start-upload.e2e-spec.ts`); full e2e 57, unit+integration 198; tsc clean
- **Observations:**
  - `VideosController` registered in `VideosModule`; `openapi.json` regenerated via `npm run openapi:export` (+91 lines).
  - e2e helper reuses the auth e2e pattern (spy on `MailService.sendConfirmationEmail` to capture the token); open multiparts are aborted in `afterAll`.

### SI-03.10 — Endpoint POST /videos/:publicId/upload/part-urls
- **Status:** completed
- **Tests:** 5 e2e passing (`test/videos-part-urls.e2e-spec.ts`); tsc clean
- **Observations:**
  - Controller wraps the service result as `{ urls }` per the API contract.
  - The 409 scenario completes the upload through `VideosService.completeUpload` because `/complete` only exists from SI-03.11; the e2e overrides `STORAGE_PUBLIC_ENDPOINT` to the internal host to PUT the part.

### SI-03.11 — Endpoint POST /videos/:publicId/upload/complete
- **Status:** completed
- **Tests:** 5 e2e passing (`test/videos-complete-upload.e2e-spec.ts`); tsc clean
- **Observations:**
  - Job presence is asserted directly on `pgboss.job`.
  - Scenario 1.4 of `videos-part-urls.e2e-spec.ts` now completes the upload through this route instead of the service.

### SI-03.12 — Consultar vídeo, resolver acesso e URLs de reprodução
- **Status:** completed
- **Tests:** 48 passing in `src/videos` + `src/auth/guards` (incl. 3 new guard specs, 6 service unit, 1 integration with Range → 206); tsc and eslint clean
- **Observations:**
  - `expires_in` fixed at 3600 s (`PLAYBACK_URL_EXPIRES_IN_SECONDS`), since no TD defines it.
  - `OptionalAuthGuard` treats an invalid/expired token as anonymous (does not reject); `@OptionalAuth()` bundles `@Public()` + the guard.
  - Visibility rule: published → anyone; draft → owner only, otherwise `VIDEO_NOT_FOUND` (owner resolved via `ChannelsService.findByUserId`). `VideoResponseDto`/`PlaybackUrlResponseDto` live in `dto/video-response.dto.ts`.

### SI-03.13 — Endpoint GET /videos/:publicId
- **Status:** completed
- **Tests:** 4 e2e passing (`test/videos-get-status.e2e-spec.ts`); e2e total 71, jest src 208; tsc and eslint clean
- **Observations:**
  - `VideosModule` now imports `AuthModule` (needs `JwtService` for `OptionalAuthGuard`); `videos.service.integration-spec.ts` therefore loads `appConfig`, `authConfig` and `mailConfig` too.
  - `@ApiBearerAuth` moved from class level to the three authenticated methods, per the rule that public/optional-auth routes must not advertise it.
  - The post-processing scenario inserts a `ready` row directly (the worker only arrives in SI-03.18).

### SI-03.14 — Endpoint GET /videos/:publicId/stream
- **Status:** completed
- **Tests:** 4 e2e passing (`test/videos-stream.e2e-spec.ts`); tsc and eslint clean
- **Observations:**
  - The e2e uploads a real object via `StorageService.putObject` and fetches the returned URL with `Range: bytes=0-99` (206, 100 bytes); `STORAGE_PUBLIC_ENDPOINT` is pointed at the internal host before the app boots.
  - Ready/processing videos are created via `POST /videos` and their status updated directly (worker arrives in SI-03.18).

### SI-03.15 — Endpoint GET /videos/:publicId/download
- **Status:** completed
- **Tests:** 4 e2e passing (`test/videos-download.e2e-spec.ts`); tsc and eslint clean
- **Observations:**
  - Fetching the returned URL yields `Content-Disposition: attachment; filename…` (original filename).
  - Same fixture strategy as SI-03.14 (real object via `putObject`, status set directly).

### SI-03.16 — Infra: worker como segundo entrypoint e serviço do Compose
- **Status:** completed
- **Tests:** 1 unit (`src/worker/worker.module.spec.ts`); jest src 209, e2e 79; tsc clean
- **Observations:**
  - Verified live: `video-worker` is `Up`, no connection errors in logs, `ffmpeg 5.1.9` and `ffprobe` run inside it, only the Docker DNS socket is listening (no HTTP port), and `docker compose stop` exits with code 0 in under 1 s (graceful pg-boss stop via `enableShutdownHooks`).
  - Compose runs `node_modules/.bin/ts-node` directly instead of `npm run`: npm swallowed SIGTERM and the container exited 1.
  - Plan asked for a worker build script and a `nest-cli.json` entry; `nest build` already emits `dist/worker.main.js`, so I added `start:worker:dev` and `start:worker:prod` (`node dist/worker.main`) and left `nest-cli.json` untouched (a second entry would make two watchers fight over `deleteOutDir`). The dev worker has no hot reload.
  - `WorkerModule` registers `Channel`, `User`, `RefreshToken`, `VerificationToken` besides `Video` because TypeORM needs relation metadata.
  - `Dockerfile.dev` now installs `ffmpeg` for both `nestjs-api` and `video-worker`; the apt lists are cleaned in the same layer.

### SI-03.17 — Criar FfmpegService (probe e thumbnail)
- **Status:** completed
- **Tests:** 14 new (7 unit with mocked spawn, 7 integration with real ffmpeg/ffprobe); jest src 223, e2e 79; tsc and eslint clean
- **Observations:**
  - `extractThumbnail` returns the JPEG as a `Buffer` (temp dir created and always removed in `finally`), so the handler can upload it without managing files.
  - Thumbnail instant fixed at 10% of the duration, capped at 5 s (`thumbnailInstant`).
  - Default timeout 120 s (`FFMPEG_TIMEOUT_MS`), overridable per call; on timeout the child gets SIGKILL. Process failures raise `FfmpegError` carrying the stderr tail.
  - The integration spec generates a 2 s clip with `ffmpeg -f lavfi` and also probes through a real presigned storage URL; timeouts are tested against a TCP server that never answers.
  - `FfmpegService` is registered in `WorkerModule`.

### SI-03.18 — Processar vídeo enviado (handler de video.process)
- **Status:** completed
- **Tests:** 12 new (8 handler unit, 3 handler integration with real ffmpeg/storage/db, 1 queue integration for retry counters); jest src 235, e2e 79; tsc and eslint clean
- **Observations:**
  - Final failure is detected from job metadata: `QueueService.work` now passes `includeMetadata: true` and the handler context carries `retryCount`/`retryLimit`; on `retryCount >= retryLimit` the video becomes `failed` (guarded by `status = 'processing'`) and the error is rethrown so pg-boss also fails the job.
  - New `QUEUE_OPTIONS` in `queue.constants.ts` applies the retry policy at `createQueue`: `video.process` gets 3 retries, 30 s delay, backoff. pg-boss does not alter a queue that already exists, so an existing dev DB keeps the old policy.
  - Added `StorageService.presignInternalGetUrl` (signed on the internal endpoint): the worker's ffmpeg runs inside Compose, where the public endpoint (`localhost:8333`) is unreachable. Public presigned URLs stay browser-only.
  - Idempotency: only a video in `processing` is worked on; ready/failed/uploading are skipped and a missing video drops the job (no retry). The thumbnail key is deterministic (`videos/{publicId}/thumbnail.jpg`) so even a concurrent duplicate overwrites instead of adding an object, and the final `UPDATE` is conditional on `processing`.
  - `WorkerModule` registers the handler, which calls `queue.work` in `onApplicationBootstrap`. `video-worker` was restarted to load it and starts without errors.
  - The Compose worker shares the database with e2e runs, so it also consumes `video.process` jobs enqueued by the complete-upload e2e; those videos are deleted by `cleanAllTables`, so the handler just drops the job.

### SI-03.19 — Reaper de uploads abandonados
- **Status:** completed
- **Tests:** 10 new (5 unit, 5 integration with real db and storage); jest src 245, e2e 79; tsc and eslint clean
- **Observations:**
  - Values fixed in `worker.constants.ts` (no TD defines them): cron hourly (`0 * * * *`), inactivity limit 24 h, batch of 100 per run.
  - "Inactive" is measured by `updated_at` of a `videos` row still `uploading` with an open `upload_id`. `signParts` does not touch the row, so a single upload that takes more than 24 h end to end would be reaped.
  - Per video: abort the multipart (a `NoSuchUpload`/404 counts as done), then a conditional `DELETE` (`status = 'uploading'` and the same `upload_id`), so an upload completed meanwhile is not removed. Aborting discards the parts, so no separate `deleteObject` is needed. A storage failure on one video is logged, keeps that row for the next run and does not stop the batch.
  - Does not sweep orphan multiparts without a database row (e.g. the `startUpload` compensation failing); the bucket lifecycle rule remains the unverified backstop.
  - Verified live: after restarting `video-worker`, `pgboss.schedule` holds `video.upload.reap` with `0 * * * *`.

## Final verification

- `jest src --runInBand`: 245 passing (39 suites). `jest --config test/jest-e2e.json --runInBand`: 79 passing (9 suites).
- `tsc --noEmit`: exit 0. `npm run build`: emits `dist/main.js` and `dist/worker.main.js`.
- `npm run lint`: exit 0 (re-verified on the host and inside the `nestjs-api` container; 0 errors, 0 warnings). The 190-problem backlog mentioned in SI-03.4 and SI-03.7 no longer exists, so Definition of Done item 4 is met.
- Full suites re-run at close: `jest --runInBand` 245 passing (39 suites), `jest --config test/jest-e2e.json --runInBand` 79 passing (9 suites), `tsc --noEmit` exit 0.
- AI docs updated: root `CLAUDE.md` (Architecture + new "Videos (Phase 03)" section) and `nestjs-project/CLAUDE.md` (services, "Videos Module" section).
- `library-refs.md` added. Context7 was unavailable when it was written; notes come from the installed packages and the SI-03.1 spike (stated in the file).
