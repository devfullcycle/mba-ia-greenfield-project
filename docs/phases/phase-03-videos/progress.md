# phase-03-videos — Progress

**Status:** completed
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
- **Tests:** 7 passing (`src/upload-client/multipart-uploader.spec.ts`), mais a re-prova de RSS com o arquivo de 10GB (ver abaixo)
- **Observations:**
  - `UploadApi` e `PartPutter` são injetáveis. Os testes de `uploadFile` usam fakes (fatiamento, ETags, renovação só das pendentes após `403`, retry de erro de rede, esgotamento de tentativas). O teste do `--storage-connect` usa um servidor HTTP local em `127.0.0.1` e confere que o header `Host` continua sendo o da URL assinada.
  - A URL expirada (`403`) não consome tentativa: renova as partes ainda não confirmadas, com um único `renewParts` compartilhado entre workers concorrentes, e repete. Outras falhas têm backoff linear e até 5 tentativas por parte.
  - `mimeTypeFor` cobre `.mp4/.m4v/.mov/.webm/.mkv/.avi`. Extensão desconhecida aborta antes de iniciar o upload (a API recusaria um MIME não-`video/*`).
  - Corrigido durante a implementação: `URL.port` é `''` na porta padrão, então o fallback usa `||` (com `??` a porta virava `0`).
  - `npm run build` verificado: `dist/main.js`, `dist/worker.js` e `dist/mail/templates/*.hbs` presentes, sem `dist/src`.
  - Verificado manualmente com a API rodando (`start:dev` temporário no container) e a config de dev (`S3_PUBLIC_ENDPOINT=http://localhost:9000`): `npm run upload:video -- --file test/video/fixtures/sample.mp4 --api http://nestjs-api:3000 --storage-connect minio:9000 --token …` saiu com exit 0 e imprimiu `id=QevEWIV09d status=PROCESSING`. O worker de dev levou o vídeo a `READY` em segundos.
  - **AC de RSS, correção (2026-11-10):** o AC ("durante o upload de vários GB, o RSS do processo do script fica abaixo de part_size × concurrency + 100MB") foi dado inicialmente como coberto, o que estava errado. Para o arquivo de 10GB o limite é 5 MiB × 4 + 100 MiB = 120 MiB. Via `ts-node` o cliente mediu 162–226MB, e mesmo como JS compilado ficou em ~157 MiB.
  - **Causa (investigada):** não é vazamento, e o backpressure funciona. Cada parte de 5 MiB é lida como ~80 Buffers de 64 KiB (`highWaterMark` padrão do `createReadStream`, em `src/upload-client/multipart-uploader.ts`). Esses buffers externos só são liberados quando os wrappers JS (pequenos) são coletados pelo scavenge, então até ~65 MiB de buffers mortos se acumulam entre GCs da young generation, e a glibc mantém o pico no RSS (baseline do runtime ~42 MiB, heap ~17 MiB).
  - Mudar o `highWaterMark` não resolveu: com 1 MiB os buffers vão para `mmap` e o RSS oscila; com 16 KiB o heap cresce.
  - **Correção:** `upload:video` passou a rodar `tsc -p tsconfig.scripts.json && node --max-semi-space-size=1 dist-scripts/scripts/upload-video.js`. Novo `tsconfig.scripts.json`, com saída em `dist-scripts/` (no `.gitignore` e no `exclude` do `tsconfig.build.json`). Documentado em `nestjs-project/CLAUDE.md` § Upload client.
  - **Re-prova com o npm script real:** 10.489.279.614 bytes, 2001 partes de 5 MiB, concorrência 4, upload em 35,2s, vídeo `9qFQxEJqyc` em `READY` ~8s depois. RSS do cliente em 30 amostras: mín. 88,8 / mediana 106,6 / máx. 108,9 MiB, abaixo dos 120 MiB (PASS, margem de ~11 MiB). Qualquer nova checagem precisa usar o npm script ou a mesma flag.
  - `tsc`, `eslint` e `jest src/upload-client` (7/7) passam depois da correção.

