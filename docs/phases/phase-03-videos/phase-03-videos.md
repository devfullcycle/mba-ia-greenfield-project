---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-07-01T16:42:57-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-07-01T16:43:12-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-01T16:41:33-03:00"
---

# Fase 03 — Upload e Processamento de Vídeos

## Objective

Entregar upload de vídeos de até 10GB direto ao object storage (sem passar pela API), pré-cadastro automático como rascunho, processamento assíncrono em fila (extração de duração/metadados + geração de thumbnail via worker separado), URL única por vídeo, e leitura via streaming/download por URL pré-assinada — com o ciclo de status rascunho → uploaded → processando → pronto/erro refletido no banco.

---

## Step Implementations

### SI-03.1 — Infra: Redis, MinIO e libs de fila/storage no Compose

**Description:** Sobe a infraestrutura nova (Redis para a fila, MinIO para object storage) no `compose.yaml` do backend e instala as bibliotecas decididas, preparando o terreno para os módulos de vídeo.

**Technical actions:**

1. Adicionar os serviços `redis` (imagem `redis:7-alpine`, porta `6379`, healthcheck `redis-cli ping`) e `minio` (imagem `minio/minio`, portas `9000`/`9001`, comando `server /data --console-address ":9001"`, healthcheck no endpoint de readiness, volume nomeado para persistência) ao `nestjs-project/compose.yaml` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`).
2. Instalar `bullmq`, `@nestjs/bullmq`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02` — versões em `library-refs.md`).
3. Criar `src/config/queue.config.ts` (`registerAs('queue', () => ({ host, port }))`) e `src/config/storage.config.ts` (`registerAs('storage', () => ({ endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle }))`), seguindo o padrão namespaced herdado da Fase 01.
4. Adicionar `REDIS_HOST`, `REDIS_PORT`, `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` ao `env.validation.ts` (Joi), `.env` e `.env.example`.
5. Registrar `BullModule.forRootAsync` (usando `queueConfig`) no `AppModule`.

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- `docker compose up -d` sobe `redis` e `minio` com status `running` e healthcheck passando.
- A aplicação inicia (`GET /` retorna `200`) sem erro de DI relacionado a `BullModule`.

---

### SI-03.2 — Migration e entidade `Video`

**Description:** Cria a tabela `videos` e a entidade TypeORM correspondente, ligada ao `Channel`, com o ciclo de status decidido.

**Technical actions:**

1. Criar a migration `<timestamp>-CreateVideos.ts` criando a tabela `videos` conforme `### Data Model` abaixo (per `phase-03-videos/TD-04`, `TD-06`, `TD-08`).
2. Criar `src/videos/video.entity.ts` — entidade `Video` com `@ManyToOne(() => Channel)` e o enum `VideoStatus`.
3. Criar `src/videos/videos.module.ts` (vazio por ora, registra apenas `TypeOrmModule.forFeature([Video])`) e registrar no `AppModule`.
4. Rodar `npm run migration:run`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` (entity) | Integration: FK `channel_id`, enum `status`, defaults (`status: draft`, timestamps) | `video.entity.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- A migration aplica sem erro e cria a tabela `videos` com todos os campos do Data Model.
- Inserir um `Video` com `channel_id` inexistente falha por violação de FK.
- Um `Video` criado sem `status` explícito persiste com `status: draft`.

---

### SI-03.3 — `StorageService` (adapter S3/MinIO)

**Description:** Encapsula o SDK S3 para multipart upload e URLs pré-assinadas de leitura/escrita, isolando o resto do módulo de vídeos do SDK concreto.

**Technical actions:**

