# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 3/13 completed

### SI-03.1 — Infra: Dependências, Configuração e Serviços Redis/MinIO no Compose
- **Status:** completed
- **Tests:** 13 passing (`src/config/env.validation.integration-spec.ts`)
- **Observations:**
  - **Imagem MinIO:** `minio/minio` e `minio/mc` não são mais publicadas (pull negado no Docker Hub e no quay.io). Por escolha do usuário, foram usadas `bitnamilegacy/minio:2025.7.23-debian-12-r5` e `bitnamilegacy/minio-client:2025.7.21-debian-12-r3` (mesmo binário MinIO; imagens congeladas, sem updates). O `minio-init` foi mantido como one-shot com `mc`, e o healthcheck usa `curl /minio/health/live`.
  - Verificado: `redis` e `minio` healthy, `minio-init` exit 0, buckets `streamtube` e `streamtube-test` criados, `mc admin config get … api` mostra `stale_uploads_expiry=24h`.
  - `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY` também são obrigatórios no schema (credenciais, como `DB_PASSWORD`). O Compose interpola esses valores do `.env` em `MINIO_ROOT_USER` e `MINIO_ROOT_PASSWORD`.
  - `nestjs-api` também espera `minio-init` terminar (`service_completed_successfully`), para os buckets existirem antes do boot.
  - Versões instaladas: `@aws-sdk/client-s3`/`s3-request-presigner` ^3.1165.0, `bullmq` ^6.7.2, `@nestjs/bullmq` ^12.0.1, `@nestjs/schedule` ^12.0.3, `sqids` ^0.3.0 (peer deps aceitam Nest 11).
  - Os namespaces `storage`/`queue`/`video` foram criados mas ainda não estão no `load` do `ConfigModule` (a SI não pede isso). Cada módulo consumidor deve registrá-los.
  - Fora de escopo: `nestjs-project/CLAUDE.md` ainda lista só `nestjs-api`/`db` como serviços. Atualizar a documentação com `redis`/`minio`/`minio-init` fica como tarefa separada.

### SI-03.2 — Criar StorageModule com Clientes S3 Interno e Público
- **Status:** completed
- **Tests:** 11 passing (`storage.module.spec.ts` 1 + `storage.service.integration-spec.ts` 10)
- **Observations:**
  - `StorageModule` importa `ConfigModule.forFeature(storageConfig)`, então funciona sozinho tanto no `AppModule` quanto no `WorkerModule` sem depender do `load` global.
  - Além de `NoSuchKey`, `StorageNotFoundError` também cobre `NotFound`, que é o nome que o SDK usa no 404 de `HeadObject` (resposta sem corpo).
  - `putObject` aceita `Buffer` (thumbnail). Stream de tamanho desconhecido exigiria `ContentLength` ou o `Upload` do lib-storage, o que fica fora do escopo.
  - Tipos de retorno (`UploadedPart`, `PresignedPart`, `ObjectStream`, `ObjectHead`) ficam em `src/storage/storage.types.ts`.

### SI-03.3 — Criar Entidade Video, Migration e Gerador de public_id
- **Status:** completed
- **Tests:** 181 passing (suíte unit+integration completa, 27 suites — inclui `video.entity.integration-spec.ts`, `video-public-id.service.spec.ts`, `migrations.integration-spec.ts`)
- **Observations:**
  - Migration `1794273602577-CreateVideos` gerada via `migration:generate` (nomes de índices/constraints batem com o que o `synchronize` dos testes produz). Sequence `videos_seq_seq` adicionada à mão (o CLI não expressa sequence standalone), com `OWNED BY videos.seq` e `DROP SEQUENCE IF EXISTS` no `down`.
  - A relação inversa `Channel.videos` obriga todo `DataSource` de teste com `Channel` a registrar `Video`: `Video` foi adicionado ao `ALL_ENTITIES` de 10 specs existentes (auth/users/channels).
  - O entity `seq` não declara default (por design do plano), mas a migration declara `DEFAULT nextval(...)`. Um `synchronize: true` em teste pode tentar remover esse default. Na rodada atual o default continuou presente, mas existe o risco de drift. O app sempre grava `seq` via `reserveSeq()`, então não há impacto funcional.
  - O teste "revert last migration" de `migrations.integration-spec.ts` agora reverte `CreateVideos` (antes revertia `CreateAuthTokens`), porque essa passou a ser a última migration.
  - Pré-condição: suítes que usam `synchronize: true` sobre um banco **sem** a migration `CreateVideos` criam `videos` sem a sequence. Rodar `migration:run` antes dos testes, como as e2e já exigem.
  - `VideosRepository` expõe por enquanto só `reserveSeq()`. As SIs seguintes adicionam as consultas que usarem.

