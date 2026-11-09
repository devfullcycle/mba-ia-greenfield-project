---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-11-09T22:21:17Z"
  docs/phases/phase-03-videos/library-refs.md: "2026-11-09T22:21:17Z"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-09T22:21:17Z"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-11-05T18:29:11Z"
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-11-05T18:29:11Z"
  docs/decisions/technical-decisions-next-frontend-msw-foundation.md: "2026-11-05T18:29:11Z"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Entregar o upload e processamento de vídeos no `nestjs-project/` — serviço de armazenamento de arquivos (vídeos e thumbnails), serviço de processamento em segundo plano (filas), upload de até 10GB sem impacto na performance com pré-cadastro automático do vídeo como rascunho, processamento automático (extração de duração e metadados) com geração de thumbnail a partir de um frame, URL única por vídeo sem conflito, reprodução via streaming sem download completo e download do vídeo pelo usuário.

---

## Step Implementations

### SI-03.1 — Infra: Dependências, Configuração e Serviços Redis/MinIO no Compose

**Description:** Instala as bibliotecas da fase, cria os namespaces de configuração validados por Joi e sobe Redis + MinIO (com buckets e expiração de multipart incompleto) no Compose — base de infraestrutura para storage, fila e worker.

**Technical actions:**

1. Instalar `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `bullmq`, `@nestjs/bullmq`, `@nestjs/schedule`, `sqids` no container `nestjs-api` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`, `phase-03-videos/TD-09`, `phase-03-videos/TD-10`)
2. Criar `src/config/storage.config.ts` (`registerAs('storage')`: `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`), `src/config/queue.config.ts` (`registerAs('queue')`: `REDIS_HOST`, `REDIS_PORT`, `QUEUE_PREFIX`) e `src/config/video.config.ts` (`registerAs('video')`: `VIDEO_PUBLIC_ID_ALPHABET`, `VIDEO_RECONCILER_ENABLED`) seguindo o padrão namespaced herdado (per `phase-01-configuracao-base/TD-03`)
3. Estender `src/config/env.validation.ts` com as novas chaves — hosts com default no nome do serviço Compose (`minio`, `redis`), `S3_PUBLIC_ENDPOINT` obrigatório, `VIDEO_PUBLIC_ID_ALPHABET` obrigatório com tamanho mínimo de 16 caracteres únicos (per `phase-01-configuracao-base/TD-02`)
4. Adicionar ao `compose.yaml` os serviços `redis` (com healthcheck `redis-cli ping`) e `minio` (portas `9000`/`9001`, healthcheck) (com `MINIO_API_STALE_UPLOADS_EXPIRY=24h` — mecanismo nativo do MinIO para abortar multipart incompleto após 1 dia; o MinIO não implementa a ação de lifecycle `AbortIncompleteMultipartUpload`, então este é o equivalente que cumpre a intenção do TD-04) e o one-shot `minio-init` (`minio/mc`) que cria os buckets `streamtube` e `streamtube-test`; `nestjs-api` passa a depender de `redis` e `minio` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-04`)
5. Atualizar `.env.example` e `.env` (`S3_ENDPOINT=http://minio:9000`, `S3_PUBLIC_ENDPOINT=http://localhost:9000`, `S3_BUCKET=streamtube`, `QUEUE_PREFIX=streamtube`) e criar `test/setup-test-env.ts`, registrado antes de `dotenv/config` em `setupFiles` do Jest (unit + e2e), que fixa `S3_BUCKET=streamtube-test`, `QUEUE_PREFIX=streamtube-test`, `S3_PUBLIC_ENDPOINT=http://minio:9000` e `VIDEO_RECONCILER_ENABLED=false` (per `phase-03-videos/TD-13`, `phase-03-videos/TD-01`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `envValidationSchema` | Integration: novas chaves obrigatórias rejeitam ausência; defaults `minio`/`redis` aplicados; alfabeto curto rejeitado; `process.env.S3_BUCKET`/`QUEUE_PREFIX` valem `streamtube-test` no processo Jest | `src/config/env.validation.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `docker compose up -d` deixa `redis` e `minio` com status `healthy` e `minio-init` finaliza com exit code `0`
- Após o `minio-init`, os buckets `streamtube` e `streamtube-test` existem e `mc admin config get <alias> api` mostra `stale_uploads_expiry=24h`
- A aplicação recusa iniciar quando `S3_PUBLIC_ENDPOINT` ou `VIDEO_PUBLIC_ID_ALPHABET` estão ausentes, com erro de validação de env nomeando a chave
- Processos Jest enxergam `S3_BUCKET=streamtube-test` e `QUEUE_PREFIX=streamtube-test`, mesmo com `.env` apontando para `streamtube`

---

### SI-03.2 — Criar StorageModule com Clientes S3 Interno e Público

**Description:** Encapsula todo acesso ao object storage num `StorageService` com dois `S3Client`s (interno para operações server-side, público apenas para assinar URLs de upload), reutilizado por API e worker.

**Technical actions:**

1. Criar `src/storage/storage.module.ts` com dois providers `S3Client` (tokens `S3_INTERNAL_CLIENT` e `S3_PUBLIC_CLIENT`), ambos `forcePathStyle: true`, `requestChecksumCalculation: 'WHEN_REQUIRED'` e `responseChecksumValidation: 'WHEN_REQUIRED'` (evita checksums flexíveis padrão do SDK ≥ 3.729 em URLs pré-assinadas de `UploadPart`/MinIO), endpoints `S3_ENDPOINT` e `S3_PUBLIC_ENDPOINT` via `storageConfig` (per `phase-03-videos/TD-01`)
2. Criar `src/storage/storage.service.ts` — multipart: `createMultipartUpload(key, contentType)`, `presignUploadParts(key, uploadId, partNumbers, expiresIn)` (assinado com o cliente **público**, `UploadPartCommand` + `getSignedUrl`), `completeMultipartUpload(key, uploadId, parts)` (`MultipartUpload: { Parts: [{ ETag, PartNumber }] }`), `abortMultipartUpload(key, uploadId)` (per `phase-03-videos/TD-04`)
3. Adicionar ao `StorageService` a leitura/escrita de objetos: `getObjectStream(key, range?)` (retorna `Body` stream + `ContentRange`/`ContentLength`, sem bufferizar), `headObject(key)`, `presignInternalGet(key, expiresIn)` (cliente **interno**, consumido pelo ffprobe) e `putObject(key, body, contentType)` (thumbnail) (per `phase-03-videos/TD-07`, `phase-03-videos/TD-11`)
4. Mapear erros do SDK para erros de storage tipados (`StorageInvalidPartsError` para `InvalidPart`/`InvalidPartOrder`/`EntityTooSmall`/`NoSuchUpload`, `StorageInvalidRangeError` para `InvalidRange`, `StorageNotFoundError` para `NoSuchKey`), sem acoplar o módulo a exceções HTTP
5. Exportar `StorageService` do `StorageModule` para consumo por `VideosModule` e `WorkerModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration (MinIO real, bucket `streamtube-test`): ciclo multipart completo via URLs pré-assinadas, abort, `getObjectStream` com `Range`, mapeamento `InvalidRange`/`InvalidPart` | `src/storage/storage.service.integration-spec.ts` |
| `StorageModule` | Unit: compilação do módulo com `storageConfig` de teste | `src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.1 — MinIO no Compose e `storageConfig`

**Acceptance criteria:**

- Uma URL de parte emitida por `presignUploadParts` aceita `PUT` de um chunk e devolve um `ETag`; `completeMultipartUpload` com esses ETags produz um objeto com o tamanho total enviado
- Com uma config de teste em que `S3_PUBLIC_ENDPOINT` e `S3_ENDPOINT` têm hosts distintos, as URLs de parte trazem o host de `S3_PUBLIC_ENDPOINT` e as operações server-side usam `S3_ENDPOINT`
- `getObjectStream(key, 'bytes=0-99')` retorna exatamente 100 bytes e `ContentRange` `bytes 0-99/{size}`
- Um range além do tamanho do objeto gera `StorageInvalidRangeError`; ETag inválido no complete gera `StorageInvalidPartsError`
- `abortMultipartUpload` faz uploads de parte posteriores para o mesmo `UploadId` falharem

---

### SI-03.3 — Criar Entidade Video, Migration e Gerador de public_id

**Description:** Cria a tabela `videos` (status machine numa única linha) e o gerador de `public_id` bijetivo via Sqids, fonte da URL única e sem colisão de cada vídeo.

**Technical actions:**

