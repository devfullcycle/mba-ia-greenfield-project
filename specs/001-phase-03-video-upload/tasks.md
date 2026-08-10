# Tasks: Phase 03 — Upload e Processamento de Vídeos

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Data Model**: [data-model.md](data-model.md) | **Contracts**: [contracts/videos-api.md](contracts/videos-api.md)

**Stack**: NestJS 11, BullMQ + Redis, AWS SDK S3 (MinIO), fluent-ffmpeg, TypeORM, PostgreSQL

**User Stories**: US1 (P1), US2 (P2), US5 (P2 → merged into US1), US3 (P3), US6 (P3), US4 (P4)

**Convenção de Nomenclatura**: descrições de tasks usam nomes de exceção HTTP do NestJS como shorthand (ex.: `ForbiddenException`, `NotFoundException`, `ConflictException`) — a implementação usa exceções de domínio do projeto (ex.: `VideoOwnershipException`, `ChannelRequiredException`, `VideoNotFoundException`, `VideoNotReadyException`). Ver `src/videos/exceptions/` para o mapeamento completo.

---

## Phase 1: Setup — Infraestrutura & Dependências

**Purpose**: Instalar pacotes, configurar serviços Docker e criar arquivos de configuração. Sem pré-requisitos — pode iniciar imediatamente.

- [X] T001 Instalar dependências BullMQ em `nestjs-project/`: `@nestjs/bullmq`, `bullmq`, `ioredis` (via `npm install` dentro do container ou editando `package.json` + rebuild)
- [X] T002 [P] Instalar dependências AWS SDK em `nestjs-project/`: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
- [X] T003 [P] Instalar dependências FFmpeg em `nestjs-project/`: `fluent-ffmpeg`, `@ffprobe-installer/ffprobe` (produção); instalar `@types/fluent-ffmpeg` como devDependency (`npm install --save-dev @types/fluent-ffmpeg`)
- [X] T004 [P] Adicionar serviço MinIO a `nestjs-project/compose.yaml`: image `minio/minio`, ports `9000:9000` e `9001:9001`, health check via `mc ready /data`, volume persistente, variáveis `MINIO_ROOT_USER` e `MINIO_ROOT_PASSWORD`
- [X] T005 [P] Adicionar serviço Redis a `nestjs-project/compose.yaml`: image `redis:7-alpine`, port `6379:6379`, health check via `redis-cli ping`
- [X] T006 Criar `nestjs-project/Dockerfile.worker`: base `node:22-slim`, instalar `ffmpeg` via `apt-get`, copiar projeto, rodar `npm run build`, CMD aponta para `dist/worker.js`
- [X] T007 Adicionar serviço `video-worker` a `nestjs-project/compose.yaml`: `build: { dockerfile: Dockerfile.worker }`, `depends_on` em `redis`, `db` e `minio` (com health check conditions), mesmas variáveis de ambiente do `nestjs-api` mais as de storage e fila
- [X] T008 [P] Criar `nestjs-project/src/config/storage.config.ts`: `registerAs('storage', ...)` com campos `endpoint`, `accessKey`, `secretKey`, `bucket` lidos das envs `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET`
- [X] T009 [P] Criar `nestjs-project/src/config/queue.config.ts`: `registerAs('queue', ...)` com campos `host`, `port`, `password` (opcional) lidos das envs `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- [X] T010 Atualizar `nestjs-project/src/config/env.validation.ts`: adicionar ao schema Joi as validações para `STORAGE_ENDPOINT` (string, obrigatório), `STORAGE_ACCESS_KEY` (string, obrigatório), `STORAGE_SECRET_KEY` (string, obrigatório), `STORAGE_BUCKET` (string, obrigatório), `REDIS_HOST` (string, default `'redis'`), `REDIS_PORT` (number, default `6379`), `REDIS_PASSWORD` (string, opcional); atualizar `nestjs-project/.env.example` com valores de desenvolvimento padrão: `STORAGE_ENDPOINT=http://minio:9000`, `STORAGE_ACCESS_KEY=streamtube`, `STORAGE_SECRET_KEY=streamtube`, `STORAGE_BUCKET=streamtube`, `REDIS_HOST=redis`, `REDIS_PORT=6379`; adicionar as mesmas variáveis na seção `environment:` do serviço `nestjs-api` em `compose.yaml`