1. Criar `src/videos/storage.service.ts` com `initiateMultipartUpload(key)`, `getPresignedPartUploadUrl(key, uploadId, partNumber)`, `completeMultipartUpload(key, uploadId, parts)`, `getPresignedReadUrl(key, options?: { attachment?: boolean })` (per `phase-03-videos/TD-02`, `TD-05`).
2. Registrar `StorageService` como provider em `VideosModule`, injetando `storageConfig`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration: contra o MinIO real do Compose — cria bucket de teste, inicia/completa multipart upload, gera e valida URLs pré-assinadas | `storage.service.integration-spec.ts` |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `initiateMultipartUpload` retorna um `uploadId` reconhecido pelo MinIO para a `key` informada.
- `getPresignedPartUploadUrl` retorna uma URL que aceita um `PUT` com o binário da parte e retorna um `ETag`.
- `completeMultipartUpload` com os `ETag`s corretos finaliza o objeto no bucket.
- `getPresignedReadUrl` retorna uma URL que serve o conteúdo do objeto via `GET`, com `response-content-disposition: attachment` quando `attachment: true`.

---

### SI-03.4 — `VideosService`: pré-cadastro e fluxo de upload

**Description:** Implementa o pré-cadastro do vídeo como rascunho e o ciclo initiate → upload-part-url → complete-upload, validando formato/tamanho e enfileirando o processamento ao final.

**Technical actions:**