### SI-03.13 — Fluxo Completo de Upload, Processamento e Streaming (prova de entrega)
- **Status:** completed
- **Tests:** 2 passing (`test/video/video-pipeline.e2e-spec.ts` no container `video-worker`)
- **Observations:**
  - **Bug encontrado na prova de 10GB, corrigido em branch separada (`bugfix/upload-body-limit`, mergeada na feature):** o `complete` pode receber até 10.000 pares `{ part_number, etag }` (~600kb, máximo teórico pelo limite do S3). A prova real de 10GB enviou ~2.001 pares (~120kb), já acima dos 100kb padrão do Express, e a API respondia `413`. `JSON_BODY_LIMIT = '2mb'` (`src/common/http/body-limit.ts`) é aplicado em `main.ts` e em `test/utils/e2e-app.ts`, com teste de regressão em `videos-uploads-complete.e2e-spec.ts`. A branch saiu da `feature/phase-03-videos`, não da `dev`, porque o bug só existe no endpoint da Fase 03.
  - `upload:video` passou primeiro a usar `ts-node -T` (transpile-only) e depois a rodar JS compilado com `node --max-semi-space-size=1` (ver a entrada da SI-03.12).
  - **Prova de 10GB, 2026-11-10:** arquivo de 10.489.279.614 bytes (MPEG-4 1920x1080, 3000s, gerado com `ffmpeg`, em `nestjs-project/.tmp-10gb/`), enviado com `docker compose exec nestjs-api npm run upload:video -- --file .tmp-10gb/video-10gb.mp4 --api http://nestjs-api:3000 --storage-connect minio:9000 --token …`. Exit 0, upload em **40s**, e o vídeo `aCWjUcTEYt` chegou a **`READY`** (duração 3000s e dimensões extraídas pelo worker). `GET /videos/aCWjUcTEYt/stream` com `Range: bytes=10000000000-10000001023` respondeu `206` com 1024 bytes em 27ms.
  - **Memória da API (RSS do processo `dist/main`, amostra a cada 2s, 19 amostras):** 161MB em repouso, um degrau único para 344MB no `initiate`, e depois plano em 344MB durante os 40s de transferência (os bytes vão direto ao MinIO; a API não os toca). Parte do degrau vem da pré-assinatura de todas as URLs de parte (~2.000 aqui). O número de URLs cresce com o tamanho do arquivo até o teto de 10.000, então o degrau é limitado, mas não estritamente independente do tamanho. Não cresce com o volume transferido: um segundo upload terminou em 352MB. Na primeira rodada o RSS voltou a 180MB depois do GC; nas rodadas seguintes ficou em ~340 MiB após 30s ocioso (heap retido ainda não coletado). Fica como follow-up a investigar, não bloqueante.
  - Cliente via `ts-node`: RSS entre 162 e 226MB (mediana 215MB). Isso **não** cobria o AC de memória da SI-03.12; a correção e a re-prova estão na entrada da SI-03.12.
  - **API sem bloqueio:** `GET /videos/Gqi9eizN6I` (outro vídeo) teve mediana de 3,4ms (máx. 9,9ms) em repouso e, durante o upload de 10GB, 20/20 respostas `200` com mediana de 12,1ms e máx. de 20,7ms (API e cliente dividindo o mesmo container). Na re-prova com o cliente compilado: 76/76 respostas `200`, mediana de 6,2ms, p95 de 20,3ms e máx. de 28,9ms.
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

## Validação final (2026-11-10)

- **Verificação final (subagente independente): APROVADO.** Unit+integration: 39 suites / 281 testes. E2E: 8 suites / 82 testes. E2E de vídeo: 2 suites / 5 testes. `tsc --noEmit` exit 0, lint OK (nenhum arquivo alterado pelo `--fix`), `openapi:export` sem diff, build OK (`dist/main.js`, `dist/worker.js`).
- **Validadores por SI (um subagente por SI, análise estática):** SI-03.1 a 03.11 e 03.13 APROVADO COM RESSALVAS (sem bloqueantes). SI-03.12 inicialmente REPROVADO (AC de RSS), resolvido como descrito na entrada da SI-03.12.

### Ciclo 2 (2026-11-10)

- **Base:** commit b063871. Validadores independentes (um subagente por SI, análise estática num worktree isolado) mais uma verificação final.
- **Resultado:** SI-03.1 APROVADO. SI-03.2 a 03.13 APROVADO COM RESSALVAS, nenhum bloqueante. A SI-03.12, reprovada no ciclo 1, foi aprovada.
- **Verificação final: APROVADO.** Unit+integration: 39 suites / 281 testes. E2E: 8 suites / 82 testes. E2E de vídeo: 2 suites / 5 testes. `tsc --noEmit` exit 0, lint sem alterações, `openapi:export` sem diff, build OK, `tsc -p tsconfig.scripts.json` OK.
- **Bugfix `bugfix/openapi-dto-schemas` (commit 685ec96, merge 461b0ad), resolve o Follow-up 1:**
  - Causa real: o `openapi:export` rodava em ts-node puro, sem o transformer do plugin CLI do `@nestjs/swagger`, que só roda em `nest build`/`nest start`. O `src/metadata.ts` é um stub e não tinha papel nisso.
  - Correção: o hook `scripts/register-swagger-ts-node.js` registra o ts-node com o transformer, usando as opções do `nest-cli.json`. O `openapi.json` exportado ficou idêntico ao gerado pelo build.
  - Revisão independente: APROVADO COM RESSALVAS. Aplicados timeout no `execFileSync` e limpeza do arquivo temporário do spec; nota adicionada no `nestjs-project/CLAUDE.md`.

