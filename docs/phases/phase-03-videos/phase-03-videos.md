---
kind: phase
name: phase-03-videos
status: ready
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-06-26T20:00:00-03:00"
  docs/phases/phase-03-videos/validation.md: "2026-06-26T20:08:00-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-06-26T20:05:45-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-06-26T20:06:00-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Entregar o módulo de vídeos do StreamTube: upload de arquivos de até 10GB direto ao object storage (sem passar pela API), pré-cadastro do vídeo como rascunho, processamento assíncrono em fila por um worker FFmpeg dedicado (extração de duração/metadados e geração de thumbnail), URL única por vídeo, streaming por range (`206 Partial Content`) e download via URL pré-assinada. A infraestrutura nova (Redis para a fila, MinIO para o storage e o container do worker) sobe junto com o backend via Docker Compose. O ciclo de status `draft → processing → ready | error` é refletido no banco.

Decisões que embasam este plano: `docs/decisions/technical-decisions-phase-03-videos.md` (TD-01 a TD-10). Libs fixadas: `docs/phases/phase-03-videos/library-refs.md`.

## Step Implementations

### SI-03.1 — Dependências, Config Namespaces e Infra Docker (Redis, MinIO, Worker)

**Description:** Instalar as dependências da fase, criar os config namespaces (`storage`, `queue`, `video`) seguindo o padrão `registerAs` das Fases 01–02, estender o schema Joi e o `.env.example`, e adicionar ao Compose os serviços Redis, MinIO (com bootstrap do bucket) e o `video-worker`, além de instalar FFmpeg na imagem usada pelo worker.

**Technical actions:**

