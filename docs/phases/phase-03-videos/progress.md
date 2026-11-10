# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 13/13 completed

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
- **Status:** completed
- **Tests:** 10 passing (`video-processing.queue.integration-spec.ts` 6 + `video-processing.queue.spec.ts` 2 + `worker.module.spec.ts` 2)
- **Observations:**
  - **Versões:** `@nestjs/bullmq@12` e `@nestjs/schedule@12` (instalados na SI-03.1) são ESM-only e quebram o Jest (CJS/ts-jest). Foram trocados por `@nestjs/bullmq@^11.0.5` e `@nestjs/schedule@^6.1.3` (majors alinhadas ao Nest 11, CJS; o `@nestjs/bullmq@11.0.5` aceita `bullmq` 6).
  - **bullmq v6:** o `ioredis` virou peer dependency opcional e foi instalado explicitamente (`ioredis@^5.11.1`). Nenhuma API usada pelo plano (jobId dedup, `UnrecoverableError`, `backoffStrategy`, `getJob`/`getState`/`remove`, `obliterate`) foi removida na v6.
  - **Redis double:** `attempts: Number.MAX_SAFE_INTEGER` volta do Redis como `9007199254741000` (o Lua guarda como double). Isso não afeta a semântica de retry infinito; o teste afirma `>= MAX_SAFE_INTEGER`.
  - **Bug corrigido da SI-03.1:** `test/jest-e2e.json` tinha `setupFiles` com `<rootDir>/test/setup-test-env.ts`, mas o `rootDir` desse config já é `test/`. O caminho foi corrigido para `<rootDir>/setup-test-env.ts` (antes disso, o `npm run test:e2e` nem iniciava).
  - `tsconfig.build.json` passou a excluir `dist-worker` (sem isso, o `nest start` do worker lia a própria saída como entrada: TS5055).
  - A config do TypeORM foi extraída para `src/database/database.module.ts` (`DatabaseModule`), compartilhada por `AppModule` e `WorkerModule`, sem duplicar a factory.
  - Criado `.dockerignore` (node_modules/dist/dist-worker/coverage/.git) para o build do `Dockerfile.worker` não enviar o `node_modules` do host como contexto.
  - Teste unitário extra `video-processing.queue.spec.ts` cobre o timeout de 5s do `enqueue` com fake timers.
  - Verificado manualmente: `video-worker` running, `ffprobe -version` OK (FFmpeg 5.1.9), nenhum listener na 3000 (só o DNS embutido do Docker em 127.0.0.11). Com o Redis parado, `enqueue` rejeitou em 5001ms com `EnqueueTimeoutError`. `jest-e2e.json --listTests` não inclui `test/video/`.
  - Fixtures: `test/video/fixtures/sample.mp4` (~885KB, h264 640x360 + aac, 6s, gerado com ffmpeg `testsrc2`) e `fake.mp4` (texto).
  - `test:e2e:video` ainda não tem suítes (`--listTests` vazio). As suítes de `test/video/` chegam nas SIs 03.8/03.13.