**Checkpoint**: Infraestrutura configurada. Docker Compose sobe API + PostgreSQL + Redis + MinIO + worker. Pacotes disponíveis no container.

---

## Phase 2: Foundational — Módulo Base & Entidade

**Purpose**: Entidade Video, migration, StorageModule e scaffolds dos módulos. Bloqueia TODAS as User Stories — deve ser concluída primeiro.

**⚠️ CRÍTICO**: Nenhuma User Story pode começar até esta fase estar completa.

- [X] T011 Criar `nestjs-project/src/videos/entities/video.entity.ts`: `@Entity('videos')`, PK UUID v4 `@PrimaryGeneratedColumn('uuid')`, campos `title varchar(255)`, `status` com `@Column({ type: 'enum', enum: VideoStatus, default: VideoStatus.DRAFT })`, `channelId UUID NOT NULL` com `@ManyToOne(() => Channel)` e `@JoinColumn`, `storageKey varchar NOT NULL`, `thumbnailKey varchar nullable`, `durationSeconds integer nullable`, `processingMetadata jsonb nullable`, `errorCause varchar(2048) nullable`, `@CreateDateColumn` e `@UpdateDateColumn`
- [X] T012 Gerar migration TypeORM e executar: `npm run migration:generate -- src/database/migrations/CreateVideos` (dentro do container, após T011), revisar o arquivo gerado em `nestjs-project/src/database/migrations/TIMESTAMP-CreateVideos.ts` para confirmar criação do ENUM `video_status_enum`, tabela `videos`, FK `channel_id → channels.id` com `ON DELETE RESTRICT`, índices `idx_videos_channel_id` e `idx_videos_channel_id_created_at (channel_id, created_at DESC)` e `idx_videos_status`; executar `npm run migration:run`
- [X] T013 [P] Criar `nestjs-project/src/storage/storage.module.ts` (global) + `nestjs-project/src/storage/storage.service.ts`: injetar `storage.config`; inicializar `S3Client` com `endpoint`, `credentials`, `region: 'us-east-1'`, `forcePathStyle: true`; métodos públicos: `generatePresignedPutUrl(key, mimeType, expiresIn=900): Promise<string>` (usando `PutObjectCommand` + `getSignedUrl`), `getObject(key, rangeHeader?: string): Promise<{ stream, contentType, contentLength, contentRange? }>` (usando `GetObjectCommand`), `putObject(key, body: Buffer | Readable, contentType: string): Promise<void>` (usando `PutObjectCommand` diretamente, sem presigner — upload server-side para uso do worker), `deleteObject(key): Promise<void>` (tolera `NoSuchKey`); implementar `StorageService.onModuleInit()`: verificar se bucket existe (`HeadBucketCommand`) e criá-lo se não existir (`CreateBucketCommand`) — garante idempotência independente da ordem de startup
- [X] T014 [P] Criar `nestjs-project/src/videos/videos.constants.ts` (export `VideoStatus` enum: `DRAFT='draft'`, `PROCESSING='processing'`, `READY='ready'`, `ERROR='error'`; export `VIDEO_QUEUE_NAME = 'video-processing'`); criar scaffold `nestjs-project/src/videos/videos.module.ts` (importa `TypeOrmModule.forFeature([Video])`, declara `VideosController` e `VideosService`)
- [X] T015 Criar `nestjs-project/src/video-processing/video-processing.module.ts`: importa `BullModule.registerQueue({ name: VIDEO_QUEUE_NAME })` (conexão Redis herdada do `BullModule.forRootAsync` global em AppModule), declara `VideoProcessingProcessor`; importa `TypeOrmModule.forFeature([Video])` e `StorageModule`
- [X] T016 Registrar em `nestjs-project/src/app.module.ts`: adicionar `storage.config` e `queue.config` ao array `load[]` do `ConfigModule`; importar `StorageModule` (já global) e `VideosModule`; **`VideoProcessingModule` NÃO é importado no AppModule** — fica exclusivamente em `nestjs-project/src/worker.ts` para que o worker rode em processo separado; adicionar `nestjs-api` ao `depends_on` do `compose.yaml` para incluir `redis` e `minio`
- [X] T017 Criar `nestjs-project/src/worker.ts` com skeleton mínimo: `async function bootstrap() { const app = await NestFactory.createApplicationContext(VideoProcessingModule, { logger: ['log','error','warn'] }); app.enableShutdownHooks(); }` — sem HTTP server — **`VideoProcessingProcessor` ainda não existe neste ponto (T027); o módulo ficará com o processor pendente até a Fase 4**

