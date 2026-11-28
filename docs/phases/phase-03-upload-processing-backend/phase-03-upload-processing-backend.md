---
kind: phase
name: phase-03-upload-processing-backend
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-upload-processing-backend/context.md: "2026-11-28T02:41:20-03:00"
  docs/phases/phase-03-upload-processing-backend/library-refs.md: "2026-11-28T02:41:20-03:00"
  docs/decisions/technical-decisions-phase-03-upload-processing-backend.md: "2026-11-28T02:32:09-03:00"
  docs/decisions/technical-decisions-backend-nest12-runtime-test-runner.md: "2026-11-28T02:27:13-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-11-28T00:17:07-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Entregar o backend de upload e processamento de vídeos: armazenamento de arquivos (vídeos e thumbnails) e serviço de processamento em segundo plano (filas); upload de até 10GB sem impacto na performance, com pré-cadastro automático do vídeo como rascunho; processamento automático após o upload (duração, metadados e thumbnail a partir de um frame); URL única por vídeo; e reprodução via streaming e download do vídeo pelo usuário.

---

## Step Implementations

### SI-03.1 — Fixar o baseline de Node do backend

**Description:** Leva a imagem de desenvolvimento para Node 24 LTS (a partir de 24.15) e alinha `engines` e `@types/node`, pré-requisito da migração ao Nest 12.

**Technical actions:**

1. Trocar a imagem em `nestjs-project/Dockerfile.dev` de `node:25.6.0-slim` para uma tag `node:24.x-slim` fixada em 24.15 ou superior (per `backend-nest12-runtime-test-runner/TD-01`)
2. Declarar `engines.node: ">=24.15"` em `nestjs-project/package.json` (per `backend-nest12-runtime-test-runner/TD-01`)
3. Atualizar `@types/node` para `^24` (per `backend-nest12-runtime-test-runner/TD-01`)
4. Reconstruir a imagem e reinstalar as dependências no container (`docker compose build` e `docker compose exec nestjs-api npm install`)

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- `docker compose exec nestjs-api node --version` retorna uma versão `v24.15` ou superior
- `docker compose exec nestjs-api npx tsc --noEmit` termina com código 0
- `docker compose exec nestjs-api npm test` passa com a suíte existente, sem regressão

---

### SI-03.2 — Migrar o backend para o Nest 12 e atualizar o baseline de dependências

**Description:** Executa a Option B do TD-12: leva os pacotes `@nestjs/*`, o TypeScript 6 e o mailer 4 ao baseline decidido, antes de instalar qualquer lib nova da fase.

**Technical actions:**

1. Rodar `nest upgrade --dry-run` e depois `nest upgrade` no container, a partir de `nestjs-project/`, e revisar o relatório (per `phase-03-upload-processing-backend/TD-12`)
2. Ajustar `tsconfig.json` e `tsconfig.build.json` ao TypeScript 6 conforme o relatório do `nest upgrade` (per `phase-03-upload-processing-backend/TD-12`)
3. Adaptar o uso do `@nestjs-modules/mailer` 4 em `src/mail/` (retry padrão, erros tipados) e as opções do `@nestjs/config` movidas para `validationOptions.libraryOptions` (per `phase-03-upload-processing-backend/TD-12`)
4. Confirmar que o Jest 30 com `ts-jest` carrega os pacotes ESM-only do Nest 12 no Node 24 (per `backend-nest12-runtime-test-runner/TD-02`)
5. Rodar `npm audit` e tratar os resíduos que restarem (per `phase-03-upload-processing-backend/TD-12`)

**Tests:** _(empty — Infra; a suíte completa existente é o critério)_

**Dependencies:** SI-03.1 — a imagem Node 24 precisa existir antes do `nest upgrade`

**Acceptance criteria:**

- `docker compose exec nestjs-api npm audit` não reporta vulnerabilidades de severidade `critical`
- `docker compose exec nestjs-api npx tsc --noEmit` termina com código 0
- `docker compose exec nestjs-api npm test`, `npm run test:integration` e `npm run test:e2e` passam sem falhas
- `docker compose exec nestjs-api npm run lint` termina sem erros nem avisos
- `docker compose exec nestjs-api npm ls @nestjs/core` mostra a versão major 12

---

### SI-03.3 — Infra: MinIO no compose e configuração de storage

**Description:** Sobe o object storage S3 local (MinIO) e expõe sua configuração ao backend, com um endpoint interno para o servidor e um endpoint público para assinar URLs.

**Technical actions:**

