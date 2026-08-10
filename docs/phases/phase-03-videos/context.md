---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-06-30T23:36:34-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-01T15:31:10-03:00"
  docs/decisions/technical-decisions-phase-02-auth.md: "2026-06-30T23:36:34-03:00"
  docs/decisions/technical-decisions-phase-01-configuracao-base.md: "2026-06-30T23:36:34-03:00"
  docs/phases/phase-02-auth/phase-02-auth.md: "2026-06-30T23:36:34-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-07-01T15:41:05-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities**

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** Edição das informações do vídeo, visibilidade público/unlisted, fluxo de rascunho→publicação, painel de gerenciamento do canal (Fase 04); player de vídeo, sugestões, contagem de visualizações (Fase 05); comentários, likes, inscrições (Fase 06). `next-frontend/` upload/player UI is deferred — `plan.txt` frames Fase 03 explicitly as a backend-only challenge.

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** `nestjs-project/`

**Deferred subprojects:** `next-frontend/` — upload/player UI is deferred; not initialized in this phase.

**Sequencing notes:** Depends on Fase 01 — Configuração Base do Projeto, Fase 02 — Cadastro, Login e Gerenciamento de Conta.

**Neighbors (for boundary detection only):** Fase 02 — Cadastro, Login e Gerenciamento de Conta (prior), Fase 04 — Gerenciamento de Vídeos e Canal (next).

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | technical-decisions-phase-03-videos.md | Backend | Background Job Queue Technology | decided | A (pg-boss) | pg-boss@^12.x |
| phase-03-videos/TD-02 | technical-decisions-phase-03-videos.md | Backend | Large File Upload Strategy (up to 10GB) | decided | A (Presigned multipart direct-to-storage) | — |
| phase-03-videos/TD-03 | technical-decisions-phase-03-videos.md | Backend | Object Storage Client & Bucket/Key Strategy | decided | A (AWS SDK v3) | @aws-sdk/client-s3@^3.x, @aws-sdk/s3-request-presigner@^3.x |
| phase-03-videos/TD-04 | technical-decisions-phase-03-videos.md | Backend | Video Worker Runtime & Metadata/Thumbnail Extraction | decided | A (fluent-ffmpeg) | fluent-ffmpeg@^2.1.x |
| phase-03-videos/TD-05 | technical-decisions-phase-03-videos.md | Backend | Unique Video URL Strategy | decided | A (UUID PK as URL id) | — |
| phase-03-videos/TD-06 | technical-decisions-phase-03-videos.md | Backend | Video Delivery Strategy (Streaming & Download) | decided | A (Presigned GET redirect) | — |
| phase-03-videos/TD-07 | technical-decisions-phase-03-videos.md | Backend | Processing Failure & Retry Policy | decided | B (Queue-native retry + manual reprocess) | — |

_Source files:_

- `docs/decisions/technical-decisions-phase-03-videos.md`

## Capability Coverage

| Capability | Covered by |
|------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-03 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02, phase-03-videos/TD-03 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-02, phase-03-videos/TD-01, phase-03-videos/TD-07 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-04, phase-03-videos/TD-07 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-04, phase-03-videos/TD-07 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-05 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-06 |
| Download do vídeo pelo usuário | phase-03-videos/TD-06 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** pg-boss — the project already runs PostgreSQL and nothing else stateful; adding Redis (BullMQ) or RabbitMQ purely to enqueue one job type is infrastructure not justified by the requirement, and pg-boss's transactional enqueue directly solves the "pré-cadastro automático" dual-write risk without an outbox pattern. No official `@nestjs/pg-boss` package exists — integration is a thin custom provider wrapping the `pg-boss` client, started/stopped via NestJS lifecycle hooks (`OnModuleInit`/`OnModuleDestroy`).

**Libraries:** `pg-boss@^12.x`

### phase-03-videos/TD-02

**Recommendation:** Presigned multipart upload direct-to-storage — the only option that satisfies both hard constraints simultaneously (API never blocked on transfer; upload survives connection failures) using infrastructure the project already has (S3/MinIO), without adding a new protocol or violating the non-blocking requirement. Contract: `POST /videos` (creates `rascunho` + initiates multipart upload), `POST /videos/:id/upload-parts` (presigned per-part URLs), `POST /videos/:id/complete-upload` (finalizes + enqueues processing job).