**Checkpoint**: Foundation completa. US1–US6 podem começar.

---

## Phase 3: User Story 1 — Iniciar Upload (P1) + URL única (US5)

**Goal**: `POST /videos` cria registro `draft` com UUID único, devolve URL pré-assinada para PUT direto ao MinIO. US5 (URL única) é garantida pelo UUID como PK — sem campo slug separado.

**Independent Test**: `POST /videos` autenticado com `title`, `file_size` e `mime_type` válidos retorna `201 { id, status: "draft", upload_url, storage_key }`; registro no BD tem `status=draft`, `storage_key` preenchido, `id` único mesmo com títulos idênticos.

- [X] T018 Criar `nestjs-project/src/videos/dto/initiate-upload.dto.ts`: `title: string` com `@IsString()`, `@MinLength(1)`, `@MaxLength(255)`; `file_size: number` com `@IsInt()`, `@Min(1)`, `@Max(10737418240)` (10 GB); `mime_type: string` com `@IsString()`, `@Matches(/^video\//)` para garantir prefixo `video/`; usar `@ApiProperty()` em todos os campos
- [X] T019 [US1] Implementar `VideosService.initiateUpload(userId, dto)` em `nestjs-project/src/videos/videos.service.ts`: (1) buscar canal do usuário (`channel.userId === userId`; lançar `ForbiddenException` se não tiver canal); (2) gerar UUID para o vídeo com `crypto.randomUUID()`; (3) extrair extensão do `mime_type` (ex.: `video/mp4` → `mp4`); (4) compor `storageKey = 'videos/{uuid}/original.{ext}'`; (5) chamar `StorageService.generatePresignedPutUrl(storageKey, mimeType)`; (6) salvar `Video` com `status=DRAFT`, `storageKey` e `channelId`; retornar `{ id, status, upload_url: presignedUrl, storage_key: storageKey }`
- [X] T020 [US1] Implementar `POST /videos` em `nestjs-project/src/videos/videos.controller.ts`: `@ApiBearerAuth()`, `@ApiTags('videos')`, `@Post()`, `@HttpCode(HttpStatus.CREATED)`, body `InitiateUploadDto`; extrair `userId` do JWT via `@CurrentUser()`; chamar `videosService.initiateUpload()`; `@ApiResponse` para 201, 400, 401, 403
- [X] T021 [P] [US1] Unit test `nestjs-project/src/videos/videos.service.spec.ts`: mock de `StorageService` e `Repository<Video>`; casos: criação bem-sucedida retorna `upload_url` e `storage_key` corretos, `storage_key` segue padrão `videos/{uuid}/original.{ext}`, lançamento de `ForbiddenException` quando usuário não tem canal, lançamento de erro de validação para `mime_type` não-vídeo
- [X] T022 [P] [US1] Unit test `nestjs-project/src/videos/videos.controller.spec.ts`: mock de `VideosService`; casos: `POST /videos` retorna 201 com payload correto, extrai `userId` do JWT corretamente
- [X] T023 [US1] Integration test `nestjs-project/src/videos/videos.service.integration-spec.ts`: BD real; casos: dois vídeos com mesmo título recebem UUIDs distintos (US5), `storage_key` é `NOT NULL` após criação, `status` inicial é `draft`, `channel_id` referencia canal existente
- [X] T024 [US1] Integration test `nestjs-project/src/videos/entities/video.entity.integration-spec.ts`: BD real; casos: inserção sem `storage_key` falha (NOT NULL), status fora do enum é rejeitado, `channel_id` inválido falha FK constraint

**Checkpoint**: US1 + US5 funcionais e testáveis independentemente.

---

## Phase 4: User Story 2 — Processamento Assíncrono (P2)

**Goal**: `POST /videos/:id/upload-complete` enfileira job BullMQ (enqueue-first) → atualiza status para `processing` → worker consome → processa com FFmpeg → status `ready` ou `error`.

**Independent Test**: (a) `POST /videos/:id/upload-complete` para vídeo `draft` retorna `200 { id, status: "processing" }`; (b) job consumido pelo worker com arquivo real no MinIO resulta em `status=ready`, `thumbnail_key`, `duration_seconds` e `processing_metadata` preenchidos; (c) Redis down → 500, status permanece `draft`.