- Instalar dependências de produção em `nestjs-project`: `@nestjs/bullmq@^11.0.4`, `bullmq@^5.79.1`, `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`, `nanoid@^3.3.15` (linha CommonJS — v5+ é ESM-only).
- Criar `src/config/storage.config.ts` — `registerAs('storage', ...)` lendo `S3_ENDPOINT` (default `'http://minio:9000'`), `S3_REGION` (default `'us-east-1'`), `S3_ACCESS_KEY` (required), `S3_SECRET_KEY` (required), `S3_BUCKET` (default `'streamtube-videos'`), `S3_FORCE_PATH_STYLE` (boolean, default `true`), `S3_PRESIGN_EXPIRATION` (number, default `3600`).
- Criar `src/config/queue.config.ts` — `registerAs('queue', ...)` lendo `REDIS_HOST` (default `'redis'`), `REDIS_PORT` (number, default `6379`).
- Criar `src/config/video.config.ts` — `registerAs('video', ...)` lendo `VIDEO_MAX_SIZE_BYTES` (number, default `10737418240` = 10GB), `VIDEO_UPLOAD_PART_SIZE_BYTES` (number, default `104857600` = 100MB), `VIDEO_THUMBNAIL_TIMESTAMP_SECONDS` (number, default `1`), `VIDEO_PROCESSING_CONCURRENCY` (number, default `2`), `VIDEO_PROCESSING_ATTEMPTS` (number, default `5`).
- Atualizar `src/config/env.validation.ts` — adicionar todas as novas variáveis ao schema Joi (`S3_ACCESS_KEY`/`S3_SECRET_KEY` required; demais com default). Atualizar `.env.example` com defaults compatíveis com o Compose (hosts = nomes de serviço).
- Atualizar `nestjs-project/compose.yaml`:
  - `redis` — imagem `redis:7-alpine`, porta `6379`, healthcheck `redis-cli ping`.
  - `minio` — imagem `minio/minio`, comando `server /data --console-address ":9001"`, portas `9000`/`9001`, env `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, healthcheck no endpoint `/minio/health/live`, volume para `/data`.
  - `minio-setup` — imagem `minio/mc`, depende do `minio` saudável, entrypoint que cria o bucket `streamtube-videos` de forma idempotente (`mc mb --ignore-existing`).
  - `video-worker` — build a partir do `Dockerfile.dev` (que passa a instalar `ffmpeg` via apt), comando que roda o entrypoint do worker (`npm run start:worker` em dev), `depends_on` db/redis/minio saudáveis, mesmos volumes/env da API.
  - `nestjs-api` — adicionar `depends_on` de `redis` e `minio` (e `minio-setup`).
- Atualizar `Dockerfile.dev` — instalar `ffmpeg` (apt) na imagem (usada por API e worker; só o worker o executa).
- Adicionar scripts npm: `start:worker` (`nest start --watch --entryFile main.worker`) e `start:worker:prod` (`node dist/main.worker`).

**Dependencies:** None

**Acceptance criteria:**

- `docker compose up -d` sobe `db`, `mailpit`, `redis`, `minio`, `minio-setup` (exit 0 após criar o bucket) e `video-worker`; `docker compose ps` mostra os serviços de longa duração como `running`/`healthy`.
- Subir a aplicação sem `S3_ACCESS_KEY` causa erro de validação Joi no bootstrap — a app não inicia.
- O bucket `streamtube-videos` existe no MinIO após o `minio-setup` rodar; o console do MinIO responde em `localhost:9001`.

---

### SI-03.2 — Storage Service (S3/MinIO via AWS SDK v3)

**Description:** Encapsular o acesso ao object storage num `StorageModule`/`StorageService` que fala com MinIO (e S3 em produção) via AWS SDK v3, cobrindo bucket idempotente, multipart presigned, head, presign de download, leitura por range e upload do thumbnail. (TD-02, TD-03, TD-08, TD-09.)

**Technical actions:**

- Criar `src/storage/storage.module.ts` e `src/storage/storage.service.ts`. O `StorageService` recebe a config `storage` via `@Inject(storageConfig.KEY)` e instancia um `S3Client` (`endpoint`, `region`, `forcePathStyle`, `credentials`).
- Métodos do `StorageService`:
  - `ensureBucket()` — `HeadBucketCommand`; se 404, `CreateBucketCommand` (idempotente). Chamado em `onModuleInit`.
  - `createMultipartUpload(key, contentType)` → retorna `uploadId`.
  - `presignUploadPart(key, uploadId, partNumber)` → URL presigned de `UploadPartCommand` (expira em `S3_PRESIGN_EXPIRATION`).
  - `completeMultipartUpload(key, uploadId, parts)` — `CompleteMultipartUploadCommand` com `Parts` ordenadas asc.
  - `abortMultipartUpload(key, uploadId)` — `AbortMultipartUploadCommand`.
  - `headObject(key)` → metadados (`ContentLength`, `ContentType`) ou lança se ausente.
  - `getObjectRange(key, range?)` → `{ stream, contentLength, contentRange, contentType, totalLength }` a partir de `GetObjectCommand` com `Range`.
  - `presignDownloadUrl(key, filename?)` → URL presigned de `GetObjectCommand` (com `ResponseContentDisposition: attachment`).
  - `putObject(key, body, contentType)` — upload do thumbnail.
  - `deletePrefix(prefix)` — limpeza (best-effort) dos objetos de um vídeo.
- `StorageModule` exporta `StorageService` para API e worker.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/storage/storage.service.integration-spec.ts` | Integration | Contra MinIO real: `ensureBucket` idempotente; roundtrip multipart (create → uploadPart via URL presigned → complete) reconstrói o objeto; `headObject` retorna tamanho; `getObjectRange` devolve o range correto com `contentRange`; `presignDownloadUrl` gera URL que baixa o objeto; `putObject` grava o thumbnail. |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- O bucket é garantido na inicialização sem erro quando já existe.
- Um upload multipart de um buffer pequeno via URLs presigned, finalizado por `completeMultipartUpload`, produz um objeto cujo conteúdo é idêntico ao original.
- `getObjectRange(key, 'bytes=0-9')` retorna 10 bytes e `Content-Range` coerente.

---

### SI-03.3 — Entidade Video e Migration

**Description:** Criar a entidade `Video` ligada ao `Channel`, com status enum, chaves de storage, `public_id` único, duração e metadados; gerar a migration. (TD-02, TD-07, TD-10.)

**Technical actions:**

