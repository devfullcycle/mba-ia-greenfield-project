---
kind: phase
name: phase-03-upload
sources_mtime:
  docs/project-plan.md: "2026-11-03T15:00:00-03:00"
  docs/decisions/technical-decisions-upload-processing.md: "2026-11-03T15:58:51-03:00"
  docs/phases/phase-02-auth/phase-02-auth.md: "2026-04-08T14:58:57-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Implementar o pipeline completo de vídeo: upload de arquivos de até 10GB com streaming direto para MinIO, processamento assíncrono via BullMQ+Redis (extração de metadados e thumbnail com FFmpeg), streaming com HTTP Range requests, e download de vídeos — tudo no backend NestJS, sem frontend.

---

## Step Implementations

### SI-03.1 — Infraestrutura Docker: MinIO + Redis

**Description:** Adicionar os serviços MinIO (object storage) e Redis (backend do BullMQ) ao Docker Compose do nestjs-project, configurar variáveis de ambiente e criar o namespace de config de storage.

**Technical actions:**

- Adicionar serviço `minio` ao `nestjs-project/compose.yaml` — imagem `minio/minio:latest`, porta 9000 (API S3-compatible) e 9001 (console web), volume para persistência, variáveis `MINIO_ROOT_USER` e `MINIO_ROOT_PASSWORD`, comando `server /data --console-address ":9001"`, healthcheck via `mc ready local`
- Adicionar serviço `redis` ao `nestjs-project/compose.yaml` — imagem `redis:7-alpine`, porta 6379, healthcheck via `redis-cli ping`
- Adicionar `minio` e `redis` ao `depends_on` do serviço `nestjs-api`
- Criar `src/config/storage.config.ts` — `registerAs('storage', ...)` lendo `STORAGE_ENDPOINT` (string, default `'minio'`), `STORAGE_PORT` (number, default `9000`), `STORAGE_ACCESS_KEY` (string, required), `STORAGE_SECRET_KEY` (string, required), `STORAGE_BUCKET_VIDEOS` (string, default `'videos'`), `STORAGE_BUCKET_THUMBNAILS` (string, default `'thumbnails'`), `STORAGE_USE_SSL` (boolean, default `false`)
- Criar `src/config/queue.config.ts` — `registerAs('queue', ...)` lendo `REDIS_HOST` (string, default `'redis'`), `REDIS_PORT` (number, default `6379`)
- Atualizar `src/config/env.validation.ts` — adicionar `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` como required; demais variáveis com defaults. Atualizar `.env.example` com valores de desenvolvimento

**Dependencies:** None

**Acceptance criteria:**

- `docker compose up -d` sobe todos os serviços incluindo `minio` e `redis` sem erros
- Console MinIO acessível em `http://localhost:9001` com as credenciais configuradas
- Redis responde a `redis-cli -h localhost ping` retornando `PONG`
- Aplicação NestJS inicia sem erro quando `STORAGE_ACCESS_KEY` e `STORAGE_SECRET_KEY` estão presentes
- Iniciar a aplicação sem `STORAGE_ACCESS_KEY` causa erro de validação Joi no bootstrap

---

### SI-03.2 — Entidade Video e Migration

**Description:** Criar a entidade `Video` com todos os campos necessários para a Fase 03, gerar e executar a migration TypeORM.

**Technical actions:**

