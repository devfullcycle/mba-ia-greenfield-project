---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-10-28T16:49:56-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-28T17:01:56-03:00"
  docs/decisions/technical-decisions-phase-02-auth.md: "2026-10-28T16:49:56-03:00"
  docs/decisions/technical-decisions-phase-01-configuracao-base.md: "2026-10-28T16:49:56-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-28T16:49:56-03:00"
  docs/phases/phase-02-auth/phase-02-auth.md: "2026-10-28T16:49:56-03:00"
  docs/phases/phase-01-configuracao-base/phase-01-configuracao-base.md: "2026-10-28T16:49:56-03:00"
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

**Out of scope:** Página de visualização com player no frontend, edição/exclusão de vídeos pela interface, listagem pública paginada de vídeos na home/canal, sistema de likes/dislikes e comentários (Fases 04 e 05).

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando e URLs únicas geradas.

**Affected subprojects:** `nestjs-project/`

**Deferred subprojects:** _None — Phase 03 defines backend and infrastructure capabilities only; frontend video player and upload/management screens are scoped to Fase 04 (`Visualização e Gestão de Vídeos`)._

**Sequencing notes:** Depends on Fase 01 — Configuração Base do Projeto (config namespaces, TypeORM setup, Docker Compose foundation) and Fase 02 — Cadastro, Login e Gerenciamento de Conta (global `JwtAuthGuard`, `ChannelsModule` with `Channel` entity linked 1:1 to `User`, `DomainExceptionFilter`, `ValidationPipe`).

**Neighbors (for boundary detection only):** Fase 02 — Cadastro, Login e Gerenciamento de Conta (prior), Fase 04 — Visualização e Gestão de Vídeos (next).

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | technical-decisions-phase-03-videos.md | Backend | Object Storage Client & Bucket Organization | decided | A (AWS SDK v3 with single bucket and prefix-based keys) | @aws-sdk/client-s3@^3.x, @aws-sdk/s3-request-presigner@^3.x |
| phase-03-videos/TD-02 | technical-decisions-phase-03-videos.md | Backend | Background Job Queue Technology | decided | A (@nestjs/bullmq + bullmq on Redis 7) | @nestjs/bullmq@^11.x, bullmq@^5.x |
| phase-03-videos/TD-03 | technical-decisions-phase-03-videos.md | Backend | 10GB Upload Strategy & Automatic Draft Pre-Registration | decided | A (Direct-to-S3 Multipart Upload via Presigned URLs with Atomic Draft Pre-Registration) | @aws-sdk/client-s3@^3.x, @aws-sdk/s3-request-presigner@^3.x |
| phase-03-videos/TD-04 | technical-decisions-phase-03-videos.md | Backend | Video Worker Execution Model, Metadata Extraction & Thumbnail Generation | decided | A (Standalone `video-worker` Container + `ffprobe`/`ffmpeg` via `execFile`) | — (system `ffmpeg`/`ffprobe` + `node:child_process`) |
| phase-03-videos/TD-05 | technical-decisions-phase-03-videos.md | Backend | Video Status Lifecycle & Failure Handling | decided | A (`draft` → `processing` → `ready` \| `failed` state machine with retry handling) | — |
| phase-03-videos/TD-06 | technical-decisions-phase-03-videos.md | Backend | Unique Conflict-Free Video URL Identifier (Slug) | decided | A (11-Character Base64URL slug with DB unique constraint and collision retry) | — (`node:crypto`) |
| phase-03-videos/TD-07 | technical-decisions-phase-03-videos.md | Backend | Video Streaming (HTTP Range) & Download Strategy | decided | A (API-Proxied S3 Byte-Range Streaming `206 Partial Content` + Attachment Download) | @aws-sdk/client-s3@^3.x |

_Source files:_

- `docs/decisions/technical-decisions-phase-03-videos.md`

## Capability Coverage

