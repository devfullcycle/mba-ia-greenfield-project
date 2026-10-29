---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-28T09:13:53-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-28T09:13:49-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-28T08:40:20-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver large-file video upload (up to 10GB) via presigned S3 multipart, an object storage service for videos and thumbnails, a background processing queue and standalone worker that extracts duration/metadata and generates a thumbnail, a unique public identifier per video, and streaming and download delivery through presigned redirects.

---

## Step Implementations

### SI-03.1 — Dependências e configuração de storage e fila

**Description:** Instala as bibliotecas decididas e cria os namespaces de configuração `storage` e `queue`, validados por Joi, para que os demais SIs consumam endpoints, credenciais e TTLs tipados.

**Technical actions:**

1. Instalar `@nestjs/bullmq`, `bullmq`, `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner` em `nestjs-project/package.json` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-13`)
2. Criar `src/config/storage.config.ts` — `registerAs('storage', ...)` com `S3_ENDPOINT` (interno), `S3_PUBLIC_ENDPOINT` (assinatura), bucket, região, credenciais, TTLs de presign, tamanho fixo de parte (64 MiB) e tamanho máximo (10737418240 bytes) (per `phase-03-videos/TD-13`, `phase-03-videos/TD-12`)
3. Criar `src/config/queue.config.ts` — `registerAs('queue', ...)` com `QUEUE_HOST` e `QUEUE_PORT` (per `phase-03-videos/TD-01`)
4. Estender `src/config/env.validation.ts` com as chaves novas em Joi e registrar `storageConfig` e `queueConfig` no `load` de `ConfigModule.forRoot` em `src/app.module.ts` (per `phase-01-configuracao-base/TD-02`, `phase-01-configuracao-base/TD-03`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `envValidationSchema` | Integration: chaves obrigatórias e defaults do storage/queue | `src/config/env.validation.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- A aplicação falha na inicialização, listando a chave ausente, quando `S3_ENDPOINT` ou `S3_PUBLIC_ENDPOINT` não está definida
- `ConfigType<typeof storageConfig>` expõe o tamanho de parte e o tamanho máximo de 10GB sem valores hard-coded fora da config
- `QUEUE_HOST` resolve para o nome do serviço Compose, nunca `localhost`

---

### SI-03.2 — Infra: Redis, object storage e video-worker no Docker Compose

**Description:** Adiciona ao Compose o Redis com AOF, o gateway S3 (SeaweedFS), a criação do bucket com CORS e regra de lifecycle, e o container `video-worker` com FFmpeg instalado apenas na imagem do worker.

**Technical actions:**

1. Adicionar o serviço `redis` em `compose.yaml` com `--appendonly yes` e volume persistente (per `phase-03-videos/TD-01`)
2. Adicionar o serviço SeaweedFS com gateway S3 e um passo de bootstrap que cria o bucket, aplica CORS com `ExposeHeaders: ETag` e a regra de aborto de multipart incompleto; validar no spike os cinco recursos de TD-13 (CORS `ExposeHeaders`, multipart presign, `response-content-disposition`, lifecycle abort, `Range`) e, se algum falhar, usar MinIO apenas em dev (per `phase-03-videos/TD-13`, `phase-03-videos/TD-03`)
3. Criar o target `worker` em `Dockerfile.dev` com FFmpeg instalado; o target da API permanece sem FFmpeg (per `phase-03-videos/TD-04`)
4. Adicionar o serviço `video-worker` em `compose.yaml` — mesma base de código, comando de start do worker, `depends_on` de `db`, `redis` e do storage (per `phase-03-videos/TD-04`)
5. Espelhar as variáveis `S3_*` e `QUEUE_*` em `.env.example` e `.env`, usando os nomes de serviço Compose como host (per `phase-03-videos/TD-13`)

**Tests:** _(empty — Infra)_

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `docker compose ps` mostra `redis`, o serviço de storage e `video-worker` com status `running`
- O bucket configurado existe e aceita `CreateMultipartUpload` pelo endpoint interno
- Uma requisição `OPTIONS` ao endpoint público de storage retorna `ETag` em `Access-Control-Expose-Headers`
- `ffmpeg -version` executa no container `video-worker` e não existe no container `nestjs-api`

---

### SI-03.3 — Entidade Video e migration

**Description:** Cria a entidade `Video` com os estados de processamento e publicação, a migration correspondente e o `VideosModule` base.

**Technical actions:**