- [X] T025 [US2] Implementar `VideosService.confirmUpload(videoId, userId)` em `nestjs-project/src/videos/videos.service.ts`: (1) buscar vídeo; lançar `NotFoundException` se não existir; (2) verificar `video.channel.userId === userId`; lançar `ForbiddenException` se não for dono; (3) lançar `BadRequestException` se `status !== DRAFT`; (4) enfileirar `VideoProcessingJob { videoId, storageKey, bucketName }` via `InjectQueue(VIDEO_QUEUE_NAME)` **com opções `{ jobId: videoId, attempts: 3, backoff: { type: 'fixed', delay: 5000 } }`** — garante localização pelo videoId em T043, idempotência em chamadas duplicadas (BullMQ deduplica jobs com mesmo ID pendente) e retry automático com intervalo fixo (FR-008); se enfileiramento falhar, lançar `InternalServerErrorException` sem alterar status; (5) atualizar `status = PROCESSING`; retornar `{ id, status: 'processing' }`
- [X] T026 [US2] Implementar `POST /videos/:id/upload-complete` em `nestjs-project/src/videos/videos.controller.ts`: `@ApiBearerAuth()`, `@Post(':id/upload-complete')`, `@HttpCode(HttpStatus.OK)`; extrair `userId` via `@CurrentUser()`; `@ApiResponse` para 200, 400, 401, 403, 404
- [X] T027 [US2] Implementar `nestjs-project/src/video-processing/video-processing.processor.ts`: `@Processor(VIDEO_QUEUE_NAME, { lockDuration: 300_000 })` estendendo `WorkerHost` (lockDuration de 5 minutos evita jobs orphaned em processamento de vídeos grandes — ver research.md §1) (`@nestjs/bullmq`); sobrescrever `override async process(job: Job<VideoProcessingJob>): Promise<void>` (sem `@Process()` — padrão WorkerHost; retry configurado por-job em T025): (1) verificar `video.status === PROCESSING` — se não, descartar (idempotência); (2) baixar arquivo do MinIO para arquivo temp em `/tmp/{videoId}`; (3) usar `ffprobe` (`@ffprobe-installer/ffprobe`) para extrair `{ duration, width, height, codec, bitrate_kbps }`; (4) usar `fluent-ffmpeg` para gerar thumbnail (`-ss 00:00:01 -vframes 1 thumbnail.jpg`); (5) upload do thumbnail ao MinIO com `storageService.putObject(thumbnailKey, buffer, 'image/jpeg')`; (6) atualizar BD: `status=READY`, `thumbnailKey`, `durationSeconds`, `processingMetadata`; em falha definitiva (`job.attemptsMade >= attempts`): `status=ERROR`, `errorCause=error.message.slice(0, 2048)` — remover arquivo temp em `finally`; se o vídeo não for encontrado em qualquer ponto (`EntityNotFoundException` — vídeo deletado durante o processamento), capturar silenciosamente e encerrar sem lançar erro nem retentativa
- [X] T028 [P] [US2] Unit test `nestjs-project/src/videos/videos.service.spec.ts` (seção `confirmUpload`): mock de `Queue` e `Repository<Video>`; casos: enfileiramento bem-sucedido → status muda para `processing`; `Queue.add()` lança erro → `InternalServerErrorException`, status permanece `draft`; vídeo não `draft` → `BadRequestException`; dono errado → `ForbiddenException`
- [X] T029 [P] [US2] Unit test `nestjs-project/src/video-processing/video-processing.processor.spec.ts`: mock de `ffprobe`, `fluent-ffmpeg` e `StorageService`; casos: fluxo completo → `status=READY` com metadados preenchidos; `status !== PROCESSING` → descartado sem modificação (idempotência); falha no ffprobe → relança erro (BullMQ retentar); job com `attemptsMade >= 3` → `status=ERROR`, `errorCause` truncado; ffprobe OK mas `fluent-ffmpeg` falha → erro relançado (sem `status=ready` parcial); após 3 tentativas BullMQ → `status=ERROR` com `errorCause` — **nota C3**: integration test do processor omitido por design; dependência de BullMQ+Redis+MinIO reais equivale ao nível e2e; cobertura completa do fluxo via T057 (quickstart manual)
- [X] T030 [US2] Integration test `nestjs-project/src/videos/videos.service.integration-spec.ts` (seção `confirmUpload`): BD real, Queue mockado; casos: transição `draft→processing` persiste, `BadRequestException` para vídeo já em `processing`, `ForbiddenException` para canal de outro usuário
- [X] T031 [US2] Verificar `nestjs-project/src/worker.ts` após T027: confirmar que `VideoProcessingProcessor` está registrado no `VideoProcessingModule` e que o contexto standalone inicializa sem erros (`enableShutdownHooks()` já adicionado em T017); confirmar que o módulo importa `BullModule`, `TypeOrmModule` e `StorageModule`; ajustar imports se necessário

