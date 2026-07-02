# phase-03-videos — Progress

**Status:** completed
**SIs:** 12/12 completed

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

### SI-03.5 — Endpoint `POST /videos`
- **Status:** completed
- **Tests:** 4 passing (`test/videos.e2e-spec.ts`, grupo `POST /videos`: 201, 401, 400 UNSUPPORTED_MEDIA_TYPE, 400 FILE_TOO_LARGE)
- **Observations:**
  - `ChannelsService` ganhou `findByUserId(userId)` (novo `Repository<Channel>` injetado no construtor) porque o `JwtPayload` só carrega `sub`/`email`, não o `channelId` — necessário para o controller resolver o canal dono do usuário autenticado. Isso alterou a assinatura do construtor de `ChannelsService`; os 3 arquivos de teste que instanciavam a classe diretamente (`channels.service.spec.ts`, `channels.service.integration-spec.ts`, `users.service.integration-spec.ts`) foram corrigidos. Fora do escopo original da SI, mas necessário para o endpoint funcionar.
  - Corrigido `test:e2e` em `package.json`, que não tinha `--runInBand` apesar de `nestjs-project/CLAUDE.md` documentar esse requisito (suítes e2e compartilham o mesmo banco de teste). Antes só existia um e2e "pesado" (`auth.e2e-spec.ts`) e o gap não se manifestava; com `videos.e2e-spec.ts` também usando `cleanAllTables`, a execução paralela causava contaminação cruzada (401 inesperado por truncamento concorrente de tabelas).
  - Corrigido `videos.service.integration-spec.ts` (SI-03.4): o teste não limpava a fila real do Redis entre execuções, causando falha ao re-rodar a suíte (jobs de execuções anteriores se acumulavam). Adicionado `queue.obliterate({ force: true })` no `beforeEach`, espelhando o `cleanAllTables` do banco.

### SI-03.6 — Endpoint `POST /videos/:id/upload-part-url`
- **Status:** completed
- **Tests:** 3 passing (`test/videos.e2e-spec.ts`, grupo `POST /videos/:id/upload-part-url`: 200 owner, 404 VIDEO_NOT_FOUND para não-dono, 400 UPLOAD_PART_INVALID)
- **Observations:**
  - Endpoint usa `@HttpCode(200)` — o padrão do Nest para `@Post` é `201`, mas a operação não cria um recurso novo (apenas gera uma URL pré-assinada), então `200` é o código correto per Technical Specifications do plano.
  - Fixture de vídeo `draft` criada diretamente via `videoRepository` no teste e2e (sem passar pelo endpoint `POST /videos`), per decisão do `videos.plan.md`; `upload_id` é um `randomUUID()` sintético porque a assinatura de URL é uma operação client-side (não valida contra um multipart upload real já iniciado no MinIO).

### SI-03.7 — Endpoint `POST /videos/:id/complete-upload`
- **Status:** completed
- **Tests:** 3 passing (`test/videos.e2e-spec.ts`, grupo `POST /videos/:id/complete-upload`: 200 + job enfileirado, 409 na segunda conclusão, 404 para não-dono)
- **Observations:**
  - Mesmo `@HttpCode(200)` da SI-03.6 (não cria recurso).
  - Ao contrário da SI-03.6, esta fixture usa o fluxo real via API (`POST /videos` + `POST /videos/:id/upload-part-url` + `PUT` real contra o MinIO) porque `completeUpload` chama `storageService.completeMultipartUpload`, que precisa de um `upload_id`/parte reais no MinIO — um `upload_id` sintético (como na SI-03.6) faria a chamada ao S3 falhar.
  - `videos.e2e-spec.ts` passou a limpar a fila do Redis (`queue.obliterate({ force: true })`) no `beforeEach`, mesmo ajuste já feito em `videos.service.integration-spec.ts` na SI-03.5/03.6, necessário para a asserção de `toHaveLength(1)` de jobs não vazar entre testes/execuções.

