# phase-03-videos — Progress

**Status:** completed
**SIs:** 11/11 completed

### Post-completion manual verification (real 10GB upload)
- **Status:** completed
- **Tests:** 20 + 49 passing (regression tests for both fixes below) + full suite reconfirmed (34/34 unit+integration, 5/5 e2e)
- **Observations:**
  - Ran a real end-to-end test with a genuine ~9.5GB video (synthetic rawvideo generated via ffmpeg, not a mock) through the full pipeline: 973 real multipart parts uploaded to MinIO, real worker downloaded and ran ffprobe/ffmpeg on it, reached `status: pronto` with correct metadata (`duration_seconds: 984`, `width: 640`, `height: 360`). Verified independently of the API response — queried Postgres directly and ran `mc stat` against MinIO to confirm the 9.5GB original object and the generated thumbnail JPEG genuinely exist (not just trusting `200 OK`).
  - **Bug found:** `ThrottlerGuard` is registered via `APP_GUARD` inside `AuthModule`, making it global (applies to every route, not just `/auth/*`, contrary to what the SI-02.13 comment assumed) — broke `GET /videos/:publicId` status polling with `429` after 10 requests/min during the real test. Fixed with `@SkipThrottle()` on `VideosController`, matching `AppController`'s existing opt-out.
  - **Bug found:** `VideosService.completeUpload` never populated `Video.size_bytes`, despite the Data Model documenting it as "confirmed at multipart completion." No test anywhere asserted on this field, so it went unnoticed through every SI. Fixed by adding `StorageService.getObjectSize()` (`HeadObjectCommand`) and calling it right after `CompleteMultipartUploadCommand` succeeds.
  - Both bugs were only discoverable through genuine end-to-end manual testing against real infrastructure — neither was caught by 190+ passing automated tests, because the automated tests either cleared throttler storage before every test (masking the global-scope issue) or never asserted on `size_bytes` at all. Worth remembering: automated test coverage and manual exploratory testing catch different bug classes.
  - Local testing note: presigned URLs from `POST /videos` point at the Docker-internal `minio` hostname, which the host machine's browser/curl/Postman cannot resolve without adding `127.0.0.1 minio` to the OS hosts file (requires admin rights, not something this session can do unattended) — or by running the test client inside a container on the same Docker network instead.