### SI-03.5 — Endpoint POST /videos/uploads (Início do Upload e Pré-cadastro em Rascunho)
- **Status:** completed
- **Tests:** 17 passing da SI (`upload-plan.spec.ts` 6, `video-uploads.service.integration-spec.ts` 2, `channels.service.integration-spec.ts` +2, `test/videos-uploads.e2e-spec.ts` 4). Suíte unit+integration completa verde: 201/32 suites.
- **Observations:**
  - **Correção da SI-03.3 (sequence):** o TypeORM interpreta `DEFAULT nextval('<tabela>_<coluna>_seq')` como coluna `increment`. Como o entity não é `@Generated`, qualquer `synchronize: true` de teste rodava `DROP SEQUENCE videos_seq_seq`, e o `reserveSeq()` passava a falhar com `relation "videos_seq_seq" does not exist`. A migration `CreateVideos` deixou de declarar `DEFAULT nextval(...)` na coluna `seq` (a "rede de segurança" do plano foi removida). A sequence continua existindo com o mesmo nome e `OWNED BY videos.seq`. A migration só tinha rodado localmente nesta branch sem push, então foi editada e reaplicada em vez de ganhar uma migration nova.
  - **Correção da SI-03.3 (deadlock):** o `beforeAll` de `migrations.integration-spec.ts` fazia os `DROP TABLE ... CASCADE` em paralelo. Com `videos → channels`, isso dava deadlock e deixava o banco parcialmente migrado. Agora é um único `DROP TABLE IF EXISTS a, b, … CASCADE`. O schema local de dev/teste foi recriado (`DROP SCHEMA public CASCADE` + `migration:run`).
  - Helpers E2E compartilhados em `test/utils/e2e-app.ts`: `createE2eApp()` (reproduz pipes e filters do `main.ts`), `resetThrottler()` (register/login seguem limitados a 10 req/min) e `registerConfirmAndLogin()`. O `auth.e2e-spec.ts` não foi refatorado para usá-los (fora de escopo).
  - O plano cita `ApiErrorEnvelopeDto`, mas a classe existente se chama `ApiErrorEnvelope`. Foi usada a existente.
  - `ChannelsService.findByUserId` retornando `null` dentro de `initiate` lança `Error` genérico (500). Todo usuário ganha channel no registro, então esse caso é violação de invariante, não erro do catálogo.
  - Constantes e chaves de storage (`videoSourceKey`, `videoThumbnailKey`, `UPLOAD_URL_TTL_SECONDS`, `MAX_VIDEO_SIZE_BYTES`, `VIDEO_MIME_TYPE_PATTERN`) ficam em `videos.constants.ts`.
  - **OpenAPI (pré-existente):** `openapi:export` roda via ts-node sem o plugin do `@nestjs/swagger`, então todos os DTOs (inclusive os de auth, desde a Fase 02) saem com `properties: {}`. O endpoint e as respostas 201/400/401 foram exportados, mas os schemas dos DTOs ficaram vazios. Isso fica como pendência separada.

### SI-03.6 — Endpoints POST /videos/:id/uploads/parts e DELETE /videos/:id/uploads (Renovação e Abort)
- **Status:** completed
- **Tests:** 17 passing (`video-uploads.service.spec.ts` 7 + `video-uploads.service.integration-spec.ts` 4 + `test/videos-uploads-renew-abort.e2e-spec.ts` 6)
- **Observations:**
  - `VideosRepository` ganhou `findByPublicIdWithChannel` (carrega `channel` para checar `user_id`) e `deleteById`. A ownership é resolvida pela relação `channel.user_id`, sem chamada extra ao `ChannelsService`.
  - `findOwnedDraft` rejeita ids que não decodificam canonicamente antes de consultar o banco, e devolve o mesmo `VIDEO_NOT_FOUND` para inexistente e para não-owner (o E2E confirma corpo idêntico).
  - `RangeNotSatisfiableException` carrega `objectSize`, para a SI-03.11 montar `Content-Range: bytes */{size}`. O `DomainExceptionFilter` atual não define headers, então a SI-03.11 precisa tratar isso.
  - O `presignParts` privado é compartilhado por `initiate` e `renewParts`.

### SI-03.7 — Endpoint POST /videos/:id/uploads/complete (Finalização e Enfileiramento)
- **Status:** completed
- **Tests:** 22 passing (`video-uploads.service.spec.ts` 11 + `video-uploads.service.integration-spec.ts` 5 + `test/videos-uploads-complete.e2e-spec.ts` 6)
- **Observations:**
  - A transição `DRAFT → PROCESSING` usa o `VideosRepository.transitionStatus(id, from, to)`, um `UPDATE … WHERE status = from` atômico. Se outra requisição já moveu o vídeo (complete concorrente), responde `VIDEO_NOT_IN_DRAFT` e não enfileira. É um single statement em autocommit, então o "commit antes do enqueue" fica garantido sem transação explícita.
  - O helper `createE2eApp` passou a aceitar um `customize(builder)` opcional (usado no cenário 1.3 com `overrideProvider(VideoProcessingQueue)`).
  - O AC "com o Redis parado ainda retorna 202" está coberto no E2E pelo override do enqueue. A parada real do Redis fica para a verificação manual da SI-03.9, como o spec define. O timeout real de 5s já foi verificado na SI-03.4.
  - `upload_id` permanece gravado depois do complete (o plano não pede para limpá-lo).