- Criar `src/videos/entities/video.entity.ts` — `@Entity('videos')` com as colunas do Data Model (abaixo). `status` é enum PostgreSQL (`video_status`); relação `@ManyToOne(() => Channel)` com `@JoinColumn({ name: 'channel_id' })`; `metadata` como `jsonb`; `public_id` único.
- Criar `src/videos/videos.module.ts` — `TypeOrmModule.forFeature([Video])`, exporta `TypeOrmModule`.
- Gerar migration via `npm run migration:generate -- src/database/migrations/CreateVideos` e revisar o SQL (enum, índices `public_id` único / `channel_id` / `status`, FK para `channels`).

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/entities/video.entity.integration-spec.ts` | Integration | `public_id` único; `status` default `draft`; FK para `channel`; `metadata` jsonb persistido/lido; timestamps automáticos; `thumbnail_key`/`duration_seconds`/`failure_reason` nullable. |
| `src/database/migrations.integration-spec.ts` | Integration | (estende o teste existente) a migration `CreateVideos` aplica e reverte corretamente. |
| `src/videos/videos.module.spec.ts` | Unit | Módulo compila com `TypeOrmModule.forFeature`. |

**Dependencies:** SI-03.1; reusa `Channel` (Fase 02).

**Acceptance criteria:**

- `npm run migration:run` cria a tabela `videos` com o enum `video_status`, FK para `channels`, e índices únicos/secundários.
- Inserir dois vídeos com o mesmo `public_id` viola a constraint `UNIQUE`.
- Um vídeo recém-criado tem `status = 'draft'`.

---

### SI-03.4 — Public ID, Máquina de Status e Exceções de Domínio

**Description:** Implementar a geração do `public_id` (nanoid + retry em colisão), a máquina de transições de status e as exceções de domínio da fase, reusando o `DomainException`/filtro da Fase 02. (TD-07, TD-10, herda TD-07 da Fase 02.)

**Technical actions:**

- Criar `src/videos/services/public-id.service.ts` — `customAlphabet` (URL-safe, 11 chars); método `generateUnique(repo)` que tenta gerar e verifica colisão (apoiado pela constraint `UNIQUE` no insert; retry limitado).
- Criar `src/videos/video-status.ts` — enum `VideoStatus` e helper `assertTransition(from, to)` com as transições válidas (`draft→processing`, `processing→ready`, `processing→error`).
- Criar `src/videos/exceptions/` — `VideoNotFoundException` (404), `NotVideoOwnerException` (403), `InvalidVideoStateException` (409), `FileTooLargeException` (413), `UnsupportedMediaTypeException` (415), `UploadIncompleteException` (422), `RangeNotSatisfiableException` (416), todas estendendo `DomainException` com `errorCode`/`httpStatus`.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/services/public-id.service.spec.ts` | Unit | Gera id no alfabeto/tamanho esperado; em colisão simulada, faz retry e retorna id distinto. |
| `src/videos/video-status.spec.ts` | Unit | Aceita transições válidas; rejeita inválidas (ex.: `ready→draft`). |

**Dependencies:** SI-03.3

**Acceptance criteria:**

- `generateUnique` retorna um id de 11 chars URL-safe; com a primeira tentativa colidindo, retorna um id diferente sem lançar.
- `assertTransition('ready', 'processing')` lança `InvalidVideoStateException`.

---

### SI-03.5 — Queue Module e Contrato do Job (Producer)

**Description:** Configurar o BullMQ (conexão Redis), registrar a fila `video-processing` e expor um produtor para enfileirar o processamento com retentativas/backoff. (TD-01, TD-10.)

**Technical actions:**