- Criar `src/videos/entities/video.entity.ts` — entidade `Video` com campos: `id` (uuid, PK gerado), `title` (varchar 255, nullable — rascunho pode não ter título), `description` (text, nullable), `status` (enum `VideoStatus`, not null, default `PENDING_UPLOAD`), `duration_seconds` (float, nullable — preenchido pelo worker), `original_filename` (varchar 255, not null), `storage_key` (varchar 500, nullable — chave do arquivo no MinIO, preenchida após upload), `thumbnail_key` (varchar 500, nullable — chave da thumbnail no MinIO, preenchida pelo worker), `error_message` (text, nullable — mensagem de erro se status = ERROR), `channel_id` (uuid, FK para `channels.id`, not null), `created_at` (timestamp, auto), `updated_at` (timestamp, auto)
- Criar enum `VideoStatus` no mesmo arquivo: `PENDING_UPLOAD = 'pending_upload'`, `PROCESSING = 'processing'`, `READY = 'ready'`, `ERROR = 'error'`
- Criar relação `Video` → `Channel` (many-to-one, `channel_id` como FK, `eager: false`)
- Adicionar index em `channel_id` para queries de listagem por canal
- Criar `src/videos/videos.module.ts` — módulo base com `TypeOrmModule.forFeature([Video])`
- Registrar `VideosModule` no `AppModule`
- Gerar migration: `npm run migration:generate -- src/database/migrations/Phase03-AddVideoTable`
- Executar migration: `npm run migration:run`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/entities/video.entity.integration-spec.ts` | Integration | Constraints (channel_id FK, status default, nullable fields), índice em channel_id |
| `src/videos/videos.module.spec.ts` | Unit | Compilação do módulo com TypeOrmModule.forFeature([Video]) |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- Migration executa sem erro e cria a tabela `videos` com todos os campos especificados
- Status padrão ao criar `Video` sem especificar status é `PENDING_UPLOAD`
- Inserir `Video` sem `channel_id` válido falha com constraint de FK
- Campos `storage_key`, `thumbnail_key`, `duration_seconds` e `title` aceitam `null`
- Campo `original_filename` não aceita `null`

---

### SI-03.3 — StorageService (MinIO Integration)

**Description:** Criar o módulo e serviço de storage que encapsula operações com o MinIO via AWS SDK S3-compatible, incluindo upload, download como stream e geração de URL de acesso.

**Technical actions:**

- Instalar dependências: `@aws-sdk/client-s3@^3.x`, `@aws-sdk/lib-storage@^3.x`
- Criar `src/storage/storage.module.ts` — módulo global que exporta `StorageService`, usa `ConfigModule` para injetar `storage.config.ts`
- Criar `src/storage/storage.service.ts` — serviço com métodos:
  - `uploadStream(key: string, stream: Readable, contentType: string, bucket: string): Promise<void>` — usa `Upload` do `@aws-sdk/lib-storage` para upload multipart de streams grandes
  - `getObjectStream(key: string, bucket: string, range?: string): Promise<{ stream: Readable; contentLength: number; contentRange?: string }>` — retorna stream do objeto com suporte a Range header
  - `deleteObject(key: string, bucket: string): Promise<void>` — deleta objeto
  - `ensureBucketExists(bucketName: string): Promise<void>` — cria o bucket se não existir (chamado no `onModuleInit`)
- No `onModuleInit` do `StorageService`, chamar `ensureBucketExists` para os buckets `videos` e `thumbnails`
- Registrar `StorageModule` como global no `AppModule`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/storage/storage.service.spec.ts` | Unit | uploadStream, getObjectStream, deleteObject com mock do S3Client |
| `src/storage/storage.module.spec.ts` | Unit | Compilação do módulo com ConfigModule |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- `StorageService.uploadStream()` com um stream válido persiste o objeto no MinIO sem erro
- `StorageService.getObjectStream()` retorna stream do objeto armazenado
- `StorageService.getObjectStream()` com range `bytes=0-1023` retorna apenas os primeiros 1024 bytes (status implícito 206)
- `StorageService.ensureBucketExists()` cria o bucket se ele não existir e não falha se já existir
- `StorageService.deleteObject()` remove o objeto do MinIO sem erro

---

### SI-03.4 — Upload Endpoint (POST /videos/upload)

**Description:** Implementar o endpoint de upload de vídeos que cria o rascunho, faz streaming do arquivo para MinIO e retorna o vídeo criado.

**Technical actions:**

- Instalar dependência: `@types/multer@^1.x` (tipos para multer)
- Criar `src/videos/videos.service.ts` — com método `uploadVideo(channelId: string, file: Express.Multer.File, originalFilename: string): Promise<Video>`:
  - Criar entidade `Video` com status `PENDING_UPLOAD`, `original_filename`, `channel_id`
  - Salvar no banco de dados
  - Gerar `storage_key` = `videos/{videoId}/{originalFilename}`
  - Chamar `StorageService.uploadStream()` com o stream do arquivo
  - Atualizar `storage_key` na entidade e status para `PROCESSING`
  - Salvar e retornar o vídeo atualizado
- Criar `src/videos/dto/upload-video.dto.ts` — DTO vazio (upload via multipart não usa body JSON) com comentário explicativo
- Criar `src/videos/dto/video-response.dto.ts` — DTO de resposta com campos: `id`, `title`, `status`, `duration_seconds`, `original_filename`, `channel_id`, `created_at`, `updated_at`
- Criar `src/videos/videos.controller.ts` — controller com `@Controller('videos')`:
  - `POST /videos/upload` — usa `@UseInterceptors(FileInterceptor('file'))`, `@UploadedFile()`, extrai `channelId` do JWT (`@CurrentUser()`), chama `VideosService.uploadVideo()`. Retorna 201 com `VideoResponseDto`
