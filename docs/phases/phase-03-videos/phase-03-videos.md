---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-07-12T20:19:48Z"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-12T19:54:34Z"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-07-12T18:21:39Z"
  docs/phases/phase-01-configuracao-base/context.md: "2026-07-12T18:21:39Z"
  docs/phases/phase-02-auth/context.md: "2026-07-12T18:21:39Z"
  docs/phases/phase-02-auth-frontend/context.md: "2026-07-12T18:21:39Z"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-07-12T18:21:38Z"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Implementar o sistema completo de upload e processamento de vídeos do StreamTube: armazenamento em Object Storage (MinIO/S3), fila de processamento assíncrono (BullMQ + Redis), worker FFmpeg para extração de duração, metadados e geração de thumbnail, e API REST para upload multipart pré-assinado de arquivos de até 10GB sem impacto na performance da API, reprodução via streaming e download com pre-signed GET URLs, e identificação pública única por vídeo via slug gerado com `crypto.randomBytes`.

---

## Step Implementations

### SI-03.1 — Infraestrutura: Docker Compose, config namespaces e variáveis de ambiente

**Description:** Adicionar serviços MinIO e Redis ao Docker Compose, criar config namespaces para storage e queue, e registrar as novas variáveis no schema Joi — base para todos os SIs subsequentes.

**Technical actions:**

