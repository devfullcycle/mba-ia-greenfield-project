---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-04-08T14:58:57-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-06-27T00:00:00-03:00"
  docs/phases/phase-02-auth/phase-02-auth.md: "2026-05-12T13:36:17-03:00"
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

**Out of scope:** Edição de informações do vídeo, categorias, visibilidade público/unlisted, fluxo de publicação, painel do canal (Fase 04); página de visualização com player e contagem de views (Fase 05); interações sociais (Fase 06). Toda a UI de vídeo no `next-frontend/` está fora do escopo desta fase.

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** `nestjs-project/`

**Deferred subprojects:** `next-frontend/` — a UI de upload e o player de vídeo ficam diferidos para fases futuras (04/05). O handshake de upload (TD-03) é um contrato de API que qualquer cliente consumirá.

**Sequencing notes:** Depends on Fase 01 (Configuração Base) e Fase 02 (canal do usuário — os vídeos pertencem a um canal).

**Neighbors (for boundary detection only):** Fase 02 — Cadastro, Login e Gerenciamento de Conta (prior), Fase 04 — Gerenciamento de Vídeos e Canal (next).

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | technical-decisions-phase-03-videos.md | Backend | Background Processing Queue Technology | decided | A (BullMQ + Redis) | bullmq@^5.x, @nestjs/bullmq@^11.x, ioredis (transitive) |
| phase-03-videos/TD-02 | technical-decisions-phase-03-videos.md | Backend | Object Storage Client and Bucket/Key Organization | decided | A (AWS SDK v3, single bucket + prefixes) | @aws-sdk/client-s3@^3.x, @aws-sdk/s3-request-presigner@^3.x |
| phase-03-videos/TD-03 | technical-decisions-phase-03-videos.md | Backend | 10GB Upload Protocol (non-blocking) | decided | A (presigned multipart, client → storage) | @aws-sdk/client-s3@^3.x, @aws-sdk/s3-request-presigner@^3.x |
| phase-03-videos/TD-04 | technical-decisions-phase-03-videos.md | Backend | Video Worker Runtime and FFmpeg Invocation | decided | A (dedicated worker + direct ffmpeg/ffprobe) | ffmpeg (system binary in worker image); node:child_process |
| phase-03-videos/TD-05 | technical-decisions-phase-03-videos.md | Backend | Unique Public Video URL Generation | decided | A (crypto base64url + unique column + retry) | node:crypto (built-in) |
| phase-03-videos/TD-06 | technical-decisions-phase-03-videos.md | Backend | Streaming and Download Delivery | decided | A (API range-proxy 206) | @aws-sdk/client-s3@^3.x |
| phase-03-videos/TD-07 | technical-decisions-phase-03-videos.md | Backend | Video Status Lifecycle and Failure Handling | decided | A (status enum + bounded retries) | bullmq@^5.x |

_Source files:_

- `docs/decisions/technical-decisions-phase-03-videos.md`

## Capability Coverage

| Capability | Covered by |
|------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-02 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-03 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-07 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-04, phase-03-videos/TD-07 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-04 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-05 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-06 |
| Download do vídeo pelo usuário | phase-03-videos/TD-06 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** Option A (BullMQ + Redis) — official NestJS queue technique with built-in retries/backoff and a clean worker-host consumer, directly serving "processing in background without blocking the user"; Redis is a light addition to Compose, and the architecture diagram already anticipates a dedicated message queue.

**Libraries:** `bullmq@^5.x`, `@nestjs/bullmq@^11.x`

### phase-03-videos/TD-02

**Recommendation:** Option A (AWS SDK v3, single bucket + prefixes) — keeps the dev→prod swap purely a matter of endpoint/credentials, supports the presigned multipart flow TD-03 needs, and uses prefixes to separate originals from thumbnails without multiplying buckets.

**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

### phase-03-videos/TD-03

**Recommendation:** Option A (presigned multipart, direct to storage) — the only option that satisfies 10GB without routing bytes through the API and gives part-level resumability; single PUT fails the 5GB cap and through-API streaming violates the explicit constraint.

