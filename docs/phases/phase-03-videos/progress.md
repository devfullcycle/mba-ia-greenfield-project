# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 7/7 completed

### SI-03.1 — Infraestrutura: Docker Compose, config namespaces e variáveis de ambiente
- **Status:** completed
- **Tests:** no tests (infra) — 4 ACs verified manually (docker compose up com 5 serviços, MinIO console em :9001, Redis PONG, Joi rejeita MINIO_ENDPOINT ausente)
- **Observations:**
  - Registrei `storageConfig` e `queueConfig` no `load` array do `ConfigModule.forRoot` em `app.module.ts` (não listado explicitamente nas Technical actions, mas necessário para injeção via `ConfigType` nos SIs seguintes).
  - Atualizei `env.validation.integration-spec.ts` (`requiredEnv`) para incluir os novos campos obrigatórios (MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET_NAME, REDIS_HOST) — sem isso os testes existentes de `validate({})` quebrariam.

### SI-03.2 — Entidade Video e Migração de banco
- **Status:** completed
- **Tests:** 7 passing (6 entity integration + 1 module compilation)
- **Observations:**
  - O banco de dev estava completamente vazio (migrações CreateUsersAndChannels e CreateAuthTokens nunca haviam sido aplicadas neste ambiente) — a primeira tentativa de `migration:generate` gerou um diff recriando todas as tabelas existentes. Rodei `migration:run` para aplicar as duas migrações pendentes primeiro, depois regenerei `CreateVideos` limpo (apenas a tabela `videos`).
  - Atualizei `src/test/create-test-data-source.ts` (`cleanAllTables`) para incluir `DELETE FROM "videos"` antes de `channels` — sem isso, qualquer suíte de integração existente que usa esse helper quebraria por violação de FK assim que houver linhas em `videos` referenciando `channels`.

