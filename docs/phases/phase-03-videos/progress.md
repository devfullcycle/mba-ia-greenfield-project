# phase-03-videos — Progress

**Status:** completed
**SIs:** 11/11 completed

### SI-03.1 — Dependências, Config Namespaces e Infra Docker (Redis, MinIO, Worker)
- **Status:** completed
- **Tests:** no tests (infra/config); baseline da suíte permanece verde
- **Observations:** db remapeado para `5433:5432` no host por conflito com um Postgres de outro projeto (acesso interno `db:5432` inalterado). Redis/MinIO não publicam portas host (acesso por nome de serviço). `S3_ACCESS_KEY/S3_SECRET_KEY` ficaram com default (não `required`) para manter a convenção do projeto de `validate({})` limpo. ffmpeg 5.1.9 instalado na imagem.

### SI-03.2 — Storage Service (S3/MinIO via AWS SDK v3)
- **Status:** completed
- **Tests:** 4/4 passing (storage.service.integration-spec.ts — roundtrip multipart, range/206, presigned download, ensureBucket idempotente) contra MinIO real
- **Observations:** AWS SDK instalado em `3.1075.0`. `getObjectRange` devolve stream + `Content-Range` para o streaming. `onModuleInit` garante o bucket.

### SI-03.3 — Entidade Video e Migration
- **Status:** completed
- **Tests:** 8/8 passing (video.entity.integration-spec.ts: 4; videos.module.spec.ts: 1; migrations.integration-spec.ts: 3)
- **Observations:** Migration `CreateVideos` gerada via CLI (enum `video_status`, índices `public_id` único/`channel_id`/`status`, FK para `channels`). Teste de migrations estendido para 5 tabelas e passou a dropar os enums no setup (idempotente em DB pré-migrado); drops serializados para evitar deadlock. Limpeza dos testes respeita a ordem de FK (videos antes de channels/users).

### SI-03.4 — Public ID, Máquina de Status e Exceções de Domínio
- **Status:** completed
- **Tests:** 12/12 passing (public-id.service.spec.ts: 4; video-status.spec.ts: 8)
- **Observations:** `nanoid@3` (linha CommonJS) em `customAlphabet` (11 chars, sem `-`/`_`). `assertTransition` valida o ciclo; exceções estendem `DomainException` (reuso do filtro da Fase 02).

### SI-03.5 — Queue Module e Contrato do Job (Producer)
- **Status:** completed
- **Tests:** 8/8 passing (video-queue.service.spec.ts: 4; queue.module.integration-spec.ts: 4)
- **Observations:** BullMQ `connection: {host, port}` (não `redis:`). `VIDEO_QUEUE = 'video-processing'`. Producer enfileira o job com `videoId`. Integração contra Redis real confirma enfileiramento e leitura do job.

### SI-03.6 — Iniciação do Upload (POST /videos)
- **Status:** completed
- **Tests:** unidade em videos.service.spec.ts (casos de sucesso + validações de contentType/fileSize)
- **Observations:** Valida `content_type` (deve começar com `video/`) e `file_size_bytes` (≤10GB). Gera `public_id` via `PublicIdService`, inicia multipart via `StorageService`, devolve N URLs presigned (uma por parte de 5MB, arredondado para cima).

### SI-03.7 — Finalização do Upload (POST /videos/:id/complete)
- **Status:** completed
- **Tests:** e2e em videos-upload.e2e-spec.ts (6 casos: 401, 415, 413, flow completo, 403, 409)
- **Observations:** Valida owner e estado (`draft`). Chama `completeMultipartUpload`, depois `headObject` para capturar `size_bytes`/`content_type`. Transita para `processing` e enfileira o job.

### SI-03.8 — Worker: Bootstrap, Processor e Processamento FFmpeg
- **Status:** completed
- **Tests:** 2/2 passing (video.processor.integration-spec.ts — vídeo válido→ready com duration+thumbnail; vídeo inválido→error)
- **Observations:** `NestFactory.createApplicationContext(WorkerModule)`. `WorkerModule` inclui `Channel` e `User` nas entities (necessário para TypeORM resolver relações). Clamping do timestamp da thumbnail: se `durationSeconds ≤ thumbnailTimestampSeconds`, usa `0`. Worker usa `compile()` (não `init()`) no teste para não auto-iniciar o consumer BullMQ.

### SI-03.9 — Streaming por Range (GET /videos/:publicId/stream)
- **Status:** completed
- **Tests:** e2e em videos-stream.e2e-spec.ts (206 com Range, 200 sem Range)
- **Observations:** Proxy do objeto do storage com `Content-Range`/`Accept-Ranges`. Mapeia erro 416 do S3/MinIO para `RangeNotSatisfiableException` (416). Apenas vídeos com status `ready` são streamáveis (404 para outros status).

### SI-03.10 — Download Presigned e Leitura do Vídeo
- **Status:** completed
- **Tests:** e2e em videos-stream.e2e-spec.ts (302 download redirect, 200 metadata, 404 desconhecido)
- **Observations:** `GET /download` redireciona 302 para URL presigned com `Content-Disposition: attachment`. `GET /:publicId` devolve JSON com metadados + URL presigned da thumbnail.

### SI-03.11 — OpenAPI, Wiring Final, Definition of Done e Documentação
- **Status:** completed
- **Tests:** DoD completo: 177/177 unit+integration + 64/64 e2e + `tsc --noEmit` limpo + lint 0 erros
- **Observations:** ESLint config atualizado para desligar regras `unsafe-*` inconsistentes com `no-explicit-any: 'off'` já estabelecido nas fases anteriores. `unbound-method: 'off'` para padrões Jest. `cleanAllTables` garante deleção de `videos` antes de `channels`/`users`. `test:e2e` com `--runInBand` para evitar contaminação cross-suite.