### SI-03.4 — Infra: Fila video-processing e Processo video-worker
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.5 — Endpoint POST /videos/uploads (Início do Upload e Pré-cadastro em Rascunho)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.6 — Endpoints POST /videos/:id/uploads/parts e DELETE /videos/:id/uploads (Renovação e Abort)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.7 — Endpoint POST /videos/:id/uploads/complete (Finalização e Enfileiramento)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.8 — Processar Vídeo no Worker (Metadados, Thumbnail e Política de Falha)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.9 — Reconciliar Vídeos Presos em PROCESSING
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.10 — Endpoint GET /videos/:id (Metadados com Autenticação Opcional)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.11 — Endpoints GET /videos/:id/stream, /download e /thumbnail (Proxy com Range)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.12 — Criar Cliente de Upload scripts/upload-video.ts
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.13 — Fluxo Completo de Upload, Processamento e Streaming (prova de entrega)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

## Validações do planejamento

Vereditos dos validadores independentes (subagente novo por ciclo, conforme o "Modelo de execução" de `docs/Desafio 5 — plano detalhado.md`).

- 2026-11-05 — Etapa 1 Research (`technical-decisions-phase-03-videos.md`) — APROVADO — 1 ciclo. Observação: o Scope Repo-wide do TD-05 é discutível.
- 2026-11-08 — Etapas 2-3 Contexto, validação e resolução (`context.md`, `validation.md`, `library-refs.md`) — validador independente não executado; o merge foi feito a pedido do responsável (commit 3e0f878).
- 2026-11-09 — Etapa 4 Build (`phase-03-videos.md`) — APROVADO — 5 ciclos (limite de 3 estendido pelo responsável). Ciclos 1 a 4 reprovados com 2 bloqueantes cada, todos corrigidos:
  - Ciclo 1: fixtures criadas depois do SI que as usa; falha de rede classificada como erro permanente (contrariava o TD-09).
  - Ciclo 2: URLs assinadas para `localhost:9000` inalcançáveis de dentro dos containers (resolvido com `--storage-connect`); teste do reconciler virando no-op.
  - Ciclo 3: `ThrottlerGuard` global da Fase 02 bloqueando as rotas de vídeo (`@SkipThrottle()`); `scripts/` fora do `exclude` do `tsconfig.build.json`.
  - Ciclo 4: volume anônimo sobre o `dist` do worker (`EBUSY`), trocado por `dist-worker`; `@Generated` em `seq` quebrando `public_id = Sqids(seq)`; ação de lifecycle não suportada pelo MinIO.
  - Ciclo 5: aprovado; não bloqueantes para tratar no `/implement`: `"dist-worker"` no `exclude` do tsconfig, `default nextval` na entidade, `MaxLength(127)` em `mime_type`, `VIDEO_PUBLIC_ID_ALPHABET`/`REDIS_*` no `.env.example`, `load` dos configs novos no `ConfigModule`.

**Desvio registrado — TD-04:** o TD pede "bucket lifecycle aborts incomplete multipart after 1 day". O MinIO não implementa a ação de lifecycle `AbortIncompleteMultipartUpload`; o plano (SI-03.1) usa `MINIO_API_STALE_UPLOADS_EXPIRY=24h`, mecanismo nativo do MinIO com o mesmo efeito (uploads incompletos são abortados após ~1 dia). A revisão formal no `technical-decisions-phase-03-videos.md` fica para o fechamento da fase: editar o doc agora alteraria o mtime das fontes e invalidaria `context.md`, `validation.md` e o plano (staleness do pipeline).