### Correções pós-validação (2026-11-10)

Cada branch foi implementada por um subagente e revisada por outro subagente independente. Veredito das duas: APROVADO COM RESSALVAS, sem bloqueantes.

- **`bugfix/video-upload-abort` (commit cea6432, merge 2ee8d7a), resolve o Follow-up 2:**
  - O delete do rascunho só acontece com `status = 'DRAFT'` (`VideosRepository.deleteDraft`). Se nenhuma linha for apagada, a resposta é 409 `VIDEO_NOT_IN_DRAFT`.
  - `NoSuchUpload` no abort é tratado como sucesso na camada de storage (`isUploadGone`). No `complete`, continua mapeado para `INVALID_UPLOAD_PARTS`.
  - Na falha definitiva, o cliente chama `DELETE /videos/:id/uploads` em best-effort, depois de esperar as partes em voo, sem mascarar o erro original.
  - Suíte: 297 unit+integration, 83 e2e, 5 e2e de vídeo.
- **`bugfix/upload-client-robustness` (commit ae6af38, merge d30afeb), resolve o Follow-up 3:**
  - Um 403 logo depois de renovar a URL da parte falha de vez, com mensagem apontando SignatureDoesNotMatch, Host ou `--storage-connect`. Antes, entrava em loop infinito.
  - Cada PUT de parte tem timeout de inatividade de 60s, inclusive na conexão TCP (`options.timeout`), com retry. O `ReadStream` é destruído quando o request fecha, sem vazar file descriptor.
  - `--concurrency` só aceita inteiros de 1 a 32, tanto na CLI quanto em `uploadFile`.
  - Suíte: 317 unit+integration, 83 e2e, 5 e2e de vídeo.

### Follow-ups