### SI-03.1 — Dependencies, Config Namespaces, and Docker Compose
- **Status:** completed
- **Tests:** no tests (Infra)
- **Observations:**
  - Adding the new required Joi fields (STORAGE_*, RABBITMQ_URL) broke the pre-existing `env.validation.integration-spec.ts` fixture (`requiredEnv` didn't include them); fixed by extending the fixture — direct consequence of this SI's schema change, not out of scope.
  - Live dev-server boot smoke test via `npm run start:dev` was inconclusive in this environment (Windows Docker bind-mount I/O made the watch-mode webpack build too slow to confirm within a reasonable wait); verified instead via `npx tsc --noEmit` (clean) + the env-validation integration test (passing) + MinIO/RabbitMQ healthchecks + host-reachability curls (both 200).

### SI-03.2 — Video Entity and Migration
- **Status:** completed
- **Tests:** 6 passing
- **Observations:**
  - Extended the shared `cleanAllTables` helper (`src/test/create-test-data-source.ts`) with `DELETE FROM "videos"` (before `channels`, respecting the FK) — every integration test that calls it now truncates the videos table too; safe since the table already exists physically in the shared DB via the real migration run, and TypeORM `synchronize: true` never drops tables absent from a given DataSource's entity list.
  - `size_bytes` maps to TS `string | null` (bigint columns are returned as strings by node-postgres/TypeORM to avoid unsafe-integer precision loss) — intentional, not a typo.

### SI-03.3 — StorageService (Presigned Multipart Upload and Presigned GET)
- **Status:** completed
- **Tests:** 5 passing
- **Observations:**
  - Integration test ensures the `videos` MinIO bucket exists in `beforeAll` (`CreateBucketCommand`, tolerating `BucketAlreadyOwnedByYou`) rather than baking bucket provisioning into `StorageService` itself — keeps the service focused on the multipart/presign contract; bucket lifecycle is a deploy/infra concern.
  - Used native `fetch` (Node 22) to exercise the presigned URLs end-to-end (PUT a part, GET with Range) rather than mocking the HTTP layer, per the project's real-capture-service testing convention.

### SI-03.4 — Queue Producer (RabbitMQ)
- **Status:** completed
- **Tests:** 3 passing
- **Observations:**
  - `ClientProxy#emit()` is a "hot" Observable that in practice only reliably publishes once subscribed (NestJS GitHub issue #2651/#625) — wrapped it in `lastValueFrom()` so the producer both triggers delivery and surfaces broker errors as a rejected promise, instead of a silent fire-and-forget call.
  - First test run failed all 3 tests with "Nest can't resolve dependencies... dependency at index [0] appears to be undefined" — root cause was a circular import: `queue.module.ts` imported `VideoProcessingProducer` while `video-processing.producer.ts` imported the `VIDEO_PROCESSING_SERVICE` token back from `queue.module.ts`, so the `@Inject()` decorator saw `undefined` at module-evaluation time. Fixed by extracting the token into `queue.constants.ts` per the project's constants convention — not just a test-setup issue, this would have broken the real app too.

### SI-03.5 — POST /videos (Initiate Multipart Upload)
- **Status:** completed
- **Tests:** 15 passing (7 channels unit incl. 2 new + 4 videos unit + 1 videos integration + 3 videos e2e)
- **Observations:**
  - `ChannelsService` had no way to resolve a channel from a `userId` (only `createChannel`); added `findByUserId(userId)` reusing the existing single `dataSource` dependency (`dataSource.getRepository(Channel).findOne(...)`) instead of injecting a new `Repository<Channel>` — avoids changing the constructor signature and breaking the 5 existing unit tests that call `new ChannelsService(mockDataSource)` with one argument.
  - `Video.public_id` is `varchar(12)`, so `nanoid()` must be called with an explicit size (`nanoid(12)`) — the package default is 21 chars and would overflow the column.
  - The video's internal `id` (uuid) is generated client-side via `randomUUID()` *before* insert, because the storage key (`videos/{channelId}/{videoId}/original.<ext>`) needs the id before the row exists; passed explicitly to `repository.create({ id, ... })`, which TypeORM accepts (overrides the column's `DEFAULT uuid_generate_v4()`).
  - First test run failed all 3 non-channels suites with `SyntaxError: Cannot use import statement outside a module` from `node_modules/nanoid/index.js` — `nanoid@5` is pure ESM and Jest's default `transformIgnorePatterns` skips `node_modules`, so `require()` inside Jest's sandbox couldn't load it (unlike plain `node -e "require('nanoid')"`, which works because Node 22+/25 has native synchronous ESM-interop for `require()` that Jest's own module loader doesn't use). Fixed by adding `"transformIgnorePatterns": ["/node_modules/(?!(nanoid)/)"]` to both the `jest` block in `package.json` and `test/jest-e2e.json`, letting ts-jest transpile nanoid's ESM to CJS.

### SI-03.6 — POST /videos/:publicId/complete
- **Status:** completed
- **Tests:** 18 passing (9 videos.service unit incl. 5 new completeUpload cases + 2 videos integration incl. 1 new + 7 videos e2e incl. 4 new)
- **Observations:**
  - Plan's API Contracts specifies `Response 200` for this endpoint, but NestJS defaults `@Post()` to 201 — added explicit `@HttpCode(HttpStatus.OK)`, matching the same pattern already used by `AuthController.login`.
  - `VideosService`'s constructor grew a third dependency (`VideoProcessingProducer`); updated all existing test instantiations (unit `new VideosService(...)` calls, integration `Test.createTestingModule` providers) rather than letting them silently pass `undefined` for the new param.
  - The e2e suite now exercises the real RabbitMQ producer end-to-end (no mock) since `AppModule` → `VideosModule` → `QueueModule` connects to the actual broker; the integration test instead mocks `VideoProcessingProducer` since its purpose is the DB/storage contract, not queue delivery (already covered by the unit test's "emits exactly one processing job" case and by SI-03.4's own producer tests).

### SI-03.7 — DELETE /videos/:publicId (Abort Upload)
- **Status:** completed
- **Tests:** 24 passing (13 videos.service unit incl. 4 new abortUpload cases + 11 videos e2e incl. 4 new DELETE cases)
- **Observations:**
  - First e2e run had 2 failures (403 test got 401; 409 test crashed on `initiated.parts[0]` being undefined) — root cause was throttler-storage leakage: `videos.e2e-spec.ts` never cleared `ThrottlerStorage` between tests (unlike `auth.e2e-spec.ts`, which does), so by the 10th+ auth round-trip across the growing suite the per-IP 10 req/min cap on `/auth/*` silently 429'd `register`/`login`, leaving `access_token` (and therefore `initiated`) undefined. Fixed by adding the same `throttlerStorage.storage.clear()` in `beforeEach` that `auth.e2e-spec.ts` already uses — documented as a known gotcha in `.claude/rules/auth-jwt.md`, which I should have applied from the start.

### SI-03.8 — Video Worker (FFmpeg Processing)
- **Status:** completed
- **Tests:** 6 passing (video-processing.service unit, video-processing.consumer unit, worker.module compile)
- **Observations:**
  - `Dockerfile.dev` had no `ffmpeg` binary — added it to the `apt install` line (resolves to ffmpeg 7:5.1.9 from Debian bookworm's main repo, no extra sources needed) and rebuilt the image.
  - `WorkerModule` is a separate NestJS application root (own `ConfigModule.forRoot` + `TypeOrmModule.forRootAsync`), not nested inside `AppModule` — required duplicating the DB bootstrap wiring, which is expected for a genuinely separate hybrid-microservice process per `phase-03-videos/TD-01`.
  - `worker.module.spec.ts` (a real compile test hitting the real DB) failed twice while wiring entities: first "Entity metadata for Video#channel was not found", then "...Channel#user was not found" — TypeORM's `autoLoadEntities: true` only registers entities reachable through some `TypeOrmModule.forFeature()` in the imported tree, and `WorkerModule` only registered `Video`. Had to add `Channel` and then `User` to `TypeOrmModule.forFeature([...])` to close the relation chain (`Video → Channel → User`), even though the worker never queries Channel/User directly.
  - `StorageService` gained two new methods (`downloadToFile`, `uploadFile`) needed by the worker — kept in `StorageService` rather than a separate class since it's the same storage abstraction, just two more operations on it.
  - Manually started `npm run start:worker:dev` in the `worker` container to verify AC #4 empirically (unit tests can't prove real RabbitMQ connectivity): logged `Nest microservice successfully started`, then drained a real backlog of `video.processing` messages left over from earlier e2e test runs (SI-03.5–03.7 e2e tests emit real jobs since `AppModule` uses the real `QueueModule`, but no worker had ever consumed them). Most backlog entries hit `EntityNotFoundError` (their `Video` rows were already wiped by later tests' `cleanAllTables`) — expected for stale test artifacts, not a defect; one entry found its row, downloaded the (fake, non-video) e2e test payload from MinIO, and correctly failed at `ffprobe` into `status: erro` via the catch path, confirming the full pipeline wiring end-to-end. Stopped and re-killed the process afterward (it respawned once under `nest --watch` mid-kill) to leave the container idle per the project's "don't run the app unless asked" convention.

### SI-03.9 — GET /videos/:publicId (Status and Metadata)
- **Status:** completed
- **Tests:** 40 passing (7 jwt-auth.guard unit incl. 2 new + 18 videos.service unit incl. 5 new findByPublicId cases + 15 videos e2e incl. 4 new GET cases)
- **Observations:**
  - Pre-existing `JwtAuthGuard` bypassed token verification entirely for `@Public()` routes (`if (isPublic) return true` before even reading the header), so `request.user` was never populated even with a valid Bearer token — this endpoint needs "anonymous OK, but owner sees any status," which requires exactly that. Extended the guard to best-effort-decode a Bearer token on `@Public()` routes (attach payload if valid, silently proceed unauthenticated otherwise, never throw) rather than adding a second parallel auth mechanism — additive change, inert for every other `@Public()` route since none of them read `request.user`.
  - Removed `@ApiBearerAuth('access-token')` from the new endpoint's Swagger decorators — the project's own convention (`nestjs-controllers.md`) forbids that decorator on `@Public()` methods since it would falsely advertise the route as requiring auth.
  - E2E test for the "pronto video visible anonymously" case writes `status: 'pronto'` directly via `dataSource.getRepository(Video).update(...)` rather than running the real worker — the worker is a separate process not started during API e2e runs; this is the standard way to reach an async-background-driven state in these tests.

### SI-03.10 — GET /videos/:publicId/stream and /download
- **Status:** completed
- **Tests:** 41 passing (22 videos.service unit incl. 4 new + 19 videos e2e incl. 4 new)
- **Observations:**
  - Used NestJS's declarative `@Redirect()` decorator + returning `{ url, statusCode }` from the handler, rather than `@Res()` — keeps the response inside NestJS's normal pipeline so a thrown `VideoNotFoundException`/`VideoNotReadyException` still gets mapped by the global `DomainExceptionFilter` (using `@Res()` opts out of that unless handled manually).
  - Even the video's owner cannot stream/download a non-`pronto` video — `getStreamUrl`/`getDownloadUrl` call `findByPublicId` (which lets the owner see any status) and then apply a *separate* `status !== PRONTO` check, matching the Authorization Matrix where all three columns (anonymous/owner/non-owner) require `pronto` for these two endpoints specifically, unlike the plain `GET /videos/:publicId` status endpoint.
  - E2E tests reach a `pronto` video the same way as SI-03.9's — direct `dataSource` update, since the worker isn't running during API e2e tests.

### Final verification fixes (pre-existing regressions caught by the full suite)
- **Status:** completed
- **Tests:** 3 passing (migrations.integration-spec.ts x2, videos.module.spec.ts x1)
- **Observations:**
  - `src/database/migrations.integration-spec.ts` (legacy, phase-02): its `beforeAll` did `DROP TABLE IF EXISTS ... CASCADE` for cleanup but never dropped the `verification_tokens_type_enum` Postgres type the dropped column referenced — enum types are independent objects, not cascaded from a table drop. A prior run (predating this session — the `db` container had 3 days of uptime) left that type orphaned, so `CreateAuthTokens.up()`'s `CREATE TYPE` failed on rerun with "already exists". Fixed by adding `DROP TYPE IF EXISTS "verification_tokens_type_enum"` to the same `beforeAll` cleanup.
  - `src/videos/videos.module.spec.ts`: broken since SI-03.5 (when `StorageModule` was added to `VideosModule`'s imports) and never caught because I only ever re-ran the videos service/controller/e2e tests in each subsequent SI's verification, not this module-compile test in isolation. Fixed by adding `ConfigModule.forRoot({ isGlobal: true, load: [storageConfig, queueConfig] })` to the test's imports. **Process gap, not just a code gap:** the per-SI test scoping in this workflow only re-verifies the files a given SI directly touches or that the plan's Tests table names — a module-compile test whose failure is caused by a *sibling* SI's changes (not its own) can go unnoticed until a full-suite run. Worth remembering for future phases.

### SI-03.11 — End-to-End Upload-to-Playback Flow
- **Status:** completed
- **Tests:** 1 passing (real ffprobe/ffmpeg + real RabbitMQ worker process)
- **Observations:**
  - No binary fixture committed to the repo — `beforeAll` generates a real ~2s synthetic MP4 via `ffmpeg -f lavfi -i testsrc=... -f lavfi -i sine=...` (available in the container per SI-03.8's Dockerfile change), so the test is fully self-contained and reproducible without a checked-in video asset.
  - This test requires a **real worker process actively running** in the separate `worker` container — unlike every other SI, which mocked or DB-updated around the worker. Manually started `npm run start:worker:dev` in the `worker` container before running this test (it drained the RabbitMQ backlog left by earlier SIs' e2e runs first, then picked up this test's real job), and stopped it again afterward. This is a real operational gap worth flagging: the worker isn't started automatically by anything, so this specific e2e file will hang/timeout in any environment (CI included) unless something first brings up a live worker process — out of scope for this phase to solve (no CI pipeline exists yet in this project), but the next phase or a CI setup task should account for it.
  - `fetch(url, { body: <Buffer> })` failed `tsc` under the project's `@types/node` version — `Buffer` didn't satisfy `BodyInit`/`BlobPart` due to an `ArrayBufferLike`-vs-`ArrayBuffer` structural mismatch (SharedArrayBuffer branch). Fixed with `new Blob([Uint8Array.from(buffer)])`, which copies into a plain `Uint8Array` backed by a fresh `ArrayBuffer`.
  - `Uint8Array.from(fixtureBuffer)` — this same pattern is worth reusing anywhere else binary bytes need to go through `fetch`'s `body` in this project.

### Final Verification (Deliverables checklist)
- **Backend tests (unit+integration):** `docker compose exec nestjs-api npm test -- --runInBand` — 34/34 suites, 192/192 tests passing.
- **E2E tests:** `docker compose exec nestjs-api npm run test:e2e` — 5/5 suites, 72/72 tests passing (app, auth, swagger, videos, videos-flow).
- **Type-check:** `docker compose exec nestjs-api npx tsc --noEmit` — clean throughout every SI, and at final verification.
- **Lint:** `docker compose exec nestjs-api npm run lint` — 0 errors from phase-03's own code. 32 errors remain, all in phase-01/02 files never touched this phase (`auth.service.spec.ts` unbound-method warnings, `channels.service.ts`'s pre-existing `isPgUniqueViolationOnColumn` helper, `create-test-data-source.ts`'s pre-existing `Function` type, `users.service.integration-spec.ts` unused import, `auth.e2e-spec.ts` require-await) — left untouched per Scope Limits (one feature/fix at a time); flagged to the user as separate pre-existing debt, not fixed here.
- **Build:** `docker compose exec nestjs-api npm run build` — succeeds; `dist/main.js` (API) and `dist/worker/main.js` (worker) both present.
- One flaky failure encountered during final verification (`auth.service.integration-spec.ts`'s `beforeAll` exceeding the default 5000ms Jest hook timeout under full-suite sequential load) did not reproduce in isolation (25/25 passing) or on a full-suite re-run (34/34 passing) — pre-existing file, untouched, not a regression.