### SI-03.8 — Infra: worker de vídeo separado (entrypoint + Compose)
- **Status:** completed
- **Tests:** nenhum (Infra) — verificado via `docker compose ps` (`video-worker` `running`, sem porta HTTP publicada), `docker compose exec video-worker ffmpeg -version`/`ffprobe -version` (ambos retornam versão, exit 0), e logs confirmando bootstrap limpo do `WorkerModule` (`Video worker started`, sem crash-loop).
- **Observations:**
  - `WorkerModule` (`src/videos/worker.module.ts`) precisou registrar não só `TypeOrmModule.forFeature([Video])`, mas também toda a cadeia de relações do TypeORM que o `autoLoadEntities: true` só resolve se algum módulo do *mesmo* app tree registrar a entidade via `forFeature`: `Video.channel` (`ManyToOne` para `Channel`) e `Channel.user` (`OneToOne` para `User`). Como o worker é um app tree independente da API (bootstrap próprio via `NestFactory.createApplicationContext`, não reaproveita o `AppModule`), essas entidades não estavam registradas automaticamente. Resolvido importando `UsersModule` (que já importa `ChannelsModule` e exporta `TypeOrmModule` de ambos), evitando duplicar `TypeOrmModule.forFeature` fora do módulo dono de cada entidade.
  - `main-worker.ts` usa `NestFactory.createApplicationContext` (sem servidor HTTP, per TD-03); o processo permanece vivo pela conexão ativa do BullMQ/ioredis — sem um `Processor`/`Worker` de fato ainda (isso é a SI-03.9), então o worker hoje só mantém a conexão de fila aberta, sem consumir jobs.
  - `Dockerfile.worker` segue o mesmo padrão minimalista do `Dockerfile.dev` (imagem `node:25.6.0-slim`), mas adiciona `ffmpeg` via `apt-get`; ao contrário do `nestjs-api` (que só roda o dev server quando o usuário pede explicitamente), o `video-worker` já inicia via `CMD` (`npm run start:worker`), porque ele precisa estar de pé para a fila/processamento assíncrono funcionar de ponta a ponta — é um serviço de infraestrutura, não um servidor de API opcional.

### SI-03.9 — `VideoProcessor`: extração de metadados e thumbnail
- **Status:** completed
- **Tests:** 2 passing (`video.processor.integration-spec.ts`, contra Redis+MinIO+Postgres reais do Compose): vídeo válido → `ready` com `durationSeconds`/`thumbnailKey`; arquivo inválido → `failed` com `failureReason` após esgotar tentativas.
- **Observations:**
  - **`nestjs-api` também precisou de `ffmpeg`** (adicionado ao `Dockerfile.dev`): a suíte de integração roda dentro do container `nestjs-api` (convenção do projeto), e o `VideoProcessor` invoca os binários `ffmpeg`/`ffprobe` via `fluent-ffmpeg`. Sem isso, o teste do processor não teria como rodar sem inventar uma segunda convenção de execução de testes (ex.: rodar um arquivo específico dentro do `video-worker`). O `Dockerfile.worker` continua sendo a imagem "de produção" do worker; o `ffmpeg` no `Dockerfile.dev` existe só para suportar o teste de integração, sem contradizer a decisão do TD-03.
  - **Bug real de teste encontrado**: `Test.createTestingModule({...}).compile()` **não** dispara os lifecycle hooks (`onModuleInit`/`onApplicationBootstrap`) do NestJS — só `.init()` faz isso. Como o `@Processor` do `@nestjs/bullmq` só registra o `Worker` real do BullMQ dentro de `onModuleInit` (via `BullExplorer`), o teste do processor ficava esperando indefinidamente (timeout) porque o worker nunca começava a consumir jobs. Corrigido chamando `await module.init()` no `beforeAll` de `video.processor.integration-spec.ts`. Isso não afetou os testes anteriores (`videos.service.integration-spec.ts` etc.) porque eles só testam o lado *produtor* da fila (`queue.add`), que não depende de lifecycle hooks.
  - `failure_reason` (varchar(500)) precisou de truncamento explícito no `VideoProcessor.onFailed` — mensagens de erro do ffmpeg/ffprobe podem exceder 500 caracteres, e sem o truncamento o próprio `UPDATE` de persistência da falha lançava `QueryFailedError`, impedindo a transição para `failed`.
  - `StorageService` ganhou `downloadToFile`/`uploadFile` (fora do escopo original da SI-03.3, mas necessário aqui): baixa o objeto original para um arquivo temporário (`fs/promises.mkdtemp` em `os.tmpdir()`) e faz upload do thumbnail gerado, via `PutObjectCommand`/`GetObjectCommand` simples (não multipart, pois thumbnails são pequenos).
  - Fixtures de vídeo criadas em `src/videos/fixtures/`: `sample.mp4` (2s, gerado via `ffmpeg -f lavfi -i testsrc` dentro do próprio container `video-worker`) e `invalid.mp4` (texto puro com extensão enganosa, para o caminho de falha).