1. Criar `src/videos/entities/video.entity.ts` com os campos de `### Data Model → Video`, índice único em `publicId` e índice em `(processingStatus, updatedAt)` (per `phase-03-videos/TD-07`, `phase-03-videos/TD-10`)
2. Criar `src/videos/video.enums.ts` com `ProcessingStatus` (`UPLOADING`, `PROCESSING`, `READY`, `FAILED`) e `PublicationState` (`DRAFT`, `PUBLISHED`) (per `phase-03-videos/TD-10`)
3. Criar a migration `src/database/migrations/{timestamp}-CreateVideos.ts` com tabela, enums, FK para `channels` e índices
4. Adicionar a relação `videos` em `src/channels/entities/channel.entity.ts` (one-to-many)
5. Criar `src/videos/videos.module.ts` com `TypeOrmModule.forFeature([Video])` e importá-lo em `src/app.module.ts`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: constraints, defaults, unicidade de `publicId` | `src/videos/entities/video.entity.integration-spec.ts` |
| `VideosModule` | Unit: compilation test | `src/videos/videos.module.spec.ts` |
| Migration `CreateVideos` | Integration: aplica e reverte | `src/database/migrations.integration-spec.ts` |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- Inserir um `Video` sem `processingStatus` persiste com `UPLOADING` e `publicationState` `DRAFT`
- Inserir dois `Video` com o mesmo `publicId` viola a constraint única
- Inserir um `Video` com `channelId` inexistente viola a FK
- A migration `CreateVideos` aplica e reverte sem erro sobre o schema existente

---

### SI-03.4 — StorageModule: cliente S3 e presign

**Description:** Encapsula o AWS SDK v3 em um serviço que fala com o endpoint interno para I/O e assina URLs com o endpoint público.

**Technical actions:**

1. Criar `src/storage/storage.constants.ts` com os tokens do cliente interno e do cliente de assinatura (per `phase-03-videos/TD-13`)
2. Criar `src/storage/storage.module.ts` — provê dois `S3Client` a partir de `storageConfig` com `forcePathStyle: true`, um com `S3_ENDPOINT` e outro com `S3_PUBLIC_ENDPOINT` (per `phase-03-videos/TD-13`)
3. Criar `src/storage/storage.service.ts` com `createMultipartUpload`, `completeMultipartUpload`, `abortMultipartUpload`, `headObject`, `getObjectToFile` e `putObject` sobre o cliente interno (per `phase-03-videos/TD-02`, `phase-03-videos/TD-05`)
4. Adicionar a `StorageService` `presignUploadPart(key, uploadId, partNumber)` e `presignGet(key, { downloadFilename? })`, assinados com o cliente público; o download inclui `ResponseContentDisposition` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-08`, `phase-03-videos/TD-09`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration: multipart completo, head, presign GET e `Range` contra o storage do Compose | `src/storage/storage.service.integration-spec.ts` |
| `StorageModule` | Unit: compilation test | `src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.1, SI-03.2

**Acceptance criteria:**

- Uma URL de `presignGet` gerada para um objeto existente retorna `200` ao ser requisitada e `206` com cabeçalho `Range`
- Uma URL de `presignGet` com `downloadFilename` retorna `Content-Disposition: attachment; filename="..."`
- O host das URLs assinadas é o de `S3_PUBLIC_ENDPOINT`, nunca o de `S3_ENDPOINT`
- Um multipart upload criado, com parte enviada por URL pré-assinada e completado, resulta em objeto cujo `headObject` retorna o tamanho enviado

---

### SI-03.5 — QueueModule: fila video-processing e producer

**Description:** Registra a conexão BullMQ/Redis e a fila `video-processing`, com retry e backoff fixados, e expõe um producer idempotente de `process-video`.

**Technical actions:**