### SI-03.8 — Processar Vídeo no Worker (Metadados, Thumbnail e Política de Falha)
- **Status:** completed
- **Tests:** 33 passing (`processing-policy.spec.ts` + `video.processor.spec.ts` + `worker.module.spec.ts` = 30 no `nestjs-api`; `test/video/video-processing.e2e-spec.ts` 3 no `video-worker` com FFmpeg real). As duas suítes encerram sem `--forceExit` (sem handles abertos).
- **Observations:**
  - **Correção da SI-03.4 (grafo de entidades do worker):** o `autoLoadEntities` só conhece entidades passadas a `forFeature`. O `WorkerModule` registrava só `Video` (via `VideosDataModule`), mas o grafo `Video → Channel → User` exige as três, e o `DataSource` falhava com `Entity metadata for Video#channel was not found` (com o retry do TypeORM, os testes ficavam pendurados). Agora o `WorkerModule` importa `UsersModule`, que registra `User` e, via `ChannelsModule`, `Channel`.
  - Erros de processamento são tipados em `src/processing/processing.errors.ts` (`FfmpegProcessError` com `command`/`exitCode`/`stderr`, `FfmpegTimeoutError`, `NoVideoStreamError`, `NoDurationError`). Para ser `INVALID_FILE`, o `classifyProcessingError` exige `command === 'ffprobe'`, código ≠ 0, padrão de dado inválido **e** ausência de padrão de rede. Falha do `ffmpeg` (extração de frame) é infra.
  - `VideosRepository.markReady`/`markError` são `UPDATE … WHERE status = 'PROCESSING'` (idempotentes com entrega at-least-once). `findById` foi adicionado.
  - `ObjectHead` passou a expor `lastModified`, usado no E2E para provar que reprocessar um vídeo `READY` não regrava a thumbnail.
  - A URL interna pré-assinada para o ffprobe/ffmpeg dura 1h (`INTERNAL_URL_TTL_SECONDS`). O plano não fixava valor; está dimensionada para o probe/frame de arquivos grandes, dentro do timeout de 10 min por comando.
  - Verificado manualmente com o worker de dev: com o MinIO parado, o vídeo ficou `PROCESSING` e o job foi para `delayed` com `delay: 30000` (`getaddrinfo ENOTFOUND minio`). Com o MinIO de volta, o retry levou o vídeo a `READY`.

