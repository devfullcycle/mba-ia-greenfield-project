# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 4/12 completed

### SI-03.1 — Infra: Redis, MinIO e libs de fila/storage no Compose
- **Status:** completed
- **Tests:** no tests (Infra) — verificado via `docker compose ps` (redis/minio healthy) e `test/app.e2e-spec.ts` (AppModule com BullModule resolve sem erro de DI)
- **Observations:** none

### SI-03.2 — Migration e entidade Video
- **Status:** completed
- **Tests:** 7 passing (`video.entity.integration-spec.ts`: 5; `migrations.integration-spec.ts`: 2, atualizado para a 3ª migration)
- **Observations:**
  - `migrations.integration-spec.ts` e `create-test-data-source.ts` (cleanAllTables) atualizados para incluir a tabela `videos` — fora do escopo original da SI mas necessário para manter esses testes compartilhados corretos.
  - Corrigido um deadlock latente em `migrations.integration-spec.ts`: os `DROP TABLE ... CASCADE` do `beforeAll` rodavam em paralelo via `Promise.all`; com a 5ª tabela (`videos`, FK para `channels`) isso passou a colidir em lock do Postgres. Trocado para sequencial.

### SI-03.3 — StorageService (adapter S3/MinIO)
- **Status:** completed
- **Tests:** 2 passing (`storage.service.integration-spec.ts`, contra o MinIO real do Compose)
- **Observations:**
  - Adicionado `onModuleInit` no `StorageService` para criar o bucket automaticamente (idempotente — ignora `BucketAlreadyOwnedByYou`/`BucketAlreadyExists`), já que o MinIO não cria buckets sozinho. Não estava explícito na ação técnica da SI, mas é necessário para o adapter funcionar.

### SI-03.4 — VideosService: pré-cadastro e fluxo de upload
- **Status:** completed
- **Tests:** 9 passing (8 unit em `videos.service.spec.ts` + 1 integration em `videos.service.integration-spec.ts`, contra Postgres/Redis/MinIO reais do Compose)
- **Observations:**
  - Validação de `mimeType`/`sizeInBytes` (TD-08) e de `partNumber` deliberadamente fora do DTO (`class-validator`) — ficou na service, para mapear para os `errorCode`s de domínio (`UNSUPPORTED_MEDIA_TYPE`, `FILE_TOO_LARGE`, `UPLOAD_PART_INVALID`) do Error Catalog em vez do `VALIDATION_ERROR` genérico que o `ValidationPipe` geraria.
  - Exceções de domínio de vídeo ficaram em `src/videos/exceptions/video.exception.ts` (módulo próprio), reaproveitando a classe abstrata `DomainException` de `common/`.