### SI-03.10 — `VideosService`/Endpoint `GET /videos/:id` (leitura com autorização)
- **Status:** completed
- **Tests:** 6 unit (`VideosService.getVideoForRead` em `videos.service.spec.ts`) + 2 unit novos em `jwt-auth.guard.spec.ts` (guard com auth opcional) + 4 e2e (`test/videos.e2e-spec.ts`, grupo `GET /videos/:id`): anônimo+ready → 200; anônimo+não-ready → 404; dono+qualquer status → 200; não-dono autenticado+não-ready → 404.
- **Observations:**
  - **Mudança de comportamento no `JwtAuthGuard` (componente compartilhado)**: até aqui, `@Public()` pulava completamente a decodificação do JWT — `request.user` nunca era populado em rotas públicas, mesmo que um token válido fosse enviado. TD-07 exige "dono sempre pode ler, mesmo vídeo não-`ready`" numa rota que também aceita anônimos — ou seja, o guard precisa **tentar** decodificar o token quando presente, mesmo em rota pública, mas nunca lançar `401` se o token estiver ausente/inválido nesse caso. Guard alterado para: sem header/token inválido → `true` se `@Public()`, senão `401` (comportamento antigo preservado); com token válido → sempre popula `request.user` e retorna `true`, público ou não. Cobertura antiga (rotas não-públicas, `@Public()` sem header) permanece verde; 2 testes novos cobrem o caminho "público + token válido" e "público + token inválido tratado como anônimo".
  - Novo decorator `OptionalUser` (`auth/decorators/optional-user.decorator.ts`), paralelo ao `CurrentUser` existente mas retornando `JwtPayload | undefined` — criado em vez de tornar `CurrentUser` opcional para não mudar o tipo de retorno (e, portanto, o contrato) dos 3 endpoints já existentes que dependem de `CurrentUser` sempre populado.
  - `VideosService.getVideoForRead(videoId, requesterUserId?)` recebe o **`userId`** (não `channelId`, ao contrário de `initiateUpload`/`getPartUploadUrl`/`completeUpload`) porque "sem canal" é um resultado válido para leitura (qualquer usuário autenticado pode tentar ler um vídeo, tenha canal ou não) — diferente dos endpoints de escrita, onde a ausência de canal é um erro. A resolução `userId → channel` (via `ChannelsService.findByUserId`, já usado desde a SI-03.5) fica dentro do service, não no controller.
  - Resposta usa `errorCode: VIDEO_NOT_FOUND` tanto para "vídeo não existe" quanto para "vídeo existe mas requisitante não pode ver no status atual" (per Error Catalog do plano) — não revela a existência do vídeo a quem não tem permissão.
  - `thumbnailUrl` só é incluído quando `status === ready` e `thumbnail_key` está preenchido; construído via `StorageService.getPresignedReadUrl`, reaproveitado das SI-03.3/03.9.