### SI-03.3 — Módulo de Storage (MinIO/S3)
- **Status:** completed
- **Tests:** 7 passing (1 module compilation + 6 integration against real MinIO)
- **Observations:**
  - context7 MCP não estava disponível neste ambiente (server não conectado); usei WebFetch/WebSearch para validar a API do AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`) como alternativa, conforme exigido pela regra de "Library Documentation Lookup" do CLAUDE.md.
  - `initializeBucket()` distingue erro 404 (bucket ausente, cria) de qualquer outro erro (relança), em vez de um `catch` genérico — evita mascarar falhas de rede/credenciais como "bucket ausente".
  - Os testes de integração criam alguns uploads multipart que nunca são completados (`test-key-create`, `test-key-parts` — usados só para validar forma do retorno, não fluxo completo), o que deixa multipart uploads incompletos no MinIO entre execuções de teste. Não há endpoint de abort/cleanup implementado nesta SI; se isso virar um problema de acúmulo, considerar um `AbortMultipartUploadCommand` de limpeza ou lifecycle policy no bucket — fora do escopo desta SI.

### SI-03.4 — Módulo de Fila (BullMQ + Redis)
- **Status:** completed
- **Tests:** 3 passing (1 module compilation + 2 integration against real Redis/BullMQ)
- **Observations:**
  - context7 MCP não disponível novamente; usei WebSearch para confirmar a API do `@nestjs/bullmq` (`BullModule.forRootAsync`/`registerQueue`, `@InjectQueue`, opts `attempts`/`backoff`) como alternativa.
  - Teste de integração usa `queue.obliterate({ force: true })` em `beforeEach` para isolar jobs entre testes (fila real compartilhada no Redis do compose), e `queue.close()` em `afterAll` para não deixar conexão pendurada.

### SI-03.5 — Videos API: Criar rascunho e concluir upload
- **Status:** completed
- **Tests:** 58 passing (6 unit + 52 e2e — inclui toda a suíte de `auth.e2e-spec.ts`, que compartilha o helper `registerConfirmAndLogin` extraído nesta SI)
- **Observations:**
  - Divergência entre o plano e a convenção já estabelecida: os ACs e o spec (`videos.plan.md`) citam `body.errorCode`, mas a própria fonte citada pelo plano (`phase-02-auth/TD-07`) define o campo de resposta como `error` — que é o que o `DomainExceptionFilter` já implementado de fato usa (confirmado em todos os testes e2e existentes de auth). Implementei e testei com `error`, seguindo a convenção real e vinculante, não o texto do plano.
  - Endpoints `POST /videos` e `POST /videos/:id/upload-complete` NÃO usam `@UseGuards(JwtAuthGuard)` como o texto do plano sugere — o projeto já registra `JwtAuthGuard` globalmente via `APP_GUARD` (ver `.claude/rules/nestjs-controllers.md`), então endpoints autenticados são o padrão e não precisam de decorator; só endpoints públicos usam `@Public()`.
  - Adicionei `ChannelsService.findByUserId` (não existia) para o `VideosService` buscar o canal do usuário sem acessar a entidade `Channel` diretamente, preservando single responsibility.
  - Extraí `registerConfirmAndLogin`/`captureConfirmationToken` de `test/auth.e2e-spec.ts` para `test/helpers/auth-e2e.helpers.ts` (parametrizado por `app`), conforme pedido explicitamente pelo spec de testes ("reuse the helper"); `auth.e2e-spec.ts` foi atualizado para delegar a essas funções, sem mudar nenhuma asserção existente.
  - Descoberto débito de lint pré-existente e generalizado no projeto (~200 erros em arquivos já commitados de fases anteriores, principalmente `@typescript-eslint/unbound-method` em padrões `expect(mock.method)` e `no-unsafe-member-access` em `res.body` do supertest) — já existia antes desta SI (confirmado revertendo temporariamente as mudanças). Todo código novo desta SI (`videos.service.ts`, `videos.controller.ts`, DTOs, `videos.module.ts`) está limpo; os arquivos de teste novos seguem o mesmo padrão (não lint-clean) já usado em todo o projeto. Aberta task separada para o cleanup geral (fora do escopo desta SI).
  - `npm run lint` com `--fix` reformatou cosmeticamente arquivos já commitados de SIs anteriores (migration de SI-03.2, specs de SI-03.3/03.4); a pedido do usuário, essa reformatação foi mantida (não revertida) e pode aparecer no diff desta SI.

### SI-03.6 — Worker: Processamento de Vídeos com FFmpeg
- **Status:** completed
- **Tests:** 19 passing (7 VideoProcessor unit + 1 WorkerModule compilation + 8 VideosService unit incl. os 2 novos métodos + 3 StorageService integration incl. `uploadObject`); AC de build/boot do worker verificado manualmente (`docker compose --profile worker build/up` — loga "Video worker ready to process jobs")
- **Observations:**
  - O texto do plano cita `@Processor(...)` com `@Process(JOBS.PROCESS_VIDEO)` — esse é o shape antigo do pacote `@nestjs/bull` (Bull). O pacote real instalado na SI-03.4 é `@nestjs/bullmq`, que não tem `@Process()`; o padrão correto é `@Processor(queueName)` na classe estendendo `WorkerHost` com um método `process(job)`. Implementado com o shape real (confirmado via busca), não o texto do plano.
  - Extraí a lógica de ffmpeg/ffprobe para `src/worker/ffmpeg.util.ts` (funções `probeVideo`, `generateThumbnail`, `parseFrameRate`) em vez de chamar `fluent-ffmpeg` diretamente dentro do `VideoProcessor` — permite mockar no teste unitário via `jest.mock('../ffmpeg.util')` em vez de simular toda a API encadeável do fluent-ffmpeg (mock boundary mais limpo).
  - Adicionei `StorageService.uploadObject` (PutObjectCommand simples) e `VideosService.markProcessingReady`/`markProcessingError` — não existiam nas SIs anteriores mas são exigidos pela ação técnica (d)/(e) desta SI; a escrita no Video passa por `VideosService`, não pelo repositório diretamente no worker, preservando single responsibility.
  - Erro final (`status=error`) é decidido via `@OnWorkerEvent('failed')` checando `job.attemptsMade >= job.opts.attempts`, não um try/catch dentro de `process()` — deixa o BullMQ controlar o backoff/retry nativamente (per TD-01) e só persiste `error` quando as tentativas se esgotam.
  - `Dockerfile.worker` usa `node:25.6.0-slim` + `apt-get install ffmpeg` em vez do `node:22-alpine` + `apk` sugerido no texto do plano — para ficar consistente com a versão de Node já fixada em `Dockerfile.dev` deste projeto (25.6.0), evitando divergência de versão entre containers sem necessidade.
  - `compose.yaml`: o serviço `worker` depende de `db`/`minio`/`redis`, não de `nestjs-api` como o texto do plano sugere — `nestjs-api` roda `Dockerfile.dev` (só `tail -f /dev/null`; o servidor HTTP é iniciado manualmente via `docker compose exec`), então um healthcheck HTTP nele nunca passaria no fluxo normal de dev, e o worker não chama a API via HTTP mesmo. `worker` está sob `profiles: [worker]` para não subir no `docker compose up -d` padrão.
  - Bug pego apenas no boot real do container (não no `videos.module.spec.ts`, que passa entidades explicitamente e mascara isso): `WorkerModule` precisou importar `UsersModule` além de `VideosModule`/`ChannelsModule`/`StorageModule`/`QueueModule` — sem isso, `autoLoadEntities: true` não registra a entidade `User`, e o TypeORM falha ao montar metadata da relação `Channel.user` no boot (`Entity metadata for Channel#user was not found`).

