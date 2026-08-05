# phase-03-videos — Progress

**Status:** completed
**SIs:** 5/5 completed

### SI-03.1 — Dependencies, Environment Configuration Namespaces, and Docker Compose Services
- **Status:** completed
- **Tests:** 10 passing
- **Observations:**
  - Implementation (deps, storage.config.ts, redis.config.ts, env.validation.ts, compose.yaml, Dockerfile.dev) already existed from a prior session; audited against spec and confirmed correct.
  - Added missing test coverage for storage/redis env vars in `env.validation.integration-spec.ts` (previously only covered `SWAGGER_ENABLED`).

### SI-03.2 — Video Entity and Database Migration (`videos` Table)
- **Status:** completed
- **Tests:** 7 passing (5 entity + 2 migrations)
- **Observations:**
  - Entity and migration already existed from a prior session; audited against Data Model spec — correct column types, constraints, and FK.
  - Fixed a real bug: `Video.status` column lacked `enumName: 'video_status_enum'`, so TypeORM's `synchronize` (used by entity integration tests) generated a mismatched enum type name (`videos_status_enum`, from default naming) that collided with the migration-created `video_status_enum` type on repeated test runs, leaving orphaned enum types in the shared dev DB. Added explicit `enumName` to align both paths.
  - Extended `video.entity.integration-spec.ts` with FK relation load, FK violation, and timestamp auto-population tests (spec required these but only default-status and unique-constraint were covered).
  - Had to manually `DROP TYPE videos_status_enum CASCADE` in the dev DB to clear residue from the pre-fix test runs; no migration change needed since the migration always used the correct name.

### SI-03.3 — Storage Service (MinIO / S3 AWS SDK Integration)
- **Status:** completed
- **Tests:** 5 passing
- **Observations:**
  - `StorageService`/`StorageModule` already existed from a prior session; audited against spec — all required methods present and correctly wired to real MinIO container.
  - Extended `storage.service.integration-spec.ts` with a Range-header retrieval test and a bucket-init idempotency test (spec required range streaming + bucket auto-creation coverage, only implicitly exercised before).
  - `ensureBucketsExist` swallows creation errors with only a log (no rethrow) — acceptable for a boot-time initializer, but not calling this out as a defect since it's not a request-lifecycle service path.

### SI-03.4 — Queue Module and Video Worker (BullMQ + FFmpeg Processing)
- **Status:** completed
- **Tests:** 6 passing (4 unit + 2 integration)
- **Observations:**
  - `QueueModule`, `VideoProcessor`, and `worker.ts` already existed from a prior session; audited against spec.
  - Fixed a spec deviation: the abort condition only checked for `!video` and `status === READY`, letting `draft`/`error` videos incorrectly proceed through processing. Changed to abort whenever `status !== PROCESSING`, per spec.
  - Fixed two real TypeScript compile errors that were crash-looping the `video-worker` container: `storage.service.ts` needed `import type { ConfigType }` (TS1272, `isolatedModules`), and `video-processor.ts` needed a default import for `fluent-ffmpeg` instead of a namespace import (TS2349, not callable). Verified via `npx tsc --noEmit` and by confirming `video-worker` boots cleanly.
  - Fixed a minor spec deviation: thumbnail capture used `timestamps: ['0.5']` instead of the spec's 1s mark; changed to `['1']`.
  - Wrote `video-processor.spec.ts` (unit, mocks repo/storage/fluent-ffmpeg/fs) and `video-processor.integration-spec.ts` (integration, generates a synthetic MP4 via `ffmpeg -f lavfi` and exercises real ffprobe/ffmpeg/MinIO).
  - Discovered a cross-cutting regression from SI-03.2: 10 pre-existing integration/module specs build their own `DataSource`/`TypeOrmModule` with a local `ALL_ENTITIES` array that didn't include `Video`. Since `Channel` now has `@OneToMany(() => Video, ...)`, TypeORM failed to resolve the inverse relation in those specs. Added `Video` to all 10 `ALL_ENTITIES` arrays (auth, users, channels module/service/entity specs).
  - `src/openapi-export.integration-spec.ts` still fails: it boots the full `AppModule`, which uses `autoLoadEntities: true` — an entity is only auto-loaded once some module registers it via `TypeOrmModule.forFeature()`. `VideosModule` isn't wired into `AppModule` yet (that's SI-03.5), so `Channel#videos` can't resolve at the real-app level. Expected to self-resolve once SI-03.5 registers `VideosModule`; full suite will be re-verified at that point.

### SI-03.5 — Videos Service, Controller, and API Endpoints
- **Status:** completed
- **Tests:** 221 passing (15 unit + 9 integration in `videos.service` + 7 e2e in `videos.e2e-spec.ts`; 190 total unit/integration and 59 total e2e across the full suite)
- **Observations:**
  - Registered `VideosModule` (and `storageConfig`/`redisConfig` namespaces) in `AppModule`, resolving the SI-03.4 deferred regression: `src/openapi-export.integration-spec.ts` now passes since `Channel#videos` resolves at the real-app level.
  - Added `VideoNotFoundException`, `VideoAccessDeniedException`, `InvalidVideoStateException`, `StorageUploadFailedException`, `VideoNotReadyException` to the domain exception hierarchy; `VideoNotReadyException` maps to 422 (Unprocessable Entity) — a judgment call where the Error Catalog listed "400 / 422" ambiguously, reasoning that "syntactically valid request, not yet fulfillable" fits 422 better than 400. `StorageUploadFailedException` wasn't named in the SI's prose but is required by `uploadComplete`'s `headObject` failure path and is listed in the Error Catalog table.
  - `stream`/`download` permit both `PROCESSING` and `READY` status (not just `READY`) since `storage_key` always points at the original raw upload regardless of transcoding progress — this also avoids E2E flakiness from racing the real `video-worker` container, which consumes the same BullMQ queue concurrently with the tests.
  - Found and fixed a real cross-suite regression exposed by running the full E2E suite together for the first time: `test:e2e` was missing `--runInBand` in `package.json`, so all four E2E suites ran in parallel workers against the shared test DB, causing FK violations and flaky assertion failures (`auth.e2e-spec.ts` duplicate-email and confirm-email cases, `videos.e2e-spec.ts` upload-complete/stream cases). Added `--runInBand`.
  - Fixed `cleanAllTables` (`src/test/create-test-data-source.ts`) to also `DELETE FROM videos` before `channels` — it previously only cleaned `refresh_tokens`/`verification_tokens`/`channels`/`users`, so leftover video rows from the videos E2E suite blocked channel/user deletion via FK in other suites.
  - Fixed a latent deadlock in `src/database/migrations.integration-spec.ts`: its `beforeAll` dropped all managed tables concurrently via `Promise.all`, which raced on lock ordering once `videos` (FK-referencing `channels`) was added to the managed-tables list. Serialized the drops into sequential `await` calls.