- Configurar `multer` sem `dest` (memória/stream) e sem limite de tamanho no controller (limite configurado no NestJS factory via `bodyParser: false` ou via opção do multer)
- Em `src/main.ts`, configurar o NestJS para aceitar arquivos grandes: aumentar o limit do body parser ou desabilitar para usar multer direto

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | uploadVideo: cria Video no status correto, chama StorageService.uploadStream, atualiza storage_key |
| `src/videos/videos.service.integration-spec.ts` | Integration | uploadVideo persiste Video no banco com campos corretos |
| `test/videos.e2e-spec.ts` | E2E | POST /videos/upload: 201 com video criado, 401 sem auth, 400 sem arquivo |

**Dependencies:** SI-03.2, SI-03.3

**Acceptance criteria:**

- `POST /videos/upload` com arquivo válido e token JWT retorna 201 com `{ id, status: "processing", original_filename, channel_id, ... }`
- `POST /videos/upload` sem Authorization header retorna 401
- `POST /videos/upload` sem arquivo no campo `file` retorna 400
- Após upload bem-sucedido, o arquivo está acessível no MinIO no bucket `videos`
- A entidade `Video` é criada no banco com `channel_id` do usuário autenticado e `status = 'processing'`
- Upload de arquivo de 1GB completa sem timeout ou erro de memória

---

### SI-03.5 — Queue Module e Video Processing Job

**Description:** Configurar o módulo BullMQ no NestJS, criar o job de processamento de vídeo, e publicar o job na fila após o upload ser concluído.

**Technical actions:**

- Instalar dependências: `@nestjs/bullmq@^11.x`, `bullmq@^5.x`, `ioredis@^5.x`
- Criar `src/queue/queue.module.ts` — módulo global usando `BullModule.forRootAsync()` com configuração do Redis via `queue.config.ts`. Registrar a fila `'video-processing'` via `BullModule.registerQueue({ name: 'video-processing' })`
- Criar `src/queue/jobs/video-processing.job.ts` — interface/type `VideoProcessingJob` com campos: `videoId: string`, `storageKey: string`, `bucket: string`
- Adicionar `QueueModule` ao `AppModule`
- Injetar `Queue` do BullMQ no `VideosService` e adicionar método `publishVideoProcessingJob(videoId: string, storageKey: string): Promise<void>` que adiciona o job `'process-video'` à fila `'video-processing'`
- Chamar `publishVideoProcessingJob` ao final de `uploadVideo()` no `VideosService`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/queue/queue.module.spec.ts` | Unit | Compilação do módulo BullMQ com Redis config |
| `src/videos/videos.service.spec.ts` | Unit | publishVideoProcessingJob chamado após upload bem-sucedido |

**Dependencies:** SI-03.4

**Acceptance criteria:**

- Após `POST /videos/upload` bem-sucedido, um job `'process-video'` aparece na fila `'video-processing'` no Redis
- O job contém `videoId`, `storageKey` e `bucket` corretos
- Se a publicação do job falhar (Redis indisponível), o erro é logado mas o vídeo já salvo permanece com `status = 'processing'`

---

### SI-03.6 — Video Worker (BullMQ Processor + FFmpeg)

**Description:** Criar o módulo worker com o processor BullMQ que consome jobs da fila, baixa o vídeo do MinIO, extrai metadados com FFprobe e gera thumbnail com FFmpeg.

**Technical actions:**

- Instalar dependências: `fluent-ffmpeg@^2.x`, `@ffmpeg-installer/ffmpeg@^1.x`, `@ffprobe-installer/ffprobe@^1.x`, `@types/fluent-ffmpeg@^2.x`
- Criar `src/video-worker/video-worker.module.ts` — módulo com `BullModule.registerQueue({ name: 'video-processing' })` e provider do processor
- Criar `src/video-worker/services/ffmpeg.service.ts` — serviço que encapsula operações FFmpeg:
  - `extractMetadata(inputPath: string): Promise<{ duration: number; width: number; height: number }>` — usa `ffprobe` para extrair duração e dimensões do vídeo
  - `generateThumbnail(inputPath: string, outputPath: string, timemarkSeconds: number): Promise<void>` — usa `ffmpeg` para capturar frame no tempo especificado e salvar como JPEG
  - Configurar os paths dos binários via `@ffmpeg-installer/ffmpeg` e `@ffprobe-installer/ffprobe`
- Criar `src/video-worker/video-processing.processor.ts` — `@Processor('video-processing')` com método `@Process('process-video')`:
  - Baixar o vídeo do MinIO como stream e salvar em arquivo temporário em `/tmp/`
  - Chamar `FfmpegService.extractMetadata()` para extrair duração
  - Chamar `FfmpegService.generateThumbnail()` para gerar thumbnail (no segundo 5 ou no primeiro frame disponível)
  - Fazer upload da thumbnail para o bucket `thumbnails` via `StorageService`
  - Atualizar o `Video` no banco: `status = 'ready'`, `duration_seconds`, `thumbnail_key`
  - Em caso de erro: atualizar `status = 'error'`, `error_message = error.message`
  - Limpar arquivos temporários em `/tmp/` após processamento (success ou error)
- Registrar `VideoWorkerModule` no `AppModule`

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/video-worker/services/ffmpeg.service.spec.ts` | Unit | extractMetadata e generateThumbnail com mock do fluent-ffmpeg |
| `src/video-worker/video-processing.processor.spec.ts` | Unit | Processor: fluxo happy path (status READY), fluxo de erro (status ERROR) |