**Libraries:** —

### phase-03-videos/TD-03

**Recommendation:** AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`) — the brief explicitly frames MinIO as a local stand-in for a production AWS S3 target; the AWS SDK v3 is the only option where that transition requires no client-code changes (`forcePathStyle: true` + custom `endpoint` pointing at the `minio` Compose service). Bucket/key layout: `videos/{channelId}/{videoId}/original.<ext>` and `videos/{channelId}/{videoId}/thumbnail.jpg`.

**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

### phase-03-videos/TD-04

**Recommendation:** fluent-ffmpeg, run inside a dedicated `video-worker` Compose service (own Dockerfile installing `ffmpeg`), consuming TD-01's queue. Handles 10GB inputs while giving a documented API for both required operations (`.ffprobe()` for metadata, `.screenshots()`/seek-and-capture for the thumbnail frame).

**Note:** `fluent-ffmpeg@2.1.3` (last published years ago) is unmaintained upstream — the GitHub repo is read-only and no longer accepts issues/PRs. The API remains widely used and functionally stable against current `ffmpeg` binaries for the two operations this phase needs (probe + single-frame capture), but this should be re-confirmed at `plan-resolve` time; the maintained fork `@ts-ffmpeg/fluent-ffmpeg` is a fallback if a concrete incompatibility with the pinned `ffmpeg` binary surfaces.

**Libraries:** `fluent-ffmpeg@^2.1.x`

### phase-03-videos/TD-05

**Recommendation:** UUID primary key used directly as the public URL id — the brief's requirement is strictly "unique, no conflict," which the already-mandated UUID PK (`.claude/rules/nestjs-entities.md`) satisfies with zero additional mechanism, consistent with how `channels`/`users` already expose their UUID `id`.

**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** Presigned GET redirect (`inline` for streaming, `attachment` for download) — keeps the same architectural principle used for upload (API orchestrates, storage moves bytes), avoids reimplementing Range/206 handling that S3/MinIO already provides, and does not block API capacity on playback/download traffic. Reuses TD-03's AWS SDK v3 presigner.

**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** Queue-native retry (pg-boss `retryLimit`/`retryDelay`) + authenticated `POST /videos/:id/reprocess` (owner-only) endpoint — automatic retries absorb most transient failures for free; the manual endpoint avoids making a full 10GB re-upload the only remediation path for a recoverable failure.

**Libraries:** —

## Inherited Decisions Detail

### phase-02-auth/TD-06

**Recommendation:** class-validator + class-transformer — the documented NestJS approach, already used extensively across the codebase (decorators, DI). Applies unchanged to Phase 03's DTOs (e.g., initiate-upload, complete-upload, reprocess request bodies).

**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Custom Domain Exception Filter — machine-readable `{ statusCode, error, message }` error codes. Phase 03 must add its own `DomainException` subclasses (e.g., `VideoNotFoundException`, `UploadNotInitiatedException`, `InvalidVideoStatusTransitionException`) following the same base class and filter established in Phase 02.

**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** @nestjs/throttler — native NestJS integration via `APP_GUARD`, scoped per module. Phase 02 registered `ThrottlerGuard` only inside `AuthModule`; a new module needing rate limiting (e.g., upload-initiation endpoints, to blunt abuse of presigned-URL issuance) must import `ThrottlerModule` and register its own scoped `APP_GUARD` — it is not automatically inherited application-wide.

**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-02

**Recommendation:** Custom guards with `@nestjs/jwt` only (no Passport) — `JwtAuthGuard` is registered globally via `APP_GUARD`, so all Phase 03 endpoints require authentication by default; routes needing anonymous access (e.g., `GET /videos/:id/stream`, `GET /videos/:id/download` once a video is `pronto`) must opt out explicitly via `@Public()` (`src/auth/decorators/public.decorator.ts`).

**Libraries:** `@nestjs/jwt@^11.0.0`

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: { allowUnknown: true, abortEarly: false } })`. _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for non-DI contexts (e.g., TypeORM CLI). _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options including `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_
- Global `ValidationPipe` in `src/main.ts` with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true` — every new DTO is validated and unknown properties rejected automatically. _(from phase 02)_
- Domain errors extend `DomainException` (`src/common/exceptions/domain.exception.ts`, fields `errorCode`/`httpStatus`); services never throw NestJS HTTP exceptions directly. The global `DomainExceptionFilter` (`src/common/filters/domain-exception.filter.ts`) maps them to `{ statusCode, error, message }`. _(from phase 02)_
- Authentication uses custom guards + `@nestjs/jwt` (no `@nestjs/passport`); `JwtAuthGuard` is registered globally via `APP_GUARD` in `AuthModule`, protecting all routes by default; `@Public()` opts a route out. _(from phase 02)_
- Rate limiting via `@nestjs/throttler`'s `ThrottlerGuard`, registered as an `APP_GUARD` scoped to the module that imports `ThrottlerModule` — currently only `AuthModule`. Any Phase 03 module wanting throttling must import `ThrottlerModule` and register its own scoped guard. _(from phase 02)_
- Entities use `@PrimaryGeneratedColumn('uuid')`, explicit `@Entity('table_name')`, `@CreateDateColumn()`/`@UpdateDateColumn()`, and `{ unique: true }` on naturally unique columns — see `.claude/rules/nestjs-entities.md`. _(from phase 01/02 entities, e.g. `User`, `Channel`)_