1. Adicionar serviço `minio` (image: `minio/minio:latest`, portas 9000/9001, vars `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, comando `server /data --console-address ":9001"`) e serviço `redis` (image: `redis:7-alpine`, porta 6379) ao `nestjs-project/compose.yaml`
2. Criar `nestjs-project/src/config/storage.config.ts` com `registerAs('storage', () => ({ endpoint, port, accessKey, secretKey, bucketName, useSSL }))` — keys: `MINIO_ENDPOINT`, `MINIO_PORT` (default 9000), `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET_NAME`, `MINIO_USE_SSL` (default false) (per `phase-01-configuracao-base/TD-03`)
3. Criar `nestjs-project/src/config/queue.config.ts` com `registerAs('queue', () => ({ host, port }))` — keys: `REDIS_HOST`, `REDIS_PORT` (default 6379) (per `phase-01-configuracao-base/TD-03`)
4. Atualizar `nestjs-project/src/config/env.validation.ts` — adicionar ao schema Joi: `MINIO_ENDPOINT` (string required), `MINIO_PORT` (number default 9000), `MINIO_ACCESS_KEY` (string required), `MINIO_SECRET_KEY` (string required), `MINIO_BUCKET_NAME` (string required), `MINIO_USE_SSL` (boolean default false), `REDIS_HOST` (string required), `REDIS_PORT` (number default 6379) (per `phase-01-configuracao-base/TD-02`)
5. Atualizar `nestjs-project/.env.example` com os novos valores padrão para desenvolvimento local

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- `docker compose up -d` inicia 5 serviços (nestjs-api, db, mailpit, minio, redis) sem crash loop
- MinIO console acessível em `http://localhost:9001` (host)
- Redis acessível em `redis:6379` dentro da rede Docker Compose
- NestJS recusa inicialização quando `MINIO_ENDPOINT` está ausente do `.env` — Joi lança `ValidationError`

---

### SI-03.2 — Entidade Video e Migração de banco

**Description:** Criar a entidade Video com todos os campos do Data Model (per `### Data Model`), o enum de status e gerar a migração de banco de dados.

**Technical actions:**

1. Criar `nestjs-project/src/videos/enums/video-status.enum.ts` — `export enum VideoStatus { DRAFT = 'draft', PROCESSING = 'processing', READY = 'ready', ERROR = 'error' }`
2. Criar `nestjs-project/src/videos/entities/video.entity.ts` com `@Entity('videos')` e todos os campos do Data Model: `id` (uuid PK gerado), `channel_id` (uuid FK, not null), `title` (varchar 255, not null), `slug` (varchar 11, unique not null), `status` (enum VideoStatus, default DRAFT), `upload_id` (varchar 500, nullable), `storage_key` (varchar 500, not null), `thumbnail_key` (varchar 500, nullable), `duration_seconds` (int nullable), `metadata` (jsonb nullable), `error_message` (text nullable), `created_at` (timestamptz default now()), `updated_at` (timestamptz on update); `@ManyToOne(() => Channel, { eager: false })` + `@JoinColumn({ name: 'channel_id' })` (per `phase-01-configuracao-base/TD-03`)
3. Criar `nestjs-project/src/videos/videos.module.ts` shell com `TypeOrmModule.forFeature([Video])`
4. Registrar `VideosModule` no array `imports` de `AppModule`
5. Gerar migração `CreateVideos` com `npm run migration:generate -- src/database/migrations/CreateVideos`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` entity | Integration: unique constraint em `slug`; default `status = 'draft'`; NOT NULL em `storage_key`; FK `channel_id → channels.id` criada | `nestjs-project/src/videos/entities/video.entity.integration-spec.ts` |
| `VideosModule` | Unit: compilation via `Test.createTestingModule({ imports: [VideosModule] }).compile()` | `nestjs-project/src/videos/videos.module.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `npm run migration:run` aplica `CreateVideos` sem erro
- Dois `INSERT` com mesmo `slug` lançam erro de unique constraint no banco
- `INSERT` sem `status` persiste `'draft'` como padrão
- `INSERT` sem `storage_key` lança erro NOT NULL no banco
- `DELETE` de Channel com vídeos associados falha por FK constraint (sem cascade delete)

---

### SI-03.3 — Módulo de Storage (MinIO/S3)

**Description:** Implementar `StorageService` com toda a lógica de multipart upload pré-assinado e geração de pre-signed GET URLs usando `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (per `phase-03-videos/TD-07`).

**Technical actions:**

1. Instalar `@aws-sdk/client-s3 @aws-sdk/s3-request-presigner` como dependências de produção (per `phase-03-videos/TD-07`)
2. Criar `nestjs-project/src/storage/storage.service.ts` injetando `storageConfig` via `@Inject(storageConfig.KEY)` — métodos: `createMultipartUpload(key, contentType)` → `string` (UploadId, via `CreateMultipartUploadCommand`); `generatePartPresignedUrls(key, uploadId, partCount)` → `{partNumber, uploadUrl}[]` (via `UploadPartCommand` + `getSignedUrl`); `completeMultipartUpload(key, uploadId, parts)` → `void` (via `CompleteMultipartUploadCommand`); `generatePresignedGetUrl(key, expiresIn, responseContentDisposition?)` → `{url, expiresAt}` (via `GetObjectCommand` + `getSignedUrl`); `initializeBucket()` → `void` (via `HeadBucketCommand` + `CreateBucketCommand`) (per `phase-03-videos/TD-07`)
3. Criar `nestjs-project/src/storage/storage.module.ts` — imports `ConfigModule`; providers/exports `StorageService`; implementar `OnApplicationBootstrap` para chamar `storageService.initializeBucket()` no startup
4. Registrar `StorageModule` em `AppModule` e adicionar `storage.config.ts` ao `load` do `ConfigModule` (per `phase-01-configuracao-base/TD-03`)
5. Injetar `storageConfig.KEY` em `StorageService` via `@Inject(storageConfig.KEY)` e tipar como `ConfigType<typeof storageConfig>` (per `phase-01-configuracao-base/TD-03`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration: real MinIO — `createMultipartUpload`, `generatePartPresignedUrls`, `completeMultipartUpload` end-to-end; `generatePresignedGetUrl` retorna URL acessível com GET | `nestjs-project/src/storage/storage.service.integration-spec.ts` |
| `StorageModule` | Unit: compilation test via `Test.createTestingModule({ imports: [StorageModule] }).compile()` | `nestjs-project/src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.1 (config namespace `storage.config.ts`, serviço `minio` no compose.yaml)

**Acceptance criteria:**

- `StorageService.createMultipartUpload('test-key', 'video/mp4')` retorna string não-vazia (UploadId válido)
- `StorageService.generatePartPresignedUrls('test-key', uploadId, 3)` retorna array com 3 elementos, cada URL começando com `http://minio:9000/`
- `PUT` em uma das URLs de parte com payload de teste retorna 200 com header `ETag`
- `StorageService.completeMultipartUpload(key, uploadId, parts)` não lança erro — objeto consolida no MinIO
- `StorageService.generatePresignedGetUrl(key, 3600)` retorna URL cujo `GET` retorna 200
- `StorageModule.onApplicationBootstrap()` é idempotente — duas chamadas consecutivas não lançam erro

---

### SI-03.4 — Módulo de Fila (BullMQ + Redis)

**Description:** Implementar o módulo de fila usando `@nestjs/bullmq` + `bullmq` (per `phase-03-videos/TD-01`) com `VideoQueueService` para publicar jobs `process-video` na fila `video-processing`.

**Technical actions:**

1. Instalar `@nestjs/bullmq bullmq` como dependências de produção (per `phase-03-videos/TD-01`)
2. Criar `nestjs-project/src/queue/queue.constants.ts` — `export const QUEUES = { VIDEO_PROCESSING: 'video-processing' } as const` e `export const JOBS = { PROCESS_VIDEO: 'process-video' } as const` (per Events/Messages spec)
3. Criar `nestjs-project/src/queue/video-queue.service.ts` — interface `ProcessVideoPayload { videoId: string; storageKey: string; channelId: string; slug: string }`; método `publishProcessingJob(payload: ProcessVideoPayload): Promise<void>` que adiciona job `JOBS.PROCESS_VIDEO` à fila `QUEUES.VIDEO_PROCESSING` com `{ attempts: 3, backoff: { type: 'exponential', delay: 5000 } }` (per `phase-03-videos/TD-01` e Events/Messages spec)
4. Criar `nestjs-project/src/queue/queue.module.ts` — `BullModule.forRootAsync({ inject: [queueConfig.KEY], useFactory: (cfg: ConfigType<typeof queueConfig>) => ({ connection: { host: cfg.host, port: cfg.port } }) })`; `BullModule.registerQueue({ name: QUEUES.VIDEO_PROCESSING })`; providers e exports `VideoQueueService` (per `phase-01-configuracao-base/TD-03`)
5. Registrar `QueueModule` em `AppModule` e adicionar `queue.config.ts` ao `load` do `ConfigModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoQueueService` | Integration: real BullMQ + Redis — `publishProcessingJob` adiciona job à fila com nome `process-video` e payload correto (per `phase-03-videos/TD-01` — não mockar internals BullMQ) | `nestjs-project/src/queue/video-queue.service.integration-spec.ts` |
| `QueueModule` | Unit: compilation test via `Test.createTestingModule({ imports: [QueueModule] }).compile()` | `nestjs-project/src/queue/queue.module.spec.ts` |

**Dependencies:** SI-03.1 (config namespace `queue.config.ts`, serviço `redis` no compose.yaml)

**Acceptance criteria:**

- `VideoQueueService.publishProcessingJob({videoId, storageKey, channelId, slug})` não lança erro
- Job aparece na fila `video-processing` com nome `process-video` e payload exato `{videoId, storageKey, channelId, slug}`
- Job tem `opts.attempts === 3` e backoff exponencial de 5 000 ms
- `QueueModule` compila sem erro de DI no `Test.createTestingModule`

---

### SI-03.5 — Videos API: Criar rascunho e concluir upload

**Description:** Implementar `POST /videos` (cria rascunho e inicia multipart upload pré-assinado) e `POST /videos/:id/upload-complete` (finaliza upload e dispara processamento) per Tech Specs (per `phase-03-videos/TD-02`, `TD-05`).

**Route:** POST /videos
**Test Specs:** see `nestjs-project/specs/videos.plan.md`
**Authorization:** Authenticated (per `### Authorization Matrix`)

**Technical actions:**

1. Criar `nestjs-project/src/videos/dto/create-video.dto.ts` (title: string required max 255; file_name: string required; file_size: number int required 1–10_737_418_240; content_type: string optional default `'video/mp4'`) e `nestjs-project/src/videos/dto/upload-complete.dto.ts` (parts: array de `{part_number: number, etag: string}`, min 1 elemento)
2. Criar `nestjs-project/src/videos/videos.service.ts` — `createDraft(userId: string, dto: CreateVideoDto)`: busca canal via `ChannelsRepository` (ou `ChannelsService`) por `user_id`; lança `ChannelRequiredException` se não encontrado; gera `slug = crypto.randomBytes(8).toString('base64url')` (per `phase-03-videos/TD-05`); `storage_key = videos/${slug}/original`; calcula `partCount = Math.ceil(dto.file_size / PART_SIZE)` onde `PART_SIZE = 100_000_000` (100 MB); chama `StorageService.createMultipartUpload` e `generatePartPresignedUrls`; salva Video com `status = DRAFT` e `upload_id`; retorna `{id, slug, storage_key, parts, part_size: PART_SIZE}`
3. Adicionar `markUploadComplete(videoId: string, userId: string, dto: UploadCompleteDto)` ao `VideosService`: carrega Video com relação Channel; lança `VideoNotFoundException` se ausente; lança `VideoAccessDeniedException` se `video.channel.user_id !== userId`; lança `VideoInvalidStatusException` se `video.status !== DRAFT`; chama `StorageService.completeMultipartUpload(storage_key, upload_id, parts)`; atualiza `status = PROCESSING`, `upload_id = null`; publica job via `VideoQueueService.publishProcessingJob({videoId, storageKey, channelId, slug})`
4. Criar `nestjs-project/src/videos/videos.controller.ts` — `POST /videos` retorna 201 com corpo da resposta de `createDraft`; `POST /videos/:id/upload-complete` retorna 204; ambos com `@UseGuards(JwtAuthGuard)`; extrai `user.id` do request via `@Request()` (per `phase-02-auth/TD-06`)
5. Atualizar `nestjs-project/src/videos/videos.module.ts` — imports: `TypeOrmModule.forFeature([Video])`, `ChannelsModule`, `StorageModule`, `QueueModule`; providers: `VideosService`; exports: `VideosService`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.createDraft` | Unit: mock ChannelsRepository + mock StorageService — slug tem 11 chars, status inicial é `'draft'`, `storage_key = videos/{slug}/original`; lança `ChannelRequiredException` se sem canal | `nestjs-project/src/videos/videos.service.spec.ts` |
| `VideosService.markUploadComplete` | Unit: mock StorageService + mock VideoQueueService — lança `VideoAccessDeniedException` em ownership inválido; lança `VideoInvalidStatusException` em status não-draft; publica job em caso de sucesso | (mesmo arquivo) |

**Dependencies:** SI-03.2 (Video entity), SI-03.3 (StorageModule), SI-03.4 (QueueModule)

**Acceptance criteria:**

- `POST /videos` sem `Authorization` retorna 401
- `POST /videos` com JWT válido de usuário sem canal retorna 403 `errorCode: "CHANNEL_REQUIRED"`
- `POST /videos` com `file_size > 10_737_418_240` retorna 400 (validação DTO)
- `POST /videos` com payload válido retorna 201 com `id` (uuid), `slug` (11 chars base64url), `parts` (array não-vazio), `part_size` (100_000_000)
- `POST /videos/:id/upload-complete` com JWT de proprietário diferente retorna 403 `errorCode: "VIDEO_ACCESS_DENIED"`
- `POST /videos/:id/upload-complete` com vídeo em status `processing` retorna 409 `errorCode: "VIDEO_INVALID_STATUS"`
- `POST /videos/:id/upload-complete` com payload válido retorna 204; `video.status` é `'processing'` no banco; job `process-video` consta na fila Redis

---

### SI-03.6 — Worker: Processamento de Vídeos com FFmpeg

**Description:** Implementar o worker NestJS ApplicationContext (per `phase-03-videos/TD-03`) com `VideoProcessor` usando `fluent-ffmpeg` (per `phase-03-videos/TD-06`) para extrair metadados, duração e gerar thumbnail diretamente a partir de pre-signed URL do MinIO — sem download do arquivo completo.

**Technical actions:**

1. Instalar `fluent-ffmpeg @types/fluent-ffmpeg ffmpeg-static @ffprobe-installer/ffprobe` como dependências de produção (per `phase-03-videos/TD-06`); criar `Dockerfile.worker` baseado em `node:22-alpine` com `apk add --no-cache ffmpeg` para FFmpeg nativo no sistema
2. Criar `nestjs-project/src/worker/processors/video.processor.ts` — `@Processor(QUEUES.VIDEO_PROCESSING)` com `@Process(JOBS.PROCESS_VIDEO)`: (a) gera pre-signed URL do vídeo via `StorageService.generatePresignedGetUrl(storageKey, 3600)`; (b) extrai `duration` e `metadata` (codec, resolution, bitrate, fps) via `ffprobe(presignedUrl)` sem download do arquivo completo (per `phase-03-videos/TD-06`); (c) gera thumbnail a ~50% da duração via `fluent-ffmpeg(presignedUrl).screenshots({...})`; (d) faz upload do thumbnail via `StorageService`; (e) atualiza Video: `status = READY`, `duration_seconds`, `metadata`, `thumbnail_key`; em falha na tentativa final: `status = ERROR`, `error_message` (per `phase-03-videos/TD-01`)
3. Criar `nestjs-project/src/worker/worker.module.ts` — imports: `ConfigModule.forRoot({ load: [dbConfig, storageConfig, queueConfig] })`, `TypeOrmModule.forRootAsync(...)`, `StorageModule`, `QueueModule` (com `BullModule.registerQueue`), `VideosModule`; providers: `VideoProcessor`
4. Criar `nestjs-project/src/worker/main.ts` — `NestFactory.createApplicationContext(WorkerModule)` (per `phase-03-videos/TD-03`); `app.enableShutdownHooks()` para graceful shutdown via SIGTERM
5. Adicionar serviço `worker` ao `nestjs-project/compose.yaml` — build de `Dockerfile.worker`, depends_on: nestjs-api (healthcheck), minio, redis, db; env_file: `.env`; comando: `node dist/worker/main.js`; profile: `worker` para não iniciar em `docker compose up -d` padrão

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessor` | Unit: mock StorageService + mock VideoRepository + mock fluent-ffmpeg — caminho de sucesso (`status=ready`, `duration_seconds` populado, `thumbnail_key` definido) e caminho de erro (`status=error`, `error_message` não-nulo) | `nestjs-project/src/worker/processors/video.processor.spec.ts` |
| `WorkerModule` | Unit: compilation test | `nestjs-project/src/worker/worker.module.spec.ts` |

**Dependencies:** SI-03.2 (Video entity), SI-03.3 (StorageModule), SI-03.4 (QueueModule)

**Acceptance criteria:**

- `VideoProcessor` processa job `process-video` e atualiza `video.status` para `'ready'`
- Após processamento, `video.duration_seconds` é inteiro positivo
- Após processamento, `video.thumbnail_key` é string não-nula (e.g. `videos/{slug}/thumbnail.jpg`)
- Em caso de erro em todas as 3 tentativas, `video.status` é `'error'` e `video.error_message` é não-nulo
- `Dockerfile.worker` builda sem erro; worker inicia (`node dist/worker/main.js`) e loga pronto para processar

---

### SI-03.7 — Videos API: Endpoints de Recuperação (streaming e download)

**Description:** Implementar `GET /videos/:slug`, `GET /videos/:slug/stream-url` e `GET /videos/:slug/download-url` per Tech Specs (per `phase-03-videos/TD-04`).

**Route:** GET /videos/:slug
**Test Specs:** see `nestjs-project/specs/videos.plan.md`
**Authorization:** Public / Authenticated (per `### Authorization Matrix`)

**Technical actions:**

1. Adicionar `findBySlug(slug: string): Promise<Video>` ao `VideosService` — busca Video por slug com relação Channel; lança `VideoNotFoundException` se ausente
2. Adicionar `getStreamUrl(slug: string): Promise<{url: string, expiresAt: string}>` ao `VideosService` — chama `findBySlug`, valida `status === READY` (lança `VideoNotReadyException`); chama `StorageService.generatePresignedGetUrl(video.storage_key, 3600)`; retorna `{url, expiresAt}` (per `phase-03-videos/TD-04` — HTTP 206 range requests tratados nativamente pelo MinIO/S3)
3. Adicionar `getDownloadUrl(slug: string): Promise<{url: string, expiresAt: string}>` ao `VideosService` — mesma validação; chama `StorageService.generatePresignedGetUrl(video.storage_key, 300, 'attachment; filename="${video.title}"')` (per `phase-03-videos/TD-04`)
4. Adicionar ao `videos.controller.ts`: `GET /videos/:slug` (público — sem guard); `GET /videos/:slug/stream-url` (público); `GET /videos/:slug/download-url` (`@UseGuards(JwtAuthGuard)`); `GET /videos/:slug` retorna o Video com `thumbnail_url` (null ou pre-signed URL de 3600s gerada inline quando `thumbnail_key` não é null)
5. Registrar `VideoNotFoundException` e `VideoNotReadyException` como domain exceptions no exception filter existente (per `phase-02-auth/TD-07` — padrão de domain exceptions com `errorCode` no response body)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.findBySlug` | Unit: mock VideoRepository — retorna Video se existe; lança `VideoNotFoundException` se não existe | `nestjs-project/src/videos/videos.service.spec.ts` |
| `VideosService.getStreamUrl` | Unit: mock StorageService — valida status READY, retorna `{url, expiresAt}`; lança `VideoNotReadyException` se status ≠ ready | (mesmo arquivo) |
| `VideosService.getDownloadUrl` | Unit: mock StorageService — valida status READY, Content-Disposition `attachment` na URL (via parâmetro passado ao StorageService) | (mesmo arquivo) |

**Dependencies:** SI-03.5 (VideosService existe, controller estrutura definida, Video entity pronto)

**Acceptance criteria:**

- `GET /videos/slug-inexistente` retorna 404 com `errorCode: "VIDEO_NOT_FOUND"`
- `GET /videos/:slug` de vídeo em status `draft` retorna 200 com `status: "draft"` e `thumbnail_url: null`
- `GET /videos/:slug/stream-url` de vídeo em status `processing` retorna 409 com `errorCode: "VIDEO_NOT_READY"`
- `GET /videos/:slug/stream-url` de vídeo `ready` retorna 200 com `url` (string) e `expires_at` (ISO-8601)
- `GET /videos/:slug/download-url` sem `Authorization` retorna 401
- `GET /videos/:slug/download-url` de vídeo `ready` com JWT válido retorna 200 com `url` contendo `Content-Disposition=attachment` no query param de presign

---

## Technical Specifications

### Data Model

#### Video

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated |
| channel_id | uuid | FK → channels.id, not null |
| title | varchar(255) | not null |
| slug | varchar(11) | unique, not null |
| status | enum('draft','processing','ready','error') | not null, default 'draft' |
| upload_id | varchar(500) | nullable (set at multipart initiation; cleared after CompleteMultipartUpload) |
| storage_key | varchar(500) | not null (set at draft creation — e.g. `videos/{slug}/original`) |
| thumbnail_key | varchar(500) | nullable (set by worker after FFmpeg processing) |
| duration_seconds | integer | nullable (set by worker) |
| metadata | jsonb | nullable (codec, resolution, bitrate, frame rate — set by worker) |
| error_message | text | nullable (set by worker on final failure) |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | on update now() |

**Relations:** `Video` belongs to `Channel` (many-to-one via `channel_id`)
**Indexes:** unique on `slug`; index on `channel_id`; index on `status`

### API Contracts

#### POST /videos (SI-03.5)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {access_token}

**Request body:**
- title: string, required — max 255 characters
- file_name: string, required — original file name (stored in metadata, not used as storage key)
- file_size: integer, required — total file size in bytes; range 1–10_737_418_240 (10 GB)
- content_type: string, optional — MIME type of the video (default: `video/mp4`; must match `video/*`)

**Response 201:**
- id: string (uuid) — internal ID used to call `upload-complete`
- slug: string (11-char base64url — permanent public identifier for all retrieval endpoints)
- storage_key: string — object key used in MinIO/S3 (e.g. `videos/{slug}/original`)
- parts: array of `{ part_number: integer, upload_url: string }` — one per S3 multipart part; client PUTs each part and collects the ETag from the response header
- part_size: integer — size in bytes of each part except the last (last part may be smaller)

**Error responses:**
- 403 CHANNEL_REQUIRED: authenticated user has no channel
- 400 validation error: missing/invalid fields (title, file_size out of range, content_type not `video/*`)

---

#### POST /videos/:id/upload-complete (SI-03.5)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {access_token}

**Request body:**
- parts: array of `{ part_number: integer, etag: string }` — one per uploaded part; ETags as returned by MinIO/S3 in the ETag response header of each PUT

**Response 204:** No content. Video status transitions to `processing`; a `process-video` job is published to the `video-processing` queue.

**Error responses:**
- 404 VIDEO_NOT_FOUND: video with the given ID does not exist
- 403 VIDEO_ACCESS_DENIED: video does not belong to the authenticated user's channel
- 409 VIDEO_INVALID_STATUS: video status is not `draft` (e.g. already processing or complete)
- 400 validation error: missing or empty `parts` array

---

#### GET /videos/:slug (SI-03.7)

**Request headers:** none required (public endpoint)

**Response 200:**
- id: string (uuid)
- slug: string
- title: string
- status: string (`draft` | `processing` | `ready` | `error`)
- channel_id: string (uuid)
- duration_seconds: integer | null
- thumbnail_url: string | null (pre-signed GET URL, ~60 min validity; null when thumbnail not yet generated)
- created_at: string (ISO-8601)
- updated_at: string (ISO-8601)

**Error responses:**
- 404 VIDEO_NOT_FOUND

---

#### GET /videos/:slug/stream-url (SI-03.7)

**Request headers:** none required (public endpoint)

**Response 200:**
- url: string — pre-signed GET URL pointing to `storage_key`; MinIO/S3 handles HTTP 206 range requests natively; valid for 60 minutes
- expires_at: string (ISO-8601)

**Error responses:**
- 404 VIDEO_NOT_FOUND
- 409 VIDEO_NOT_READY: video status is not `ready`

---

#### GET /videos/:slug/download-url (SI-03.7)

**Request headers:**
- Authorization: Bearer {access_token}

**Response 200:**
- url: string — pre-signed GET URL with `Content-Disposition: attachment; filename="{title}"` header; valid for 5 minutes
- expires_at: string (ISO-8601)

**Error responses:**
- 401 Unauthorized: missing or invalid JWT
- 404 VIDEO_NOT_FOUND
- 409 VIDEO_NOT_READY: video status is not `ready`

### Authorization Matrix

| Endpoint | Anonymous | Authenticated | Owner |
|----------|-----------|---------------|-------|
| POST /videos | ✗ | ✓ (requires channel) | N/A |
| POST /videos/:id/upload-complete | ✗ | ✗ | ✓ |
| GET /videos/:slug | ✓ | ✓ | ✓ |
| GET /videos/:slug/stream-url | ✓ | ✓ | ✓ |
| GET /videos/:slug/download-url | ✗ | ✓ | ✓ |

### Error Catalog

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| VIDEO_NOT_FOUND | 404 | Vídeo com slug ou ID informado não existe |
| VIDEO_NOT_READY | 409 | Tentativa de obter URL de streaming/download de vídeo com status diferente de `ready` |
| VIDEO_ACCESS_DENIED | 403 | Tentativa de concluir upload de vídeo que não pertence ao canal do usuário autenticado |
| VIDEO_INVALID_STATUS | 409 | Tentativa de concluir upload de vídeo com status diferente de `draft` |
| CHANNEL_REQUIRED | 403 | Usuário autenticado não possui canal ao tentar criar vídeo |

### Events/Messages

#### process-video

**Payload:**

```json
{
  "videoId": "uuid",
  "storageKey": "string",
  "channelId": "uuid",
  "slug": "string"
}
```

**Producer:** `VideoQueueService.publishProcessingJob()` (per `phase-03-videos/TD-01`)
**Consumer:** `VideoProcessor` no processo worker (per `phase-03-videos/TD-01`, `TD-03`, `TD-06`)
**Queue:** `video-processing` (BullMQ + Redis — per `phase-03-videos/TD-01`)
**Trigger:** chamado por `VideosService.markUploadComplete()` após `CompleteMultipartUpload` bem-sucedido — video status muda de `draft` → `processing`
**Delivery semantics:** at-least-once (per `phase-03-videos/TD-01` — BullMQ padrão)
**Retry policy:** `maxAttempts: 3`; backoff exponencial iniciando em 5 000 ms; na terceira falha o worker grava `status: error` + `error_message` e não re-tenta

---

<!-- phase-a-complete -->

## Dependency Map

```
SI-03.1 — Infra (root)
├── SI-03.3 — Storage Module (depends on: SI-03.1)
└── SI-03.4 — Queue Module (depends on: SI-03.1)

SI-03.2 — Video Entity (root)

SI-03.2 + SI-03.3 + SI-03.4
├── SI-03.5 — Videos API: criar rascunho e concluir upload
└── SI-03.6 — Worker: processamento FFmpeg

SI-03.5
└── SI-03.7 — Videos API: endpoints de recuperação
```

**Ordem de implementação recomendada:** SI-03.1 → SI-03.2 → SI-03.3 → SI-03.4 → SI-03.5 → SI-03.6 → SI-03.7

---

## Deliverables

- [ ] SI-03.1 — Infraestrutura: Docker Compose, config namespaces e variáveis de ambiente
- [ ] SI-03.2 — Entidade Video e Migração de banco
- [ ] SI-03.3 — Módulo de Storage (MinIO/S3)
- [ ] SI-03.4 — Módulo de Fila (BullMQ + Redis)
- [ ] SI-03.5 — Videos API: Criar rascunho e concluir upload
- [ ] SI-03.6 — Worker: Processamento de Vídeos com FFmpeg
- [ ] SI-03.7 — Videos API: Endpoints de Recuperação (streaming e download)

**Full test suite (executar dentro do container):**

- [ ] Testes unitários e de integração: `docker compose exec nestjs-api npm test -- --runInBand`
- [ ] Testes E2E: `docker compose exec nestjs-api npm run test:e2e`
- [ ] TypeScript sem erros: `docker compose exec nestjs-api npx tsc --noEmit`
- [ ] Lint sem erros: `docker compose exec nestjs-api npm run lint`