**Checkpoint**: US2 funcional. Fluxo completo upload → processamento testável.

---

## Phase 5: User Story 3 — Streaming & Detalhes Públicos (P3)

**Goal**: `GET /videos/:id` (público, qualquer status, polling de progresso) + `GET /videos/:id/stream` (público, range requests, apenas status `ready`).

**Independent Test**: `GET /videos/:id` sem token retorna 200 com metadados; `GET /videos/:id/stream` com header `Range: bytes=0-1048575` retorna 206 com `Content-Range`; vídeo em `draft` → stream retorna 409.

- [X] T032 [US3] Implementar `VideosService.findById(videoId)` em `nestjs-project/src/videos/videos.service.ts`: buscar vídeo; lançar `NotFoundException` se não existir; montar `thumbnailUrl` como URL HTTP completa (`${storageEndpoint}/${bucket}/${thumbnailKey}`) quando `thumbnailKey` não nulo; retornar campos públicos (sem `errorCause`)
- [X] T033 [US3] Implementar `GET /videos/:id` em `nestjs-project/src/videos/videos.controller.ts`: `@Public()`, `@Get(':id')`; chamar `findById()`; retornar `{ id, title, status, thumbnail_url, duration_seconds, processing_metadata, channel_id, created_at, updated_at }`; `@ApiResponse` para 200, 404
- [X] T034 [US3] Implementar `VideosService.streamVideo(videoId, rangeHeader?)` em `nestjs-project/src/videos/videos.service.ts`: buscar vídeo; lançar `NotFoundException` se não existir; lançar `ConflictException` se `status !== READY`; chamar `storageService.getObject(storageKey, rangeHeader)`; lançar `RangeNotSatisfiableException` (416) se MinIO retornar erro de range inválido; retornar `{ stream, contentType, contentLength, contentRange, statusCode: rangeHeader ? 206 : 200 }`
- [X] T035 [US3] Implementar `GET /videos/:id/stream` em `nestjs-project/src/videos/videos.controller.ts`: `@Public()`, `@Get(':id/stream')`; ler header `Range` via `@Headers('range')`; chamar `streamVideo()`; setar headers `Content-Type`, `Content-Length`, `Accept-Ranges: bytes`, `Content-Range` (se 206); fazer pipe do stream para `@Res() res`; `@ApiResponse` para 200, 206, 404, 409, 416
- [X] T036 [P] [US3] Unit test `nestjs-project/src/videos/videos.service.spec.ts` (seção `findById` e `streamVideo`): mock de `Repository<Video>` e `StorageService`; casos: `findById` monta `thumbnailUrl` completa, retorna `null` para `thumbnailUrl` quando `thumbnailKey` é nulo, lança 404 para ID inexistente; `streamVideo` lança 409 para status `draft`/`processing`/`error`, retorna stream para `ready`, lança 416 para range inválido
- [X] T037 [P] [US3] Unit test `nestjs-project/src/videos/videos.controller.spec.ts` (seção pública): casos: `GET /videos/:id` sem Authorization header retorna 200, `GET /videos/:id/stream` sem token retorna stream, headers `Content-Range` e `Accept-Ranges` presentes na resposta 206
- [X] T038 [US3] Integration test `nestjs-project/src/videos/videos.service.integration-spec.ts` (seção `findById`): BD real; casos: retorna vídeo existente, lança `NotFoundException` para UUID inexistente, `errorCause` não aparece no retorno público

**Checkpoint**: US3 funcional. Detalhes e streaming testáveis sem autenticação.

---

## Phase 6: User Story 6 — Gerenciamento de Vídeos (P3)

**Goal**: `GET /channels/:channelId/videos` (listagem paginada, OWNER) + `PATCH /videos/:id` (edição de título, OWNER) + `DELETE /videos/:id` (remoção completa, OWNER, qualquer status).