### SI-03.9 — Reconciliar Vídeos Presos em PROCESSING
- **Status:** completed
- **Tests:** 10 passing (`video-reconciler.service.integration-spec.ts` 8 + `worker.module.spec.ts` 2 re-executado)
- **Observations:**
  - A consulta de vídeos presos fica em `VideosRepository.findStaleProcessing(updatedBefore)` (`status = 'PROCESSING' AND updated_at < …`, índice `(status, updated_at)`). O `VideoReconcilerService.findStaleProcessing(now)` só calcula o corte de 15 min.
  - `reconcile(now?)` devolve quantos vídeos re-enfileirou. Falhas por vídeo (Redis fora) são logadas sem interromper o lote (contexto de cron).
  - O `ProcessingModule` importa `ConfigModule.forFeature(videoConfig)` para ler `VIDEO_RECONCILER_ENABLED`.
  - **Verificação manual (AC #4), 2026-11-10:** com o Redis parado, o fluxo real `initiate` → PUT → `complete` (via `VideoUploadsService`) respondeu `{ status: "PROCESSING" }` em 5032ms (timeout do enqueue engolido) e a linha ficou `PROCESSING`. O Redis foi religado e o `updated_at` retrocedido em 20 min por SQL, para não esperar 15 min reais. No disparo das 03:05:00 o cron do worker de dev logou `Re-enqueued 2 stale video(s)`, e às 03:05:01 o vídeo estava `READY`. O segundo vídeo re-enfileirado era um `PROCESSING` deixado no banco compartilhado pelos E2E da SI-03.7 (o reconciler também o recuperou).
  - Para assinar as URLs de parte com o host alcançável de dentro do container, o script de verificação rodou com `S3_PUBLIC_ENDPOINT=http://minio:9000`. Trocar o host de uma URL já assinada a invalida (TD-01).

### SI-03.10 — Endpoint GET /videos/:id (Metadados com Autenticação Opcional)
- **Status:** completed
- **Tests:** 29 passing (`jwt-auth.guard.spec.ts` + `videos.service.spec.ts` = 23; `test/videos-metadata.e2e-spec.ts` 6). `test/auth.e2e-spec.ts` re-executado depois da refatoração do guard: 45/45.
- **Observations:**
  - O `JwtAuthGuard` foi refatorado em `verifyBearer()` (payload ou `null`) + `isMarked(key)`. Em rotas `@OptionalAuth()`, token ausente ou inválido segue anônimo; nas demais, o comportamento continua idêntico (401).
  - `VideoResponseDto.from(video)` é uma allow-list explícita: o UUID interno, `storage_key`, `upload_id`, `seq` e `thumbnail_key` nunca são serializados. As URLs de mídia são relativas (`/videos/{public_id}/stream|download|thumbnail`), como no contrato.
  - Helper E2E `test/utils/video-seed.ts` (`channelOf`, `seedVideo`) para semear vídeos em qualquer status (reutilizável na SI-03.11).

### SI-03.11 — Endpoints GET /videos/:id/stream, /download e /thumbnail (Proxy com Range)
- **Status:** completed
- **Tests:** 18 passing (`media-delivery.service.integration-spec.ts` 3 + `domain-exception.filter.spec.ts` (+2 novos) + `test/videos-media.e2e-spec.ts` 7)
- **Observations:**
  - `DomainException` ganhou o getter `headers` (vazio por padrão), e o `DomainExceptionFilter` aplica esses headers. `RangeNotSatisfiableException` devolve `Content-Range: bytes */{size}`. O filtro não conhece exceções específicas.
  - O `size` do `416` vem de `video.size_bytes`, não do corpo de erro do S3 (o formato de `InvalidRange` varia entre S3 e MinIO).
  - `attachmentDisposition()` (`src/videos/content-disposition.ts`): fallback ASCII sem aspas, barra invertida ou controle, mais `filename*=UTF-8''` com percent-encoding RFC 5987 (que também codifica `'()*`). O E2E usa `vídeo "férias".mp4`.
  - O controller faz `stream.pipeline(body, res)`. Se o cliente desconecta no meio, a falha é só logada (os headers já foram enviados, não há resposta de erro possível), e o `pipeline` destrói o stream do S3, liberando o socket.
  - O cenário 1.7 do E2E inspeciona as respostas coletadas pelos cenários anteriores do mesmo arquivo. Depende da ordem de execução dentro do arquivo (padrão do Jest, sequencial).

### SI-03.12 — Criar Cliente de Upload scripts/upload-video.ts
- **Status:** completed
- **Tests:** 7 passing (`src/upload-client/multipart-uploader.spec.ts`)
- **Observations:**
  - `UploadApi` e `PartPutter` são injetáveis. Os testes de `uploadFile` usam fakes (fatiamento, ETags, renovação só das pendentes após `403`, retry de erro de rede, esgotamento de tentativas). O teste do `--storage-connect` usa um servidor HTTP local em `127.0.0.1` e confere que o header `Host` continua sendo o da URL assinada.
  - A URL expirada (`403`) não consome tentativa: renova as partes ainda não confirmadas, com um único `renewParts` compartilhado entre workers concorrentes, e repete. Outras falhas têm backoff linear e até 5 tentativas por parte.
  - `mimeTypeFor` cobre `.mp4/.m4v/.mov/.webm/.mkv/.avi`. Extensão desconhecida aborta antes de iniciar o upload (a API recusaria um MIME não-`video/*`).
  - Corrigido durante a implementação: `URL.port` é `''` na porta padrão, então o fallback usa `||` (com `??` a porta virava `0`).
  - `npm run build` verificado: `dist/main.js`, `dist/worker.js` e `dist/mail/templates/*.hbs` presentes, sem `dist/src`.
  - Verificado manualmente com a API rodando (`start:dev` temporário no container) e a config de dev (`S3_PUBLIC_ENDPOINT=http://localhost:9000`): `npm run upload:video -- --file test/video/fixtures/sample.mp4 --api http://nestjs-api:3000 --storage-connect minio:9000 --token …` saiu com exit 0 e imprimiu `id=QevEWIV09d status=PROCESSING`. O worker de dev levou o vídeo a `READY` em segundos.
  - O AC de RSS (arquivo de vários GB) é medido na prova de 10GB da SI-03.13, na mesma rodada.

### SI-03.13 — Fluxo Completo de Upload, Processamento e Streaming (prova de entrega)
- **Status:** completed
- **Tests:** 2 passing (`test/video/video-pipeline.e2e-spec.ts` no container `video-worker`)
- **Observations:**
  - **Bug encontrado na prova de 10GB, corrigido em branch separada (`bugfix/upload-body-limit`, mergeada na feature):** concluir um upload de 10GB envia até 10.000 pares `{ part_number, etag }` (~600kb), acima dos 100kb padrão do Express, e a API respondia `413`. `JSON_BODY_LIMIT = '2mb'` (`src/common/http/body-limit.ts`) é aplicado em `main.ts` e em `test/utils/e2e-app.ts`, com teste de regressão em `videos-uploads-complete.e2e-spec.ts`. A branch saiu da `feature/phase-03-videos`, não da `dev`, porque o bug só existe no endpoint da Fase 03.
  - `upload:video` passou a usar `ts-node -T` (transpile-only): o cliente não paga type-check a cada execução.
  - **Prova de 10GB, 2026-11-10:** arquivo de 10.489.279.614 bytes (MPEG-4 1920x1080, 3000s, gerado com `ffmpeg`, em `nestjs-project/.tmp-10gb/`), enviado com `docker compose exec nestjs-api npm run upload:video -- --file .tmp-10gb/video-10gb.mp4 --api http://nestjs-api:3000 --storage-connect minio:9000 --token …`. Exit 0, upload em **40s**, e o vídeo `aCWjUcTEYt` chegou a **`READY`** (duração 3000s e dimensões extraídas pelo worker). `GET /videos/aCWjUcTEYt/stream` com `Range: bytes=10000000000-10000001023` respondeu `206` com 1024 bytes em 27ms.
  - **Memória da API (RSS do processo `dist/main`, amostra a cada 2s, 19 amostras):** 161MB em repouso, um degrau único para 344MB no `initiate` (pré-assinatura de ~2.000 URLs de parte), e depois plano em 344MB durante os 40s de transferência (os bytes vão direto ao MinIO; a API não os toca). Não cresce com o volume transferido: um segundo upload terminou em 352MB, e depois do GC o RSS voltou a 180MB. Cliente: RSS entre 162 e 226MB (mediana 215MB) durante todo o upload, constante (cobre o AC de memória da SI-03.12).
  - **API sem bloqueio:** `GET /videos/Gqi9eizN6I` (outro vídeo) teve mediana de 3,4ms (máx. 9,9ms) em repouso e, durante o upload de 10GB, 20/20 respostas `200` com mediana de 12,1ms e máx. de 20,7ms (API e cliente dividindo o mesmo container).
  - **Limite de disco do Docker:** a segunda rodada de 10GB falhou com `507` do MinIO na parte 1392 porque o disco da VM do Docker encheu (55GB, 100%). O rascunho foi abortado via `DELETE /videos/pEAGyJtMgl/uploads` (204), o que liberou 7GB. Follow-up fora de escopo: o cliente não chama o abort quando uma parte falha de vez; o multipart fica para o `MINIO_API_STALE_UPLOADS_EXPIRY=24h`.
  - **Smoke test do Compose, 2026-11-10:** depois de `docker compose down -v`, um único `docker compose up -d` deixou `db`, `redis`, `minio` e `mailpit` em `healthy`, `nestjs-api` e `video-worker` em `Up` (log `video-worker started`) e `minio-init` em `Exited (0)` (buckets `streamtube` e `streamtube-test` criados). Depois de `npm run migration:run`, o E2E do pipeline foi re-executado no ambiente zerado: 2/2.
  - Documentação (ação 2): a readiness do MinIO está descrita pelo healthcheck do Compose (`healthy`) e pelo `minio-init` em `Exited (0)`, não por `mc ready`. O efeito é o mesmo, sem depender de alias do `mc` no container.

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