## Inherited Deferred Capabilities

_No inherited deferred capabilities relevant to backend scope._ (Phase 02's deferred item — cadastro/login/confirmação/recuperação screens — is a `next-frontend/` UI concern, orthogonal to Phase 03's backend-only scope.)

## Non-UI / Deferred Capabilities

_None._ All 9 Fase 03 capabilities are covered by TD-01 through TD-07 (see Capability Coverage above); none are deferred.

## Testing Requirements

Refer to the `testing-guide-nestjs-project` Skill for layer requirements per artifact type in `nestjs-project/`. Phase 03 exercises the existing pyramid (entities, services, controllers, modules, DTOs, guards, filters) plus artifact types anticipated in `artifacts/future-types.md` (queue consumers/processors) that this phase is the first to actually introduce:

- **Video entity** — Integration tests for constraints/defaults/status enum, per `artifacts/entities.md`.
- **VideosService** (branching: status transitions, presigned URL orchestration) — Unit (mock storage/queue clients) + Integration (real DB), per `artifacts/services.md`.
- **StorageService** (S3/MinIO client wrapper) — Integration against the real `minio` Compose service, not local filesystem: `references/external-systems.md`'s "Object Storage — Local Filesystem" section predates Fase 03's TD-03 decision (AWS SDK v3 against MinIO) and does not apply as written; tests should hit the real `minio` container the way Phase 02 hits the real `db` container, using a dedicated test bucket cleaned between tests.
- **Queue producer/consumer** (pg-boss) — `references/external-systems.md`'s "Message Queue — Real (Docker)" section is written for the (then-TBD) BullMQ/Redis case; substitute pg-boss equivalents: assert job insertion via `pgBoss.send()`/`getJobById()` in producer integration tests, and test the `video-worker` processor directly per `artifacts/future-types.md`'s "Queue Consumers / Processors" guidance (call the handler method directly with a synthetic job payload, assert DB/storage side effects — do not test that pg-boss's polling loop fires).
- **VideosController** — E2E only, per `artifacts/controllers.md`; one test per endpoint proving `ValidationPipe`, `JwtAuthGuard`/`@Public()`, and the domain exception filter are wired correctly.
- **video-worker container** — runs as a separate Node process/Compose service, not part of the `nestjs-api` Nest application; its FFmpeg-invoking code is still tested with the same unit/integration split (mock `fluent-ffmpeg` calls for branch logic, real `ffmpeg`/`ffprobe` binary + a small fixture video for the integration path).

Specific layer coverage by SI is recorded in `progress.md`.