### SI-03.11 — Endpoint `GET /videos/:id/stream`
- **Status:** completed
- **Tests:** 3 e2e (`test/videos.e2e-spec.ts`, grupo `GET /videos/:id/stream`): 302 com `Location` para vídeo `ready`; 404 `VIDEO_NOT_FOUND` para não-dono em vídeo não-`ready`; `Range: bytes=0-99` na URL do `Location` retorna `206 Partial Content` com `Content-Range` (comportamento nativo do MinIO, não código do projeto — apenas exercitado no teste).
- **Observations:**
  - Endpoint usa `@Redirect()` do Nest (sem precedente no projeto até aqui) em vez de `@Res()` manual — mantém o handler declarativo, retornando `{ url }` e deixando o Nest montar o `302 Location`.
  - Reaproveita `VideosService.getVideoForRead` (mesma regra de autorização da SI-03.10) e um novo `VideosService.getVideoReadUrl(video, options?)`, que apenas encapsula `StorageService.getPresignedReadUrl(video.storage_key, options)` — a chamada ao storage fica no service, não no controller, seguindo a separação de camadas já usada no restante do módulo.
  - Teste de streaming precisou de um objeto real no MinIO (o teste de leitura de metadados da SI-03.10 não precisava, pois só valida o JSON de metadados). Novo helper `createReadyVideoWithObject` reaproveita a fixture `sample.mp4` (já criada na SI-03.9) via `StorageService.uploadFile`.

### SI-03.12 — Endpoint `GET /videos/:id/download`
- **Status:** completed
- **Tests:** 2 e2e (`test/videos.e2e-spec.ts`, grupo `GET /videos/:id/download`): 302 com `Location` cuja resposta final carrega `Content-Disposition: attachment`; 404 `VIDEO_NOT_FOUND` para não-dono em vídeo não-`ready`.
- **Observations:**
  - Idêntico à SI-03.11 em estrutura (mesma regra de autorização via `getVideoForRead`, mesmo `@Redirect()`), diferindo apenas em `VideosService.getVideoReadUrl(video, { attachment: true })`, que já existia pronto para essa reutilização desde a SI-03.11 — nenhuma mudança em `StorageService`/`VideosService` foi necessária além de passar a opção.
  - Fecha as 12 SIs da Fase 03. Próximo passo é a Etapa 7 (fechamento): Definition of Done completa, atualização do `CLAUDE.md`/`nestjs-project/CLAUDE.md`, e checklist final de Critérios de Aceite/Reprova automática do `instrucoes.md`.

### Etapa 7 — Fechamento
- **Status:** completed
- **Observations:**
  - Auditoria final contra o `instrucoes.md` (fornecido verbatim pelo usuário nesta etapa) encontrou uma inconsistência entre o Data Model do plano (`### Technical Specifications` → `upload_id`: "limpo após `complete-upload`") e o código real: `VideosService.completeUpload` nunca zerava `upload_id`. Corrigido (`video.upload_id = null` antes do save em `completeUpload`) — além de alinhar plano↔código, corrige um bug real: sem isso, `POST /videos/:id/upload-part-url` podia ser chamado após a conclusão e gerar uma URL pré-assinada para um multipart upload já finalizado (e portanto inválido no S3/MinIO). Teste unitário de `completeUpload` em `videos.service.spec.ts` passou a asserir `upload_id: null` no `save`.
  - `CLAUDE.md` (raiz e `nestjs-project`) atualizados com a seção de vídeos (fila/worker/storage, endpoints, autorização, lifecycle de status), coerentes com o código.
  - Checklist final de Critérios de Aceite/Reprova automática do `instrucoes.md` conferido item a item — nenhum item de reprova automática incorrido; todos os artefatos obrigatórios presentes (incluindo a seção `### Events/Messages` das Technical Specifications, com o evento `process-video`).
  - `feature/phase-03-videos` mesclada em `dev` (local, sem push, por decisão do usuário).