1. Criar `src/videos/entities/video.entity.ts` com todas as colunas de `### Data Model → Video` (enum `VideoStatus` `'DRAFT' | 'PROCESSING' | 'READY' | 'ERROR'`, transformer `bigint → number` em `size_bytes` e `seq`, `seq` como `@Column({ type: 'bigint', unique: true })` **sem** `@Generated` (o TypeORM remove colunas `increment` do INSERT, o que quebraria `public_id = Sqids(seq)`; a aplicação sempre grava o valor reservado por `reserveSeq()`), relação many-to-one com `Channel`) e o inverso one-to-many em `src/channels/entities/channel.entity.ts` (per `phase-03-videos/TD-06`)
2. Gerar migration `src/database/migrations/{timestamp}-CreateVideos.ts` — sequence `videos_seq_seq` (default `nextval` em `seq` como rede de segurança), enum `videos_status_enum`, FK `channel_id` com `ON DELETE CASCADE`, índices únicos em `seq`/`public_id`, índices `(channel_id)` e `(status, updated_at)`; `down` reverte tudo (per `phase-03-videos/TD-06`)
3. Criar `src/videos/video-public-id.service.ts` — `encode(seq: number): string` / `decode(publicId: string): number | null` com `new Sqids({ alphabet: VIDEO_PUBLIC_ID_ALPHABET, minLength: 10 })`; `decode` retorna `null` quando o id não faz round-trip canônico (per `phase-03-videos/TD-10`)
4. Criar `src/videos/videos.repository.ts` (`VideosRepository`, provider injetável que encapsula o `Repository<Video>`) com `reserveSeq()` (`SELECT nextval('videos_seq_seq')`) para que `seq` e `public_id` sejam gravados no mesmo `INSERT`; como a sequence só existe via migration, todo teste de integração que toca `videos` usa `createTestDataSource(entities, { synchronize: false, migrations })` + `runMigrations()` (per `phase-03-videos/TD-10`)
5. Criar `src/videos/videos-data.module.ts` (`VideosDataModule`: `TypeOrmModule.forFeature([Video])`, exporta `VideosRepository` e `VideoPublicIdService` — reutilizado pelo worker sem trazer providers HTTP) e `src/videos/videos.module.ts` (importa `VideosDataModule`, `StorageModule`, `ChannelsModule`); registrar `VideosModule` em `AppModule`; incluir `DELETE FROM "videos"` (antes de `channels`) em `cleanAllTables` de `src/test/create-test-data-source.ts`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` entity | Integration (schema via migrations): defaults (`status = 'DRAFT'`), unique `public_id`/`seq`, cascade ao deletar channel, `size_bytes` > 2^31 lido como `number`, `seq` persistido = valor de `reserveSeq()` e `decode(public_id) = seq` | `src/videos/entities/video.entity.integration-spec.ts` |
| `VideoPublicIdService` | Unit (Sqids real com alfabeto de teste): `minLength` 10, round-trip, ids não canônicos → `null`, seqs distintos → ids distintos | `src/videos/video-public-id.service.spec.ts` |
| Migration `CreateVideos` | Integration: `up`/`down` aplicados pelo runner existente | `src/database/migrations.integration-spec.ts` |

**Dependencies:** SI-03.1 — `videoConfig` com o alfabeto; SI-03.2 — `StorageModule` importado pelo `VideosModule`

**Acceptance criteria:**

- `npm run migration:run` cria a tabela `videos`, a sequence `videos_seq_seq` e o enum `videos_status_enum`; `migration:revert` remove os três
- Inserir um vídeo sem `status` persiste `'DRAFT'`; inserir dois vídeos com o mesmo `public_id` viola a constraint única
- Deletar um `channel` remove seus vídeos (cascade)
- Um `size_bytes` de `10737418240` é persistido e lido de volta como o número `10737418240`
- O `public_id` gerado para qualquer `seq` tem ≥ 10 caracteres e decodifica de volta para o mesmo `seq`

---

### SI-03.4 — Infra: Fila video-processing e Processo video-worker

**Description:** Conecta a fila BullMQ ao Redis e cria o processo `video-worker` (mesmo codebase, contexto standalone sem HTTP, imagem com FFmpeg) com sua suíte de testes isolada — infraestrutura de processamento em segundo plano.

**Technical actions:**

1. Criar `src/queue/queue.module.ts` — `BullModule.forRootAsync({ imports: [ConfigModule], inject: [queueConfig.KEY], useFactory: → { connection: { host, port }, prefix } })` e `BullModule.registerQueue({ name: 'video-processing' })`; prover e exportar `VideoProcessingQueue` junto com o `BullModule` registrado (consumidos por `VideosModule` e `ProcessingModule`) (per `phase-03-videos/TD-02`)
2. Criar `src/queue/video-processing.queue.ts` (`VideoProcessingQueue`, injeta a fila registrada — o worker mantém a conexão padrão com offline queue habilitada) — `enqueue(videoId)` faz `queue.add('process-video', { videoId }, { jobId: videoId, attempts: Number.MAX_SAFE_INTEGER, backoff: { type: 'capped-exponential' }, removeOnComplete: true })` envolto em `Promise.race` com timeout de 5s (`ENQUEUE_TIMEOUT_MS`), para que o enqueue falhe rápido com o Redis fora em vez de ficar pendurado; `hasActiveJob(videoId)` via `queue.getJob(videoId)` + `job.getState()` — só `waiting`/`delayed`/`active`/`prioritized` contam; job em `failed`/`completed` é removido (`job.remove()`) para liberar o `jobId` antes de re-enfileirar (per `### Events/Messages → video-processing`, `phase-03-videos/TD-09`)
3. Criar `src/worker.module.ts` (`WorkerModule`: `ConfigModule`, `TypeOrmModule`, `StorageModule`, `QueueModule`, `ScheduleModule.forRoot()` — sem controllers, guards ou providers HTTP) e `src/worker.ts` com `NestFactory.createApplicationContext(WorkerModule)` + `enableShutdownHooks()` (per `phase-03-videos/TD-03`)
4. Criar `Dockerfile.worker` (base Node igual ao `Dockerfile.dev`, `apt install -y ffmpeg`, `npm ci` no build) e o serviço `video-worker` no `compose.yaml` (bind mount do código + volume anônimo em `node_modules`; depende de `db`, `redis`, `minio`; comando `npm run start:worker:dev`); criar `tsconfig.worker.json` (estende `tsconfig.build.json`, `outDir: "./dist-worker"`) e adicionar `/dist-worker` ao `.gitignore` — saída separada evita que o `nest start --watch` do worker e o da API, com `deleteOutDir: true`, apaguem a saída um do outro (sem montar volume sobre o `outDir`, que daria `EBUSY` no `rm`); scripts `start:worker:dev` (`nest start --watch --entryFile worker -p tsconfig.worker.json`) e `start:worker` (`node dist-worker/worker`) em `package.json` (per `phase-03-videos/TD-03`)
5. Criar `test/jest-e2e-video.json` (`rootDir: "./video"` — relativo à pasta do config —, `setupFiles` iguais ao e2e, mais um `globalSetup` que faz `obliterate` da fila de teste `video-processing` — como `globalSetup` não executa os `setupFiles`, ele define o prefixo `streamtube-test` e a conexão Redis explicitamente) e o script `test:e2e:video` (`jest --config ./test/jest-e2e-video.json --runInBand`), executado via `docker compose exec video-worker`; adicionar `testPathIgnorePatterns: ["/test/video/"]` ao `test/jest-e2e.json`; versionar as fixtures em `test/video/fixtures/` — MP4 válido de ~1MB e um `.mp4` falso (texto) (per `phase-03-videos/TD-13`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingQueue` | Integration (Redis real, prefixo `streamtube-test`, fila esvaziada no `afterEach`): `enqueue` duas vezes com o mesmo `videoId` resulta em um único job; `hasActiveJob` verdadeiro para job `waiting`, falso para ausente e para `failed` (que é removido) | `src/queue/video-processing.queue.integration-spec.ts` |
| `WorkerModule` | Unit (compilação de módulo; depende de DB e Redis reais do Compose, como o `auth.module.spec.ts`): contexto standalone compila sem providers HTTP | `src/worker.module.spec.ts` |

**Dependencies:** SI-03.1 — Redis no Compose e `queueConfig`; SI-03.2 — `StorageModule` importado pelo `WorkerModule`

**Acceptance criteria:**

- `docker compose up -d` inicia `video-worker` em estado `running`, e `docker compose exec video-worker ffprobe -version` responde com sucesso
- O processo `video-worker` não abre nenhuma porta HTTP (nenhum listener na porta `3000` dentro do container)
- Enfileirar `process-video` duas vezes para o mesmo `videoId` deixa exatamente um job na fila `video-processing`
- `docker compose exec video-worker npm run test:e2e:video` executa somente as suítes em `test/video/`, e `npm run test:e2e` no `nestjs-api` não as executa
- Com o Redis parado, `VideoProcessingQueue.enqueue` rejeita em poucos segundos em vez de ficar pendente

---

### SI-03.5 — Endpoint POST /videos/uploads (Início do Upload e Pré-cadastro em Rascunho)

**Route:** POST /videos/uploads
**Test Specs:** see `nestjs-project/specs/videos-uploads.plan.md`
**Authorization:** Authenticated (torna-se owner do vídeo criado)

**Description:** Inicia o upload multipart pré-assinado e pré-cadastra o vídeo como `DRAFT` no mesmo passo, devolvendo todas as URLs de parte sem que nenhum byte de vídeo passe pela API.

**Technical actions:**

1. Criar `src/videos/upload-plan.ts` — função pura `computeUploadPlan(sizeBytes)` → `{ part_size, part_count }` com `part_size = max(5 MiB, ceil(size_bytes / 10000))` limitado a 100 MiB (5 MiB = 5242880 bytes, mínimo de parte do S3) (per `### API Contracts → POST /videos/uploads`, `phase-03-videos/TD-04`)
2. Adicionar `findByUserId(userId)` ao `ChannelsService` (resolução de ownership fica no domínio de channels) e criar `src/videos/dto/initiate-upload.dto.ts` com as regras de `#### Validation Rules — Upload handshake` (`original_filename`, `mime_type` `^video\/[\w.+-]+$`, `size_bytes` 1..10737418240)
3. Criar `src/videos/video-uploads.service.ts` — `initiate(userId, dto)`: resolve o channel, gera o `id` na aplicação com `randomUUID()` (necessário antes do INSERT para montar `storage_key = videos/{id}/source`), `reserveSeq()` + `encode`, `createMultipartUpload(storage_key, mime_type)`, persiste `Video` com esse `id` (`status = 'DRAFT'`, `title = original_filename`, `storage_key`, `upload_id`) e presigna todas as partes com `expiresIn: 21600`; se a persistência falhar, aborta o multipart criado (per `phase-03-videos/TD-04`, `phase-03-videos/TD-06`)
4. Criar `src/videos/video-uploads.controller.ts` com `@SkipThrottle()` na classe (o `ThrottlerGuard` de 10 req/min é `APP_GUARD` global desde a Fase 02 e só deve valer para auth, como no `AppController`) e `POST /videos/uploads` (`@CurrentUser()`, status `201`) e response DTO `InitiateUploadResponseDto` (`id`, `status`, `part_size`, `part_count`, `parts[{ part_number, url }]`, `expires_at`) (per `### API Contracts → POST /videos/uploads`)
5. Documentar o endpoint com `@ApiOperation`, `@ApiBody`, `@ApiResponse` (201/400/401 com `ApiErrorEnvelopeDto`) e re-exportar `openapi.json` via `npm run openapi:export` (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `computeUploadPlan` | Unit: 1 byte → 1 parte de 5 MiB (5242880); 10GB → `part_count` ≤ 10000 e `part_size` ≤ 100 MiB; fronteiras exatas de múltiplos | `src/videos/upload-plan.spec.ts` |
| `VideoUploadsService.initiate` | Integration (DB + MinIO reais): cria `DRAFT` com `upload_id` e `public_id`; falha de persistência aborta o multipart | `src/videos/video-uploads.service.integration-spec.ts` |
| `ChannelsService.findByUserId` | Integration: retorna o channel do usuário / `null` | `src/channels/channels.service.integration-spec.ts` |

**Dependencies:** SI-03.2 — `StorageService` multipart; SI-03.3 — entidade `Video` e `VideoPublicIdService`

**Acceptance criteria:**

- `POST /videos/uploads` autenticado com `{ original_filename: "a.mp4", mime_type: "video/mp4", size_bytes: 10737418240 }` retorna `201` com `status: "DRAFT"`, `part_count` ≤ 10000 e uma URL por parte, com `expires_at` 6h no futuro
- Após essa chamada, existe uma linha em `videos` com `status = 'DRAFT'`, `channel_id` do usuário, `title = 'a.mp4'` e `upload_id` preenchido
- `POST /videos/uploads` com `mime_type: "application/pdf"` retorna `400` com `error: "VALIDATION_ERROR"`
- `POST /videos/uploads` com `size_bytes: 10737418241` retorna `400` com `error: "VALIDATION_ERROR"`
- `POST /videos/uploads` sem token retorna `401`
- O `id` retornado tem ≥ 10 caracteres e não é um UUID
- 15 chamadas autenticadas a `POST /videos/uploads` dentro de um minuto não recebem `429`

---

### SI-03.6 — Endpoints POST /videos/:id/uploads/parts e DELETE /videos/:id/uploads (Renovação e Abort)

**Route:** POST /videos/:id/uploads/parts, DELETE /videos/:id/uploads
**Test Specs:** see `nestjs-project/specs/videos-uploads-renew-abort.plan.md`
**Authorization:** Owner (anônimo 401; não-owner 404; status ≠ `DRAFT` → 409)

**Description:** Permite retomar uploads (renovando URLs de parte expiradas) e cancelá-los (abortando o multipart e removendo o rascunho), e introduz as exceções de domínio de vídeo e a regra de ownership "404, nunca 403".

**Technical actions:**

1. Adicionar a `src/common/exceptions/domain.exception.ts` as exceções `VideoNotFoundException` (`VIDEO_NOT_FOUND`, 404), `VideoNotInDraftException` (`VIDEO_NOT_IN_DRAFT`, 409), `InvalidUploadPartsException` (`INVALID_UPLOAD_PARTS`, 400) e `RangeNotSatisfiableException` (`RANGE_NOT_SATISFIABLE`, 416) (per `### Error Catalog`, `phase-02-auth/TD-07`)
2. Adicionar ao `VideoUploadsService` o helper `findOwnedDraft(publicId, userId)` — `decode` inválido, vídeo inexistente ou de outro channel → `VideoNotFoundException`; status ≠ `DRAFT` → `VideoNotInDraftException` (per `phase-03-videos/TD-12`)
3. Implementar `renewParts(publicId, userId, dto)` — valida `part_numbers` ≤ `part_count` derivado de `computeUploadPlan(size_bytes)` (fora do intervalo → `InvalidUploadPartsException`) e presigna com `expiresIn: 21600`; criar `src/videos/dto/renew-parts.dto.ts` (array não vazio, inteiros ≥ 1, únicos) (per `phase-03-videos/TD-04`)
4. Implementar `abort(publicId, userId)` — `abortMultipartUpload(storage_key, upload_id)` e remoção da linha `DRAFT` (per `### API Contracts → DELETE /videos/:id/uploads`)
5. Expor no `VideoUploadsController` `POST /videos/:id/uploads/parts` (`200`) e `DELETE /videos/:id/uploads` (`204`), com decorators OpenAPI (200/204/400/401/404/409) e `openapi.json` re-exportado (per `openapi-docs-nestjs/TD-01`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoUploadsService.findOwnedDraft` | Unit (repo mockado): id não decodificável, inexistente, de outro owner → `VIDEO_NOT_FOUND`; `PROCESSING` → `VIDEO_NOT_IN_DRAFT` | `src/videos/video-uploads.service.spec.ts` |
| `VideoUploadsService.renewParts` / `abort` | Integration (DB + MinIO reais): URLs renovadas aceitam `PUT`; abort remove a linha e invalida o `UploadId` | `src/videos/video-uploads.service.integration-spec.ts` |

**Dependencies:** SI-03.5 — vídeo `DRAFT` criado por `initiate` e `computeUploadPlan`

**Acceptance criteria:**

- `POST /videos/:id/uploads/parts` pelo owner de um `DRAFT` com `{ part_numbers: [1, 2] }` retorna `200` com duas URLs e `expires_at` 6h no futuro
- `POST /videos/:id/uploads/parts` com um `part_number` maior que `part_count` retorna `400` com `error: "INVALID_UPLOAD_PARTS"`
- `POST /videos/:id/uploads/parts` ou `DELETE /videos/:id/uploads` por outro usuário autenticado retorna `404` com `error: "VIDEO_NOT_FOUND"`, idêntico ao de um id inexistente
- `DELETE /videos/:id/uploads` pelo owner retorna `204`; a linha some de `videos` e uma segunda chamada com o mesmo id retorna `404` com `error: "VIDEO_NOT_FOUND"`
- As duas rotas, sobre um vídeo em `PROCESSING`, retornam `409` com `error: "VIDEO_NOT_IN_DRAFT"`
- As duas rotas, sem token, retornam `401`

---

### SI-03.7 — Endpoint POST /videos/:id/uploads/complete (Finalização e Enfileiramento)

**Route:** POST /videos/:id/uploads/complete
**Test Specs:** see `nestjs-project/specs/videos-uploads-complete.plan.md`
**Authorization:** Owner (anônimo 401; não-owner 404; status ≠ `DRAFT` → 409)

**Description:** Finaliza o multipart com os ETags enviados pelo cliente, grava `PROCESSING` antes de enfileirar e responde `202` mesmo com o Redis fora — o banco é a fonte da verdade e o reconciler cobre o enqueue perdido.

**Technical actions:**

1. Criar `src/videos/dto/complete-upload.dto.ts` — `parts` não vazio de `{ part_number: integer ≥ 1, etag: string não vazia }` com `part_number` único (`@ValidateNested` + `@Type`) (per `#### Validation Rules — Upload handshake`)
2. Implementar `VideoUploadsService.complete(publicId, userId, dto)` — `findOwnedDraft`, `completeMultipartUpload(storage_key, upload_id, parts)`; `StorageInvalidPartsError` → `InvalidUploadPartsException` (status permanece `DRAFT`) (per `phase-03-videos/TD-04`)
3. Após o complete no storage, gravar `status = 'PROCESSING'` e confirmar a transação **antes** de chamar `VideoProcessingQueue.enqueue(video.id)`; falha no enqueue (Redis indisponível — falha rápida garantida pelo timeout de 5s do `enqueue`, ver SI-03.4) é logada e engolida — a resposta continua `202` (per `phase-03-videos/TD-09`)
4. Expor `POST /videos/:id/uploads/complete` no `VideoUploadsController` com `@HttpCode(202)` e response `{ id, status: 'PROCESSING' }`; importar `QueueModule` no `VideosModule` (per `### API Contracts → POST /videos/:id/uploads/complete`)
5. Documentar com decorators OpenAPI (202/400/401/404/409) e re-exportar `openapi.json` (per `openapi-docs-nestjs/TD-01`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoUploadsService.complete` | Unit (storage/queue mockados): ordem status→enqueue; enqueue lançando erro não propaga; `StorageInvalidPartsError` → `INVALID_UPLOAD_PARTS` sem mudar status | `src/videos/video-uploads.service.spec.ts` |
| `VideoUploadsService.complete` | Integration (DB + MinIO + Redis reais): upload real de 2 partes → objeto montado, `PROCESSING` persistido, job `process-video` com `jobId = video.id` | `src/videos/video-uploads.service.integration-spec.ts` |

**Dependencies:** SI-03.4 — `VideoProcessingQueue`; SI-03.6 — `findOwnedDraft` e exceções de vídeo

**Acceptance criteria:**

- `POST /videos/:id/uploads/complete` pelo owner com os ETags corretos de todas as partes retorna `202` com `{ id, status: "PROCESSING" }`, e o objeto em `storage_key` tem tamanho igual a `size_bytes`
- Após o complete, a fila `video-processing` contém um job `process-video` com `jobId` igual ao UUID do vídeo e payload `{ videoId }`
- Com o Redis parado, `POST /videos/:id/uploads/complete` ainda retorna `202` e a linha fica `status = 'PROCESSING'`
- Um ETag incorreto retorna `400` com `error: "INVALID_UPLOAD_PARTS"` e o vídeo permanece `DRAFT`
- Repetir o complete num vídeo já em `PROCESSING` retorna `409` com `error: "VIDEO_NOT_IN_DRAFT"`
- `POST /videos/:id/uploads/complete` com `parts: []` retorna `400` com `error: "VALIDATION_ERROR"`

---

### SI-03.8 — Processar Vídeo no Worker (Metadados, Thumbnail e Política de Falha)

**Description:** Implementa o consumer `process-video`: extrai duração e metadados com ffprobe sobre URL interna pré-assinada, gera a thumbnail de um frame e classifica falhas entre permanentes (`ERROR`) e de infraestrutura (retry com backoff, para sempre).

**Technical actions:**

1. Criar `src/processing/processing-policy.ts` com funções puras: `thumbnailTimestamp(duration)` = `min(0.1 × duration, duration − 0.1)` (piso em 0), `classifyProcessingError(err)` → `{ kind: 'permanent', reason: 'INVALID_FILE' | 'NO_VIDEO_STREAM' | 'NO_DURATION' } | { kind: 'infra' }` — `INVALID_FILE` só quando o ffprobe sai com código ≠ 0 **e** o stderr indica dado inválido (`Invalid data found when processing input`, `moov atom not found`); erros de rede/HTTP no stderr (`Connection refused`, `Server returned`, `timed out`), timeout e qualquer erro desconhecido → `infra` e `processingBackoff(attemptsMade)` = `min(30s × 2^(attemptsMade − 1), 1h)` (per `phase-03-videos/TD-08`, `phase-03-videos/TD-09`)
2. Criar `src/processing/ffmpeg.service.ts` — `probe(url)` executa `ffprobe -v error -print_format json -show_format -show_streams` via `child_process.spawn` com timeout de 10 min (kill + erro de infra no estouro) e retorna `duration_seconds`, `width`, `height`, `codec`; `extractFrame(url, atSeconds)` executa `ffmpeg -ss {t} -i {url} -frames:v 1 -f image2 pipe:1` e devolve o JPEG (per `phase-03-videos/TD-07`)
3. Criar `src/processing/video.processor.ts` — `@Processor('video-processing', { settings: { backoffStrategy: processingBackoff } })` estendendo `WorkerHost`; `process(job)`: carrega o vídeo por `videoId`, ignora (ack) se o vídeo não existe (abortado/removido) ou se `status ≠ 'PROCESSING'`, `headObject(storage_key)` antes do probe (falha aqui = storage inacessível → `infra`, nunca `ERROR`), `presignInternalGet(storage_key)`, `probe`, `extractFrame` → `putObject(thumbnail_key, jpeg, 'image/jpeg')`, grava `READY` + metadados (per `### Events/Messages → video-processing`, `phase-03-videos/TD-09`)
4. No `VideoProcessor`, erros `permanent` gravam `status = 'ERROR'` + `error_reason` e só então relançam como `UnrecoverableError`; se a gravação do `ERROR` falhar (DB fora), o erro é relançado como `infra` (retry), nunca `UnrecoverableError`; erros `infra` são relançados sem tocar o status (per `phase-03-videos/TD-09`)
5. Criar `src/processing/processing.module.ts` (`FfmpegService`, `VideoProcessor`; persistência via `VideosDataModule` → `VideosRepository`, sem `forFeature` próprio) e registrá-lo **apenas** no `WorkerModule` (per `phase-03-videos/TD-03`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `processing-policy` | Unit: timestamp para 0.05s / 1s / 100s; classificação de cada razão permanente; stderr de rede (`Connection refused`) e erro desconhecido como `infra`; backoff 30s, 60s, …, teto 3600s | `src/processing/processing-policy.spec.ts` |
| `VideoProcessor` | Unit (deps mockadas): skip quando não `PROCESSING`; permanente → `ERROR` + `UnrecoverableError`; infra → relança sem mudar status | `src/processing/video.processor.spec.ts` |
| Pipeline de processamento | E2E vídeo (container `video-worker`, FFmpeg + MinIO + Redis + DB reais, `WorkerModule` no processo Jest): fixture MP4 de ~1MB → `READY` com metadados e thumbnail no storage; `.mp4` falso → `ERROR` com `error_reason = 'INVALID_FILE'` | `test/video/video-processing.e2e-spec.ts` |

**Dependencies:** SI-03.4 — `WorkerModule`, fila, suíte `test:e2e:video` e fixtures; SI-03.7 — vídeos chegam em `PROCESSING` com job enfileirado

**Acceptance criteria:**

- Um MP4 válido completado via upload chega a `status = 'READY'` com `duration_seconds` > 0, `width`, `height` e `codec` preenchidos
- O vídeo `READY` tem `thumbnail_key` apontando para um objeto `image/jpeg` existente no bucket
- Um arquivo `.mp4` que não é vídeo termina em `status = 'ERROR'` com `error_reason = 'INVALID_FILE'`, e o job vai para o set `failed` sem novas tentativas
- Com o MinIO inacessível durante o processamento, o vídeo continua em `PROCESSING` e o job é reagendado com atraso de 30s na primeira retentativa
- Reprocessar um job de um vídeo já `READY` não altera a linha nem regrava a thumbnail

---

### SI-03.9 — Reconciliar Vídeos Presos em PROCESSING

**Description:** Garante que nenhum job se perca quando o Redis cai: um cron no worker re-enfileira, a cada 5 minutos, vídeos em `PROCESSING` há mais de 15 minutos sem job na fila.

**Technical actions:**

1. Criar `src/processing/video-reconciler.service.ts` — `findStaleProcessing(now)` consulta `status = 'PROCESSING' AND updated_at < now − 15 min` (usa o índice `(status, updated_at)`) (per `phase-03-videos/TD-09`)
2. Implementar `reconcile()` (puro, sem checar a flag) — para cada vídeo stale sem job ativo (`VideoProcessingQueue.hasActiveJob(id)` falso; job `failed` antigo é removido antes), chamar `enqueue(id)`; `jobId = videoId` torna re-enfileiramentos concorrentes inofensivos; falha de Redis é logada e a execução seguinte tenta de novo (per `### Events/Messages → video-processing`)
3. Criar `handleCron()` decorado com `@Cron('*/5 * * * *', { name: 'video-reconciler' })` que retorna sem efeito quando `VIDEO_RECONCILER_ENABLED` é `false` e, caso contrário, chama `reconcile()` — os testes chamam `reconcile()` diretamente e o cron fica inerte (per `phase-03-videos/TD-09`)
4. Registrar `VideoReconcilerService` no `ProcessingModule` (worker), importando `QueueModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoReconcilerService` | Integration (DB + Redis reais, `reconcile()` chamado diretamente): stale sem job → enfileirado; stale com job `failed` → job removido e re-enfileirado; stale com job ativo → ignorado; `handleCron()` com flag `false` → nada enfileirado; recente (< 15 min) → ignorado; `READY`/`ERROR` → ignorados | `src/processing/video-reconciler.service.integration-spec.ts` |

**Dependencies:** SI-03.4 — `VideoProcessingQueue.hasActiveJob`/`enqueue`; SI-03.8 — `ProcessingModule`

**Acceptance criteria:**

- Um vídeo em `PROCESSING` com `updated_at` de 20 minutos atrás e sem job na fila ganha um job `process-video` após uma execução do reconciler
- Um vídeo em `PROCESSING` atualizado há 5 minutos não é re-enfileirado
- Um vídeo stale que já tem job na fila continua com exatamente um job após a execução
- Um vídeo cujo `complete` respondeu `202` com o Redis parado chega a `READY` após o Redis voltar e o reconciler rodar (verificação manual com `docker compose stop/start redis`, registrada no `progress.md`)

---

### SI-03.10 — Endpoint GET /videos/:id (Metadados com Autenticação Opcional)

**Route:** GET /videos/:id
**Test Specs:** see `nestjs-project/specs/videos-metadata.plan.md`
**Authorization:** Anonymous / Authenticated veem só `READY`; Owner vê qualquer status (oculto → 404)

**Description:** Expõe os metadados do vídeo pela URL única, aplicando a matriz "owner vê tudo, demais só `READY`, oculto é 404" — o que exige autenticação opcional numa rota pública.

**Technical actions:**

1. Criar `src/auth/decorators/optional-auth.decorator.ts` (`@OptionalAuth()`) e estender `JwtAuthGuard`: em rotas `@OptionalAuth()`, token ausente ou inválido segue como anônimo (sem `401`) e token válido popula `request.user` (per `### Authorization Matrix`, `phase-02-auth/TD-02`)
2. Criar `src/videos/videos.service.ts` — `findVisible(publicId, viewerUserId | null)`: `decode` inválido ou inexistente → `VideoNotFoundException`; não `READY` e viewer ≠ owner → `VideoNotFoundException` (per `phase-03-videos/TD-12`)
3. Criar `src/videos/dto/video-response.dto.ts` com os campos de `### API Contracts → GET /videos/:id` (`id` = `public_id`; `stream_url`/`download_url`/`thumbnail_url` só quando `READY`; `error_reason` só quando `ERROR`) — o UUID interno nunca é serializado
4. Criar `src/videos/videos.controller.ts` com `@SkipThrottle()` na classe (player `<video>` dispara várias requisições `Range`; o throttler global é só para auth) e `GET /videos/:id` (`@OptionalAuth()`, `@CurrentUser()` opcional), e registrá-lo no `VideosModule`
5. Documentar com decorators OpenAPI (200/404, `@ApiBearerAuth` opcional) e re-exportar `openapi.json` (per `openapi-docs-nestjs/TD-01`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `JwtAuthGuard` (`@OptionalAuth`) | Unit: sem token → passa sem user; token inválido → passa sem user; token válido → user populado; rota normal continua exigindo token | `src/auth/guards/jwt-auth.guard.spec.ts` |
| `VideosService.findVisible` | Unit (repo mockado): matriz status × viewer (anônimo, outro usuário, owner) | `src/videos/videos.service.spec.ts` |

**Dependencies:** SI-03.6 — `VideoNotFoundException`; SI-03.3 — entidade `Video` e `VideoPublicIdService`

**Acceptance criteria:**

- `GET /videos/:id` anônimo de um vídeo `READY` retorna `200` com `duration_seconds`, `width`, `height`, `codec` e `stream_url`/`download_url`/`thumbnail_url` preenchidos
- `GET /videos/:id` anônimo ou por outro usuário de um vídeo `DRAFT`, `PROCESSING` ou `ERROR` retorna `404` com `error: "VIDEO_NOT_FOUND"`, idêntico ao de um id inexistente
- `GET /videos/:id` pelo owner de um vídeo `PROCESSING` retorna `200` com `status: "PROCESSING"` e URLs de mídia `null`
- `GET /videos/:id` com `Authorization: Bearer invalido` em vídeo `READY` retorna `200` (tratado como anônimo, sem `401`)
- O body de resposta nunca contém o UUID interno do vídeo nem `storage_key`/`upload_id`
- 20 chamadas anônimas a `GET /videos/:id` dentro de um minuto não recebem `429`

---

### SI-03.11 — Endpoints GET /videos/:id/stream, /download e /thumbnail (Proxy com Range)

**Route:** GET /videos/:id/stream, GET /videos/:id/download, GET /videos/:id/thumbnail
**Test Specs:** see `nestjs-project/specs/videos-media.plan.md`
**Authorization:** Anonymous, Authenticated e Owner — somente vídeos `READY` (demais → 404)

**Description:** Entrega reprodução via streaming e download pelo proxy da API, repassando `Range` e devolvendo `206`, sem bufferizar e sem expor o storage — a autorização fica centralizada por requisição.

**Technical actions:**

1. Adicionar `VideosService.findReady(publicId)` — inexistente ou não `READY` (owner incluído) → `VideoNotFoundException` (per `phase-03-videos/TD-12`)
2. Criar `src/videos/media-delivery.service.ts` — `openMedia(video, range?)` chama `StorageService.getObjectStream(storage_key, range)` e devolve stream + headers (`Content-Type`, `Content-Length`, `Content-Range`, `Accept-Ranges: bytes`, status `206`/`200`); `StorageInvalidRangeError` → `RangeNotSatisfiableException` com `Content-Range: bytes */{size}` (per `phase-03-videos/TD-11`)
3. Adicionar ao `VideosController` `GET /videos/:id/stream` e `GET /videos/:id/download` (`@Public()`, `@Res()` Express com `stream.pipeline` para respeitar backpressure e encerrar o stream do S3 se o cliente desconectar); download acrescenta `Content-Disposition: attachment; filename="{fallback ASCII sem aspas/controle}"; filename*=UTF-8''{original_filename percent-encoded}` (RFC 6266/5987 — evita `ERR_INVALID_CHAR` e injeção de parâmetros) (per `### API Contracts → GET /videos/:id/stream`, `### API Contracts → GET /videos/:id/download`)
4. Adicionar `GET /videos/:id/thumbnail` (`@Public()`) servindo `thumbnail_key` com `Content-Type: image/jpeg` (per `### API Contracts → GET /videos/:id/thumbnail`, `phase-03-videos/TD-08`)
5. Garantir que o `DomainExceptionFilter` renderize `RANGE_NOT_SATISFIABLE` com o header `Content-Range`, documentar as três rotas com decorators OpenAPI (200/206/404/416, `@ApiProduces`) e re-exportar `openapi.json` (per `openapi-docs-nestjs/TD-01`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `MediaDeliveryService` | Integration (MinIO real): range parcial → `206` + `Content-Range` correto; sem range → `200` + `Content-Length` total; range inválido → `RANGE_NOT_SATISFIABLE` | `src/videos/media-delivery.service.integration-spec.ts` |
| `DomainExceptionFilter` | Unit: `RangeNotSatisfiableException` gera `416` com envelope e header `Content-Range` | `src/common/filters/domain-exception.filter.spec.ts` |

**Dependencies:** SI-03.10 — `VideosController`/`VideosService`; SI-03.2 — `getObjectStream`

**Acceptance criteria:**

- `GET /videos/:id/stream` de um vídeo `READY` com `Range: bytes=0-1023` retorna `206`, `Content-Range: bytes 0-1023/{size_bytes}`, `Accept-Ranges: bytes` e exatamente 1024 bytes
- `GET /videos/:id/stream` sem `Range` retorna `200` com `Content-Length` igual a `size_bytes` e o `Content-Type` do vídeo
- `GET /videos/:id/download` retorna `Content-Disposition: attachment` com `filename*=UTF-8''` contendo o `original_filename` codificado e aceita `Range` com `206`; um `original_filename` com acentos e aspas não gera `500`
- `GET /videos/:id/stream` com `Range: bytes={size_bytes}-` retorna `416` com `error: "RANGE_NOT_SATISFIABLE"` e `Content-Range: bytes */{size_bytes}`
- `GET /videos/:id/thumbnail` de um vídeo `READY` retorna `200` com `Content-Type: image/jpeg`
- As três rotas, para um vídeo `PROCESSING` — inclusive chamadas pelo owner — retornam `404` com `error: "VIDEO_NOT_FOUND"`
- Nenhuma resposta das três rotas expõe hostname ou URL do MinIO

---

### SI-03.12 — Criar Cliente de Upload scripts/upload-video.ts

**Description:** Cliente Node que executa o contrato de upload de ponta a ponta com memória constante — prova reproduzível do upload de 10GB e ferramenta reutilizada pelos testes.

**Technical actions:**

1. Criar `nestjs-project/scripts/upload-video.ts` — CLI `--file <path> --api <url> --token <access_token> [--concurrency N]`; chama `POST /videos/uploads` com `original_filename`, `mime_type` (por extensão) e `size_bytes` (via `fs.stat`) (per `phase-03-videos/TD-05`, `### API Contracts → POST /videos/uploads`)
2. Ler o arquivo parte a parte com `fs.createReadStream({ start, end })` conforme `part_size` e fazer `PUT` de cada parte na URL pré-assinada (via `http.request`, com concorrência limitada), guardando o `ETag` de cada resposta (memória constante, sem carregar o arquivo inteiro); flag opcional `--storage-connect <host:port>`: abre a conexão TCP nesse endereço mas mantém o header `Host` da URL assinada (assinatura SigV4 é host-bound) — permite rodar o script dentro da rede do Compose (`--storage-connect minio:9000`) contra URLs assinadas para `localhost:9000`, respeitando o TD-01 e a regra de `npm` só no container (per `phase-03-videos/TD-04`, `phase-03-videos/TD-01`)
3. Retentar partes com falha (backoff curto) e, ao receber `403` por URL expirada, renovar via `POST /videos/:id/uploads/parts` só para as partes pendentes (per `### API Contracts → POST /videos/:id/uploads/parts`)
4. Finalizar com `POST /videos/:id/uploads/complete` enviando `parts[{ part_number, etag }]` e imprimir `id`, `status` e tempo total; extrair a lógica de upload em `src/upload-client/multipart-uploader.ts` (dentro do `rootDir` do Jest e do glob do lint; importada pelo script e pelos testes, sem dependências de Nest) e adicionar o script `upload:video` (`ts-node scripts/upload-video.ts`) ao `package.json`
5. Adicionar `"scripts"` ao `exclude` do `tsconfig.build.json` — sem isso o `rootDir` inferido vira a raiz do projeto, a saída passa a `dist/src/...` e quebra `node dist/main`, o `start:worker` e o carregamento dos templates `.hbs`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `multipart-uploader` | Unit (HTTP mockado): fatiamento por `part_size`, coleta de ETags, renovação após `403`, retentativa de parte falha, `--storage-connect` conecta no endereço informado preservando o header `Host` da URL | `src/upload-client/multipart-uploader.spec.ts` |

**Dependencies:** SI-03.7 — contrato completo de upload (`initiate`, `renew`, `complete`)

**Acceptance criteria:**

- Com a config de dev (`S3_PUBLIC_ENDPOINT=http://localhost:9000`), `docker compose exec nestjs-api npm run upload:video -- --file fixture.mp4 --api http://nestjs-api:3000 --storage-connect minio:9000 --token <t>` termina com exit code `0` e imprime um `id` cujo vídeo está em `PROCESSING` ou `READY`
- Durante o upload de um arquivo de vários GB, o RSS do processo do script fica abaixo de `part_size × concurrency + 100MB`
- Com URLs expiradas no meio do upload, o script renova só as partes pendentes e conclui sem reenviar partes já confirmadas
- Uma falha de rede numa parte é retentada sem reiniciar o upload inteiro
- Após `npm run build`, existem `dist/main.js` e `dist/worker.js` (não `dist/src/...`), e `dist/mail/templates/*.hbs` continua presente

---

### SI-03.13 — Fluxo Completo de Upload, Processamento e Streaming (prova de entrega)

**Description:** Fecha a fase com o pipeline real de ponta a ponta (upload pelo cliente → worker → streaming/download) rodando no Compose, mais o smoke test e a prova manual dos 10GB registrada no `progress.md`.

**Technical actions:**

1. Criar `test/video/video-pipeline.e2e-spec.ts` — sobe a API HTTP e o `WorkerModule` no mesmo processo Jest (container `video-worker`), registra um usuário, confirma o e-mail lendo o token no Mailpit (helper `src/test/mailpit.ts` já existente) e faz login, envia a fixture de `test/video/fixtures/` (SI-03.4) via `src/upload-client/multipart-uploader.ts`, aguarda `READY` por polling de `GET /videos/:id` e valida `stream`/`download`/`thumbnail` (per `phase-03-videos/TD-13`, `phase-03-videos/TD-05`)
2. Documentar no `nestjs-project/CLAUDE.md` e no `README.md` os novos serviços (`redis`, `minio`, `minio-init`, `video-worker`), checagens de readiness (`redis-cli ping`, `mc ready`), o comando `docker compose exec video-worker npm run test:e2e:video` e o uso de `npm run upload:video` (incluindo `--storage-connect minio:9000` ao rodar dentro do container e a pré-condição de a API estar rodando via `npm run start:dev`); registrar também que, após `npm install` no `nestjs-api`, o worker precisa de `docker compose build video-worker && docker compose up -d -V video-worker` (volume anônimo de `node_modules`)
3. Executar o smoke test do Compose (`docker compose up -d` do zero → todos os serviços `running`/`healthy`) e a prova manual de upload de 10GB com `docker compose exec nestjs-api npm run upload:video -- --api http://nestjs-api:3000 --storage-connect minio:9000 ...` (arquivo de 10GB gerado dentro do container, ex.: `ffmpeg`/`fallocate`), registrando no `docs/phases/phase-03-videos/progress.md` tamanho, tempo, pico de memória da API e status final (per `phase-03-videos/TD-13`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Pipeline upload → processamento → entrega | E2E vídeo (container `video-worker`, todos os serviços reais): fixture válida chega a `READY` e é reproduzível via `206`; fixture falsa chega a `ERROR` e `GET /videos/:id/stream` retorna `404` | `test/video/video-pipeline.e2e-spec.ts` |

**Dependencies:** SI-03.8 — processamento no worker; SI-03.9 — reconciler; SI-03.11 — streaming/download/thumbnail; SI-03.12 — cliente de upload

**Acceptance criteria:**

- Partindo de `docker compose down -v`, um único `docker compose up -d` deixa `nestjs-api`, `video-worker`, `db`, `redis`, `minio` e `mailpit` em `running` e `minio-init` concluído com sucesso
- Uma fixture MP4 enviada pelo cliente fica `READY` e é reproduzível por `GET /videos/:id/stream` com `206`, sem nenhum passo manual entre upload e reprodução
- O upload de um arquivo de 10GB conclui com status final `READY` e o `progress.md` registra tamanho, duração e pico de memória da API, que permanece estável (sem crescer com o tamanho do arquivo)
- Durante o upload de 10GB, `GET /videos/:id` de outro vídeo continua respondendo em tempo normal (sem bloqueio da API)

---

## Technical Specifications

### Data Model

#### Video

Table `videos` (per phase-03-videos/TD-06 — single table with status enum + processing columns; `description`/`visibility` deferred to Fase 04).

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK — generated in the application (`randomUUID()`) so `storage_key` can be built before `INSERT` |
| seq | bigint | unique, not null, DB default `nextval('videos_seq_seq')` (migration); the application always writes the value from `reserveSeq()` — no `@Generated` — feeds `public_id` (phase-03-videos/TD-10) |
| public_id | varchar(32) | unique, not null — `Sqids(seq)` with shuffled alphabet, `minLength: 10` (phase-03-videos/TD-10) |
| channel_id | uuid | FK → `channels.id`, `ON DELETE CASCADE`, not null |
| title | varchar(255) | not null — initialized with `original_filename` on draft creation (edited in Fase 04) |
| status | enum `videos_status_enum` | not null, default `'DRAFT'`, values: `'DRAFT'`, `'PROCESSING'`, `'READY'`, `'ERROR'` |
| original_filename | varchar(255) | not null |
| mime_type | varchar(127) | not null — must match `video/*` |
| size_bytes | bigint | not null — TypeORM transformer → `number` |
| storage_key | varchar(255) | not null — object key of the source file (`videos/{id}/source`; `id` is generated in the application with `randomUUID()` before the multipart upload is created) |
| thumbnail_key | varchar(255) | nullable — set when processing succeeds (`videos/{id}/thumbnail.jpg`) |
| upload_id | varchar(255) | nullable — S3 multipart `UploadId` while `DRAFT` |
| duration_seconds | double precision | nullable — set by processing |
| width | integer | nullable — set by processing |
| height | integer | nullable — set by processing |
| codec | varchar(64) | nullable — set by processing |
| error_reason | varchar(64) | nullable — permanent-failure reason when `status = 'ERROR'` (phase-03-videos/TD-09) |
| created_at | timestamp | not null, auto-generated (`@CreateDateColumn`) |
| updated_at | timestamp | not null, auto-generated (`@UpdateDateColumn`) — used by the reconciler stale check |

**Relations:** `Video` → `Channel` (many-to-one via `channel_id`); `Channel` has many `Video` (one-to-many, inverse side). Ownership: a video is owned by the user whose `channels.user_id` equals the JWT `sub`.
**Indexes:** unique on `seq`; unique on `public_id`; `(channel_id)` — FK; `(status, updated_at)` — reconciler query (`status = 'PROCESSING' AND updated_at < now() - 15 min`).
**Sequence:** `videos_seq_seq` (PostgreSQL sequence). `seq` is reserved with `SELECT nextval('videos_seq_seq')` before insert so `public_id` is written in the same `INSERT` (no update round-trip, no conflict path).
**Status transitions (phase-03-videos/TD-09):** `DRAFT → PROCESSING` (upload complete) · `PROCESSING → READY` (processing succeeded) · `PROCESSING → ERROR` (permanent failure only). Infra failures never leave `PROCESSING`. A `DRAFT` aborted via `DELETE /videos/:id/uploads` is removed (row deleted).

### API Contracts

`:id` in every route is the video's `public_id` (phase-03-videos/TD-10) — the UUID `id` is never exposed. All upload-flow endpoints are owner-only; read endpoints follow phase-03-videos/TD-12 (hidden or foreign → `404 VIDEO_NOT_FOUND`, never 403). Error bodies follow the inherited envelope `{ statusCode, error, message }` (phase-02-auth/TD-07). Every endpoint is documented with explicit `@nestjs/swagger` decorators (`@ApiOperation`, `@ApiResponse` per status, `@ApiParam`, `@ApiBody`) per openapi-docs-nestjs/TD-01 revision 2026-05-12, and `openapi.json` is re-exported.

#### POST /videos/uploads (SI-03.5)

Starts a presigned multipart upload and pre-registers the video as `DRAFT` (phase-03-videos/TD-04, phase-03-videos/TD-06). No video bytes pass through the API.

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- original_filename: string, required — non-empty, max 255 characters
- mime_type: string, required — must match `^video\/[\w.+-]+$`
- size_bytes: integer, required — min 1, max 10737418240 (10GB)

**Response 201:**
- id: string — the video `public_id`
- status: `'DRAFT'`
- part_size: integer — bytes per part, computed as `max(5 MiB, ceil(size_bytes / 10000))` capped at 100 MiB (5 MiB = 5242880 bytes, the S3 minimum part size; S3 limit of 10,000 parts)
- part_count: integer — `ceil(size_bytes / part_size)`
- parts: array of `{ part_number: integer, url: string }` — one presigned `PUT` URL per part, signed with the **public** S3 client (phase-03-videos/TD-01)
- expires_at: string (ISO-8601) — URL validity, 6h from issue (`expiresIn: 21600`)

**Error responses:**
- 401: when the access token is missing or invalid
- 400 validation error: when the body fails validation (non-`video/*` MIME type, `size_bytes` > 10GB or < 1, missing filename)

---

#### POST /videos/:id/uploads/parts (SI-03.6)

Renews presigned part URLs for a `DRAFT` upload (expired URLs / resumed upload).

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- part_numbers: integer[], required — non-empty, each between 1 and the video's `part_count`, unique

**Response 200:**
- parts: array of `{ part_number: integer, url: string }`
- expires_at: string (ISO-8601) — 6h from issue

**Error responses:**
- 401: when the access token is missing or invalid
- 404 VIDEO_NOT_FOUND: when the video does not exist or belongs to another user
- 409 VIDEO_NOT_IN_DRAFT: when the video status is not `DRAFT`
- 400 INVALID_UPLOAD_PARTS: when a `part_number` is greater than the video's `part_count`
- 400 validation error: when `part_numbers` is empty, contains duplicates or values < 1

---

#### POST /videos/:id/uploads/complete (SI-03.7)

Finalizes the multipart upload, writes `PROCESSING` **before** enqueuing, and enqueues the processing job (phase-03-videos/TD-09). Returns `202` even when Redis is unavailable — the reconciler re-enqueues later.

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- parts: array, required — non-empty; each item `{ part_number: integer (≥ 1), etag: string (non-empty) }`, unique `part_number`

**Response 202:**
- id: string — the video `public_id`
- status: `'PROCESSING'`

**Error responses:**
- 401: when the access token is missing or invalid
- 404 VIDEO_NOT_FOUND: when the video does not exist or belongs to another user
- 409 VIDEO_NOT_IN_DRAFT: when the video status is not `DRAFT`
- 400 INVALID_UPLOAD_PARTS: when storage rejects the part list (missing/unknown part, wrong ETag, invalid order, part too small)
- 400 validation error: when the body fails validation

---

#### DELETE /videos/:id/uploads (SI-03.6)

Aborts the multipart upload in storage and removes the `DRAFT` video row.

**Request headers:**
- Authorization: Bearer <access_token>

**Response 204:** No content.

**Error responses:**
- 401: when the access token is missing or invalid
- 404 VIDEO_NOT_FOUND: when the video does not exist or belongs to another user
- 409 VIDEO_NOT_IN_DRAFT: when the video status is not `DRAFT`

---

#### GET /videos/:id (SI-03.10)

Video metadata. Public route with optional authentication: the owner sees any status; everyone else sees only `READY` (phase-03-videos/TD-12).

**Request headers:**
- Authorization: Bearer <access_token> — optional

**Response 200:**
- id: string — `public_id`
- title: string
- status: `'DRAFT' | 'PROCESSING' | 'READY' | 'ERROR'`
- original_filename: string
- mime_type: string
- size_bytes: integer
- duration_seconds: number | null
- width: integer | null
- height: integer | null
- codec: string | null
- error_reason: string | null — only populated when `status = 'ERROR'`
- stream_url: string | null — `/videos/{id}/stream` when `READY`, else `null`
- download_url: string | null — `/videos/{id}/download` when `READY`, else `null`
- thumbnail_url: string | null — `/videos/{id}/thumbnail` when `READY`, else `null`
- created_at: string (ISO-8601)

**Error responses:**
- 404 VIDEO_NOT_FOUND: when the video does not exist, or is not `READY` and the requester is not the owner (anonymous or other user)

---

#### GET /videos/:id/stream (SI-03.11)

Streams the source file through the API with `Range` pass-through (phase-03-videos/TD-11). The S3 `GetObject` body is piped without buffering.

**Request headers:**
- Range: `bytes=start-end` — optional

**Response 206 (with `Range`):** partial body; headers `Content-Type: {mime_type}`, `Content-Range: bytes {start}-{end}/{size}`, `Content-Length`, `Accept-Ranges: bytes`.

**Response 200 (without `Range`):** full body streamed; headers `Content-Type`, `Content-Length`, `Accept-Ranges: bytes`.

**Error responses:**
- 404 VIDEO_NOT_FOUND: when the video does not exist or is not `READY` (owner included)
- 416 RANGE_NOT_SATISFIABLE: when the `Range` is outside the object size; header `Content-Range: bytes */{size}`

---

#### GET /videos/:id/download (SI-03.11)

Same delivery path as `/stream` with `Content-Disposition: attachment; filename="{ASCII fallback}"; filename*=UTF-8''{percent-encoded original_filename}` (phase-03-videos/TD-11; RFC 6266/5987 encoding).

**Request headers:**
- Range: `bytes=start-end` — optional (resumable download)

**Response 200 / 206:** same headers as `/stream` plus `Content-Disposition: attachment`.

**Error responses:**
- 404 VIDEO_NOT_FOUND: when the video does not exist or is not `READY`
- 416 RANGE_NOT_SATISFIABLE: when the `Range` is outside the object size

---

#### GET /videos/:id/thumbnail (SI-03.11)

Streams the generated thumbnail (phase-03-videos/TD-08, phase-03-videos/TD-12).

**Response 200:** `Content-Type: image/jpeg`, body streamed from storage.

**Error responses:**
- 404 VIDEO_NOT_FOUND: when the video does not exist or is not `READY`

#### Validation Rules — Upload handshake

| Field | Rule | Error message |
|-------|------|---------------|
| original_filename | Required, string, 1–255 characters | original_filename must be shorter than or equal to 255 characters |
| mime_type | Required, matches `^video\/[\w.+-]+$` | mime_type must be a video MIME type |
| size_bytes | Required, integer, 1 ≤ value ≤ 10737418240 | size_bytes must not be greater than 10737418240 |
| part_numbers | Required, non-empty integer array, unique, each ≥ 1 (upper bound `part_count` checked in service) | part_numbers should not be empty |
| parts[].part_number | Required, integer ≥ 1, unique within `parts` | part_number must not be less than 1 |
| parts[].etag | Required, non-empty string | etag should not be empty |

### Authorization Matrix

Per phase-03-videos/TD-12 (owner-only writes, `READY`-only reads, 404 for hidden). "Owner" = authenticated user whose channel (`channels.user_id = sub`) owns the video. Stream/download/thumbnail use `@Public()`; `GET /videos/:id` uses `@OptionalAuth()` (SI-03.10), which resolves the user from an optional Bearer token (invalid/absent token → treated as anonymous, never 401).

| Endpoint | Anonymous | Authenticated (non-owner) | Owner |
|----------|-----------|---------------------------|-------|
| POST /videos/uploads | ✗ 401 | ✓ (becomes owner) | ✓ |
| POST /videos/:id/uploads/parts | ✗ 401 | ✗ 404 | ✓ (`DRAFT` only, else 409) |
| POST /videos/:id/uploads/complete | ✗ 401 | ✗ 404 | ✓ (`DRAFT` only, else 409) |
| DELETE /videos/:id/uploads | ✗ 401 | ✗ 404 | ✓ (`DRAFT` only, else 409) |
| GET /videos/:id | ✓ `READY` only (else 404) | ✓ `READY` only (else 404) | ✓ any status |
| GET /videos/:id/stream | ✓ `READY` only | ✓ `READY` only | ✓ `READY` only |
| GET /videos/:id/download | ✓ `READY` only | ✓ `READY` only | ✓ `READY` only |
| GET /videos/:id/thumbnail | ✓ `READY` only | ✓ `READY` only | ✓ `READY` only |

"My videos" listing is deferred to Fase 04 (phase-03-videos/TD-12).

### Error Catalog

Inherits the error response format `{ statusCode, error, message }` (phase-02-auth/TD-07, established in Phase 02). New domain exceptions extend `DomainException` in `src/common/exceptions/domain.exception.ts` and are rendered by the existing `DomainExceptionFilter`.

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| VIDEO_NOT_FOUND | 404 | `:id` does not exist; video belongs to another user (write routes); video not `READY` and requester is not the owner (`GET /videos/:id`); video not `READY` (stream/download/thumbnail) |
| VIDEO_NOT_IN_DRAFT | 409 | `POST /videos/:id/uploads/parts`, `POST /videos/:id/uploads/complete` or `DELETE /videos/:id/uploads` on a video whose status is not `DRAFT` |
| INVALID_UPLOAD_PARTS | 400 | `POST /videos/:id/uploads/complete` when storage rejects `CompleteMultipartUpload` (`InvalidPart`, `InvalidPartOrder`, `EntityTooSmall`, `NoSuchUpload`) or a `part_number` exceeds `part_count` in `/uploads/parts` |
| RANGE_NOT_SATISFIABLE | 416 | `GET /videos/:id/stream` or `/download` with a `Range` beyond the object size (storage `InvalidRange`); response carries `Content-Range: bytes */{size}` |
| VALIDATION_ERROR | 400 | Inherited — body/params fail class-validator rules (non-`video/*` MIME, `size_bytes` > 10GB, empty `parts`, etc.) |

**Processing `error_reason` values** (not HTTP — persisted in `videos.error_reason` when a permanent failure moves the video to `ERROR`, per phase-03-videos/TD-09):

| error_reason | Trigger |
|--------------|---------|
| INVALID_FILE | `headObject` succeeded **and** ffprobe exits non-zero with stderr reporting invalid data (`Invalid data found when processing input`, `moov atom not found`) — e.g., fake `.mp4`. Network/HTTP errors in stderr, timeouts and unknown failures are `infra` (retry), never `INVALID_FILE` |
| NO_VIDEO_STREAM | ffprobe output has no stream with `codec_type = 'video'` |
| NO_DURATION | ffprobe reports no duration or duration ≤ 0 |

### Events/Messages

#### video-processing → `process-video`

BullMQ queue `video-processing`, job name `process-video`, connection `{ host: 'redis', port: 6379 }` and `prefix` from config (`streamtube` in dev, `streamtube-test` in tests — phase-03-videos/TD-13).

**Payload:**

```json
{ "videoId": "uuid" }
```

**Job options:** `jobId = videoId` (dedup — re-adding an existing id is ignored); `attempts: Number.MAX_SAFE_INTEGER` (infra failures retry "forever"); `backoff: { type: 'capped-exponential' }` resolved by worker `settings.backoffStrategy` → `min(30s × 2^(attemptsMade − 1), 1h)`; `removeOnComplete: true`; failed jobs kept (the `failed` set doubles as dead-letter store — phase-03-videos/TD-02).
**Producer:** `VideoProcessingQueue` (API, called from `VideoUploadsService.complete` after `status = 'PROCESSING'` is committed) and `VideoReconcilerService` (worker) (per phase-03-videos/TD-09)
**Consumer:** `VideoProcessor` (`@Processor('video-processing')` extends `WorkerHost`, registered only in `WorkerModule`) (per phase-03-videos/TD-03)
**Trigger:** upload completion; reconciler re-enqueue (every 5 min, `@Cron('*/5 * * * *')`) for videos in `PROCESSING` with `updated_at` older than 15 min and no job in the queue (per phase-03-videos/TD-09)
**Processing steps:** load video by `videoId`; skip (ack) unless `status = 'PROCESSING'` (idempotency); `headObject(storage_key)` (failure → `infra`); presign an internal `GET` URL for `storage_key`; run `ffprobe` (`child_process.spawn`, 10-minute timeout) → `duration_seconds`, `width`, `height`, `codec` (phase-03-videos/TD-07); run `ffmpeg -ss {min(0.1 × duration, duration − 0.1)} -frames:v 1` → JPEG uploaded to `thumbnail_key` (phase-03-videos/TD-08); update row to `READY` with metadata.
**Failure classification:** pure function `classifyProcessingError(err)` → `permanent` (throw `UnrecoverableError` → `status = 'ERROR'` + `error_reason`) or `infra` (rethrow → retry with backoff, status stays `PROCESSING`); `permanent` requires invalid-data evidence in ffprobe stderr (see `### Error Catalog → error_reason`) — network/HTTP stderr, timeouts and unknown errors are `infra` (phase-03-videos/TD-09).
**Delivery semantics:** at-least-once, idempotent consumer (per phase-03-videos/TD-02, phase-03-videos/TD-09)

---

## Dependency Map

```
SI-03.1 (root)
├── SI-03.2 — depends on SI-03.1 (MinIO + storageConfig)
│   ├── SI-03.3 — depends on SI-03.1 + SI-03.2 (videoConfig; VideosModule imports StorageModule)
│   │   └── SI-03.5 — depends on SI-03.2 + SI-03.3 (multipart + Video entity + public_id)
│   │       └── SI-03.6 — depends on SI-03.5 (DRAFT video + computeUploadPlan)
│   │           ├── SI-03.7 — depends on SI-03.4 + SI-03.6 (queue producer + findOwnedDraft)
│   │           │   ├── SI-03.8 — depends on SI-03.4 + SI-03.7 (worker + PROCESSING videos)
│   │           │   │   └── SI-03.9 — depends on SI-03.4 + SI-03.8 (queue + ProcessingModule)
│   │           │   └── SI-03.12 — depends on SI-03.7 (full upload contract)
│   │           └── SI-03.10 — depends on SI-03.3 + SI-03.6 (Video entity + VideoNotFoundException)
│   │               └── SI-03.11 — depends on SI-03.2 + SI-03.10 (getObjectStream + VideosController)
│   └── SI-03.4 — depends on SI-03.1 + SI-03.2 (Redis + queueConfig; WorkerModule imports StorageModule)
└── SI-03.13 — depends on SI-03.8 + SI-03.9 + SI-03.11 + SI-03.12 (end-to-end delivery proof)
```

Linearized implementation order: SI-03.1 → SI-03.2 → SI-03.3, SI-03.4 (parallel) → SI-03.5 → SI-03.6 → SI-03.7, SI-03.10 (parallel) → SI-03.8, SI-03.11, SI-03.12 (parallel) → SI-03.9 → SI-03.13

---

## Deliverables

- [ ] SI-03.1 — Infra: Dependências, Configuração e Serviços Redis/MinIO no Compose
- [ ] SI-03.2 — Criar StorageModule com Clientes S3 Interno e Público
- [ ] SI-03.3 — Criar Entidade Video, Migration e Gerador de public_id
- [ ] SI-03.4 — Infra: Fila video-processing e Processo video-worker
- [ ] SI-03.5 — Endpoint POST /videos/uploads (Início do Upload e Pré-cadastro em Rascunho)
- [ ] SI-03.6 — Endpoints POST /videos/:id/uploads/parts e DELETE /videos/:id/uploads (Renovação e Abort)
- [ ] SI-03.7 — Endpoint POST /videos/:id/uploads/complete (Finalização e Enfileiramento)
- [ ] SI-03.8 — Processar Vídeo no Worker (Metadados, Thumbnail e Política de Falha)
- [ ] SI-03.9 — Reconciliar Vídeos Presos em PROCESSING
- [ ] SI-03.10 — Endpoint GET /videos/:id (Metadados com Autenticação Opcional)
- [ ] SI-03.11 — Endpoints GET /videos/:id/stream, /download e /thumbnail (Proxy com Range)
- [ ] SI-03.12 — Criar Cliente de Upload scripts/upload-video.ts
- [ ] SI-03.13 — Fluxo Completo de Upload, Processamento e Streaming (prova de entrega)

**Full test suites:**

- [ ] Backend tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Video E2E tests pass (`docker compose exec video-worker npm run test:e2e:video`)
- [ ] Type/compilation checks pass (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`docker compose exec nestjs-api npm run lint`)
- [ ] `openapi.json` is up to date (`docker compose exec nestjs-api npm run openapi:export` produces no diff)