**Dependencies:** SI-03.5

**Acceptance criteria:**

- Após processamento bem-sucedido, `Video.status` = `'ready'`, `duration_seconds` preenchido, `thumbnail_key` preenchido
- Thumbnail gerada está acessível no MinIO no bucket `thumbnails`
- Se FFmpeg falhar (arquivo corrompido), `Video.status` = `'error'` e `error_message` contém a mensagem de erro
- Arquivos temporários em `/tmp/` são removidos após o processamento (sucesso ou falha)
- Job com erro retorna para a fila com retry automático (configuração de retry do BullMQ)

---

### SI-03.7 — Streaming Endpoint (GET /videos/:id/stream)

**Description:** Implementar o endpoint de streaming com suporte a HTTP Range requests (206 Partial Content), permitindo que players de vídeo HTML5 façam seek sem download completo.

**Technical actions:**

- Adicionar método `streamVideo(videoId: string, rangeHeader?: string): Promise<{ stream: Readable; headers: Record<string, string | number>; status: number }>` no `VideosService`:
  - Buscar `Video` pelo `id`, verificar se existe e se `status = 'ready'` (lançar exceções domínio apropriadas)
  - Chamar `StorageService.getObjectStream()` passando o `storage_key` e o `range` header
  - Retornar stream e headers (`Content-Type`, `Content-Length`, `Content-Range`, `Accept-Ranges: bytes`)
- Criar exceções de domínio: `VideoNotFoundException` (404), `VideoNotReadyException` (409)
- Adicionar as novas exceções ao `DomainExceptionFilter` existente e ao Error Catalog
- Adicionar endpoint `GET /videos/:id/stream` no `VideosController`:
  - Extrair `Range` header da request
  - Chamar `VideosService.streamVideo()`
  - Definir response headers e status (200 ou 206)
  - Retornar `new StreamableFile(stream)` via `@Res({ passthrough: true })`