- Criar `src/queue/queue.module.ts` — `BullModule.forRootAsync` lendo `queue` config (`connection: { host, port }`, `defaultJobOptions` com `attempts` = `VIDEO_PROCESSING_ATTEMPTS`, `backoff` exponencial `delay: 2000`, `removeOnComplete: true`, `removeOnFail: false`) e `BullModule.registerQueue({ name: 'video-processing' })`. Exporta o `BullModule` para reuso.
- Criar `src/queue/video-jobs.ts` — constantes `VIDEO_QUEUE = 'video-processing'`, `PROCESS_VIDEO_JOB = 'process'` e tipo `ProcessVideoJobData = { videoId: string }`.
- Criar `src/videos/services/video-queue.service.ts` — `@InjectQueue(VIDEO_QUEUE)`; método `enqueueProcessing(videoId)` → `queue.add(PROCESS_VIDEO_JOB, { videoId })`.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/services/video-queue.service.integration-spec.ts` | Integration | Contra Redis real: `enqueueProcessing` adiciona um job à fila `video-processing` com o payload `{ videoId }` e as opções de retry/backoff configuradas. |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- Após `enqueueProcessing('x')`, a fila `video-processing` contém um job `process` com `data.videoId === 'x'` e `opts.attempts`/`opts.backoff` definidos.

---

### SI-03.6 — Iniciação do Upload (POST /videos)

**Description:** Endpoint autenticado que pré-cadastra o vídeo como rascunho e inicia o upload multipart, devolvendo as URLs presigned por parte. Nenhum byte do arquivo passa pela API. (TD-03, TD-04.)

**Technical actions:**

- Criar `src/videos/dto/initiate-upload.dto.ts` — `title` (string, 1..120), `filename` (string), `contentType` (string), `fileSize` (int > 0).
- Criar/St estender `src/videos/videos.service.ts` — `initiateUpload(channelId, dto)`:
  - valida `contentType` começa com `video/` (senão `UnsupportedMediaTypeException`) e `fileSize <= VIDEO_MAX_SIZE_BYTES` (senão `FileTooLargeException`);
  - gera `public_id`; define `storage_key = videos/{id}/source`;
  - cria o registro `Video` (`status=draft`, `channel_id`, `title`, `content_type`, `size_bytes`, `original_filename`);
  - `createMultipartUpload(storage_key, contentType)` → `uploadId` (persistido);
  - calcula o nº de partes = `ceil(fileSize / VIDEO_UPLOAD_PART_SIZE_BYTES)` e gera uma URL presigned por parte;
  - retorna `{ videoId, publicId, status, uploadId, partSize, parts: [{ partNumber, url }] }`.
- Criar `src/videos/videos.controller.ts` — `POST /videos` com `@CurrentUser()`; resolve o `channelId` do usuário (via `ChannelsService`/repo) e delega ao service.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | `initiateUpload` rejeita contentType não-vídeo (415) e fileSize > 10GB (413); calcula o nº de partes corretamente; cria o rascunho e chama `createMultipartUpload`. |
| `test/videos-upload.e2e-spec.ts` | E2E | `POST /videos` autenticado retorna 201 com `status=draft`, `uploadId` e `parts[]` com URLs presigned; sem auth retorna 401; body inválido retorna 400. |

**Dependencies:** SI-03.2, SI-03.3, SI-03.4

**Acceptance criteria:**

- `POST /videos` cria um vídeo `draft` ligado ao canal do usuário e devolve URLs presigned por parte; o número de partes corresponde ao `fileSize`.
- `contentType` não-vídeo → 415 `UNSUPPORTED_MEDIA_TYPE`; `fileSize` > 10GB → 413 `FILE_TOO_LARGE`.

---

### SI-03.7 — Finalização do Upload (POST /videos/:id/complete)

**Description:** Endpoint autenticado (dono) que finaliza o multipart, valida a existência do objeto, transiciona o vídeo para `processing` e enfileira o processamento. (TD-04, TD-10.)

**Technical actions:**

- Criar `src/videos/dto/complete-upload.dto.ts` — `parts: { partNumber: int; etag: string }[]` (min 1).
- `videos.service.ts` — `completeUpload(channelId, videoId, dto)`:
  - carrega o vídeo; `VideoNotFoundException` se ausente; `NotVideoOwnerException` se `channel_id` ≠ do usuário; `InvalidVideoStateException` se `status !== 'draft'`;
  - `completeMultipartUpload(storage_key, upload_id, parts)`; em falha → `UploadIncompleteException`;
  - `headObject(storage_key)` para confirmar e capturar `size_bytes`;
  - `assertTransition('draft','processing')`, seta `status='processing'`, limpa `upload_id`, salva;
  - `videoQueue.enqueueProcessing(videoId)`.
- `videos.controller.ts` — `POST /videos/:id/complete`.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | `completeUpload` valida dono/estado; chama `completeMultipartUpload` + `headObject`; transiciona para `processing` e enfileira. |
| `test/videos-upload.e2e-spec.ts` | E2E | Fluxo: `POST /videos` → upload das partes ao MinIO via AWS SDK → `POST /videos/:id/complete` retorna 200 `status=processing`; completar vídeo de outro usuário → 403; completar vídeo já `processing` → 409. |

**Dependencies:** SI-03.6, SI-03.5

**Acceptance criteria:**

- Após subir as partes e chamar `complete`, o vídeo fica `processing` e um job é enfileirado.
- `complete` por não-dono → 403 `NOT_VIDEO_OWNER`; em vídeo não-`draft` → 409 `INVALID_VIDEO_STATE`.

---

### SI-03.8 — Worker: Bootstrap, Processor e Processamento FFmpeg

**Description:** O container `video-worker` consome a fila e processa cada vídeo: baixa o original do storage, extrai duração/metadados (ffprobe), gera o thumbnail (ffmpeg), sobe o thumbnail e atualiza o vídeo para `ready`; em falha persistente, marca `error` com a razão. (TD-05, TD-06, TD-10.)

**Technical actions:**

- Criar `src/videos/services/ffmpeg.service.ts` — wrapper sobre `node:child_process`:
  - `probe(inputPath)` → roda `ffprobe -v error -print_format json -show_format -show_streams` e parseia duração (segundos) + metadados (codec, largura, altura, bitrate);
  - `extractThumbnail(inputPath, outputPath, atSeconds)` → `ffmpeg -ss <t> -i <in> -frames:v 1 -q:v 2 <out>`.
- Criar `src/videos/video.processor.ts` — `@Processor(VIDEO_QUEUE, { concurrency })` estendendo `WorkerHost`; `process(job)`:
  - carrega o vídeo; baixa o `storage_key` para um arquivo temporário (via `getObjectRange` sem range / stream);
  - `probe` → `duration_seconds` + `metadata`; `extractThumbnail` → `putObject(thumbnail_key, ...)`;
  - `assertTransition('processing','ready')`, salva `status='ready'`, `duration_seconds`, `metadata`, `thumbnail_key`; limpa o temp.
  - `@OnWorkerEvent('failed')` — quando `job.attemptsMade >= attempts` (retentativas esgotadas), seta `status='error'` + `failure_reason`.
- Criar `src/worker.module.ts` — importa `ConfigModule`, `TypeOrmModule.forRootAsync`, `QueueModule`, `StorageModule`, `VideosModule` (repo) e provê `VideoProcessor` + `FfmpegService` (sem controllers HTTP).
- Criar `src/main.worker.ts` — `NestFactory.createApplicationContext(WorkerModule)` + `app.init()` + `app.enableShutdownHooks()`.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/services/ffmpeg.service.spec.ts` | Unit | `probe`/`extractThumbnail` montam os argumentos corretos e parseiam a saída (com `child_process` mockado). |
| `src/videos/video.processor.integration-spec.ts` | Integration | Com MinIO + Redis + Postgres + ffmpeg reais e um fixture mp4 pequeno: ao enfileirar um vídeo `processing`, o processor extrai duração/metadados, gera e sobe o thumbnail, e o vídeo vira `ready` com `duration_seconds` > 0 e `thumbnail_key` setado. Caso o source seja inválido, após esgotar as tentativas o vídeo vira `error` com `failure_reason`. |