1. **OpenAPI:** todos os schemas de DTO saem com `properties: {}` desde a Fase 02. O `openapi:export` roda via ts-node sem o plugin CLI do `@nestjs/swagger` (`src/metadata.ts` não é carregado). Branch `bugfix/openapi-dto-schemas`. — **resolvido** em 685ec96 (merge 461b0ad).
2. **Abort:** o delete no `abort` é incondicional depois da checagem de DRAFT (corrida com um `complete` concorrente pode apagar um vídeo `PROCESSING`). `abortMultipartUpload` não trata `NoSuchUpload` como sucesso (o rascunho fica impossível de apagar, `500`). O cliente de upload nunca chama `DELETE /videos/:id/uploads` em falha definitiva. Branch `bugfix/video-upload-abort`. — **resolvido** em cea6432 (merge 2ee8d7a).
3. **Robustez do cliente de upload:** qualquer `403` é tratado como URL expirada, sem teto de renovações (loop infinito em `SignatureDoesNotMatch`). Sem timeout de socket. `--concurrency` não é validado (`NaN`/`0` resulta em zero workers). Branch `bugfix/upload-client-robustness`. — **resolvido** em ae6af38 (merge d30afeb).
4. **Vídeos presos:** se o `transitionStatus` falha depois de um complete bem-sucedido no S3, o vídeo fica em DRAFT para sempre (o reconciler não cobre DRAFT). Objeto de origem ausente faz o worker repetir para sempre como erro de infra. Vídeo `READY` sem objeto ou com `thumbnail_key` nulo gera `500` nas rotas de mídia.
5. **Fila/reconciler:** `hasActiveJob` não tem timeout (ticks podem se acumular com o Redis fora). `updated_at` é `timestamp` sem time zone comparado a um `Date` do Node (sensível a TZ). `findStaleProcessing` não tem `LIMIT`.
6. **RSS da API:** fica em ~340 MiB depois de um `initiate` grande. Investigar heap retido pela pré-assinatura.
7. **Docs:** o plano (`phase-03-videos.md`, SI-03.3 ação 2 e Data Model) e a entrada da SI-03.3 neste progress ainda citam `DEFAULT nextval` em `seq`, removido na SI-03.5. O README não tem checagem de readiness do MinIO. O default `DB_HOST=localhost` em `env.validation.ts` contradiz a regra de usar o nome do serviço do Compose.
8. **Lacunas menores de teste:** o status do login não é verificado em `video-pipeline.e2e-spec.ts`. O E2E de processamento do "fake mp4" pode ter corrida entre `markError` e o estado `failed` do job. O teste "more than one number" de `video-public-id` não exercita esse branch.
9. **`.dockerignore`:** não lista `.tmp-10gb` nem `dist-scripts`. Um `docker compose build` levaria o arquivo de 10GB para o contexto de build.
10. **Worker:** se o ffmpeg sai com 0 sem produzir frame, `extractFrame` devolve um Buffer vazio e o vídeo vira `READY` com thumbnail de 0 bytes (`ffmpeg.service.ts`, `video.processor.ts`). JSON truncado do ffprobe é tratado como erro de infra e repete para sempre. stdout/stderr do ffmpeg acumulam sem teto.
11. **Testes de integração em paralelo:** `npm test` roda os integration specs em workers paralelos enquanto `migrations.integration-spec.ts` faz `DROP TABLE videos`/`DROP SEQUENCE` no banco compartilhado. Risco de falha intermitente fora do `--runInBand` (a suíte oficial usa `--runInBand`).
12. **OpenAPI:** `GET /videos/{id}` declara `security: [{bearer: []}]` (Bearer obrigatório) apesar do `@OptionalAuth`. `@ApiProduces('video/*')`/`image/jpeg` faz os erros 404/416 de stream/download/thumbnail aparecerem com esse content type em vez de JSON. `status` sai como `{"type":"object"}` nos DTOs de resposta (union de literais via `import type`; precisa de `@ApiProperty({ enum: VIDEO_STATUSES })`). `metadata.ts` e o `loadPluginMetadata` em `main.ts` são código morto.
13. **`complete` concorrente:** as duas requisições chamam `completeMultipartUpload` antes do UPDATE condicional. A segunda recebe `NoSuchUpload` e responde 400 `INVALID_UPLOAD_PARTS` em vez do 409 `VIDEO_NOT_IN_DRAFT` do contrato.
14. **`initiate`:** se a pré-assinatura falha depois do insert, ficam um rascunho DRAFT e um multipart órfãos, sem o cliente receber o id. Os E2E deixam ~16 multiparts incompletos abertos por execução no bucket `streamtube-test`.
15. **SI-03.12:** a margem do AC de RSS é de ~6,5 MiB se "100MB" for decimal (limite de ~115,4 MiB), não ~11 MiB. A medição a ~1 Hz pode perder picos (`VmHWM` daria o pico real). O AC depende de uma flag de runtime sem teste automatizado. `scripts/` está fora do lint. O plano ainda descreve `upload:video` com ts-node.
16. **Lacunas de teste (ciclo 2):** o polling de `video-pipeline.e2e-spec.ts` não tem limite próprio nem checa o status HTTP. Não há teste do cron com a flag ligada nem de falha em um vídeo sem interromper o lote. Os defaults de `S3_BUCKET`/`QUEUE_PREFIX`/`VIDEO_RECONCILER_ENABLED` não são testados. `worker.module.spec` só olha os controllers do próprio módulo.
17. **Docs do progress:** a entrada da SI-03.13 mistura as rodadas da prova de 10GB e as unidades MB/MiB. A observação da SI-03.6 sobre "o filter não define headers" está desatualizada.
18. **Janela residual no abort (aberta pela idempotência):** se o `CompleteMultipartUpload` do `complete` já terminou mas o `transitionStatus` ainda não rodou, o abort recebe `NoSuchUpload` (sucesso), o `deleteDraft` apaga a linha DRAFT, o abort responde 204 e o complete 409, e o objeto montado fica órfão em `videos/<uuid>/source`. Gravidade baixa: mesmo dono, janela de uma query (o cliente pode provocar isso ao abortar depois de um 5xx no complete). Opções: sweeper de objetos `source` sem linha no banco, ou serializar abort/complete por linha. Efeito positivo: o rascunho preso em DRAFT após falha do `transitionStatus` (Follow-up 4) agora pode ser removido pelo abort.
19. **Cliente de upload (abort):** uma parte em voo continua tentando até `maxAttempts` antes do abort. Com duas falhas, o erro relançado é o do primeiro worker no array, não necessariamente o primeiro no tempo. `createHttpApi().abort` não tem teste. O teste unitário "multipart já removido" do service é igual ao caminho feliz.
20. **Teste de timeout de conexão** (`multipart-uploader.spec.ts`): depende de a rede descartar o SYN para `10.255.255.1`. Numa rede que responda `ENETUNREACH` na hora, ele falharia (no container é estável).
21. **Teste "share one renewal":** provavelmente já passava antes do fix do 403 e não exercita de forma determinística o desvio "URL já renovada por outro worker".