**Independent Test**: (a) listagem retorna itens paginados com `has_next_page` correto; (b) PATCH altera título mas `id` permanece igual; (c) DELETE remove registro do BD, arquivos do MinIO e cancela job pendente; (d) todos retornam 403 para canal de outro usuário.

- [X] T039 Criar `nestjs-project/src/videos/dto/list-videos-query.dto.ts`: `page: number` com `@IsInt()`, `@Min(1)`, `@Type(() => Number)`, default `1`; `limit: number` com `@IsInt()`, `@Min(1)`, `@Max(100)`, `@Type(() => Number)`, default `20`
- [X] T040 Criar `nestjs-project/src/videos/dto/update-video.dto.ts`: `title: string` com `@IsString()`, `@MinLength(1)`, `@MaxLength(255)` — obrigatório (sem `@IsOptional()`)
- [X] T041 [US6] Implementar `VideosService.listChannelVideos(channelId, userId, query)` em `nestjs-project/src/videos/videos.service.ts`: verificar que `channel.userId === userId` (403 se não); query paginada com `findAndCount({ where: { channelId }, order: { createdAt: 'DESC' }, skip: (page-1)*limit, take: limit })`; retornar `{ items: [...], total, page, limit, has_next_page: page * limit < total }`
- [X] T042 [US6] Implementar `VideosService.updateTitle(videoId, userId, dto)` em `nestjs-project/src/videos/videos.service.ts`: verificar existência (404) e ownership (403); `save({ ...video, title: dto.title })`; retornar `{ id, title, status, updated_at }` — `id` inalterado
- [X] T043 [US6] Implementar `VideosService.deleteVideo(videoId, userId)` em `nestjs-project/src/videos/videos.service.ts`: verificar existência (404) e ownership (403); tentar remover job BullMQ pendente (via `queue.getJob(videoId)` → `job.remove()`, ignorar se não existir); remover `storageKey` e `thumbnailKey` do MinIO (tolerante a `NoSuchKey`); remover registro do BD
- [X] T044 [US6] Implementar `GET /channels/:channelId/videos` em `nestjs-project/src/videos/videos.controller.ts`: `@ApiBearerAuth()`, `@Get()` no `ChannelsController` ou sub-rota em `VideosController`; query params `ListVideosQueryDto`; `@ApiResponse` para 200, 401, 403, 404

  > **Nota**: se não existir `ChannelsController`, implementar como sub-rota em `VideosController` com path `channels/:channelId/videos`.

- [X] T045 [US6] Implementar `PATCH /videos/:id` em `nestjs-project/src/videos/videos.controller.ts`: `@ApiBearerAuth()`, `@Patch(':id')`, body `UpdateVideoDto`; `@ApiResponse` para 200, 400, 401, 403, 404
- [X] T046 [US6] Implementar `DELETE /videos/:id` em `nestjs-project/src/videos/videos.controller.ts`: `@ApiBearerAuth()`, `@Delete(':id')`, `@HttpCode(HttpStatus.NO_CONTENT)`; `@ApiResponse` para 204, 401, 403, 404
- [X] T047 [P] [US6] Unit test `nestjs-project/src/videos/videos.service.spec.ts` (seção gerenciamento): mock de `Repository<Video>`, `StorageService` e `Queue`; casos: `listChannelVideos` retorna items na ordem `created_at DESC`, calcula `has_next_page` corretamente, lança 403 para canal de outro usuário; `updateTitle` persiste novo título, `id` não muda; `deleteVideo` chama `deleteObject` para ambos os arquivos (tolerante a inexistentes), remove BD, tenta cancelar job
- [X] T048 [US6] Integration test `nestjs-project/src/videos/videos.service.integration-spec.ts` (seção gerenciamento): BD real; casos: listagem paginada com 25 vídeos retorna `limit=20` + `has_next_page=true`; edição de título persiste no BD; exclusão remove registro (findById lança 404 depois); 403 para canal de outro usuário em todos os métodos

**Checkpoint**: US6 funcional. CRUD completo testável.

---

## Phase 7: User Story 4 — Download Autenticado (P4)

**Goal**: `GET /videos/:id/download` retorna arquivo completo para qualquer usuário autenticado (não requer ownership), com `Content-Disposition: attachment`.

**Independent Test**: `GET /videos/:id/download` com Bearer token válido → arquivo completo com `Content-Disposition: attachment; filename="titulo.ext"`; sem token → 401; vídeo em `processing` → 409.