1. Criar `src/queue/queue.constants.ts` com `VIDEO_PROCESSING_QUEUE`, `PROCESS_VIDEO_JOB` e `SWEEP_STALE_UPLOADS_JOB` (per `phase-03-videos/TD-01`)
2. Criar `src/queue/queue.module.ts` — `BullModule.forRootAsync` lendo `queueConfig` e `BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE })` com `defaultJobOptions` `attempts: 3`, `backoff` exponencial de 5000 ms e `removeOnFail: false` para manter o conjunto de falhas como DLQ (per `phase-03-videos/TD-01`)
3. Criar `src/queue/video-processing.producer.ts` com `enqueueProcessVideo(videoId)` usando `jobId` igual ao `id` do vídeo para deduplicar (per `phase-03-videos/TD-01`, `phase-03-videos/TD-06`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingProducer` | Integration: enfileira no Redis real e deduplica por `jobId` | `src/queue/video-processing.producer.integration-spec.ts` |
| `QueueModule` | Unit: compilation test | `src/queue/queue.module.spec.ts` |

**Dependencies:** SI-03.1, SI-03.2

**Acceptance criteria:**

- Duas chamadas a `enqueueProcessVideo` com o mesmo `videoId` resultam em um único job na fila
- Um job enfileirado carrega `{ videoId }` como payload e `attempts: 3` com backoff exponencial
- Um job que esgota as tentativas permanece no conjunto de falhas

---

### SI-03.6 — Endpoint POST /videos

**Description:** Inicia o upload: valida os metadados declarados, cria o vídeo como rascunho e o multipart upload no storage.

**Route:** POST /videos
**Test Specs:** see `nestjs-project/specs/videos-init-upload.plan.md`
**Authorization:** Authenticated (owner do canal do usuário)

**Technical actions:**

1. Criar `src/videos/dto/init-upload.dto.ts` com `originalFilename`, `contentType` e `sizeBytes` e as validações de `### API Contracts → POST /videos` (per `phase-03-videos/TD-12`, `phase-02-auth/TD-06`)
2. Criar `src/videos/public-id.util.ts` — gera 11 caracteres URL-safe via `crypto.randomBytes` em base64url, sem nova dependência (per `phase-03-videos/TD-07`)
3. Criar `VideosService.initUpload` em `src/videos/videos.service.ts` — valida allowlist e tamanho, resolve o canal do usuário, cria o `Video` com retry em colisão de `publicId`, define `objectKey` `videos/{id}/original.{ext}` e chama `StorageService.createMultipartUpload` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-03`, `phase-03-videos/TD-07`, `phase-03-videos/TD-10`)
4. Adicionar a `ChannelsService` a busca do canal por `user_id` e criar `VideosController` com `POST /videos` (per `phase-03-videos/TD-11`)
5. Criar `VideoTooLargeException` e `UnsupportedVideoTypeException` em `src/common/exceptions/domain.exception.ts` com os códigos de `### Error Catalog` (per `phase-02-auth/TD-07`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `generatePublicId` | Unit: tamanho, alfabeto URL-safe | `src/videos/public-id.util.spec.ts` |
| `VideosService.initUpload` | Unit: branch logic (allowlist, tamanho, retry de colisão; repo e storage mockados) | `src/videos/videos.service.spec.ts` |
| `VideosService.initUpload` | Integration: persistência do rascunho e unicidade de `publicId` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.3, SI-03.4

**Acceptance criteria:**

- `POST /videos` com `originalFilename`, `contentType` na allowlist e `sizeBytes` válido retorna `201` com `id`, `partSizeBytes`, `partCount` e `processingStatus` `UPLOADING`
- `POST /videos` cria um `Video` com `publicationState` `DRAFT` e `uploadId` preenchido
- `POST /videos` com `sizeBytes` acima de 10737418240 retorna `413` com `error: "VIDEO_TOO_LARGE"`
- `POST /videos` com `contentType` fora da allowlist retorna `415` com `error: "UNSUPPORTED_VIDEO_TYPE"`
- `POST /videos` sem token retorna `401`
- `POST /videos` com corpo sem `originalFilename` retorna `400`

---

### SI-03.7 — Endpoint POST /videos/{id}/parts

**Description:** Assina as URLs pré-assinadas de `UploadPart` para as partes solicitadas, para que o navegador envie os bytes direto ao storage.

**Route:** POST /videos/{id}/parts
**Test Specs:** see `nestjs-project/specs/videos-sign-parts.plan.md`
**Authorization:** Owner

**Technical actions:**

1. Criar `src/videos/dto/sign-parts.dto.ts` com `partNumbers` e o limite de lote por requisição (per `phase-03-videos/TD-02`)
2. Criar `VideosService.signParts` — carrega o vídeo por `publicId`, verifica dono e `processingStatus` `UPLOADING`, valida a faixa de `partNumbers` e assina cada parte com `StorageService.presignUploadPart` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-13`)
3. Adicionar `POST /videos/:id/parts` a `VideosController`
4. Criar `VideoNotFoundException`, `VideoForbiddenException` e `UploadNotInProgressException` em `src/common/exceptions/domain.exception.ts` (per `phase-02-auth/TD-07`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.signParts` | Unit: branch logic (dono, status, faixa de partes; repo e storage mockados) | `src/videos/videos.service.spec.ts` |

**Dependencies:** SI-03.6

**Acceptance criteria:**

- `POST /videos/{id}/parts` com `partNumbers` válidos retorna `200` com uma URL por parte e `expiresInSeconds`
- `POST /videos/{id}/parts` por usuário que não é o dono retorna `403` com `error: "VIDEO_FORBIDDEN"`
- `POST /videos/{id}/parts` com `publicId` inexistente retorna `404` com `error: "VIDEO_NOT_FOUND"`
- `POST /videos/{id}/parts` para vídeo fora de `UPLOADING` retorna `409` com `error: "UPLOAD_NOT_IN_PROGRESS"`
- `POST /videos/{id}/parts` com `partNumbers` vazio retorna `400`

---

### SI-03.8 — Endpoint POST /videos/{id}/complete

**Description:** Completa o multipart upload, verifica o objeto armazenado, move o vídeo para `PROCESSING` e publica o job `process-video` de forma idempotente.

**Route:** POST /videos/{id}/complete
**Test Specs:** see `nestjs-project/specs/videos-complete-upload.plan.md`
**Authorization:** Owner

**Technical actions:**

1. Criar `src/videos/dto/complete-upload.dto.ts` com `parts` (`partNumber`, `etag`) (per `phase-03-videos/TD-02`)
2. Criar `VideosService.completeUpload` — verifica dono; se o vídeo já saiu de `UPLOADING`, retorna o estado atual sem novo job; senão chama `completeMultipartUpload`, confere com `headObject` que o tamanho é `sizeBytes`, grava `PROCESSING`, zera `uploadId` e chama `enqueueProcessVideo` (per `phase-03-videos/TD-06`, `phase-03-videos/TD-12`)
3. Adicionar `POST /videos/:id/complete` a `VideosController` com resposta `202`
4. Criar `UploadIncompleteException` em `src/common/exceptions/domain.exception.ts` (per `phase-02-auth/TD-07`)
5. Importar `StorageModule` e `QueueModule` em `VideosModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.completeUpload` | Unit: branch logic (idempotência, tamanho divergente, ordem storage/DB/fila; colaboradores mockados) | `src/videos/videos.service.spec.ts` |
| `VideosService.completeUpload` | Integration: transição de status e job real no Redis | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.5, SI-03.7

**Acceptance criteria:**

- `POST /videos/{id}/complete` com todas as partes retorna `202` com `processingStatus` `PROCESSING`
- Após `complete`, existe exatamente um job `process-video` com o `id` do vídeo na fila
- `POST /videos/{id}/complete` repetido retorna `202` sem criar um segundo job
- `POST /videos/{id}/complete` quando o objeto armazenado tem tamanho diferente de `sizeBytes` retorna `409` com `error: "UPLOAD_INCOMPLETE"`
- `POST /videos/{id}/complete` por usuário que não é o dono retorna `403` com `error: "VIDEO_FORBIDDEN"`

---

### SI-03.9 — Video worker: entrypoint e processamento do vídeo

**Description:** Cria o entrypoint standalone do worker e o processor `process-video`, que extrai duração e metadados, gera a thumbnail e marca o vídeo como `READY` ou `FAILED`.

**Technical actions:**

1. Criar `src/worker/worker.ts` e `src/worker/worker.module.ts` — `NestFactory.createApplicationContext` sem listener HTTP, importando config, TypeORM, `StorageModule` e `QueueModule`; adicionar o script `start:worker` em `package.json` (per `phase-03-videos/TD-04`)
2. Criar `src/worker/media-probe.service.ts` — `ffprobe` e `ffmpeg` via `execFile` sobre URL pré-assinada, frame em ~10% da duração limitado para vídeos curtos, com fallback automático para download em arquivo temporário (per `phase-03-videos/TD-05`)
3. Criar `src/worker/video.processor.ts` — `@Processor(VIDEO_PROCESSING_QUEUE)` que ignora vídeos já `READY`, valida que o arquivo tem stream de vídeo, grava `durationSeconds` e `metadata`, envia `videos/{id}/thumbnail.jpg` e define `READY` (per `phase-03-videos/TD-05`, `phase-03-videos/TD-10`, `phase-03-videos/TD-12`, `phase-03-videos/TD-03`)
4. Tratar o evento `failed` do processor: só após esgotar `attempts`, define `FAILED` e `failureReason` (per `phase-03-videos/TD-10`, `phase-03-videos/TD-12`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `MediaProbeService` | Unit: montagem de argumentos, clamp do frame e fallback (execFile mockado) | `src/worker/media-probe.service.spec.ts` |
| `VideoProcessor` | Unit: branch logic (idempotência, arquivo inválido, falha final; repo, storage e probe mockados) | `src/worker/video.processor.spec.ts` |
| `VideoProcessor` | Integration: DB real e storage do Compose com vídeo de fixture | `src/worker/video.processor.integration-spec.ts` |

**Dependencies:** SI-03.3, SI-03.4, SI-03.5

**Acceptance criteria:**

- Processar um vídeo `PROCESSING` válido define `READY`, preenche `durationSeconds` e `metadata` e cria o objeto `videos/{id}/thumbnail.jpg` no storage
- Processar um vídeo já `READY` não altera `durationSeconds` nem recria a thumbnail
- Um arquivo sem stream de vídeo, após esgotar as tentativas, resulta em `processingStatus` `FAILED` com `failureReason` preenchido
- Uma falha antes de esgotar as tentativas mantém `processingStatus` `PROCESSING`
- O processo do worker inicia sem abrir porta HTTP

---

### SI-03.10 — Endpoint GET /videos/{id}/stream e VideoAccessPolicy

**Description:** Redireciona para uma URL pré-assinada de leitura, mantendo a API fora do caminho dos dados, atrás de uma `VideoAccessPolicy` única.

**Route:** GET /videos/{id}/stream
**Test Specs:** see `nestjs-project/specs/videos-stream.plan.md`
**Authorization:** Anonymous (apenas vídeos `READY`)

**Technical actions:**

1. Criar `src/videos/video-access.policy.ts` — `VideoAccessPolicy.canAccess(video)` permite acesso público apenas a `READY`; ponto único que a Fase 04 endurece (per `phase-03-videos/TD-11`)
2. Criar `VideosService.getStreamUrl` — carrega por `publicId`, aplica a policy e chama `presignGet` com TTL de leitura superior ao tempo típico de exibição (per `phase-03-videos/TD-08`, `phase-03-videos/TD-11`)
3. Adicionar `GET /videos/:id/stream` a `VideosController` com `@Public()` e resposta `302` com `Location`
4. Criar `VideoNotReadyException` em `src/common/exceptions/domain.exception.ts` (per `phase-02-auth/TD-07`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoAccessPolicy` | Unit: branch logic por `processingStatus` | `src/videos/video-access.policy.spec.ts` |
| `VideosService.getStreamUrl` | Unit: branch logic (não encontrado, não pronto, pronto; collaborators mockados) | `src/videos/videos.service.spec.ts` |

**Dependencies:** SI-03.4, SI-03.8

**Acceptance criteria:**

- `GET /videos/{id}/stream` de um vídeo `READY`, sem token, retorna `302` com `Location` apontando ao endpoint público de storage
- Seguir o `Location` com cabeçalho `Range` retorna `206`
- `GET /videos/{id}/stream` de um vídeo `PROCESSING` retorna `409` com `error: "VIDEO_NOT_READY"`
- `GET /videos/{id}/stream` com `publicId` inexistente retorna `404` com `error: "VIDEO_NOT_FOUND"`

---

### SI-03.11 — Endpoint GET /videos/{id}/download

**Description:** Redireciona para uma URL pré-assinada que força o download com o nome original do arquivo.

**Route:** GET /videos/{id}/download
**Test Specs:** see `nestjs-project/specs/videos-download.plan.md`
**Authorization:** Anonymous (apenas vídeos `READY`)

**Technical actions:**

1. Criar `VideosService.getDownloadUrl` — reutiliza `VideoAccessPolicy` e chama `presignGet` com `downloadFilename` igual a `originalFilename` (per `phase-03-videos/TD-09`, `phase-03-videos/TD-11`)
2. Adicionar `GET /videos/:id/download` a `VideosController` com `@Public()` e resposta `302` com `Location`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.getDownloadUrl` | Unit: branch logic (não encontrado, não pronto, nome do arquivo no presign; collaborators mockados) | `src/videos/videos.service.spec.ts` |

**Dependencies:** SI-03.10

**Acceptance criteria:**

- `GET /videos/{id}/download` de um vídeo `READY` retorna `302` com `Location` cuja resposta traz `Content-Disposition: attachment` com o `originalFilename`
- `GET /videos/{id}/download` de um vídeo fora de `READY` retorna `409` com `error: "VIDEO_NOT_READY"`
- `GET /videos/{id}/download` com `publicId` inexistente retorna `404` com `error: "VIDEO_NOT_FOUND"`

---

### SI-03.12 — Sweeper de uploads travados

**Description:** Registra um job repetível que aborta uploads travados em `UPLOADING` e os marca como `FAILED`, cobrindo o caso em que o cliente nunca chama `complete`.

**Technical actions:**

1. Criar `src/worker/stale-upload.sweeper.ts` — busca vídeos em `UPLOADING` com `updatedAt` anterior a 24 horas, chama `abortMultipartUpload`, zera `uploadId` e define `FAILED` com `failureReason` (per `phase-03-videos/TD-10`, `phase-03-videos/TD-03`)
2. Registrar o job repetível `sweep-stale-uploads` a cada 15 minutos no bootstrap do worker via job scheduler do BullMQ e roteá-lo no processor (per `phase-03-videos/TD-01`, `phase-03-videos/TD-10`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StaleUploadSweeper` | Unit: branch logic (limite de 24h, falha no abort; repo e storage mockados) | `src/worker/stale-upload.sweeper.spec.ts` |
| `StaleUploadSweeper` | Integration: DB real e storage do Compose | `src/worker/stale-upload.sweeper.integration-spec.ts` |

**Dependencies:** SI-03.9

**Acceptance criteria:**

- Um vídeo `UPLOADING` com `updatedAt` há mais de 24 horas passa a `FAILED` com `failureReason` e `uploadId` nulo após o sweeper
- Um vídeo `UPLOADING` atualizado há menos de 24 horas permanece `UPLOADING`
- O multipart upload do vídeo varrido deixa de existir no storage
- Após o bootstrap do worker existe um único scheduler `sweep-stale-uploads` com intervalo de 15 minutos, mesmo após reinícios

---

## Technical Specifications

### Data Model

#### Video

Per `phase-03-videos/TD-02`, `TD-03`, `TD-05`, `TD-07`, `TD-10`, `TD-12`. Created as a draft at upload init (capability "pré-cadastro automático do vídeo como rascunho").

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated |
| publicId | varchar(11) | unique, not null — short random URL-safe id (per `phase-03-videos/TD-07`); the unique index is the uniqueness guarantee, generation retries on collision |
| channelId | uuid | FK → `Channel.id`, not null — owner of the upload (per `phase-03-videos/TD-11`; ownership entity is not fixed by a TD, `Channel` follows the project data model) |
| originalFilename | varchar(255) | not null — declared at init, used for `response-content-disposition` on download (per `phase-03-videos/TD-09`) |
| contentType | varchar(100) | not null — validated against the narrow MIME/extension allowlist (per `phase-03-videos/TD-12`) |
| sizeBytes | bigint | not null — declared at init, verified against the stored object at complete (per `phase-03-videos/TD-12`) |
| objectKey | varchar(512) | not null — `videos/{id}/original.{ext}` (per `phase-03-videos/TD-03`) |
| uploadId | varchar(255) | nullable — S3 multipart `UploadId`, cleared once the upload completes or is aborted (per `phase-03-videos/TD-02`) |
| processingStatus | enum (`UPLOADING`, `PROCESSING`, `READY`, `FAILED`) | not null, default `UPLOADING` (per `phase-03-videos/TD-10`) |
| publicationState | enum (`DRAFT`, `PUBLISHED`) | not null, default `DRAFT` — only `DRAFT` is written in this phase; `PUBLISHED` is introduced by Phase 04 (per `phase-03-videos/TD-10`) |
| failureReason | varchar(255) | nullable — set when `processingStatus = FAILED` (per `phase-03-videos/TD-12`) |
| durationSeconds | numeric | nullable — filled by the worker (per `phase-03-videos/TD-05`) |
| metadata | jsonb | nullable — ffprobe-extracted metadata; persisted columns are not fixed by a TD (per `phase-03-videos/TD-05`) |
| createdAt | timestamptz | default now() |
| updatedAt | timestamptz | default now(), updated on change — drives the stale-upload sweeper (per `phase-03-videos/TD-10`) |

**Relations:** `Channel` has many `Video` (one-to-many)
**Indexes:** unique on `publicId`; index on `(processingStatus, updatedAt)` for the stale-upload sweeper; index on `channelId`

The thumbnail has no column: its key is derivable as `videos/{id}/thumbnail.jpg` (per `phase-03-videos/TD-03`).

### API Contracts

Path parameter `{id}` is the video's `publicId` in every endpoint below (per `phase-03-videos/TD-11`). Error body shape is inherited: `{ statusCode, error, message }` with domain codes (per `phase-02-auth/TD-07`). Upload is S3 multipart with presigned URLs per part, so file bytes never pass through the API (per `phase-03-videos/TD-02`).

#### POST /videos (SI-03.6)

Initiates an upload: validates declared metadata, creates the `Video` draft (`processingStatus = UPLOADING`, `publicationState = DRAFT`) and the S3 multipart upload (per `phase-03-videos/TD-02`, `TD-10`, `TD-12`).

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {accessToken}

**Request body:**
- originalFilename: string, required — max 255 characters
- contentType: string, required — must be in the MIME/extension allowlist (per `phase-03-videos/TD-12`)
- sizeBytes: integer, required — min 1, max 10737418240 (10GB)

**Response 201:**
- id: string (the video's `publicId`)
- partSizeBytes: integer — server-fixed part size (per `phase-03-videos/TD-12`)
- partCount: integer — `ceil(sizeBytes / partSizeBytes)`
- processingStatus: string (`UPLOADING`)

**Error responses:**
- 401 UNAUTHORIZED: when the access token is missing or invalid
- 400 validation error: when the request body fails validation
- 413 VIDEO_TOO_LARGE: when `sizeBytes` exceeds the 10GB limit
- 415 UNSUPPORTED_VIDEO_TYPE: when `contentType` or the filename extension is outside the allowlist

---

#### POST /videos/{id}/parts (SI-03.7)

Signs presigned `UploadPart` URLs for the requested part numbers. The URL host is the public storage endpoint, since the host is part of the signature (per `phase-03-videos/TD-13`).

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {accessToken}

**Request body:**
- partNumbers: integer[], required — each between 1 and `partCount`, at most one batch per request (batch size is set in SI-03.7)

**Response 200:**
- parts: array of `{ partNumber: integer, url: string }`
- expiresInSeconds: integer — presign TTL from configuration (per `phase-03-videos/TD-13`)

**Error responses:**
- 401 UNAUTHORIZED: when the access token is missing or invalid
- 403 VIDEO_FORBIDDEN: when the authenticated user does not own the video
- 404 VIDEO_NOT_FOUND: when no video has the given `publicId`
- 409 UPLOAD_NOT_IN_PROGRESS: when `processingStatus` is not `UPLOADING`
- 400 validation error: when `partNumbers` is empty or contains an out-of-range value

---

#### POST /videos/{id}/complete (SI-03.8)

Completes the multipart upload, verifies the stored object, moves the video to `PROCESSING` and publishes the `process-video` job. Idempotent: repeating the call for a video already past `UPLOADING` returns the current state without publishing a second job (per `phase-03-videos/TD-06`, `TD-12`).

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {accessToken}

**Request body:**
- parts: array of `{ partNumber: integer, etag: string }`, required — one entry per uploaded part

**Response 202:**
- id: string (the video's `publicId`)
- processingStatus: string (`PROCESSING`)

**Error responses:**
- 401 UNAUTHORIZED: when the access token is missing or invalid
- 403 VIDEO_FORBIDDEN: when the authenticated user does not own the video
- 404 VIDEO_NOT_FOUND: when no video has the given `publicId`
- 409 UPLOAD_INCOMPLETE: when the stored object is missing, or its size differs from the declared `sizeBytes`
- 400 validation error: when `parts` is empty or malformed

---

#### GET /videos/{id}/stream (SI-03.10)

Redirects to a presigned GET URL so the API stays out of the data path; the storage engine serves `Range` requests (per `phase-03-videos/TD-08`).

**Response 302:**
- Location: presigned GET URL for `videos/{id}/original.{ext}`; TTL must exceed typical watch time (per `phase-03-videos/TD-08`)

**Error responses:**
- 404 VIDEO_NOT_FOUND: when no video has the given `publicId`
- 409 VIDEO_NOT_READY: when `processingStatus` is not `READY`

---

#### GET /videos/{id}/download (SI-03.11)

Redirects to a presigned GET URL carrying `response-content-disposition` with the stored `originalFilename` (per `phase-03-videos/TD-09`).

**Response 302:**
- Location: presigned GET URL with `response-content-disposition: attachment; filename="{originalFilename}"`

**Error responses:**
- 404 VIDEO_NOT_FOUND: when no video has the given `publicId`
- 409 VIDEO_NOT_READY: when `processingStatus` is not `READY`

### Authorization Matrix

Upload endpoints require an authenticated owner; stream and download are public by `publicId` for `READY` videos, behind a single `VideoAccessPolicy` seam that Phase 04 tightens (per `phase-03-videos/TD-11`).

| Endpoint | Anonymous | Authenticated | Owner |
|----------|-----------|---------------|-------|
| POST /videos | ✗ | ✓ | ✓ |
| POST /videos/{id}/parts | ✗ | ✗ | ✓ |
| POST /videos/{id}/complete | ✗ | ✗ | ✓ |
| GET /videos/{id}/stream | ✓ (READY only) | ✓ (READY only) | ✓ (READY only) |
| GET /videos/{id}/download | ✓ (READY only) | ✓ (READY only) | ✓ (READY only) |

### Error Catalog

Response shape is inherited from `phase-02-auth/TD-07`: `{ statusCode, error, message }`, where `error` carries the domain code. The codes below are defined by this phase.

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| VIDEO_TOO_LARGE | 413 | `POST /videos` with `sizeBytes` above the 10GB limit (per `phase-03-videos/TD-12`) |
| UNSUPPORTED_VIDEO_TYPE | 415 | `POST /videos` with a `contentType` or extension outside the allowlist (per `phase-03-videos/TD-12`) |
| VIDEO_NOT_FOUND | 404 | Any `/videos/{id}` endpoint with an unknown `publicId` |
| VIDEO_FORBIDDEN | 403 | `parts` or `complete` called by a user who does not own the video (per `phase-03-videos/TD-11`) |
| UPLOAD_NOT_IN_PROGRESS | 409 | `POST /videos/{id}/parts` for a video whose `processingStatus` is not `UPLOADING` |
| UPLOAD_INCOMPLETE | 409 | `POST /videos/{id}/complete` when the stored object is missing or its size differs from `sizeBytes` (per `phase-03-videos/TD-12`) |
| VIDEO_NOT_READY | 409 | `stream` or `download` for a video whose `processingStatus` is not `READY` (per `phase-03-videos/TD-11`) |

Worker-side failures are not HTTP errors: they set `processingStatus = FAILED` and a `failureReason` after retries are exhausted (per `phase-03-videos/TD-10`, `TD-12`).

### Events/Messages

Queue: BullMQ on Redis, queue name `video-processing` (per `phase-03-videos/TD-01`). Both events below are Backend-only.

#### process-video

**Payload:**

```json
{ "videoId": "uuid" }
```

**Producer:** `VideosService` on `POST /videos/{id}/complete` (per `phase-03-videos/TD-06`); `jobId` is the video's `id`, so a repeated `complete` cannot enqueue a second job (per `phase-03-videos/TD-01`)
**Consumer:** `video-worker` container, same codebase, standalone Nest entrypoint (per `phase-03-videos/TD-04`); runs `ffprobe`/`ffmpeg` via `execFile` against a presigned URL, falls back to a temp-file download, then writes `durationSeconds`, `metadata` and the thumbnail (per `phase-03-videos/TD-05`)
**Trigger:** the multipart upload was completed and verified; `processingStatus` moves `PROCESSING → READY`
**Delivery semantics:** at-least-once with retries and exponential backoff; the processor is idempotent; `FAILED` is set only after all retries are exhausted (per `phase-03-videos/TD-01`, `TD-10`). Retry count and backoff are fixed in SI-03.5: 3 attempts, exponential backoff starting at 5000 ms.

#### sweep-stale-uploads

**Payload:**

```json
{}
```

**Producer:** BullMQ job scheduler registered at worker bootstrap (per `phase-03-videos/TD-01`, `TD-10`)
**Consumer:** `video-worker` container (per `phase-03-videos/TD-04`)
**Trigger:** repeatable job; aborts the multipart upload and marks `FAILED` every video stuck in `UPLOADING` past the staleness threshold (per `phase-03-videos/TD-10`). Cadence and threshold are fixed in SI-03.12: every 15 minutes, videos idle for more than 24 hours.
**Delivery semantics:** best-effort, safe to run repeatedly (per `phase-03-videos/TD-10`)

---

## Dependency Map

SI-03.1 (root)
├── SI-03.2 — depends on SI-03.1 (variáveis de ambiente e config antes dos serviços Compose)
├── SI-03.3 — depends on SI-03.1 (módulo e entidade precisam do TypeORM já configurado com a config nova)
├── SI-03.4 — depends on SI-03.1, SI-03.2 (StorageModule precisa da config e do gateway S3)
│   └── SI-03.6 — depends on SI-03.3, SI-03.4 (init upload usa a entidade e o storage)
│       └── SI-03.7 — depends on SI-03.6 (assinar partes exige o vídeo criado no init)
└── SI-03.5 — depends on SI-03.1, SI-03.2 (QueueModule precisa da config e do Redis)
    └── SI-03.8 — depends on SI-03.5, SI-03.7 (complete publica o job e segue o fluxo de partes)
        └── SI-03.10 — depends on SI-03.4, SI-03.8 (stream usa presign e vídeos que chegaram a PROCESSING)
            └── SI-03.11 — depends on SI-03.10 (download reutiliza VideoAccessPolicy)
SI-03.9 — depends on SI-03.3, SI-03.4, SI-03.5 (worker consome a fila e usa entidade e storage)
└── SI-03.12 — depends on SI-03.9 (sweeper roda no worker)

---

## Deliverables

- [ ] SI-03.1 — Dependências e configuração de storage e fila
- [ ] SI-03.2 — Infra: Redis, object storage e video-worker no Docker Compose
- [ ] SI-03.3 — Entidade Video e migration
- [ ] SI-03.4 — StorageModule: cliente S3 e presign
- [ ] SI-03.5 — QueueModule: fila video-processing e producer
- [ ] SI-03.6 — Endpoint POST /videos
- [ ] SI-03.7 — Endpoint POST /videos/{id}/parts
- [ ] SI-03.8 — Endpoint POST /videos/{id}/complete
- [ ] SI-03.9 — Video worker: entrypoint e processamento do vídeo
- [ ] SI-03.10 — Endpoint GET /videos/{id}/stream e VideoAccessPolicy
- [ ] SI-03.11 — Endpoint GET /videos/{id}/download
- [ ] SI-03.12 — Sweeper de uploads travados

**Full test suites:**

- [ ] Backend tests pass (`cd nestjs-project && docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass (`cd nestjs-project && docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`cd nestjs-project && docker compose exec nestjs-api npm run lint`)
- [ ] Project builds successfully (`cd nestjs-project && docker compose exec nestjs-api npm run build`)