- Marcar o endpoint como `@Public()` (streaming é anônimo conforme project-plan)

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | streamVideo: lança VideoNotFoundException para ID inválido, lança VideoNotReadyException para status != ready |
| `test/videos.e2e-spec.ts` | E2E | GET /videos/:id/stream: 200 com Content-Type video/*, 206 com Range header, 404 para ID inválido, 409 para vídeo não ready |

**Dependencies:** SI-03.6

**Acceptance criteria:**

- `GET /videos/:id/stream` com vídeo `ready` e sem Range header retorna 200 com `Content-Type: video/*` e stream do arquivo
- `GET /videos/:id/stream` com header `Range: bytes=0-1023` retorna 206 com `Content-Range` e apenas os bytes solicitados
- `GET /videos/:id/stream` com ID inexistente retorna 404 com `VIDEO_NOT_FOUND`
- `GET /videos/:id/stream` com vídeo no status `processing` retorna 409 com `VIDEO_NOT_READY`
- Endpoint é público (não requer autenticação)

---

### SI-03.8 — Download Endpoint (GET /videos/:id/download)

**Description:** Implementar o endpoint de download que retorna o arquivo completo com header `Content-Disposition: attachment`, permitindo download direto pelo usuário.

**Technical actions:**

- Adicionar método `downloadVideo(videoId: string): Promise<{ stream: Readable; filename: string; contentLength: number }>` no `VideosService`:
  - Buscar `Video` pelo `id`, verificar existência e status `ready`
  - Chamar `StorageService.getObjectStream()` sem range (arquivo completo)
  - Retornar stream, `original_filename` e `contentLength`
- Adicionar endpoint `GET /videos/:id/download` no `VideosController`:
  - Chamar `VideosService.downloadVideo()`
  - Definir headers: `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="${filename}"`, `Content-Length`
  - Retornar `new StreamableFile(stream)` via `@Res({ passthrough: true })`
- Marcar o endpoint como `@Public()` (download é anônimo, como o streaming)

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `test/videos.e2e-spec.ts` | E2E | GET /videos/:id/download: 200 com Content-Disposition attachment, 404 para ID inválido |

**Dependencies:** SI-03.7

**Acceptance criteria:**

- `GET /videos/:id/download` com vídeo `ready` retorna 200 com `Content-Disposition: attachment; filename="<original_filename>"`
- `GET /videos/:id/download` com ID inexistente retorna 404 com `VIDEO_NOT_FOUND`
- `GET /videos/:id/download` com vídeo `processing` retorna 409 com `VIDEO_NOT_READY`
- Endpoint é público (não requer autenticação)

---

### SI-03.9 — GET /videos/:id (Status do Vídeo)

**Description:** Implementar endpoint para consultar o status e metadados de um vídeo, permitindo que o cliente faça polling do progresso do processamento.

**Technical actions:**

- Adicionar método `findVideoById(videoId: string): Promise<Video>` no `VideosService` — busca o vídeo ou lança `VideoNotFoundException`
- Adicionar endpoint `GET /videos/:id` no `VideosController`:
  - Chamar `VideosService.findVideoById()`
  - Retornar `VideoResponseDto` (com todos os campos incluindo `status`, `duration_seconds`, `thumbnail_key`)
- Marcar o endpoint como `@Public()` (status de vídeo pode ser público)

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | findVideoById: retorna vídeo existente, lança VideoNotFoundException |
| `test/videos.e2e-spec.ts` | E2E | GET /videos/:id: 200 com video data, 404 para ID inválido |

**Dependencies:** SI-03.4

**Acceptance criteria:**

- `GET /videos/:id` com ID válido retorna 200 com `{ id, status, duration_seconds, thumbnail_key, ... }`
- `GET /videos/:id` com ID inexistente retorna 404 com `VIDEO_NOT_FOUND`
- Endpoint é público (não requer autenticação)

---

## Technical Specifications

### Data Model

#### Video

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | |
| title | varchar(255) | nullable | Rascunho pode não ter título |
| description | text | nullable | |
| status | enum VideoStatus | NOT NULL, default 'pending_upload' | Valores: pending_upload, processing, ready, error |
| duration_seconds | float | nullable | Preenchido pelo worker após processamento |
| original_filename | varchar(255) | NOT NULL | Nome original do arquivo enviado |
| storage_key | varchar(500) | nullable | Chave do vídeo no MinIO (ex: videos/{id}/filename.mp4) |
| thumbnail_key | varchar(500) | nullable | Chave da thumbnail no MinIO (ex: thumbnails/{id}/thumb.jpg) |
| error_message | text | nullable | Mensagem de erro quando status = 'error' |
| channel_id | uuid | NOT NULL, FK → channels.id | |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

**Relations:** Video → Channel (many-to-one, channel_id FK)  
**Indexes:** `channel_id` — index para queries de listagem por canal

---

### API Contracts

#### POST /videos/upload (SI-03.4)

**Request headers:**
- Authorization: Bearer `<access_token>` (required)
- Content-Type: multipart/form-data

**Request body (multipart):**
- `file`: binary, required — arquivo de vídeo (mp4, mov, avi, mkv, webm); sem limite de tamanho definido no backend (suporta até 10GB)

**Response 201:**
```json
{
  "id": "uuid",
  "title": null,
  "status": "processing",
  "duration_seconds": null,
  "original_filename": "meu-video.mp4",
  "channel_id": "uuid",
  "created_at": "2026-11-03T...",
  "updated_at": "2026-11-03T..."
}
```

**Response headers:**
- Location: /videos/:id

**Error responses:**
- 401 UNAUTHORIZED: sem token ou token inválido
- 400 validation error: sem arquivo no campo `file`

---

#### GET /videos/:id (SI-03.9)

**Request headers:** (nenhum — endpoint público)

**Response 200:**
```json
{
  "id": "uuid",
  "title": null,
  "status": "ready | processing | error | pending_upload",
  "duration_seconds": 125.4,
  "original_filename": "meu-video.mp4",
  "thumbnail_key": "thumbnails/uuid/thumb.jpg",
  "channel_id": "uuid",
  "created_at": "2026-11-03T...",
  "updated_at": "2026-11-03T..."
}
```

**Error responses:**
- 404 VIDEO_NOT_FOUND: ID não existe

---

#### GET /videos/:id/stream (SI-03.7)

**Request headers:**
- Range: bytes=0-1023 (opcional — para streaming parcial)

**Response 200** (sem Range header):
- Body: stream binário do vídeo
- Content-Type: video/mp4 (ou conforme formato)
- Accept-Ranges: bytes

**Response 206** (com Range header):
- Body: stream binário parcial
- Content-Type: video/mp4
- Content-Range: bytes 0-1023/50000000
- Accept-Ranges: bytes

**Error responses:**
- 404 VIDEO_NOT_FOUND: ID não existe
- 409 VIDEO_NOT_READY: vídeo ainda em processamento ou com erro

---

#### GET /videos/:id/download (SI-03.8)

**Request headers:** (nenhum — endpoint público)

**Response 200:**
- Body: stream binário do vídeo completo
- Content-Disposition: attachment; filename="original-filename.mp4"
- Content-Type: application/octet-stream
- Content-Length: `<tamanho em bytes>`

**Error responses:**
- 404 VIDEO_NOT_FOUND: ID não existe
- 409 VIDEO_NOT_READY: vídeo ainda em processamento ou com erro

---

### Authorization Matrix

| Endpoint | Public | Authenticated |
|----------|--------|---------------|
| POST /videos/upload | | ✓ |
| GET /videos/:id | ✓ | |
| GET /videos/:id/stream | ✓ | |
| GET /videos/:id/download | ✓ | |

---

### Error Catalog

_(Herdado de Fase 02: `{ statusCode, error, message }`)_

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| VIDEO_NOT_FOUND | 404 | Video not found | GET/stream/download com ID que não existe na tabela videos |
| VIDEO_NOT_READY | 409 | Video is not ready for streaming | GET stream/download com video.status != 'ready' |

---

### Events/Messages

| Event | Payload | Publisher | Consumer | Delivery |
|-------|---------|-----------|----------|----------|
| process-video | `{ videoId: string, storageKey: string, bucket: string }` | VideosService | VideoProcessingProcessor | ack-required (BullMQ) |

---

## Dependency Map

```
SI-03.1 (infra Docker: MinIO + Redis)
├── SI-03.2 (entidade Video + migration)
│   ├── SI-03.4 (upload endpoint)
│   │   ├── SI-03.5 (queue module + publicar job)
│   │   │   └── SI-03.6 (worker + FFmpeg)
│   │   │       ├── SI-03.7 (streaming endpoint)
│   │   │       │   └── SI-03.8 (download endpoint)
│   │   └── SI-03.9 (GET /videos/:id status)
└── SI-03.3 (StorageService MinIO)
    └── SI-03.4
```

---

## Deliverables

- [x] MinIO acessível em `http://localhost:9001` com console funcional
- [x] Redis respondendo na porta 6379
- [x] Tabela `videos` criada no PostgreSQL via migration
- [x] `POST /videos/upload` aceita arquivos de até 10GB e retorna vídeo com status `processing`
- [x] Job de processamento publicado na fila BullMQ após upload
- [x] Worker consome o job e processa o vídeo com FFmpeg (extrai duração, gera thumbnail)
- [x] Vídeo atualizado para `status: ready` com `duration_seconds` e `thumbnail_key` preenchidos
- [x] `GET /videos/:id/stream` suporta Range requests (206 Partial Content)
- [x] `GET /videos/:id/download` retorna arquivo completo com Content-Disposition attachment
- [x] `GET /videos/:id` retorna status e metadados do vídeo
- [x] Todos os testes de SI passam (`docker compose exec nestjs-api npm test`)
- [x] Testes E2E passam (`docker compose exec nestjs-api npm run test:e2e`)
- [x] TypeScript compila sem erros (`docker compose exec nestjs-api npx tsc --noEmit`)
- [x] Lint passa (`docker compose exec nestjs-api npm run lint`)