1. Criar `src/videos/dto/initiate-upload.dto.ts`, `upload-part-url.dto.ts`, `complete-upload.dto.ts` (`class-validator`, per convenção herdada).
2. Criar `src/videos/videos.service.ts` com `initiateUpload(channelId, dto)`, `getPartUploadUrl(videoId, channelId, dto)`, `completeUpload(videoId, channelId, dto)`.
3. Em `initiateUpload`: validar `mimeType` contra o allowlist e `sizeInBytes` contra o limite de 10GB (per `phase-03-videos/TD-08`), lançando exceções de domínio em caso de violação; criar o `Video` com `status: draft` e chamar `StorageService.initiateMultipartUpload`.
4. Em `completeUpload`: chamar `StorageService.completeMultipartUpload`, atualizar `status: uploaded`, e publicar o job `process-video` na queue `video-processing` (per `phase-03-videos/TD-01`, `### Events/Messages`).
5. Injetar `@InjectQueue('video-processing')` em `VideosService` (per `bullmq`/`@nestjs/bullmq`, `library-refs.md`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: branch logic — validação de `mimeType`/`sizeInBytes`, transições `draft → uploaded` (repo, `StorageService` e `Queue` mockados) | `videos.service.spec.ts` |
| `VideosService` | Integration: persistência real (DB do Compose) + enqueue real (Redis do Compose) | `videos.service.integration-spec.ts` |
| DTOs de upload | E2E: wiring de validação (ver SIs de controller abaixo) | — |

**Dependencies:** SI-03.2, SI-03.3

**Acceptance criteria:**

- `initiateUpload` com `mimeType` fora do allowlist lança um erro mapeável para `400 UNSUPPORTED_MEDIA_TYPE`.
- `initiateUpload` com `sizeInBytes` maior que 10GB lança um erro mapeável para `400 FILE_TOO_LARGE`.
- `initiateUpload` válido persiste um `Video` com `status: draft` e um `storageKey` único.
- `completeUpload` bem-sucedido atualiza o `Video` para `status: uploaded` e publica exatamente um job `process-video` com `{ videoId }` na fila `video-processing`.

---

### SI-03.5 — Endpoint `POST /videos` (initiate upload)

**Description:** Expõe o pré-cadastro do vídeo como rascunho ao iniciar o upload.

**Route:** POST /videos
**Test Specs:** see `nestjs-project/specs/videos.plan.md`
**Authorization:** Authenticated (dono do canal do usuário atual)

**Technical actions:**

1. Criar `src/videos/videos.controller.ts` com `POST /videos` chamando `VideosService.initiateUpload`, resolvendo o `channelId` a partir do `@CurrentUser()` (per convenção herdada da Fase 02).
2. Decorar com `@ApiTags('videos')`, `@ApiOperation`, `@ApiResponse` (per convenção herdada — `openapi-docs-nestjs`).
3. Registrar `VideosController` em `VideosModule`.

**Tests:** _(E2E only — ver `**Test Specs:**`; controllers não recebem unit test per `testing-guide-nestjs-project`)_

**Dependencies:** SI-03.4

**Acceptance criteria:**

- `POST /videos` autenticado com corpo válido retorna `201` com `{ id, status: "draft", uploadId }`.
- `POST /videos` sem autenticação retorna `401`.
- `POST /videos` com `mimeType` inválido retorna `400` com `errorCode: "UNSUPPORTED_MEDIA_TYPE"`.
- `POST /videos` com `sizeInBytes` acima de 10GB retorna `400` com `errorCode: "FILE_TOO_LARGE"`.

---

### SI-03.6 — Endpoint `POST /videos/:id/upload-part-url`

**Description:** Expõe a geração de URL pré-assinada por parte do multipart upload, restrita ao dono do vídeo.

**Route:** POST /videos/:id/upload-part-url
**Test Specs:** see `nestjs-project/specs/videos.plan.md`
**Authorization:** Owner apenas

**Technical actions:**

1. Adicionar o método `uploadPartUrl` em `VideosController`, chamando `VideosService.getPartUploadUrl`; lançar `VIDEO_NOT_FOUND` (404) quando o vídeo não existe ou não pertence ao usuário atual (per `phase-03-videos/TD-07` — não revela existência a quem não é dono).
2. Decorar com `@ApiOperation`/`@ApiResponse`.

**Tests:** _(E2E only — ver `**Test Specs:**`)_

**Dependencies:** SI-03.4

**Acceptance criteria:**

- `POST /videos/:id/upload-part-url` do dono, com `partNumber` válido, retorna `200` com `{ url }`.
- `POST /videos/:id/upload-part-url` de outro usuário autenticado (não dono) retorna `404` com `errorCode: "VIDEO_NOT_FOUND"`.
- `POST /videos/:id/upload-part-url` com `partNumber` inválido (`< 1`) retorna `400` com `errorCode: "UPLOAD_PART_INVALID"`.

---

### SI-03.7 — Endpoint `POST /videos/:id/complete-upload`

**Description:** Expõe a finalização do multipart upload, disparando o enfileiramento do processamento.

**Route:** POST /videos/:id/complete-upload
**Test Specs:** see `nestjs-project/specs/videos.plan.md`
**Authorization:** Owner apenas

**Technical actions:**

1. Adicionar o método `completeUpload` em `VideosController`, chamando `VideosService.completeUpload`; retornar `409 INVALID_VIDEO_STATUS_TRANSITION` quando o vídeo não está em `draft` (per `### Error Catalog`).
2. Decorar com `@ApiOperation`/`@ApiResponse`.

**Tests:** _(E2E only — ver `**Test Specs:**`)_

**Dependencies:** SI-03.4

**Acceptance criteria:**

- `POST /videos/:id/complete-upload` do dono, com as partes corretas, retorna `200` com `{ id, status: "uploaded" }`.
- `POST /videos/:id/complete-upload` chamado duas vezes para o mesmo vídeo retorna `409` com `errorCode: "INVALID_VIDEO_STATUS_TRANSITION"` na segunda chamada.
- `POST /videos/:id/complete-upload` de outro usuário (não dono) retorna `404` com `errorCode: "VIDEO_NOT_FOUND"`.

---

### SI-03.8 — Infra: worker de vídeo separado (entrypoint + Compose)

**Description:** Cria o segundo processo Nest (worker), com FFmpeg instalado na imagem, subindo como serviço próprio no Compose.

**Technical actions:**

1. Criar `src/main-worker.ts` — bootstrap via `NestFactory.createApplicationContext(WorkerModule)`, sem servidor HTTP (per `phase-03-videos/TD-03`).
2. Criar `src/videos/worker.module.ts` (`WorkerModule`) importando `TypeOrmModule.forFeature([Video])`, `BullModule.registerQueue({ name: 'video-processing' })` e os providers `StorageService` + `VideoProcessor` (este último criado no SI-03.9).
3. Criar `Dockerfile.worker` (baseado no mesmo `Dockerfile.dev`, adicionando `apt-get install -y ffmpeg`) e um script `start:worker` no `package.json` (`node dist/main-worker.js` / `nest start --entryFile main-worker` em dev).
4. Adicionar o serviço `video-worker` ao `compose.yaml` (build via `Dockerfile.worker`, mesmas env vars de banco/fila/storage, `depends_on: [db, redis, minio]`).

**Tests:** _(empty — Infra)_

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `docker compose up -d` sobe o serviço `video-worker` com status `running`, sem expor porta HTTP.
- O binário `ffmpeg`/`ffprobe` está disponível dentro do container `video-worker` (`ffmpeg -version` retorna 0).

---

### SI-03.9 — `VideoProcessor`: extração de metadados e thumbnail

**Description:** Consome o job de processamento, extrai duração/metadados via `ffprobe`, gera o thumbnail via `ffmpeg`, e atualiza o ciclo de status do vídeo.

**Technical actions:**

1. Criar `src/videos/video.processor.ts` — `@Processor('video-processing')` estendendo `WorkerHost`, com `process(job)` (per `bullmq`/`@nestjs/bullmq`, `library-refs.md`).
2. No `process`: baixar/streamar o objeto original do storage para um arquivo temporário, chamar `ffmpeg.ffprobe` para extrair `durationSeconds` e metadados, chamar `.screenshots({ timestamps: ['10%'], ... })` para gerar o thumbnail (per `phase-03-videos/TD-03`).
3. Fazer upload do thumbnail gerado via `StorageService`, atualizar o `Video` para `status: ready` com `durationSeconds` e `thumbnailKey` preenchidos.
4. Adicionar `@OnWorkerEvent('failed')` — quando as tentativas se esgotam (per `phase-03-videos/TD-06`), atualizar `status: failed` e `failureReason`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessor` | Integration: contra Redis + MinIO + banco reais do Compose, com um arquivo de vídeo de fixture pequeno — extração de metadados, geração de thumbnail, transição para `ready` | `video.processor.integration-spec.ts` |
| `VideoProcessor` | Integration: fixture de arquivo inválido (não é um vídeo) — esgota tentativas e transiciona para `failed` | `video.processor.integration-spec.ts` |

**Dependencies:** SI-03.2, SI-03.3, SI-03.8

**Acceptance criteria:**

- Um job `process-video` para um vídeo válido resulta em `status: ready`, `durationSeconds` preenchido e `thumbnailKey` apontando para um objeto existente no bucket.
- Um job `process-video` para um arquivo que não é um vídeo válido resulta, após esgotar as tentativas configuradas, em `status: failed` com `failureReason` preenchido.

---

### SI-03.10 — `VideosService`/Endpoint `GET /videos/:id` (leitura com autorização)

**Description:** Expõe a leitura de metadados/status do vídeo, aplicando a política de autorização decidida (público quando `ready`, dono sempre).

**Route:** GET /videos/:id
**Test Specs:** see `nestjs-project/specs/videos.plan.md`
**Authorization:** Anonymous (apenas se `ready`) | Authenticated não-dono (apenas se `ready`) | Owner (qualquer status)

**Technical actions:**

1. Adicionar `VideosService.getVideoForRead(videoId, requesterUserId?)` — aplica a regra: retorna o vídeo se `status === 'ready'`, OU se o requisitante autenticado é o dono; caso contrário lança `VIDEO_NOT_FOUND` (404) (per `phase-03-videos/TD-07`).
2. Adicionar `GET /videos/:id` em `VideosController`, `@Public()` (guard global permite anônimo; a checagem de dono é feita dentro do service a partir do `@CurrentUser()` opcional).
3. Decorar com `@ApiOperation`/`@ApiResponse`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.getVideoForRead` | Unit: branch logic da autorização (ready/não-ready × dono/não-dono/anônimo) | `videos.service.spec.ts` |

**Dependencies:** SI-03.2

**Acceptance criteria:**

- `GET /videos/:id` anônimo para um vídeo `ready` retorna `200` com os metadados do vídeo.
- `GET /videos/:id` anônimo para um vídeo `processing`/`draft`/`failed` retorna `404` com `errorCode: "VIDEO_NOT_FOUND"`.
- `GET /videos/:id` autenticado como dono retorna `200` independentemente do `status`.

---

### SI-03.11 — Endpoint `GET /videos/:id/stream`

**Description:** Expõe a reprodução via streaming, redirecionando para uma URL pré-assinada de leitura que suporta `Range` nativamente no storage.

**Route:** GET /videos/:id/stream
**Test Specs:** see `nestjs-project/specs/videos.plan.md`
**Authorization:** Anonymous (apenas se `ready`) | Authenticated não-dono (apenas se `ready`) | Owner (qualquer status)

**Technical actions:**

1. Adicionar `GET /videos/:id/stream` em `VideosController`: reaproveita `VideosService.getVideoForRead` (mesma regra de SI-03.10) e, se autorizado, responde `302` com `Location: {StorageService.getPresignedReadUrl(video.storageKey)}` (per `phase-03-videos/TD-05`).
2. Decorar com `@ApiOperation`/`@ApiResponse`.

**Tests:** _(E2E only — ver `**Test Specs:**`)_

**Dependencies:** SI-03.10, SI-03.3

**Acceptance criteria:**

- `GET /videos/:id/stream` para um vídeo `ready` retorna `302` com um `Location` que é uma URL do storage servindo o objeto.
- `GET /videos/:id/stream` para um vídeo não `ready` (e requisitante não-dono) retorna `404` com `errorCode: "VIDEO_NOT_FOUND"`.
- A URL retornada em `Location` responde a uma requisição com header `Range` com `206 Partial Content` (comportamento nativo do storage, exercitado no teste E2E).

---

### SI-03.12 — Endpoint `GET /videos/:id/download`

**Description:** Expõe o download do vídeo, redirecionando para a mesma URL pré-assinada de leitura com `Content-Disposition: attachment`.

**Route:** GET /videos/:id/download
**Test Specs:** see `nestjs-project/specs/videos.plan.md`
**Authorization:** Anonymous (apenas se `ready`) | Authenticated não-dono (apenas se `ready`) | Owner (qualquer status)

**Technical actions:**

1. Adicionar `GET /videos/:id/download` em `VideosController`: mesma regra de autorização de SI-03.10/03.11, respondendo `302` com `Location: {StorageService.getPresignedReadUrl(video.storageKey, { attachment: true })}` (per `phase-03-videos/TD-05`).
2. Decorar com `@ApiOperation`/`@ApiResponse`.

**Tests:** _(E2E only — ver `**Test Specs:**`)_

**Dependencies:** SI-03.10, SI-03.3

**Acceptance criteria:**

- `GET /videos/:id/download` para um vídeo `ready` retorna `302` com um `Location` cuja resposta final carrega `Content-Disposition: attachment`.
- `GET /videos/:id/download` para um vídeo não `ready` (e requisitante não-dono) retorna `404` com `errorCode: "VIDEO_NOT_FOUND"`.

---

## Technical Specifications

### Data Model

#### Video

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated |
| channel_id | uuid | FK → channels.id, not null, indexed |
| title | varchar(255) | not null, default = `original_file_name` sem extensão |
| original_file_name | varchar(255) | not null |
| mime_type | varchar(100) | not null |
| size_in_bytes | bigint | not null |
| storage_key | varchar(512) | not null, unique |
| thumbnail_key | varchar(512) | nullable |
| status | enum(`draft`,`uploaded`,`processing`,`ready`,`failed`) | not null, default `draft` |
| duration_seconds | integer | nullable |
| upload_id | varchar(255) | nullable — S3 multipart UploadId, limpo após `complete-upload` |
| failure_reason | varchar(500) | nullable |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now(), atualizado em cada update |

**Relations:** `Channel` has many `Video` (one-to-many); `Video` belongs to `Channel` (`@ManyToOne`).
**Indexes:** index on `channel_id`; unique on `storage_key`.

### API Contracts

#### POST /videos (SI-03.5)

**Request headers:**
- Content-Type: application/json

**Request body:**
- originalFileName: string, required
- mimeType: string, required — um de `video/mp4`, `video/quicktime`, `video/webm`, `video/x-matroska` (per `phase-03-videos/TD-08`)
- sizeInBytes: number, required — máximo `10737418240` (10GB) (per `phase-03-videos/TD-08`)
- title: string, optional, max 255

**Response 201:**
- id: string (uuid)
- status: string (`"draft"`)
- uploadId: string

**Error responses:**
- 400 UNSUPPORTED_MEDIA_TYPE: `mimeType` fora do allowlist
- 400 FILE_TOO_LARGE: `sizeInBytes` acima de 10GB
- 400 validation error: corpo fora do schema
- 401: sem autenticação

---

#### POST /videos/:id/upload-part-url (SI-03.6)

**Request headers:**
- Content-Type: application/json

**Request body:**
- partNumber: number, required — inteiro ≥ 1

**Response 200:**
- url: string — URL pré-assinada para `PUT` da parte

**Error responses:**
- 400 UPLOAD_PART_INVALID: `partNumber` inválido
- 404 VIDEO_NOT_FOUND: vídeo não existe ou não pertence ao usuário atual
- 401: sem autenticação

---

#### POST /videos/:id/complete-upload (SI-03.7)

**Request headers:**
- Content-Type: application/json

**Request body:**
- parts: array, required — `{ partNumber: number, etag: string }[]`

**Response 200:**
- id: string (uuid)
- status: string (`"uploaded"`)

**Error responses:**
- 404 VIDEO_NOT_FOUND: vídeo não existe ou não pertence ao usuário atual
- 409 INVALID_VIDEO_STATUS_TRANSITION: vídeo não está em `draft`
- 401: sem autenticação

---

#### GET /videos/:id (SI-03.10)

**Response 200:**
- id, title, status, durationSeconds, createdAt, thumbnailUrl (quando `ready`)

**Error responses:**
- 404 VIDEO_NOT_FOUND: vídeo não existe, ou (não-dono e status != `ready`)

---

#### GET /videos/:id/stream (SI-03.11)

**Request headers:**
- Range: opcional — repassado nativamente pelo storage na URL de redirecionamento

**Response 302:**
- Location: URL pré-assinada de leitura no storage

**Error responses:**
- 404 VIDEO_NOT_FOUND: vídeo não existe, ou (não-dono e status != `ready`)

---

#### GET /videos/:id/download (SI-03.12)

**Response 302:**
- Location: URL pré-assinada de leitura no storage, com `response-content-disposition=attachment`

**Error responses:**
- 404 VIDEO_NOT_FOUND: vídeo não existe, ou (não-dono e status != `ready`)

#### Validation Rules — Backend

- `mimeType`: required, um de `video/mp4`, `video/quicktime`, `video/webm`, `video/x-matroska` (`phase-03-videos/TD-08`)
- `sizeInBytes`: required, inteiro positivo, máximo `10737418240` (`phase-03-videos/TD-08`)
- `partNumber`: required, inteiro ≥ 1
- `parts`: required, array não vazio de `{ partNumber, etag }`

### Authorization Matrix

| Endpoint | Anonymous | Authenticated (não-dono) | Owner | Notas |
|----------|-----------|---------------------------|-------|-------|
| POST /videos | ✗ | ✓ | — | Cria o vídeo no canal do próprio requisitante |
| POST /videos/:id/upload-part-url | ✗ | ✗ (404) | ✓ | `phase-03-videos/TD-07` — 404 em vez de 403 para não revelar existência |
| POST /videos/:id/complete-upload | ✗ | ✗ (404) | ✓ | idem |
| GET /videos/:id | ✓ (se `ready`) | ✓ (se `ready`) | ✓ (qualquer status) | `phase-03-videos/TD-07` |
| GET /videos/:id/stream | ✓ (se `ready`) | ✓ (se `ready`) | ✓ (qualquer status) | `phase-03-videos/TD-05`, `TD-07` |
| GET /videos/:id/download | ✓ (se `ready`) | ✓ (se `ready`) | ✓ (qualquer status) | `phase-03-videos/TD-05`, `TD-07` |

### Error Catalog

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| UNSUPPORTED_MEDIA_TYPE | 400 | `initiate-upload` com `mimeType` fora do allowlist (`phase-03-videos/TD-08`) |
| FILE_TOO_LARGE | 400 | `initiate-upload` com `sizeInBytes` acima de 10GB (`phase-03-videos/TD-08`) |
| UPLOAD_PART_INVALID | 400 | `upload-part-url` com `partNumber` inválido |
| VIDEO_NOT_FOUND | 404 | Vídeo inexistente, ou requisitante sem permissão de leitura no status atual (`phase-03-videos/TD-07`) |
| INVALID_VIDEO_STATUS_TRANSITION | 409 | `complete-upload` chamado quando o vídeo não está em `draft` |

### Events/Messages

#### process-video

**Payload:**

```json
{ "videoId": "uuid" }
```

**Producer:** `VideosService.completeUpload` (per `phase-03-videos/TD-01`, `TD-02`)
**Consumer:** `VideoProcessor` (worker, per `phase-03-videos/TD-01`, `TD-03`)
**Trigger:** Multipart upload finalizado com sucesso (`complete-upload`)
**Delivery semantics:** at-least-once, com retry e backoff exponencial (`attempts: 3, backoff: { type: 'exponential', delay: 3000 }`) antes de transicionar para `failed` (per `phase-03-videos/TD-06`). O processamento (ffprobe + geração de thumbnail, ambos sobrescrevendo as mesmas chaves de storage) é idempotente — reprocessar o mesmo `videoId` é seguro.

---

## Dependency Map

```
SI-03.1 (root)
├── SI-03.3 — depends on SI-03.1 (config/libs de storage)
│   └── SI-03.4 — depends on SI-03.2, SI-03.3
│       ├── SI-03.5 — depends on SI-03.4
│       ├── SI-03.6 — depends on SI-03.4
│       └── SI-03.7 — depends on SI-03.4
└── SI-03.8 — depends on SI-03.1 (config/libs de fila, imagem do worker)
    └── SI-03.9 — depends on SI-03.2, SI-03.3, SI-03.8

SI-03.2 (root)
└── SI-03.10 — depends on SI-03.2
    ├── SI-03.11 — depends on SI-03.10, SI-03.3
    └── SI-03.12 — depends on SI-03.10, SI-03.3
```

---

## Deliverables

- [ ] SI-03.1 — Infra: Redis, MinIO e libs de fila/storage no Compose
- [ ] SI-03.2 — Migration e entidade `Video`
- [ ] SI-03.3 — `StorageService` (adapter S3/MinIO)
- [ ] SI-03.4 — `VideosService`: pré-cadastro e fluxo de upload
- [ ] SI-03.5 — Endpoint `POST /videos`
- [ ] SI-03.6 — Endpoint `POST /videos/:id/upload-part-url`
- [ ] SI-03.7 — Endpoint `POST /videos/:id/complete-upload`
- [ ] SI-03.8 — Infra: worker de vídeo separado
- [ ] SI-03.9 — `VideoProcessor`: extração de metadados e thumbnail
- [ ] SI-03.10 — `GET /videos/:id` com autorização
- [ ] SI-03.11 — Endpoint `GET /videos/:id/stream`
- [ ] SI-03.12 — Endpoint `GET /videos/:id/download`

**Full test suites:**

- [ ] Testes unitários + integração passam (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] Testes E2E passam (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type-check limpo (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint limpo (`docker compose exec nestjs-api npm run lint`)