**Dependencies:** SI-03.2, SI-03.3, SI-03.5

**Acceptance criteria:**

- Um vídeo `processing` cujo source é um mp4 válido termina `ready` com `duration_seconds`, `metadata` e `thumbnail_key` preenchidos, e o objeto thumbnail existe no storage.
- Um source inválido leva o vídeo a `error` (com `failure_reason`) somente após esgotar as retentativas do BullMQ.

---

### SI-03.9 — Streaming por Range (GET /videos/:publicId/stream)

**Description:** Endpoint público (vídeos `ready`) que serve o vídeo por range, respondendo `206 Partial Content`, permitindo reprodução sem download completo. (TD-08.)

**Technical actions:**

- `videos.service.ts` — `streamByPublicId(publicId, range)`: resolve o vídeo `ready` (`VideoNotFoundException` se ausente/não-ready); `getObjectRange(storage_key, range)`.
- `videos.controller.ts` — `@Public() GET /videos/:publicId/stream` lê o header `Range` (via `@Headers('range')`) e usa `@Res({ passthrough: false })` para setar status `206`, headers `Content-Range`/`Accept-Ranges: bytes`/`Content-Length`/`Content-Type` e fazer `pipe` do stream. Sem `Range`, responde `200` com `Content-Length` total e `Accept-Ranges: bytes`. Range inválido → `416` `RANGE_NOT_SATISFIABLE`.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `test/videos-stream.e2e-spec.ts` | E2E | Com um vídeo `ready` (source no MinIO): `GET /stream` com `Range: bytes=0-9` retorna `206`, `Content-Range` coerente e 10 bytes; sem `Range` retorna `200` com `Accept-Ranges: bytes`; `publicId` inexistente → `404`. |

**Dependencies:** SI-03.2, SI-03.3

**Acceptance criteria:**

- `GET /videos/:publicId/stream` com `Range` retorna `206` + `Content-Range` + apenas o chunk pedido.
- Vídeo não-`ready` ou inexistente → `404`.

---

### SI-03.10 — Download Presigned e Leitura do Vídeo (GET /videos/:publicId/download, GET /videos/:publicId)

**Description:** Endpoint público de download via URL pré-assinada (arquivo inteiro direto do storage) e endpoint de leitura dos dados do vídeo (status/metadados), útil inclusive para o cliente acompanhar o processamento. (TD-09.)

**Technical actions:**