**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

### phase-03-videos/TD-04

**Recommendation:** Option A (dedicated worker container, direct ffmpeg/ffprobe) — matches the target architecture (separate Video Worker), isolates heavy processing from the API, reuses the codebase, and keeps the FFmpeg surface to two explicit, testable commands with no extra runtime dependency.

**Libraries:** `ffmpeg` (system binary baked into the worker image), `node:child_process`

### phase-03-videos/TD-05

**Recommendation:** Option A (custom crypto base64url id + unique column + retry) — short, URL-friendly, strong identifier with no dependency and no ESM friction; the database unique constraint guarantees no conflicts.

**Libraries:** `node:crypto` (built-in)

### phase-03-videos/TD-06

**Recommendation:** Option A (API range-proxy with 206) — preserves one stable public URL per video, keeps storage private, gives full control over streaming/download semantics and authorization, and is directly testable; CDN/bandwidth offload is a later-phase optimization.

**Libraries:** `@aws-sdk/client-s3@^3.x`

### phase-03-videos/TD-07

**Recommendation:** Option A (`draft → processing → ready | error`, bounded retries → terminal error) — matches the assignment's stated cycle, keeps the state machine small and guardable, and uses BullMQ's retry/backoff to handle transient failures before committing to a terminal error state.

**Libraries:** `bullmq@^5.x`

## Inherited Decisions Detail

### phase-02-auth/TD-07 (Error Response Standardization)

**Recommendation:** Custom Domain Exception Filter returning `{ statusCode, error, message }` with machine-readable domain codes. Phase 03 reuses this filter and the `DomainException` base class for all video error codes.

### phase-01-configuracao-base/TD-03 (Config namespaces with registerAs)

**Recommendation:** Namespaced `registerAs` factories, one file per domain in `src/config/`. Phase 03 adds `storage.config.ts` and `queue.config.ts` following this pattern.

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. New: `storage.config.ts`, `queue.config.ts`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`; new storage/queue variables must be added there and to `.env.example`. _(from phase 01)_
- Config is injected via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for non-DI contexts (worker bootstrap, data-source). _(from phase 01)_
- `TypeOrmModule.forRootAsync` with `autoLoadEntities: true`, `synchronize: false`; new entities auto-discovered via `src/**/*.entity.ts`. _(from phase 01)_
- Every endpoint is protected by the global `JwtAuthGuard` (`APP_GUARD`) by default; public endpoints opt out with `@Public()`. The authenticated user is read via the `@CurrentUser()` decorator (`JwtPayload.sub` = user id). _(from phase 02)_
- HTTP errors use the standardized `{ statusCode, error, message }` envelope via `DomainExceptionFilter`; new domain errors extend `DomainException`. _(from phase 02)_
- Entities: `@Entity('table')`, UUID PK, `@CreateDateColumn`/`@UpdateDateColumn`, explicit column types, migrations generated via TypeORM CLI (never `synchronize`). _(from phase 02 / rules)_
- Rate limiting via global `ThrottlerGuard`. _(from phase 02)_

## Inherited Deferred Capabilities

_No inherited deferred capabilities relevant to this phase._

## Non-UI / Deferred Capabilities

| Capability | Status | Rationale | TD refs |
|------------|--------|-----------|---------|
| UI de upload e player de vídeo | deferred | `next-frontend/` video UI starts in Fase 04/05; Fase 03 is backend (API + worker + infra). | TD-03 (upload handshake is an API contract) |

## Testing Requirements

Refer to the `testing-guide-nestjs-project` Skill for layer requirements per artifact type. Phase 03 introduces: a new entity (`Video`) → integration tests; a storage service against real MinIO → integration tests; a queue producer + worker consumer against real Redis → integration tests; HTTP endpoints (upload init/complete, stream, download) → e2e tests via supertest; pure logic (public-id generator, status transitions, ffprobe output parsing) → unit tests. Do not mock storage, queue, or DB where the Compose infrastructure can exercise the real service. Specific layer coverage by SI is recorded in `progress.md`.