1. Adicionar o serviço `minio` a `nestjs-project/compose.yaml` (API S3 e console) com o bucket de vídeos criado na subida (per `phase-03-upload-processing-backend/TD-01`)
2. Criar `src/config/storage.config.ts` com `registerAs('storage', ...)` cobrindo endpoint interno (nome do serviço Docker), endpoint público, credenciais e bucket (per `phase-03-upload-processing-backend/TD-01` e `phase-01-configuracao-base/TD-03`)
3. Validar as variáveis novas em `src/config/env.validation.ts` (Joi) e documentá-las em `.env.example`; as URLs presigned são assinadas com o host público, nunca com o nome do serviço Docker (per `phase-03-upload-processing-backend/TD-02` e `phase-01-configuracao-base/TD-02`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `env.validation.ts` (variáveis de storage) | Unit: variáveis obrigatórias e tipos | `src/config/env.validation.spec.ts` |

**Dependencies:** SI-03.2 — o schema Joi e o `@nestjs/config` já estão na versão do baseline

**Acceptance criteria:**

- `docker compose ps` mostra o serviço `minio` com status `running`
- O bucket de vídeos existe depois de `docker compose up -d`, verificável pelo console ou pela API S3 do MinIO
- A aplicação não sobe quando uma variável obrigatória de storage está ausente e aponta o erro de validação do Joi

---

### SI-03.4 — Implementar o StorageService

**Description:** Encapsula o cliente S3 (multipart, HEAD e URLs presigned) usado pelo fluxo de upload, pelo worker e pela reprodução.

**Technical actions:**

1. Criar `src/storage/storage.module.ts` com o provider do `S3Client` configurado com `endpoint` e `forcePathStyle: true` a partir de `storageConfig.KEY` (per `phase-03-upload-processing-backend/TD-01`)
2. Criar `src/storage/storage.service.ts` com `createMultipartUpload`, `getPartUploadUrl`, `completeMultipartUpload`, `abortMultipartUpload` e `listMultipartUploads` (per `phase-03-upload-processing-backend/TD-02` e `TD-10`)
3. Adicionar `headObject` e `getObjectUrl` (presigned GET com `expiresIn` e `ResponseContentDisposition` opcional) em `StorageService` (per `phase-03-upload-processing-backend/TD-06`)
4. Assinar todas as URLs presigned com o endpoint público do storage (per `phase-03-upload-processing-backend/TD-02`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration: MinIO real do compose — multipart completo, HEAD e presigned GET com Range | `src/storage/storage.service.integration-spec.ts` |
| `StorageModule` | Unit: compilação do módulo | `src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.3 — o MinIO e a configuração de storage precisam existir

**Acceptance criteria:**

- Um multipart upload criado, enviado por URLs presigned e completado pelo `StorageService` resulta em um objeto cujo tamanho no storage é igual ao enviado
- Uma URL presigned de GET aceita `Range: bytes=0-99` e responde `206` com 100 bytes
- As URLs presigned geradas usam o host público configurado, não o nome do serviço Docker
- Uma URL presigned de download gerada com `ResponseContentDisposition` responde com o header `Content-Disposition: attachment`

---

### SI-03.5 — Infra: Redis e fila BullMQ

**Description:** Sobe o Redis no compose e registra a fila de processamento de vídeo com `@nestjs/bullmq`.

**Technical actions:**

1. Adicionar o serviço `redis` a `nestjs-project/compose.yaml`; o backend e o worker o acessam pelo nome do serviço Docker (per `phase-03-upload-processing-backend/TD-03`)
2. Criar `src/config/queue.config.ts` com `registerAs('queue', ...)`, validar as variáveis em `src/config/env.validation.ts` e documentá-las em `.env.example` (per `phase-03-upload-processing-backend/TD-03` e `phase-01-configuracao-base/TD-03`)
3. Criar `src/queue/queue.module.ts` com `BullModule.forRootAsync` (conexão via `queueConfig.KEY`) e `BullModule.registerQueueAsync` da fila `video-processing` com `defaultJobOptions` de `attempts` e `backoff` (per `phase-03-upload-processing-backend/TD-03`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `QueueModule` | Unit: compilação do módulo | `src/queue/queue.module.spec.ts` |
| `video-processing` (fila) | Integration: Redis real do compose — enfileirar, consumir e repetir um job que falha | `src/queue/queue.module.integration-spec.ts` |

**Dependencies:** SI-03.2 — `@nestjs/config` e Joi já estão na versão do baseline

**Acceptance criteria:**

- `docker compose ps` mostra o serviço `redis` com status `running`
- Um job adicionado à fila `video-processing` é recebido por um consumer registrado na mesma fila
- Um job que falha é repetido até o número de `attempts` configurado e depois fica no estado `failed`

---

### SI-03.6 — Criar a entidade Video e a migration

**Description:** Persiste o vídeo com o `public_id` único e o status do ciclo de vida, base do pré-cadastro como rascunho e da URL única por vídeo.

**Technical actions:**

1. Criar `src/videos/entities/video.entity.ts` com os campos do `### Data Model → Video`; o campo `owner` segue a convenção das entidades `User` e `Channel`, pois o Data Model o marca como `_undetermined_` (per `phase-03-upload-processing-backend/TD-07` e `TD-08`)
2. Criar o enum de status em `src/videos/video-status.enum.ts` com os valores do ciclo de vida descritos na Option A do `TD-07` (per `phase-03-upload-processing-backend/TD-07`)
3. Gerar a migration `CreateVideosTable` com unique em `public_id` e índice em `(status, created_at)` via `npm run migration:generate` (per `phase-03-upload-processing-backend/TD-08` e `TD-10`)
4. Criar `src/videos/videos.module.ts` com `TypeOrmModule.forFeature([Video])` e registrá-lo em `AppModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: constraints (unique `public_id`, not null), defaults e índice | `src/videos/entities/video.entity.integration-spec.ts` |
| `VideosModule` | Unit: compilação do módulo | `src/videos/videos.module.spec.ts` |

**Dependencies:** SI-03.2 — `TypeORM` e o `DataSource` já estão no baseline do Nest 12

**Acceptance criteria:**

- `npm run migration:run` cria a tabela `videos` com a coluna `public_id` única
- Inserir dois vídeos com o mesmo `public_id` viola a restrição unique
- Inserir um vídeo sem `status` ou sem `public_id` viola a restrição not null, quando a coluna não tem default
- `npm run migration:revert` remove a tabela `videos`

---

### SI-03.7 — Implementar o fluxo de upload no VideosService

**Description:** Concentra a regra do upload: pré-cadastro do vídeo, partes presigned e conclusão com validação de tamanho e enfileiramento do processamento.

**Technical actions:**

1. Criar `src/videos/videos.service.ts` com `initUpload`: valida o tamanho (máximo 10GB), gera o `public_id` com `nanoid`, pré-cadastra o vídeo e abre o multipart via `StorageService` (per `phase-03-upload-processing-backend/TD-02`, `TD-07`, `TD-08` e `TD-10`)
2. Adicionar `getPartUrls` com validação de estado e do intervalo de partes (per `phase-03-upload-processing-backend/TD-02`)
3. Adicionar `completeUpload`: finaliza o multipart, confere o tamanho real com `declared_size_bytes` via `headObject`, muda o status e enfileira o job `video.process` (per `phase-03-upload-processing-backend/TD-09`, `TD-10` e `TD-03`)
4. Validar as transições de status no service e lançar as exceções de domínio do `### Error Catalog` (per `phase-03-upload-processing-backend/TD-07` e `phase-02-auth/TD-07`)
5. Criar os DTOs `init-upload.dto.ts`, `part-urls.dto.ts` e `complete-upload.dto.ts` em `src/videos/dto/` com `class-validator` (per `phase-02-auth/TD-06`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` (upload) | Unit: ramos de validação e transição (repositório, storage e fila mockados) | `src/videos/videos.service.spec.ts` |
| `VideosService` (upload) | Integration: Postgres, MinIO e Redis reais do compose | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.4, SI-03.5, SI-03.6 — precisa de storage, fila e entidade

**Acceptance criteria:**

- Iniciar o upload com `sizeBytes` acima de 10GB falha com `UPLOAD_SIZE_EXCEEDED` e não cria nenhum vídeo
- Iniciar o upload com dados válidos cria um vídeo no estado inicial com `public_id` único e abre o multipart no storage
- Concluir o upload de um objeto de tamanho diferente do declarado falha com `UPLOAD_SIZE_MISMATCH`
- Concluir o upload válido muda o status e adiciona um job `video.process` com o `videoId` na fila `video-processing`
- Pedir `part-urls` ou concluir um vídeo que não está no estado de upload falha com `INVALID_VIDEO_STATE`
- Pedir `part-urls`, `complete` ou o estado de um vídeo de outro dono falha com `VIDEO_NOT_FOUND`

---

### SI-03.8 — Endpoint POST /videos

**Description:** Expõe o início do upload (`init`): pré-cadastra o vídeo como rascunho e devolve o `publicId` com os dados do multipart.

**Route:** POST /videos
**Test Specs:** see `nestjs-project/specs/videos-init.plan.md`
**Authorization:** Authenticated (dono do vídeo)

**Technical actions:**

1. Criar `src/videos/videos.controller.ts` com `@Post()` protegido pelo guard JWT herdado, validando o corpo com `InitUploadDto` e delegando a `VideosService.initUpload` (per `phase-03-upload-processing-backend/TD-02` e `phase-02-auth/TD-02`)
2. Anotar o endpoint com os decoradores do `@nestjs/swagger` e registrar `VideosController` em `VideosModule` (per `openapi-docs-nestjs/TD-01`)
3. Regenerar o `openapi.json` com `npm run openapi:export` (per `openapi-docs-nestjs/TD-02`)

**Tests:** _(empty — controller E2E authored by /plan-test-specs)_

**Dependencies:** SI-03.7 — o service de upload precisa existir

**Acceptance criteria:**

- `POST /videos` com `sizeBytes` e `contentType` válidos e token válido retorna `201` com `publicId`, `status`, `partSizeBytes` e `partCount`
- `POST /videos` com `sizeBytes` acima de 10GB retorna `400` com `UPLOAD_SIZE_EXCEEDED`
- `POST /videos` com corpo inválido retorna `400` com erro de validação
- `POST /videos` sem token retorna `401`

---

### SI-03.9 — Endpoint POST /videos/:publicId/part-urls

**Description:** Entrega ao cliente as URLs presigned de upload por parte, para enviar o arquivo direto ao storage.

**Route:** POST /videos/:publicId/part-urls
**Test Specs:** see `nestjs-project/specs/videos-part-urls.plan.md`
**Authorization:** Authenticated (dono do vídeo)

**Technical actions:**

1. Adicionar `@Post(':publicId/part-urls')` em `src/videos/videos.controller.ts`, validando o corpo com `PartUrlsDto` e delegando a `VideosService.getPartUrls` (per `phase-03-upload-processing-backend/TD-02`)
2. Anotar o endpoint com os decoradores do `@nestjs/swagger` e regenerar o `openapi.json` (per `openapi-docs-nestjs/TD-01` e `TD-02`)

**Tests:** _(empty — controller E2E authored by /plan-test-specs)_

**Dependencies:** SI-03.8 — o controller de vídeos já existe

**Acceptance criteria:**

- `POST /videos/:publicId/part-urls` com `partNumbers` válidos de um vídeo próprio retorna `200` com `parts` contendo `partNumber` e `url` para cada parte pedida
- `POST /videos/:publicId/part-urls` de um vídeo de outro dono ou inexistente retorna `404` com `VIDEO_NOT_FOUND`
- `POST /videos/:publicId/part-urls` de um vídeo fora do estado de upload retorna `409` com `INVALID_VIDEO_STATE`
- `POST /videos/:publicId/part-urls` com `partNumbers` ausente ou fora do intervalo retorna `400`
- `POST /videos/:publicId/part-urls` sem token retorna `401`

---

### SI-03.10 — Endpoint POST /videos/:publicId/complete

**Description:** Conclui o upload: a API finaliza o multipart, confere o objeto e enfileira o processamento do vídeo.

**Route:** POST /videos/:publicId/complete
**Test Specs:** see `nestjs-project/specs/videos-complete.plan.md`
**Authorization:** Authenticated (dono do vídeo)

**Technical actions:**

1. Adicionar `@Post(':publicId/complete')` em `src/videos/videos.controller.ts` com resposta `202`, validando o corpo com `CompleteUploadDto` e delegando a `VideosService.completeUpload` (per `phase-03-upload-processing-backend/TD-09`)
2. Anotar o endpoint com os decoradores do `@nestjs/swagger` e regenerar o `openapi.json` (per `openapi-docs-nestjs/TD-01` e `TD-02`)

**Tests:** _(empty — controller E2E authored by /plan-test-specs)_

**Dependencies:** SI-03.9 — o controller já expõe as partes do upload

**Acceptance criteria:**

- `POST /videos/:publicId/complete` com `parts` válidas de um upload completo retorna `202` com `publicId` e o novo `status`
- `POST /videos/:publicId/complete` de um objeto com tamanho diferente do declarado retorna `422` com `UPLOAD_SIZE_MISMATCH`
- `POST /videos/:publicId/complete` de um vídeo de outro dono ou inexistente retorna `404` com `VIDEO_NOT_FOUND`
- `POST /videos/:publicId/complete` de um vídeo fora do estado de upload retorna `409` com `INVALID_VIDEO_STATE`
- `POST /videos/:publicId/complete` com lista de partes inválida retorna `400`
- `POST /videos/:publicId/complete` sem token retorna `401`

---

### SI-03.11 — Infra: worker de vídeo em container próprio

**Description:** Cria o segundo entrypoint do mesmo codebase e o container com ffmpeg que consome a fila de processamento, isolando CPU e ffmpeg da API.

**Technical actions:**

1. Criar `src/worker/main-worker.ts` com `NestFactory.createApplicationContext(WorkerModule)`, sem servidor HTTP, e shutdown limpo com `app.close()` (per `phase-03-upload-processing-backend/TD-04`)
2. Criar `src/worker/worker.module.ts` importando configuração, banco, `StorageModule`, `QueueModule` e `VideosModule` (per `phase-03-upload-processing-backend/TD-04`)
3. Criar `nestjs-project/Dockerfile.worker` na mesma base Node 24 do `Dockerfile.dev`, acrescentando `ffmpeg` (que traz `ffprobe`) (per `phase-03-upload-processing-backend/TD-04` e `backend-nest12-runtime-test-runner/TD-01`)
4. Adicionar o serviço `video-worker` a `nestjs-project/compose.yaml` e o script `start:worker` em `package.json` (per `phase-03-upload-processing-backend/TD-04`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `WorkerModule` | Unit: compilação do módulo | `src/worker/worker.module.spec.ts` |

**Dependencies:** SI-03.5, SI-03.6 — precisa de fila e entidade

**Acceptance criteria:**

- `docker compose ps` mostra o serviço `video-worker` com status `running`
- `docker compose exec video-worker ffmpeg -version` e `docker compose exec video-worker ffprobe -version` terminam com código 0
- O processo do worker não abre porta HTTP

---

### SI-03.12 — Processar o vídeo: metadados e thumbnail

**Description:** Consome o job `video.process`, extrai duração e metadados com ffprobe, gera o thumbnail a partir de um frame e deixa o vídeo `ready` ou `failed`.

**Technical actions:**

1. Criar `src/worker/video-processing.processor.ts` com `@Processor('video-processing')` estendendo `WorkerHost`: muda o status para processamento, delega a extração e marca `ready`; um job com falha final marca `failed` com `failure_reason` via `@OnWorkerEvent('failed')` (per `phase-03-upload-processing-backend/TD-03` e `TD-07`)
2. Criar `src/worker/media/ffprobe.service.ts` que roda `ffprobe` com `child_process.spawn` (`-show_format -show_streams -of json`), com timeout, e valida que o arquivo é um vídeo (per `phase-03-upload-processing-backend/TD-05` e `TD-10`)
3. Criar `src/worker/media/thumbnail.service.ts` que roda `ffmpeg` com `spawn` para extrair um frame a cerca de 10% da duração, usando a duração do ffprobe (per `phase-03-upload-processing-backend/TD-05`)
4. Enviar o thumbnail ao storage e gravar `duration_seconds`, `metadata` e `thumbnail_key` no vídeo (per `phase-03-upload-processing-backend/TD-05` e `TD-01`)
5. Tornar o processamento idempotente, porque o job tem entrega at-least-once (per `phase-03-upload-processing-backend/TD-03`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `FfprobeService` e `ThumbnailService` | Integration: ffmpeg e ffprobe reais com um vídeo de exemplo | `src/worker/media/media.integration-spec.ts` |
| `VideoProcessingProcessor` | Unit: ramos de sucesso, falha e reprocessamento (serviços mockados) | `src/worker/video-processing.processor.spec.ts` |
| `VideoProcessingProcessor` | Integration: Postgres, MinIO e Redis reais do compose | `src/worker/video-processing.processor.integration-spec.ts` |

**Dependencies:** SI-03.11, SI-03.4 — precisa do worker e do storage

**Acceptance criteria:**

- Um job `video.process` de um vídeo válido deixa o vídeo `ready` com `duration_seconds` preenchida e `metadata` com as streams do arquivo
- O thumbnail do vídeo processado existe no storage e `thumbnail_key` aponta para ele
- Um arquivo que não é vídeo deixa o vídeo em `failed` com `failure_reason` preenchido
- Reprocessar o mesmo job não duplica o thumbnail nem muda o resultado

---

### SI-03.13 — Implementar leitura e URLs de reprodução no VideosService

**Description:** Entrega o estado do vídeo e as URLs presigned de streaming e download, com acesso restrito ao dono.

**Technical actions:**

1. Adicionar `getVideo` em `src/videos/videos.service.ts`, restrito ao dono (`VIDEO_NOT_FOUND` para vídeo alheio ou inexistente) e incluindo a URL presigned do thumbnail (per `phase-03-upload-processing-backend/TD-06`)
2. Adicionar `getStreamUrl`, que exige o vídeo pronto (`VIDEO_NOT_READY`) e devolve a URL presigned de GET com suporte a Range (per `phase-03-upload-processing-backend/TD-06`)
3. Adicionar `getDownloadUrl`, que devolve a URL presigned com `Content-Disposition: attachment` (per `phase-03-upload-processing-backend/TD-06`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` (reprodução) | Unit: ramos de acesso e de estado (repositório e storage mockados) | `src/videos/videos.playback.spec.ts` |
| `VideosService` (reprodução) | Integration: Postgres e MinIO reais — URL presigned entregue de fato pelo storage | `src/videos/videos.playback.integration-spec.ts` |

**Dependencies:** SI-03.4, SI-03.6 — precisa de storage e entidade

**Acceptance criteria:**

- Pedir a URL de streaming de um vídeo `ready` devolve uma URL que o storage serve com `206` para uma requisição com Range
- Pedir a URL de download de um vídeo `ready` devolve uma URL que o storage serve com `Content-Disposition: attachment`
- Pedir streaming ou download de um vídeo que ainda não está `ready` falha com `VIDEO_NOT_READY`
- Pedir qualquer dado de um vídeo de outro dono falha com `VIDEO_NOT_FOUND`

---

### SI-03.14 — Endpoint GET /videos/:publicId

**Description:** Expõe o estado do vídeo (status, duração, metadados e thumbnail), usado para acompanhar o processamento.

**Route:** GET /videos/:publicId
**Test Specs:** see `nestjs-project/specs/videos-get.plan.md`
**Authorization:** Authenticated (dono do vídeo)

**Technical actions:**

1. Adicionar `@Get(':publicId')` em `src/videos/videos.controller.ts`, delegando a `VideosService.getVideo` (per `phase-03-upload-processing-backend/TD-06`)
2. Anotar o endpoint com os decoradores do `@nestjs/swagger` e regenerar o `openapi.json` (per `openapi-docs-nestjs/TD-01` e `TD-02`)

**Tests:** _(empty — controller E2E authored by /plan-test-specs)_

**Dependencies:** SI-03.13, SI-03.10 — o service de leitura e o controller de vídeos precisam existir

**Acceptance criteria:**

- `GET /videos/:publicId` de um vídeo próprio retorna `200` com `publicId`, `status`, `durationSeconds`, `metadata` e `thumbnailUrl`
- `GET /videos/:publicId` de um vídeo ainda em processamento retorna `200` com `durationSeconds`, `metadata` e `thumbnailUrl` nulos
- `GET /videos/:publicId` de um vídeo de outro dono ou inexistente retorna `404` com `VIDEO_NOT_FOUND`
- `GET /videos/:publicId` sem token retorna `401`

---

### SI-03.15 — Endpoint GET /videos/:publicId/stream-url

**Description:** Entrega a URL presigned para reprodução por HTTP Range, direto do storage, sem baixar o arquivo inteiro.

**Route:** GET /videos/:publicId/stream-url
**Test Specs:** see `nestjs-project/specs/videos-stream-url.plan.md`
**Authorization:** Authenticated (dono do vídeo)

**Technical actions:**

1. Adicionar `@Get(':publicId/stream-url')` em `src/videos/videos.controller.ts`, delegando a `VideosService.getStreamUrl` (per `phase-03-upload-processing-backend/TD-06`)
2. Anotar o endpoint com os decoradores do `@nestjs/swagger` e regenerar o `openapi.json` (per `openapi-docs-nestjs/TD-01` e `TD-02`)

**Tests:** _(empty — controller E2E authored by /plan-test-specs)_

**Dependencies:** SI-03.14 — o controller já expõe a leitura do vídeo

**Acceptance criteria:**

- `GET /videos/:publicId/stream-url` de um vídeo `ready` próprio retorna `200` com `url` e `expiresInSeconds`
- `GET /videos/:publicId/stream-url` de um vídeo que ainda não está `ready` retorna `409` com `VIDEO_NOT_READY`
- `GET /videos/:publicId/stream-url` de um vídeo de outro dono ou inexistente retorna `404` com `VIDEO_NOT_FOUND`
- `GET /videos/:publicId/stream-url` sem token retorna `401`

---

### SI-03.16 — Endpoint GET /videos/:publicId/download-url

**Description:** Entrega a URL presigned de download do vídeo, com `Content-Disposition`, para o usuário baixar o arquivo.

**Route:** GET /videos/:publicId/download-url
**Test Specs:** see `nestjs-project/specs/videos-download-url.plan.md`
**Authorization:** Authenticated (dono do vídeo)

**Technical actions:**

1. Adicionar `@Get(':publicId/download-url')` em `src/videos/videos.controller.ts`, delegando a `VideosService.getDownloadUrl` (per `phase-03-upload-processing-backend/TD-06`)
2. Anotar o endpoint com os decoradores do `@nestjs/swagger` e regenerar o `openapi.json` (per `openapi-docs-nestjs/TD-01` e `TD-02`)

**Tests:** _(empty — controller E2E authored by /plan-test-specs)_

**Dependencies:** SI-03.14 — o controller já expõe a leitura do vídeo

**Acceptance criteria:**

- `GET /videos/:publicId/download-url` de um vídeo `ready` próprio retorna `200` com `url` e `expiresInSeconds`
- `GET /videos/:publicId/download-url` de um vídeo que ainda não está `ready` retorna `409` com `VIDEO_NOT_READY`
- `GET /videos/:publicId/download-url` de um vídeo de outro dono ou inexistente retorna `404` com `VIDEO_NOT_FOUND`
- `GET /videos/:publicId/download-url` sem token retorna `401`

---

### SI-03.17 — Job de limpeza de uploads abandonados e vídeos com falha

**Description:** Remove periodicamente multiparts abandonados e vídeos `failed` ou órfãos, porque o MinIO não aplica o lifecycle de abort e sem isso as partes órfãs acumulam.

**Technical actions:**

1. Registrar o job repetível `video.cleanup` na fila do worker e declarar o intervalo e a idade mínima de abandono em configuração (per `phase-03-upload-processing-backend/TD-10` e `TD-03`)
2. Criar `src/videos/cleanup.service.ts` que lista os multiparts antigos pelo `StorageService` e os aborta (per `phase-03-upload-processing-backend/TD-10`)
3. Fazer o `CleanupService` remover os vídeos `failed` ou órfãos, apagando o registro e os objetos associados (per `phase-03-upload-processing-backend/TD-10`)
4. Consumir `video.cleanup` no worker de vídeo (per `phase-03-upload-processing-backend/TD-04`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `CleanupService` | Unit: ramos de seleção por idade e por status (repositório e storage mockados) | `src/videos/cleanup.service.spec.ts` |
| `CleanupService` | Integration: Postgres e MinIO reais do compose | `src/videos/cleanup.service.integration-spec.ts` |

**Dependencies:** SI-03.12, SI-03.4 — precisa do processamento (estado `failed`) e do storage

**Acceptance criteria:**

- Um multipart upload abandonado há mais que a idade mínima deixa de constar na listagem do storage depois da limpeza
- Um vídeo `failed` há mais que a idade mínima é removido, junto com seus objetos
- Um upload em andamento mais recente que a idade mínima permanece intacto
- Rodar a limpeza duas vezes seguidas não gera erro nem muda o resultado

---

## Technical Specifications

### Data Model

#### Video

Entidade nova (`phase-03-upload-processing-backend/TD-07`: tabela `videos` com coluna `status` enum; `TD-08`: id público curto separado da PK). Os campos marcados com _(plan-defined)_ são exigidos pelas capacidades da fase e não são fixados literalmente por um TD.

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated |
| public_id | varchar | unique, not null — id curto aleatório gerado no pré-cadastro, estável mesmo se o título mudar; exposto na API como `publicId` (`TD-08`) |
| owner | _undetermined — nenhum TD diz se o vídeo pertence a um usuário ou a um canal_ | not null — seguir a convenção das entidades `User`/`Channel` existentes na hora de implementar |
| status | enum | not null — valores do ciclo de vida e transições conforme a Option A do `TD-07`; as transições são validadas no service; os valores são o contrato lido pelo frontend e entram no `openapi.json` |
| storage_key | varchar | not null — chave do objeto original no storage _(plan-defined)_ |
| upload_id | varchar | nullable — id do multipart upload no storage, usado em `part-urls`, `complete` e na limpeza (`TD-02`, `TD-10`) |
| declared_size_bytes | bigint | not null — tamanho declarado no início do upload e conferido no `complete` (`TD-10`) |
| duration_seconds | numeric | nullable — preenchido pelo worker (capacidade "extração de duração e metadados", `TD-05`) |
| metadata | jsonb | nullable — saída do ffprobe, preenchida pelo worker (`TD-05`) |
| thumbnail_key | varchar | nullable — chave do thumbnail gerado a partir de um frame (`TD-05`) |
| failure_reason | varchar | nullable — preenchido quando o vídeo termina em `failed` (`TD-07`, `TD-10`) |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now(), atualizado a cada mudança |

**Relations:** `Video` pertence a seu dono (_undetermined_, ver campo `owner`).
**Indexes:** unique em `public_id`; índice em `(status, created_at)` para o job de limpeza de vídeos `failed` e órfãos (`TD-10`).

### API Contracts

> Os TDs fixam o papel dos endpoints (`init`, `part-urls` e `complete`, em `TD-02`/`TD-09`), o campo `publicId` (`TD-08`) e a entrega por URL presigned com HTTP Range e `Content-Disposition` (`TD-06`). Caminhos, nomes de campos e códigos abaixo são definidos por este plano onde o TD só fixa o comportamento. Todos os endpoints exigem autenticação com os guards JWT herdados (`phase-02-auth`). O formato de erro é `{ statusCode, error, message }` com códigos de domínio (`phase-02-auth/TD-07`). O contrato entra no `openapi.json` via `@nestjs/swagger` (`openapi-docs-nestjs/TD-01`, `TD-02`).

#### POST /videos (SI-03.8)

Início do upload (`init`): pré-cadastra o vídeo como rascunho e abre o multipart upload no storage.

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {access_token}

**Request body:**
- sizeBytes: integer, required — tamanho do arquivo; positivo e no máximo 10GB (`TD-10`)
- contentType: string, required — tipo de mídia declarado do vídeo

**Response 201:**
- publicId: string — id curto único do vídeo (`TD-08`)
- status: string — status inicial do ciclo de vida (`TD-07`)
- partSizeBytes: integer — tamanho de cada parte do multipart
- partCount: integer — total de partes esperadas

**Error responses:**
- 400 validation error: corpo inválido
- 400 UPLOAD_SIZE_EXCEEDED: `sizeBytes` acima do limite de 10GB (`TD-10`)
- 401 unauthorized: sem autenticação válida

---

#### POST /videos/:publicId/part-urls (SI-03.9)

Gera as URLs presigned de upload por parte, assinadas com o host público do storage (`TD-02`).

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {access_token}

**Request body:**
- partNumbers: integer[], required — partes para as quais gerar URL

**Response 200:**
- parts: array de `{ partNumber: integer, url: string }`

**Error responses:**
- 400 validation error: `partNumbers` ausente ou fora do intervalo `1..partCount`
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro dono
- 409 INVALID_VIDEO_STATE: vídeo fora do estado de upload

---

#### POST /videos/:publicId/complete (SI-03.10)

Conclui o upload (`TD-09`): a API finaliza o multipart, confere o objeto no storage e enfileira o processamento.

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {access_token}

**Request body:**
- parts: array de `{ partNumber: integer, etag: string }`, required — partes enviadas

**Response 202:**
- publicId: string
- status: string — novo status após o upload (`TD-07`)

**Error responses:**
- 400 validation error: lista de partes inválida
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro dono
- 409 INVALID_VIDEO_STATE: vídeo fora do estado de upload
- 422 UPLOAD_SIZE_MISMATCH: tamanho real do objeto diferente do declarado (`TD-10`)

---

#### GET /videos/:publicId (SI-03.14)

Estado do vídeo (status, duração, metadados e thumbnail), usado para acompanhar o processamento.

**Request headers:**
- Authorization: Bearer {access_token}

**Response 200:**
- publicId: string
- status: string
- durationSeconds: number | null
- metadata: object | null
- thumbnailUrl: string | null — URL presigned do thumbnail (`TD-06`)

**Error responses:**
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro dono

---

#### GET /videos/:publicId/stream-url (SI-03.15)

URL presigned para reprodução por HTTP Range, direto do storage (`TD-06`). A URL expira, então o cliente renova em reprodução longa.

**Request headers:**
- Authorization: Bearer {access_token}

**Response 200:**
- url: string — URL presigned com suporte a Range
- expiresInSeconds: integer

**Error responses:**
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro dono
- 409 VIDEO_NOT_READY: vídeo ainda não processado

---

#### GET /videos/:publicId/download-url (SI-03.16)

URL presigned de download, com `Content-Disposition` (`TD-06`).

**Request headers:**
- Authorization: Bearer {access_token}

**Response 200:**
- url: string — URL presigned com `Content-Disposition: attachment`
- expiresInSeconds: integer

**Error responses:**
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro dono
- 409 VIDEO_NOT_READY: vídeo ainda não processado

### Authorization Matrix

Política interina: a visibilidade e a publicação do vídeo ficam na Fase 04 (`TD-07`) e nenhum TD fixa o acesso de leitura a vídeos prontos antes disso. Esta fase restringe tudo ao dono. _undetermined — acesso anônimo a vídeos publicados fica para a Fase 04._

| Endpoint | Anonymous | Authenticated | Owner |
|----------|-----------|---------------|-------|
| POST /videos | ✗ | ✓ | ✓ |
| POST /videos/:publicId/part-urls | ✗ | ✗ | ✓ |
| POST /videos/:publicId/complete | ✗ | ✗ | ✓ |
| GET /videos/:publicId | ✗ | ✗ | ✓ |
| GET /videos/:publicId/stream-url | ✗ | ✗ | ✓ |
| GET /videos/:publicId/download-url | ✗ | ✗ | ✓ |

### Error Catalog

Formato herdado de `phase-02-auth/TD-07`: `{ statusCode, error, message }` com códigos de domínio mapeados pelo filtro de exceções de domínio.

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| UPLOAD_SIZE_EXCEEDED | 400 | `sizeBytes` declarado acima do limite de 10GB no início do upload |
| UPLOAD_SIZE_MISMATCH | 422 | Tamanho real do objeto diferente do declarado, conferido no `complete` |
| VIDEO_NOT_FOUND | 404 | Vídeo inexistente ou pertencente a outro dono |
| INVALID_VIDEO_STATE | 409 | Operação de upload em vídeo fora do estado de upload |
| VIDEO_NOT_READY | 409 | Pedido de streaming ou download antes de o vídeo estar processado |

### Events/Messages

#### video.process

Job de processamento do vídeo (`TD-03` fila BullMQ sobre Redis).

**Payload:**

```json
{ "videoId": "uuid" }
```

**Producer:** `VideosService`, no `complete` do upload (per `phase-03-upload-processing-backend/TD-09`)
**Consumer:** worker de vídeo, em container próprio com ffmpeg (per `phase-03-upload-processing-backend/TD-04`)
**Trigger:** o upload termina e o objeto é conferido no storage; o job extrai duração e metadados com ffprobe e gera o thumbnail (per `phase-03-upload-processing-backend/TD-05`)
**Delivery semantics:** at-least-once, com retries e backoff configurados na fila; o consumer deve ser idempotente (per `phase-03-upload-processing-backend/TD-03`)

#### video.cleanup

Job periódico de limpeza (`TD-10`): lista e aborta multiparts antigos e remove vídeos `failed` ou órfãos.

**Payload:**

```json
{}
```

**Producer:** agendador da fila (job repetível) (per `phase-03-upload-processing-backend/TD-10`)
**Consumer:** worker de vídeo (per `phase-03-upload-processing-backend/TD-04`)
**Trigger:** execução periódica
**Delivery semantics:** at-least-once; a limpeza deve ser idempotente (per `phase-03-upload-processing-backend/TD-03`)

---

## Dependency Map

SI-03.1 (root — Node 24 na imagem)
└── SI-03.2 — depends on SI-03.1 (o `nest upgrade` exige o Node 24 do container)
    ├── SI-03.3 — depends on SI-03.2 (Joi e `@nestjs/config` já no baseline)
    │   └── SI-03.4 — depends on SI-03.3 (o StorageService precisa do MinIO e da configuração)
    ├── SI-03.5 — depends on SI-03.2 (Redis e BullMQ sobre o baseline)
    └── SI-03.6 — depends on SI-03.2 (entidade e migration sobre o TypeORM do baseline)

SI-03.7 — depends on SI-03.4 + SI-03.5 + SI-03.6 (fluxo de upload precisa de storage, fila e entidade)
└── SI-03.8 — depends on SI-03.7 (POST /videos)
    └── SI-03.9 — depends on SI-03.8 (POST /videos/:publicId/part-urls)
        └── SI-03.10 — depends on SI-03.9 (POST /videos/:publicId/complete)

SI-03.11 — depends on SI-03.5 + SI-03.6 (worker precisa de fila e entidade)
└── SI-03.12 — depends on SI-03.11 + SI-03.4 (processamento precisa do worker e do storage)
    └── SI-03.17 — depends on SI-03.12 + SI-03.4 (limpeza precisa do estado `failed` e do storage)

SI-03.13 — depends on SI-03.4 + SI-03.6 (leitura e URLs precisam de storage e entidade)
└── SI-03.14 — depends on SI-03.13 + SI-03.10 (GET /videos/:publicId)
    ├── SI-03.15 — depends on SI-03.14 (GET /videos/:publicId/stream-url)
    └── SI-03.16 — depends on SI-03.14 (GET /videos/:publicId/download-url)

---

## Deliverables

- [ ] SI-03.1 — Fixar o baseline de Node do backend
- [ ] SI-03.2 — Migrar o backend para o Nest 12 e atualizar o baseline de dependências
- [ ] SI-03.3 — Infra: MinIO no compose e configuração de storage
- [ ] SI-03.4 — Implementar o StorageService
- [ ] SI-03.5 — Infra: Redis e fila BullMQ
- [ ] SI-03.6 — Criar a entidade Video e a migration
- [ ] SI-03.7 — Implementar o fluxo de upload no VideosService
- [ ] SI-03.8 — Endpoint POST /videos
- [ ] SI-03.9 — Endpoint POST /videos/:publicId/part-urls
- [ ] SI-03.10 — Endpoint POST /videos/:publicId/complete
- [ ] SI-03.11 — Infra: worker de vídeo em container próprio
- [ ] SI-03.12 — Processar o vídeo: metadados e thumbnail
- [ ] SI-03.13 — Implementar leitura e URLs de reprodução no VideosService
- [ ] SI-03.14 — Endpoint GET /videos/:publicId
- [ ] SI-03.15 — Endpoint GET /videos/:publicId/stream-url
- [ ] SI-03.16 — Endpoint GET /videos/:publicId/download-url
- [ ] SI-03.17 — Job de limpeza de uploads abandonados e vídeos com falha

**Full test suites:**

- [ ] Backend unit tests pass (`cd nestjs-project && docker compose exec nestjs-api npm test`)
- [ ] Backend integration tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:integration`)
- [ ] E2E tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass (`cd nestjs-project && docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes with no errors or warnings (`cd nestjs-project && docker compose exec nestjs-api npm run lint`)
- [ ] Project builds successfully (`cd nestjs-project && docker compose exec nestjs-api npm run build`)