- [X] T049 [US4] Implementar `VideosService.downloadVideo(videoId)` em `nestjs-project/src/videos/videos.service.ts`: buscar vídeo (404 se não existir); lançar `ConflictException` se `status !== READY`; chamar `storageService.getObject(storageKey)` sem header Range; derivar nome do arquivo a partir de `title` (sanitizar caracteres especiais) e extensão do `storageKey`; retornar `{ stream, contentType, contentLength, filename }`
- [X] T050 [US4] Implementar `GET /videos/:id/download` em `nestjs-project/src/videos/videos.controller.ts`: `@ApiBearerAuth()` (AUTH, não OWNER), `@Get(':id/download')`; chamar `downloadVideo()`; setar headers `Content-Type`, `Content-Length`, `Content-Disposition: attachment; filename="..."` (RFC 5987); fazer pipe do stream para `@Res() res`; `@ApiResponse` para 200, 401, 404, 409
- [X] T051 [P] [US4] Unit test `nestjs-project/src/videos/videos.service.spec.ts` (seção `downloadVideo`): mock de `Repository<Video>` e `StorageService`; casos: `status=READY` → stream retornado com `filename` correto; `status=PROCESSING` → `ConflictException`; ID inexistente → `NotFoundException`
- [X] T052 [P] [US4] Unit test `nestjs-project/src/videos/videos.controller.spec.ts` (seção download): casos: sem Bearer token → 401 (sem `@Public()`); `Content-Disposition` header presente na resposta; dono e não-dono ambos conseguem baixar (somente AUTH, não OWNER)
- [X] T058 [P] [US4] Integration test `nestjs-project/src/videos/videos.service.integration-spec.ts` (seção `downloadVideo`): BD real; casos: `status=READY` → stream retornado corretamente; `status=PROCESSING` → `VideoNotReadyException`; ID inexistente → `VideoNotFoundException` — adicionado via remediação C1 do speckit-analyze; não constava no planejamento original

**Checkpoint**: US4 funcional. Todas as 6 User Stories implementadas.

---

## Phase Final: Polish & Cross-Cutting

**Purpose**: Testes E2E de ponta a ponta, atualização do OpenAPI e validação final do Definition of Done.

- [X] T053 [P] E2E test `nestjs-project/test/videos.e2e-spec.ts` — golden path: POST /videos (autenticado) → PUT direto ao MinIO com `upload_url` → POST /videos/:id/upload-complete → polling GET /videos/:id até `status=ready` (max 30s) → GET /videos/:id/stream com `Range: bytes=0-1023` → assert HTTP 206 + Content-Range → GET /videos/:id/download → assert 200 + Content-Disposition; **nota SC-001**: a API permanece não-bloqueante durante upload por design — bytes de vídeo nunca passam pela API (pre-signed URL); nenhum teste de carga adicional é necessário para verificar este critério
- [X] T054 [P] E2E test `nestjs-project/test/videos.e2e-spec.ts` — autorização: POST /videos sem token → 401; POST /videos/:id/upload-complete com token de outro usuário → 403; GET /videos/:id sem token → 200 (público); GET /videos/:id/stream sem token → 200/206 (público); GET /videos/:id/download sem token → 401; DELETE /videos/:id com token de outro canal → 403
- [X] T055 Atualizar export OpenAPI: executar `nestjs-project/src/openapi-export.ts` (ou `npm run swagger`) e verificar que os 8 endpoints de vídeo (`POST /videos`, `POST /videos/:id/upload-complete`, `GET /videos/:id`, `GET /videos/:id/stream`, `GET /videos/:id/download`, `GET /channels/:channelId/videos`, `PATCH /videos/:id`, `DELETE /videos/:id`) aparecem no `openapi.json` gerado com auth levels e schemas corretos
- [X] T056 Validar Definition of Done: `npx tsc --noEmit` (sem erros de TypeScript), `npm run lint` (sem warnings), `npm test` (unit + integration passando), `npm run test:e2e` (E2E passando com `--runInBand`), `npm run migration:run` não tem migrações pendentes — **REQUER CONTAINERS: executar dentro do container após `docker compose up -d`**
- [X] T057 Executar cenários do `quickstart.md` manualmente para validação end-to-end final: os 9 cenários curl cobrem o fluxo completo — **REQUER CONTAINERS COMPLETOS (API + Redis + MinIO + worker)** — todos os 16 checkpoints passaram; C9 (range inválido → 416) exigiu fix de bug em `streamVideo` para capturar `$metadata.httpStatusCode === 416` do AWS SDK

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Sem dependências — pode iniciar imediatamente. T002, T003, T004, T005, T008, T009 podem rodar em paralelo.
- **Foundational (Phase 2)**: Depende de Phase 1 (packages instalados, compose atualizado). T013 e T014 podem rodar em paralelo após T011+T012.
- **User Stories (Phases 3–7)**: Todas dependem de Phase 2 completa. Podem ser trabalhadas sequencialmente (por prioridade: P1→P2→P3→P4) ou em paralelo por desenvolvedores distintos.
- **Polish (Phase Final)**: Depende de todas as User Stories.