- `videos.service.ts` — `getDownloadUrl(publicId)`: resolve o vídeo `ready`; `presignDownloadUrl(storage_key, filename)`. `getByPublicId(publicId, requester?)`: retorna os dados públicos; vídeos não-`ready` só são visíveis ao dono (senão `VideoNotFoundException`, sem vazar existência).
- `videos.controller.ts` — `@Public() GET /videos/:publicId/download` responde `302` com `Location` = URL presigned; `GET /videos/:publicId` responde `200` com `{ publicId, title, status, durationSeconds, thumbnailUrl?, channel, createdAt }` (presign do thumbnail quando houver). O `GET /videos/:publicId` é acessível anônimo para `ready`; o guard JWT global é opcional aqui — usar `@Public()` e, quando houver token, identificar o dono para liberar estados não-`ready`.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `test/videos-download.e2e-spec.ts` | E2E | `GET /download` de um vídeo `ready` retorna `302` com `Location` apontando para o bucket/objeto com assinatura; `GET /videos/:publicId` retorna status/metadados; vídeo `draft` é `404` para anônimo e visível para o dono. |

**Dependencies:** SI-03.2, SI-03.3

**Acceptance criteria:**

- `GET /videos/:publicId/download` retorna `302` para uma URL pré-assinada válida (o arquivo completo não passa pela API).
- `GET /videos/:publicId` reflete o `status` atual (permite o cliente acompanhar `processing → ready`).

---

### SI-03.11 — OpenAPI, Wiring Final, Definition of Done e Documentação

**Description:** Registrar os módulos no `AppModule`, anotar os endpoints para o Swagger/OpenAPI já existente, rodar a Definition of Done completa e atualizar o `CLAUDE.md` com a seção de vídeos.

**Technical actions:**

- Registrar `VideosModule`, `QueueModule`, `StorageModule` no `AppModule` (API) — garantindo que a API só **publica** na fila (não roda o `@Processor`, que vive no `WorkerModule`).
- Anotar controllers/DTOs com decorators `@nestjs/swagger` (`@ApiTags('videos')`, `@ApiOperation`, `@ApiResponse`) seguindo o padrão de OpenAPI da Fase 02; regenerar `openapi.json` via `npm run openapi:export`.
- Rodar a Definition of Done: `npm test -- --runInBand`, `npm run test:e2e`, `npx tsc --noEmit` (código 0), `npm run lint`.
- Atualizar `nestjs-project/CLAUDE.md` (e o `CLAUDE.md` raiz) com a seção de vídeos: módulo, endpoints, fila/worker, storage e comandos de execução do worker.
- Atualizar `docs/phases/phase-03-videos/progress.md` com o status final por SI.

**Dependencies:** SI-03.6 … SI-03.10

**Acceptance criteria:**

- `npx tsc --noEmit` sai com código 0; `npm run lint` passa; `npm test` e `npm run test:e2e` verdes.
- `openapi.json` inclui os endpoints de vídeo; `CLAUDE.md` descreve o módulo de vídeos de forma coerente com o código.

## Technical Specifications

### Data Model

#### Video

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | |
| public_id | varchar(16) | unique, not null | URL única (nanoid, 11 chars) |
| channel_id | uuid | FK → channels.id, not null | Dono do vídeo (canal) |
| title | varchar(120) | not null | |
| status | enum `video_status` | not null, default `'draft'` | `draft` \| `processing` \| `ready` \| `error` |
| storage_key | varchar | not null | `videos/{id}/source` |
| thumbnail_key | varchar | nullable | `videos/{id}/thumbnail.jpg` (preenchido pelo worker) |
| upload_id | varchar | nullable | UploadId do multipart; limpo após `complete` |
| original_filename | varchar | nullable | Nome informado no upload |
| content_type | varchar | not null | ex.: `video/mp4` |
| size_bytes | bigint | nullable | Tamanho informado / confirmado no `complete` |
| duration_seconds | int | nullable | Extraído pelo worker (ffprobe) |
| metadata | jsonb | nullable | codec, largura, altura, bitrate (ffprobe) |
| failure_reason | text | nullable | Preenchido quando `status = 'error'` |
| created_at | timestamp | not null, auto-generated | `@CreateDateColumn` |
| updated_at | timestamp | not null, auto-generated | `@UpdateDateColumn` |

**Relations:** Video → Channel (many-to-one, owning side via `channel_id`)
**Indexes:** `(public_id)` — unique, `(channel_id)`, `(status)`

### API Contracts

#### POST /videos (SI-03.6)

**Request headers:** Authorization: Bearer <access_token>; Content-Type: application/json

**Request body:**
- title: string, required — 1..120 chars
- filename: string, required
- contentType: string, required — deve começar com `video/`
- fileSize: integer, required — > 0 e ≤ 10737418240 (10GB)