### SI-03.7 — Videos API: Endpoints de Recuperação (streaming e download)
- **Status:** completed
- **Tests:** 74 passing (16 unit VideosService — inclui `findBySlug`/`getVideoDetails`/`getStreamUrl`/`getDownloadUrl` — + 58 e2e, unindo `videos.e2e-spec.ts` seção 2 com toda a suíte `auth.e2e-spec.ts`)
- **Observations:**
  - Mesma divergência das SIs anteriores: ACs/spec citam `errorCode`, mas a convenção real (já implementada, `DomainExceptionFilter`) usa o campo `error`. Testes e2e usam `body.error`.
  - `GET /videos/:slug/download-url` não usa `@UseGuards(JwtAuthGuard)` como o texto do plano sugere — segue a mesma convenção de guard global já estabelecida na SI-03.5 (`@Public()` só nos endpoints públicos: `:slug` e `:slug/stream-url`).
  - Adicionei `VideosService.getVideoDetails(slug)` (não citado explicitamente pelo plano, que atribui a montagem do `thumbnail_url` à ação técnica do controller) para manter a chamada ao `StorageService` (geração de URL pré-assinada da thumbnail) dentro do service, não do controller — preserva a regra de "controllers finos / lógica de negócio no service" já documentada no projeto.
  - Bug real pego só ao rodar a suíte completa: `test/videos.e2e-spec.ts` registra ~11 usuários ao longo do arquivo (3 requisições de auth cada — register/confirm/login) sem nunca limpar o `ThrottlerStorage` entre testes; por volta do 10º-11º request de auth dentro da janela de 60s, o `ThrottlerGuard` global começa a devolver 429, fazendo os últimos testes (`download-url`) falharem com "User não encontrado" (o registro silenciosamente não criava o usuário). Corrigido injetando `ThrottlerStorageService` e chamando `throttlerStorage.storage.clear()` no `beforeEach`, no mesmo padrão já usado em `auth.e2e-spec.ts`.
  - Slugs de teste hardcoded (`varchar(11)`) precisaram ser ajustados para exatamente 11 caracteres (`notreadyslg`, `downloadslg`) — dois valores iniciais excediam o limite da coluna.