### User Story Dependencies

| Story | Prioridade | Depende de |
|-------|-----------|------------|
| US1 + US5 (Phase 3) | P1 | Phase 2 |
| US2 (Phase 4) | P2 | Phase 2, recomendado após US1 (usa entidade Video) |
| US3 (Phase 5) | P3 | Phase 2, recomendado após US2 (streaming exige `status=ready`) |
| US6 (Phase 6) | P3 | Phase 2 |
| US4 (Phase 7) | P4 | Phase 2, recomendado após US2 (download exige `status=ready`) |

### Within Each User Story

- DTOs e constants → Service → Controller → Testes unitários → Testes de integração
- Cada fase deve ser independentemente completável e testável antes de avançar

---

## Parallel Opportunities

```bash
# Phase 1 — Setup (paralelos entre si):
T002  # AWS SDK
T003  # fluent-ffmpeg
T004  # MinIO no compose.yaml
T005  # Redis no compose.yaml
T008  # storage.config.ts
T009  # queue.config.ts

# Phase 2 — Foundational (após T011+T012):
T013  # StorageModule + StorageService
T014  # VideosModule scaffold + constants

# Phase 3 — US1 (testes em paralelo):
T021  # Unit: videos.service.spec.ts (initiateUpload)
T022  # Unit: videos.controller.spec.ts (POST /videos)

# Phase 4 — US2 (testes em paralelo):
T028  # Unit: videos.service.spec.ts (confirmUpload)
T029  # Unit: processor.spec.ts

# Phase 5 — US3 (testes em paralelo):
T036  # Unit: videos.service.spec.ts (findById + streamVideo)
T037  # Unit: videos.controller.spec.ts (GET endpoints públicos)

# Phase 6 — US6:
T047  # Unit: videos.service.spec.ts (list + update + delete)

# Phase 7 — US4 (testes em paralelo):
T051  # Unit: videos.service.spec.ts (downloadVideo)
T052  # Unit: videos.controller.spec.ts (GET /download)
T058  # Integration: videos.service.integration-spec.ts (downloadVideo)

# Phase Final (em paralelo):
T053  # E2E: golden path
T054  # E2E: autorização
```

---

## Implementation Strategy

### MVP First (US1 apenas)

1. Completar Phase 1: Setup
2. Completar Phase 2: Foundational (⚠️ bloqueia tudo)
3. Completar Phase 3: US1 + US5
4. **PARAR E VALIDAR**: `POST /videos` funcional com BD + MinIO reais
5. Demonstrar: URL pré-assinada válida, upload direto ao MinIO bem-sucedido

### Entrega Incremental

1. Setup + Foundational → base pronta
2. US1 → upload iniciado (MVP!)
3. US2 → processamento assíncrono (vídeo fica `ready`)
4. US3 → streaming público (usuários podem assistir)
5. US6 → gerenciamento (criador pode editar e deletar)
6. US4 → download (usuários autenticados podem baixar)

---

## Task Summary

| Phase | Tarefas | Paralelas |
|-------|---------|-----------|
| Phase 1 — Setup | 10 | T002, T003, T004, T005, T008, T009 |
| Phase 2 — Foundational | 7 | T013, T014 |
| Phase 3 — US1 + US5 | 7 | T021, T022 |
| Phase 4 — US2 | 7 | T028, T029 |
| Phase 5 — US3 | 7 | T036, T037 |
| Phase 6 — US6 | 10 | T047 |
| Phase 7 — US4 | 5 | T051, T052, T058 |
| Phase Final | 5 | T053, T054 |
| **Total** | **58** | **19 paralelas** |

**MVP mínimo**: Phases 1 + 2 + 3 = 24 tarefas → US1 entregue: upload funcional com UUID único e URL pré-assinada.