**Response 201:**
- videoId: string (uuid)
- publicId: string
- status: `"draft"`
- uploadId: string
- partSize: integer (bytes por parte)
- parts: array de `{ partNumber: integer, url: string }` (URLs presigned de UploadPart)

**Error responses:**
- 401: token ausente/inválido
- 413 FILE_TOO_LARGE: `fileSize` acima do máximo
- 415 UNSUPPORTED_MEDIA_TYPE: `contentType` não é `video/*`
- 400 validation error: body fora do schema

---

#### POST /videos/:id/complete (SI-03.7)

**Request headers:** Authorization: Bearer <access_token>; Content-Type: application/json

**Request body:**
- parts: array de `{ partNumber: integer, etag: string }`, required — min 1, ordenável por `partNumber`

**Response 200:**
- publicId: string
- status: `"processing"`

**Error responses:**
- 401: token ausente/inválido
- 403 NOT_VIDEO_OWNER: o vídeo não pertence ao canal do usuário
- 404 VIDEO_NOT_FOUND: `id` inexistente
- 409 INVALID_VIDEO_STATE: vídeo não está em `draft`
- 422 UPLOAD_INCOMPLETE: falha ao finalizar o multipart / objeto ausente
- 400 validation error: body fora do schema

---

#### GET /videos/:publicId (SI-03.10)

**Request headers:** Authorization: Bearer <access_token> (opcional — necessário só para ver estados não-`ready` do próprio canal)

**Response 200:**
- publicId, title, status, durationSeconds (nullable), thumbnailUrl (nullable, presigned), channel: `{ nickname, name }`, createdAt

**Error responses:**
- 404 VIDEO_NOT_FOUND: inexistente, ou não-`ready` para quem não é o dono

---

#### GET /videos/:publicId/stream (SI-03.9)

**Request headers:** Range: bytes=start-end (opcional)

**Response 206 (com Range):** corpo = fatia de bytes. Headers: `Content-Range: bytes start-end/total`, `Accept-Ranges: bytes`, `Content-Length` (do chunk), `Content-Type`.
**Response 200 (sem Range):** corpo = objeto completo. Headers: `Content-Length` (total), `Accept-Ranges: bytes`, `Content-Type`.

**Error responses:**
- 404 VIDEO_NOT_FOUND: inexistente ou não-`ready`
- 416 RANGE_NOT_SATISFIABLE: range fora dos limites do objeto

---

#### GET /videos/:publicId/download (SI-03.10)

**Response 302:** `Location` = URL pré-assinada de GetObject (download direto do storage, `Content-Disposition: attachment`).

**Error responses:**
- 404 VIDEO_NOT_FOUND: inexistente ou não-`ready`

#### Validation Rules — Upload

| Field | Rule | Error |
|-------|------|-------|
| title | 1..120 chars | title must be longer than or equal to 1 / shorter than or equal to 120 |
| contentType | começa com `video/` | 415 UNSUPPORTED_MEDIA_TYPE |
| fileSize | inteiro > 0 e ≤ 10GB | 413 FILE_TOO_LARGE |
| parts[].partNumber | inteiro ≥ 1 | partNumber must not be less than 1 |
| parts[].etag | string não-vazia | etag should not be empty |

---

### Authorization Matrix

| Endpoint | Public | Authenticated | Notes |
|----------|--------|---------------|-------|
| POST /videos | | ✓ | Dono = canal do usuário autenticado |
| POST /videos/:id/complete | | ✓ | Apenas o dono do vídeo |
| GET /videos/:publicId | ✓ (ready) | ✓ (dono vê todos os estados) | Estados não-`ready` só para o dono |
| GET /videos/:publicId/stream | ✓ (ready) | | Acesso anônimo a vídeos prontos |
| GET /videos/:publicId/download | ✓ (ready) | | Acesso anônimo a vídeos prontos |

---

### Error Catalog

**Error response format:** `{ statusCode: number, error: string, message: string }` (herdado da Fase 02; filtro `@Catch(DomainException)`).

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| VIDEO_NOT_FOUND | 404 | Video not found | publicId/id inexistente, ou vídeo não-`ready` acessado por quem não é o dono |
| NOT_VIDEO_OWNER | 403 | You do not own this video | `complete` (ou ação de dono) em vídeo de outro canal |
| INVALID_VIDEO_STATE | 409 | Video is not in a valid state for this operation | `complete` em vídeo que não está `draft`; transição de status inválida |
| FILE_TOO_LARGE | 413 | File exceeds the maximum allowed size | `POST /videos` com `fileSize` > 10GB |
| UNSUPPORTED_MEDIA_TYPE | 415 | Unsupported media type | `contentType` não inicia com `video/` |
| UPLOAD_INCOMPLETE | 422 | Upload could not be finalized | `CompleteMultipartUpload`/`HeadObject` falha no `complete` |
| RANGE_NOT_SATISFIABLE | 416 | Requested range not satisfiable | `Range` fora dos limites do objeto no `stream` |