| Capability | Covered by |
|------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-01 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-02 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-01, phase-03-videos/TD-03 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-03, phase-03-videos/TD-05 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-02, phase-03-videos/TD-04, phase-03-videos/TD-05 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-01, phase-03-videos/TD-04 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-06 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-07 |
| Download do vídeo pelo usuário | phase-03-videos/TD-07 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** Option A (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` with single bucket and key prefixes) — Official modular S3 SDK with first-class multipart upload, presigned URL generation, and byte-range streaming support. A single configurable bucket (`S3_BUCKET`, default `streamtube-videos`) with `videos/<videoId>/original.<ext>` and `thumbnails/<videoId>/thumb.jpg` prefixes keeps lifecycle rules and IAM policies clean while remaining 100% compatible with both MinIO (`forcePathStyle: true`) and AWS S3.

**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

### phase-03-videos/TD-02

**Recommendation:** Option A (`@nestjs/bullmq` + `bullmq` on Redis 7) — Provides first-party NestJS 11 integration via `@nestjs/bullmq` (`BullModule.forRootAsync`, `BullModule.registerQueue`, `@Processor`, `WorkerHost`), native exponential backoff retry management, stalled-job recovery for long-running FFmpeg tasks, and introduces the Redis container already planned in the target architecture.

**Libraries:** `@nestjs/bullmq@^11.x`, `bullmq@^5.x`

### phase-03-videos/TD-03

**Recommendation:** Option A (Direct-to-S3 Multipart Upload via Presigned URLs with Atomic Draft Pre-Registration) — Satisfies both the 10GB file size requirement (surpassing the 5GB single-PUT S3 limit via `CreateMultipartUploadCommand`, `UploadPartCommand` presigned URLs, and `CompleteMultipartUploadCommand`) and the zero-API-impact requirement (video bytes flow directly to S3/MinIO), while creating the `draft` video record atomically when the upload starts (`POST /videos/uploads/init`).

**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

### phase-03-videos/TD-04

**Recommendation:** Option A (Standalone `video-worker` Container + Direct `ffprobe`/`ffmpeg` via `execFile`) — Matches the target architecture diagram (`VideoWorker` container consuming `Queue`), guarantees zero CPU contention on the API container (`src/worker.ts` running `NestFactory.createApplicationContext`), and uses secure, shell-free `execFile` invocation of `ffprobe` (JSON metadata extraction of `duration_seconds`, `width`, `height`, `codec`) and `ffmpeg` (JPEG thumbnail frame extraction uploaded to `thumbnails/<videoId>/thumb.jpg`).

**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** Option A (`draft` → `processing` → `ready` | `failed` with BullMQ retries and `processing_error`) — Models pre-registration (`draft` on init), active background work (`processing` on upload completion + job enqueue), public readiness (`ready` once metadata and thumbnail are persisted), and terminal failure (`failed` with error message stored in `processing_error` after 3 exponential-backoff attempts or unrecoverable media error).

**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** Option A (11-Character Cryptographically Random Base64URL Slug) — Generated via `crypto.randomBytes(8).toString('base64url').slice(0, 11)` (`[A-Za-z0-9_-]{11}`), immutable across title edits, and guaranteed conflict-free via a pre-check retry loop in `VideosService` plus a PostgreSQL `UNIQUE` index on `videos.slug`.

**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** Option A (API-Proxied S3 Byte-Range Streaming `206 Partial Content` + Attachment Download) — `GET /videos/:slug/stream` parses `Range: bytes=start-end`, validates bounds (`416 Range Not Satisfiable` on invalid range), requests the exact byte slice from S3 via `GetObjectCommand({ Range })`, and streams it back with `206 Partial Content`, `Accept-Ranges: bytes`, `Content-Range`, and `Content-Length` without full-file buffering. `GET /videos/:slug/download` streams the full video with `Content-Disposition: attachment; filename="..."`, and `GET /videos/:slug/thumbnail` streams the generated JPEG thumbnail.

**Libraries:** `@aws-sdk/client-s3@^3.x`

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, zero custom wiring, native string-to-number coercion.

**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — Clear file boundaries per domain, typed injection via `ConfigType<typeof xxxConfig>`, natural scalability.

**Libraries:** —

### phase-02-auth/TD-02

**Recommendation:** Custom guards with `@nestjs/jwt` only — `JwtAuthGuard` registered globally via `APP_GUARD` in `AuthModule`, with `@Public()` decorator for public endpoints and `@CurrentUser()` param decorator returning `JwtPayload` (`{ sub, email }`).

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-06

**Recommendation:** Option A (`class-validator` + `class-transformer`) — Global `ValidationPipe` configured with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`.

**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — All domain exceptions extend `DomainException(errorCode, httpStatus, message)` and are formatted by `DomainExceptionFilter` into `{ statusCode, error, message }`.

**Libraries:** —

### openapi-docs-nestjs/TD-01..TD-04

**Recommendation:** `@nestjs/swagger` with CLI plugin (`nest-cli.json`), explicit `@ApiOperation`, `@ApiResponse`, `@ApiBearerAuth('access-token')`, and `ApiErrorEnvelope` decorators on all controllers, plus offline spec export via `npm run openapi:export` (`openapi.json`).

**Libraries:** `@nestjs/swagger@^11.x`

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories in `src/config/` (`storageConfig`, `queueConfig`) and Joi validation in `src/config/env.validation.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` runs with `autoLoadEntities: true` and `synchronize: false`; schema changes are managed exclusively through versioned migrations in `src/database/migrations/`. _(from phase 01)_
- `JwtAuthGuard` is registered globally via `APP_GUARD` in `AuthModule`; endpoints are authenticated by default (`@CurrentUser() user: JwtPayload`) and opt out explicitly with `@Public()`. _(from phase 02)_
- Domain errors extend `DomainException` in `src/common/exceptions/domain.exception.ts` and produce `{ statusCode, error, message }` via `DomainExceptionFilter`. _(from phase 02)_
- Each user has a 1:1 `Channel` (`channels.user_id` unique FK to `users.id`) managed by `ChannelsModule` / `ChannelsService`. _(from phase 02)_
- All HTTP controllers and DTOs carry `@nestjs/swagger` OpenAPI metadata (`@ApiTags`, `@ApiOperation`, `@ApiResponse`, `@ApiBearerAuth('access-token')`, `ApiErrorEnvelope`). _(from task-openapi-docs-nestjs)_
- All Docker services communicate via Docker Compose service hostnames (`db`, `mailpit`, `minio`, `redis`), never `localhost`. _(from phase 01 & CLAUDE.md)_

## Inherited Deferred Capabilities

| Capability | Original Phase | Status | Notes |
|------------|----------------|--------|-------|
| Telas de cadastro, login, confirmação de conta e recuperação de senha | Phase 02 | Implemented in `next-frontend/` later in Phase 02 | Out of scope for Phase 03 backend work. |

## Non-UI / Deferred Capabilities

| Capability | Status | Rationale | TD refs |
|------------|--------|-----------|---------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | non-UI | Backend infrastructure capability (S3/MinIO storage service). | phase-03-videos/TD-01 |
| Serviço de processamento em segundo plano (filas) | non-UI | Backend infrastructure capability (BullMQ/Redis queue + worker). | phase-03-videos/TD-02 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | non-UI | Backend API + S3 Multipart Presigned URL capability; upload UI belongs to Phase 04. | phase-03-videos/TD-03 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | non-UI | Backend domain/persistence behavior triggered on upload initiation. | phase-03-videos/TD-03, phase-03-videos/TD-05 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | non-UI | Asynchronous background worker (`video-worker` + `ffprobe`). | phase-03-videos/TD-04, phase-03-videos/TD-05 |
| Geração automática de thumbnail a partir de um frame do vídeo | non-UI | Asynchronous background worker (`video-worker` + `ffmpeg`). | phase-03-videos/TD-01, phase-03-videos/TD-04 |
| URL única por vídeo, sem conflito com outros vídeos | non-UI | Backend slug generation and unique persistence constraint. | phase-03-videos/TD-06 |
| Reprodução via streaming (sem necessidade de download completo) | non-UI | Backend HTTP Range (`206 Partial Content`) streaming endpoint; web player UI belongs to Phase 04. | phase-03-videos/TD-07 |
| Download do vídeo pelo usuário | non-UI | Backend attachment download endpoint (`GET /videos/:slug/download`). | phase-03-videos/TD-07 |

## Testing Requirements

Refer to the `testing-guide-nestjs-project` Skill for layer requirements per artifact type in `nestjs-project/`. Phase 03 introduces the `Video` entity and migration, `StorageService` (S3/MinIO integration), `VideosService` (upload orchestration, slug generation, streaming/download resolution), `VideoProcessor` & `FfmpegService` (BullMQ worker + real `ffmpeg`/`ffprobe` execution), and `VideosController` (upload init/parts/complete/abort, metadata, byte-range streaming, download, and thumbnail endpoints). Each layer must be verified by unit (`*.spec.ts`), integration (`*.integration-spec.ts` against real PostgreSQL, Redis, MinIO, and FFmpeg inside Docker), and E2E (`*.e2e-spec.ts` via Supertest) tests. Specific layer coverage by SI is recorded in `progress.md`.