---

### Events / Messages

**Transport:** BullMQ sobre Redis (TD-01). Conexão configurada em `BullModule.forRootAsync` (`connection: { host: REDIS_HOST, port: REDIS_PORT }`).

**Queue:** `video-processing`

| Aspecto | Valor |
|--------|-------|
| Job name | `process` |
| Payload | `{ videoId: string }` (`ProcessVideoJobData`) |
| Producer | `VideoQueueService.enqueueProcessing(videoId)` — chamado por `POST /videos/:id/complete` (SI-03.7) após transicionar para `processing` |
| Consumer | `VideoProcessor` (`@Processor('video-processing', { concurrency: VIDEO_PROCESSING_CONCURRENCY })`), no container `video-worker` (SI-03.8) |
| Retry | `attempts = VIDEO_PROCESSING_ATTEMPTS` (default 5), `backoff: { type: 'exponential', delay: 2000 }` |
| removeOnComplete / removeOnFail | `true` / `false` |

**Fluxo do evento:**

```
API: POST /videos/:id/complete
  → CompleteMultipartUpload + HeadObject
  → video.status = processing  (DB)
  → queue.add('process', { videoId })           [produz o evento]

Worker (video-worker container):
  VideoProcessor.process(job):
    → download source (storage)
    → ffprobe (duração + metadados)
    → ffmpeg (thumbnail) → putObject (storage)
    → video.status = ready; duration_seconds, metadata, thumbnail_key  (DB)
  on throw → BullMQ retry (exponential backoff)
  OnWorkerEvent('failed') com attemptsMade >= attempts:
    → video.status = error; failure_reason  (DB)
```

## Dependency Map

```
SI-03.1 (no deps)
├── SI-03.2 (storage service)
├── SI-03.3 (entity + migration)
│   └── SI-03.4 (public id + status + exceptions)
└── SI-03.5 (queue + producer)

SI-03.2 + SI-03.3 + SI-03.4 → SI-03.6 (initiate)
SI-03.6 + SI-03.5            → SI-03.7 (complete)

SI-03.2 + SI-03.3 + SI-03.5 → SI-03.8 (worker + ffmpeg)

SI-03.2 + SI-03.3 → SI-03.9  (stream)
SI-03.2 + SI-03.3 → SI-03.10 (download + read)

SI-03.6 … SI-03.10 → SI-03.11 (openapi + DoD + docs)
```

Ordem linearizada: SI-03.1 → (SI-03.2, SI-03.3, SI-03.5 em paralelo) → SI-03.4 → SI-03.6 → SI-03.7 → SI-03.8 → (SI-03.9, SI-03.10 em paralelo) → SI-03.11.

## Deliverables

- [ ] Upload de vídeo de até 10GB direto ao storage via multipart presigned, sem passar pela API (pré-cadastro como `draft` na initiate)
- [ ] Finalização do upload (`complete`) transiciona para `processing` e enfileira o job
- [ ] Processamento automático no worker: extração de duração/metadados (ffprobe) e geração de thumbnail (ffmpeg)
- [ ] URL única por vídeo (`public_id` via nanoid, constraint `UNIQUE`)
- [ ] Streaming por range com `206 Partial Content` (reprodução sem download completo)
- [ ] Download via URL pré-assinada (arquivo inteiro direto do storage)
- [ ] Ciclo de status `draft → processing → ready | error` refletido no banco, com `failure_reason` no erro
- [ ] Object storage (MinIO), fila (Redis) e worker subindo via `docker compose` junto com o backend
- [ ] Migration cria a tabela `videos` (enum `video_status`, FK para `channels`, índices)
- [ ] Testes unit/integração/e2e verdes, exercitando MinIO/Redis/Postgres/FFmpeg reais do Compose
- [ ] `npx tsc --noEmit` código 0; `npm run lint` passa
- [ ] OpenAPI atualizado com os endpoints de vídeo
- [ ] `CLAUDE.md` atualizado com a seção de vídeos, coerente com o código
- [ ] `progress.md` da fase atualizado (status + testes por SI)
