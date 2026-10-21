---
kind: phase
name: phase-03-upload-processing
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-upload-processing/context.md: "2026-10-21T16:35:56+0200"
  docs/decisions/technical-decisions-upload-processing.md: "2026-10-21T16:33:40+0200"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Entregar o armazenamento de arquivos (vídeos e thumbnails), a fila de processamento em segundo plano e o upload de vídeos de até 10GB com pré-cadastro automático como rascunho, processamento automático (duração, metadados e thumbnail via FFmpeg), URL única por vídeo, reprodução via streaming e download.

---

## Step Implementations

### SI-03.1 — Infra: serviço de object storage no Compose

**Description:** Adicionar o serviço de armazenamento S3-compatível (SeaweedFS) ao Compose, com bucket e CORS prontos, e validar por spike os recursos que o upload e o streaming exigem.

**Technical actions:**

1. Adicionar o serviço `storage` (SeaweedFS com gateway S3) em `nestjs-project/compose.yaml`, com volume persistente e healthcheck; `nestjs-api` passa a depender dele (per `upload-processing/TD-01`)
2. Criar o bucket de vídeos e aplicar CORS que expõe o header `ETag` e libera `PUT`, `GET` e `HEAD` com `Range` (per `upload-processing/TD-02`)
3. Declarar as variáveis de ambiente de storage usando o nome do serviço `storage` como host interno, nunca `localhost`, além de um endpoint público alcançável pelo navegador para assinar as URLs
4. Executar o spike: multipart com URLs presignadas de parte, GET presignado com `Range` e comportamento da regra de lifecycle (confirmar se cobre só TTL); registrar o resultado em `docs/decisions/technical-decisions-upload-processing.md` como Revision de TD-01 (per `upload-processing/TD-01`, `upload-processing/TD-08`)

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- `docker compose ps` lista `storage` como `running` e saudável
- Um multipart upload de arquivo de teste, feito só com URLs presignadas, conclui e o objeto é lido de volta com o mesmo conteúdo
- `GET` presignado com `Range: bytes=0-99` retorna `206` com 100 bytes
- `OPTIONS` de preflight no bucket responde com `Access-Control-Expose-Headers` contendo `ETag`
- O resultado do spike (multipart, Range, lifecycle) está registrado no doc de decisões

---

### SI-03.2 — Infra: cliente S3 e configuração de storage

**Description:** Instalar o cliente S3 e expor a configuração de storage seguindo as convenções de config herdadas da Fase 01.

**Technical actions:**

1. Instalar `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner` em `nestjs-project/` (nenhuma TD cita bibliotecas: consultar a doc via context7 antes de usar, conforme o CLAUDE.md)
2. Criar `src/config/storage.config.ts` com `registerAs('storage', ...)` cobrindo endpoint interno, endpoint público, bucket, credenciais, region e path-style (per `phase-01-configuracao-base/TD-03`)
3. Estender `src/config/env.validation.ts` com o schema Joi das variáveis de storage (per `phase-01-configuracao-base/TD-02`)
4. Registrar `storageConfig` no `ConfigModule.forRoot` do `AppModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `env.validation` | Integration: variáveis de storage obrigatórias e inválidas são rejeitadas | `src/config/env.validation.integration-spec.ts` |

**Dependencies:** SI-03.1 — as variáveis de ambiente do storage são definidas lá

**Acceptance criteria:**

- A aplicação não inicia sem uma variável obrigatória de storage e a mensagem de erro lista o campo ausente
- A aplicação inicia com todas as variáveis de storage válidas
- Uma variável de storage com formato inválido faz a validação falhar citando o campo

---

### SI-03.3 — Criar StorageService (adaptador S3)

**Description:** Encapsular as operações de object storage (multipart, URLs presignadas, objetos) em um módulo próprio, para que `VideosService` e o worker não conheçam o SDK.

**Technical actions:**

1. Criar `src/storage/storage.module.ts` e `src/storage/storage.service.ts`, com o cliente S3 criado a partir de `storageConfig.KEY` (per `upload-processing/TD-01`)
2. Implementar `createMultipartUpload`, `presignUploadPart`, `completeMultipartUpload` e `abortMultipartUpload` (per `upload-processing/TD-02`)
3. Implementar `presignGetUrl(key, { download, filename })` com suporte a `Range` e `Content-Disposition: attachment` para download (per `upload-processing/TD-06`)
4. Implementar `putObject`, `deleteObject` e `headObject`, usados pelo worker e pelo reaper
5. Registrar `StorageModule` (exportando `StorageService`) no `AppModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration: multipart completo, GET presignado, abort e delete contra o serviço `storage` real | `src/storage/storage.service.integration-spec.ts` |
| `StorageModule` | Unit: compilation test | `src/storage/storage.module.spec.ts` |

**Dependencies:** SI-03.2 — usa o cliente S3 e o `storageConfig`

**Acceptance criteria:**

- Concluir um multipart com as partes enviadas torna o objeto legível por GET presignado
- A URL presignada de parte aceita `PUT` e devolve o header `ETag`
- GET presignado com `Range: bytes=0-99` retorna `206` com 100 bytes
- Abortar um multipart faz o upload sair da listagem de uploads abertos
- Após `deleteObject`, `headObject` do mesmo objeto indica inexistência
- GET presignado de download devolve `Content-Disposition` de anexo com o nome pedido

---

### SI-03.4 — Criar entidade Video e migration

**Description:** Persistir o vídeo pré-cadastrado como rascunho, com identificador público único e estado de processamento separado da visibilidade.

**Technical actions:**

1. Criar `src/videos/entities/video.entity.ts` (`videos`) com os campos e restrições de `### Data Model → Video` (per `upload-processing/TD-05`, `upload-processing/TD-07`)
2. Criar `src/videos/videos.constants.ts` com os valores de `status` e `visibility` (os valores não estão em nenhuma TD: ver `### Data Model` → Enumerações)
3. Gerar a migration `CreateVideos` em `src/database/migrations/` com unique em `public_id`, FK `channel_id` e os índices `channel_id` e `(status, created_at)`
4. Adicionar a relação one-to-many `videos` em `src/channels/entities/channel.entity.ts`
5. Criar `src/videos/videos.module.ts` com `TypeOrmModule.forFeature([Video])` e registrá-lo no `AppModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: unique de `public_id`, FK de `channel_id`, default de `visibility`, colunas not null | `src/videos/entities/video.entity.integration-spec.ts` |
| Migration `CreateVideos` | Integration: up e down aplicam e revertem o schema | `src/database/migrations.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Inserir dois vídeos com o mesmo `public_id` viola a unicidade
- Inserir um vídeo com `channel_id` inexistente viola a FK
- Um vídeo criado sem `visibility` é persistido como rascunho
- Aplicar e reverter a migration deixa o schema consistente

---

### SI-03.5 — Gerar identificador público do vídeo

**Description:** Produzir o ID curto e único usado na URL do vídeo, independente do UUID interno.

**Technical actions:**

1. Instalar `nanoid` em `nestjs-project/` (a TD fixa o identificador de 11 caracteres, não a biblioteca: confirmar via context7 a compatibilidade ESM/CommonJS com `module: nodenext` antes de importar)
2. Criar `src/videos/public-id.util.ts` com `generatePublicId()` devolvendo 11 caracteres URL-safe (per `upload-processing/TD-05`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `generatePublicId` | Unit: tamanho 11 e alfabeto URL-safe | `src/videos/public-id.util.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `generatePublicId()` retorna uma string de exatamente 11 caracteres
- Os caracteres retornados pertencem ao alfabeto URL-safe, sem espaços nem `/`
- Mil chamadas consecutivas produzem identificadores distintos

---

### SI-03.6 — Infra: fila de processamento com pg-boss

**Description:** Disponibilizar a fila em segundo plano sobre o PostgreSQL existente, com enfileiramento transacional.

**Technical actions:**

1. Instalar `pg-boss` em `nestjs-project/` (a TD escolhe a biblioteca sem fixar versão: consultar a doc via context7, em especial a API de transação) (per `upload-processing/TD-03`)
2. Criar `src/queue/queue.module.ts` e `src/queue/queue.service.ts` envolvendo `PgBoss`, iniciado e parado no ciclo de vida do Nest e conectado pelo `databaseConfig` (host `db`) (per `upload-processing/TD-03`)
3. Expor `enqueue(name, payload, { transaction })` que grava o job na mesma transação TypeORM do chamador (per `upload-processing/TD-03`)
4. Expor `work(name, handler)` e `schedule(name, cron)` para o worker e o reaper
5. Declarar `video.process` e `video.upload.reap` em `src/queue/queue.constants.ts` (per `### Events/Messages`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `QueueService` | Integration: enqueue em transação com commit e com rollback, consumo por `work` | `src/queue/queue.service.integration-spec.ts` |
| `QueueModule` | Unit: compilation test | `src/queue/queue.module.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Um job enfileirado em transação confirmada é consumido pelo handler registrado com o payload enviado
- Um job enfileirado em transação revertida não é entregue a nenhum handler
- Os objetos do pg-boss são criados no banco ao iniciar o módulo, sem migration manual
- Parar o módulo encerra a conexão do pg-boss sem erro

---

### SI-03.7 — Pré-cadastrar vídeo e iniciar o upload

**Description:** Criar o vídeo como rascunho e abrir o multipart upload, base do fluxo de `POST /videos`.

**Technical actions:**

1. Criar `src/videos/videos.service.ts` com `startUpload(user, dto)`: resolve o canal do usuário, cria o `Video` rascunho, abre o multipart via `StorageService` e persiste `upload_id` e `storage_key` (per `upload-processing/TD-02`, `upload-processing/TD-07`)
2. Gerar `public_id` com `generatePublicId()` e repetir a inserção quando o unique do banco for violado (per `upload-processing/TD-05`)
3. Validar `size_bytes` (máx. 10GB) e `content_type`; a lista de formatos aceitos é fixada nesta SI, pois `upload-processing/TD-08` só afirma que ela é limitada
4. Adicionar as exceções do `### Error Catalog` em `src/common/exceptions/domain.exception.ts` e, se `ChannelsService` não buscar canal por `user_id`, adicionar o método lá (módulo dono)
5. Criar `src/videos/dto/start-upload.dto.ts` com class-validator (per `phase-02-auth/TD-06`) e definir `part_size_bytes` como constante respeitando o limite de 10.000 partes

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.startUpload` | Unit: validação de tamanho e formato, escolha do tamanho de parte (mock de repo e storage) | `src/videos/videos.service.spec.ts` |
| `VideosService.startUpload` | Integration: persiste rascunho com `upload_id`, repete a inserção em colisão de `public_id` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.3 + SI-03.4 + SI-03.5 — precisa de storage, entidade e gerador de ID

**Acceptance criteria:**

- Iniciar upload válido persiste um `Video` com `visibility` de rascunho, `public_id` de 11 caracteres e `upload_id` preenchido
- `size_bytes` acima de 10GB lança `FILE_TOO_LARGE` (400) sem criar vídeo nem upload no storage
- `content_type` fora da lista lança `UNSUPPORTED_VIDEO_FORMAT` (415) sem criar vídeo
- Uma colisão de `public_id` na inserção gera novo ID e o vídeo é criado mesmo assim

---

### SI-03.8 — Assinar partes e concluir upload com enfileiramento transacional

**Description:** Entregar ao navegador as URLs de parte e, na conclusão, fechar o multipart e enfileirar o processamento sem risco de job perdido.

**Technical actions:**

1. Adicionar `signParts(user, publicId, partNumbers)` em `VideosService`: valida dono e upload aberto e devolve as URLs via `StorageService.presignUploadPart` (per `upload-processing/TD-02`)
2. Adicionar `completeUpload(user, publicId, parts)`: valida dono, conclui o multipart no storage e, em uma transação, atualiza `status`, limpa `upload_id` e enfileira `video.process` com `{ videoId }` (per `upload-processing/TD-03`)
3. Mapear a recusa do storage para `UPLOAD_INCOMPLETE` e a reentrada em upload fechado para `UPLOAD_ALREADY_COMPLETED`
4. Criar `src/videos/dto/sign-parts.dto.ts` e `src/videos/dto/complete-upload.dto.ts` com class-validator (per `phase-02-auth/TD-06`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.signParts` / `completeUpload` | Unit: dono, upload fechado, mapeamento de erros (mock de repo, storage e fila) | `src/videos/videos.service.spec.ts` |
| `VideosService.completeUpload` | Integration: job `video.process` gravado junto com o update, rollback não deixa job | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.6 + SI-03.7 — usa a fila e o upload já aberto

**Acceptance criteria:**

- Concluir um upload válido muda o `status` do vídeo, zera `upload_id` e deixa um job `video.process` com o `videoId`
- Se a transação de conclusão falhar, nenhum job é enfileirado e o vídeo mantém o estado anterior
- Pedir URLs de parte para vídeo de outro canal lança `VIDEO_FORBIDDEN` (403)
- Concluir um upload já concluído lança `UPLOAD_ALREADY_COMPLETED` (409)
- Lista de partes recusada pelo storage lança `UPLOAD_INCOMPLETE` (400)

---

### SI-03.9 — Endpoint POST /videos

**Route:** POST /videos
**Test Specs:** see `nestjs-project/specs/videos-start-upload.plan.md`
**Authorization:** Authenticated (dono do canal)

**Description:** Expor o início do upload e o pré-cadastro do vídeo como rascunho.

**Technical actions:**

1. Criar `src/videos/videos.controller.ts` com `POST /videos` (201), usando `@CurrentUser()` e `StartUploadDto`, e registrá-lo em `VideosModule` (per `upload-processing/TD-02`)
2. Retornar `public_id`, `upload_id`, `part_size_bytes`, `status` e `visibility` conforme `### API Contracts → POST /videos`
3. Documentar a rota com os decorators OpenAPI do projeto e regenerar `openapi.json`

**Tests:** _(empty — E2E scenarios live in the /plan-test-specs spec)_

**Dependencies:** SI-03.7 — o controller delega ao `startUpload`

**Acceptance criteria:**

- `POST /videos` autenticado com `filename`, `size_bytes` e `content_type` válidos retorna `201` com `public_id`, `upload_id`, `part_size_bytes`, `status` e `visibility`
- `POST /videos` sem token retorna `401`
- `POST /videos` com `size_bytes` acima de 10GB retorna `400` com `error: "FILE_TOO_LARGE"`
- `POST /videos` com `content_type` não aceito retorna `415` com `error: "UNSUPPORTED_VIDEO_FORMAT"`
- `POST /videos` com body sem `filename` retorna `400` de validação

---

### SI-03.10 — Endpoint POST /videos/:publicId/upload/part-urls

**Route:** POST /videos/:publicId/upload/part-urls
**Test Specs:** see `nestjs-project/specs/videos-part-urls.plan.md`
**Authorization:** Owner

**Description:** Expor a assinatura de URLs de parte para o navegador enviar direto ao storage.

**Technical actions:**

1. Adicionar `POST /videos/:publicId/upload/part-urls` (200) em `VideosController`, usando `SignPartsDto` (per `upload-processing/TD-02`)
2. Retornar `urls` como lista de `{ part_number, url }` conforme `### API Contracts → POST /videos/:publicId/upload/part-urls`
3. Documentar a rota com OpenAPI e regenerar `openapi.json`

**Tests:** _(empty — E2E scenarios live in the /plan-test-specs spec)_

**Dependencies:** SI-03.8 + SI-03.9 — delega a `signParts` e estende o controller criado antes

**Acceptance criteria:**

- `POST /videos/:publicId/upload/part-urls` do dono com `part_numbers: [1, 2]` retorna `200` com duas URLs
- A mesma chamada de outro usuário autenticado retorna `403` com `error: "VIDEO_FORBIDDEN"`
- Com `publicId` inexistente retorna `404` com `error: "VIDEO_NOT_FOUND"`
- Com upload já concluído retorna `409` com `error: "UPLOAD_ALREADY_COMPLETED"`
- Com `part_numbers` vazio retorna `400` de validação

---

### SI-03.11 — Endpoint POST /videos/:publicId/upload/complete

**Route:** POST /videos/:publicId/upload/complete
**Test Specs:** see `nestjs-project/specs/videos-complete-upload.plan.md`
**Authorization:** Owner

**Description:** Expor a conclusão do upload, que dispara o processamento em segundo plano.

**Technical actions:**

1. Adicionar `POST /videos/:publicId/upload/complete` (202) em `VideosController`, usando `CompleteUploadDto` (per `upload-processing/TD-03`)
2. Retornar `public_id` e `status` conforme `### API Contracts → POST /videos/:publicId/upload/complete`
3. Documentar a rota com OpenAPI e regenerar `openapi.json`

**Tests:** _(empty — E2E scenarios live in the /plan-test-specs spec)_

**Dependencies:** SI-03.8 + SI-03.10 — delega a `completeUpload` e estende o controller

**Acceptance criteria:**

- `POST /videos/:publicId/upload/complete` do dono, com a lista de partes enviada, retorna `202` com `public_id` e `status`
- A mesma chamada de outro usuário autenticado retorna `403` com `error: "VIDEO_FORBIDDEN"`
- Chamar de novo após concluir retorna `409` com `error: "UPLOAD_ALREADY_COMPLETED"`
- Com lista de partes recusada pelo storage retorna `400` com `error: "UPLOAD_INCOMPLETE"`
- Com `parts` ausente retorna `400` de validação

---

### SI-03.12 — Consultar vídeo, resolver acesso e URLs de reprodução

**Description:** Servir status, metadados e URLs presignadas de streaming e download, respeitando que rascunhos só o dono acessa.

**Technical actions:**

1. Adicionar `getVideo(publicId, viewer?)` em `VideosService`, devolvendo `VIDEO_NOT_FOUND` para rascunho consultado por quem não é o dono (per `### Authorization Matrix`, `upload-processing/TD-07`)
2. Adicionar `getPlaybackUrl(publicId, viewer?, { download })`: exige vídeo pronto (senão `VIDEO_NOT_READY`) e devolve `url` e `expires_in` via `StorageService.presignGetUrl` (per `upload-processing/TD-06`); `expires_in` é constante a fixar, pois nenhuma TD a define
3. Criar `src/auth/guards/optional-auth.guard.ts` e o decorator correspondente: preenche `request.user` quando há token válido e não rejeita anônimos, já que o `JwtAuthGuard` global exige token salvo `@Public()`
4. Criar `src/videos/dto/video-response.dto.ts` com `public_id`, `status`, `visibility`, `duration_seconds`, `metadata` e `has_thumbnail`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.getVideo` / `getPlaybackUrl` | Unit: visibilidade por dono, vídeo não pronto (mock de repo e storage) | `src/videos/videos.service.spec.ts` |
| `OptionalAuthGuard` | Unit: com token válido, sem token e com token inválido | `src/auth/guards/optional-auth.guard.spec.ts` |
| `VideosService.getPlaybackUrl` | Integration: URL presignada de um objeto real aceita `Range` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.3 + SI-03.4 — lê a entidade e assina URLs no storage

**Acceptance criteria:**

- Consultar um rascunho como dono devolve os dados do vídeo; como anônimo ou outro usuário lança `VIDEO_NOT_FOUND`
- Pedir URL de reprodução de vídeo ainda em processamento lança `VIDEO_NOT_READY` (409)
- Pedir URL de reprodução de vídeo pronto devolve uma URL que serve o arquivo com `Range`
- O guard opcional deixa passar requisição sem token sem preencher `request.user`
- O guard opcional preenche `request.user` quando o token é válido

---

### SI-03.13 — Endpoint GET /videos/:publicId

**Route:** GET /videos/:publicId
**Test Specs:** see `nestjs-project/specs/videos-get-status.plan.md`
**Authorization:** Anonymous (publicado) / Owner (rascunho)

**Description:** Expor status e metadados para o polling de progresso do processamento.

**Technical actions:**

1. Adicionar `GET /videos/:publicId` (200) em `VideosController`, com `@Public()` e autenticação opcional (per `upload-processing/TD-07`)
2. Retornar `VideoResponseDto` conforme `### API Contracts → GET /videos/:publicId`
3. Documentar a rota com OpenAPI e regenerar `openapi.json`

**Tests:** _(empty — E2E scenarios live in the /plan-test-specs spec)_

**Dependencies:** SI-03.12 + SI-03.11 — delega a `getVideo` e estende o controller

**Acceptance criteria:**

- `GET /videos/:publicId` do dono de um vídeo em rascunho retorna `200` com `public_id`, `status`, `visibility`, `duration_seconds`, `metadata` e `has_thumbnail`
- A mesma chamada sem token retorna `404` com `error: "VIDEO_NOT_FOUND"`
- Com `publicId` inexistente retorna `404` com `error: "VIDEO_NOT_FOUND"`
- Após o processamento, a resposta traz `duration_seconds` preenchido e `has_thumbnail: true`

---

### SI-03.14 — Endpoint GET /videos/:publicId/stream

**Route:** GET /videos/:publicId/stream
**Test Specs:** see `nestjs-project/specs/videos-stream.plan.md`
**Authorization:** Anonymous (publicado) / Owner (rascunho)

**Description:** Entregar a URL presignada para reprodução em streaming, sem baixar o arquivo inteiro.

**Technical actions:**

1. Adicionar `GET /videos/:publicId/stream` (200) em `VideosController`, com `@Public()` e autenticação opcional (per `upload-processing/TD-06`)
2. Retornar `url` e `expires_in` conforme `### API Contracts → GET /videos/:publicId/stream`
3. Documentar a rota com OpenAPI e regenerar `openapi.json`

**Tests:** _(empty — E2E scenarios live in the /plan-test-specs spec)_

**Dependencies:** SI-03.12 + SI-03.13 — delega a `getPlaybackUrl` e estende o controller

**Acceptance criteria:**

- `GET /videos/:publicId/stream` de um vídeo pronto, pelo dono, retorna `200` com `url` e `expires_in`
- A `url` retornada responde `206` a um GET com `Range: bytes=0-99`
- Com o vídeo ainda em processamento retorna `409` com `error: "VIDEO_NOT_READY"`
- De um rascunho, sem token, retorna `404` com `error: "VIDEO_NOT_FOUND"`

---

### SI-03.15 — Endpoint GET /videos/:publicId/download

**Route:** GET /videos/:publicId/download
**Test Specs:** see `nestjs-project/specs/videos-download.plan.md`
**Authorization:** Anonymous (publicado) / Owner (rascunho)

**Description:** Entregar a URL presignada que força o download do arquivo do vídeo.

**Technical actions:**

1. Adicionar `GET /videos/:publicId/download` (200) em `VideosController`, com `@Public()` e autenticação opcional (per `upload-processing/TD-06`)
2. Chamar `getPlaybackUrl` com `download: true` e retornar `url` e `expires_in` conforme `### API Contracts → GET /videos/:publicId/download`
3. Documentar a rota com OpenAPI e regenerar `openapi.json`

**Tests:** _(empty — E2E scenarios live in the /plan-test-specs spec)_

**Dependencies:** SI-03.12 + SI-03.14 — reaproveita `getPlaybackUrl` e estende o controller

**Acceptance criteria:**

- `GET /videos/:publicId/download` de um vídeo pronto, pelo dono, retorna `200` com `url` e `expires_in`
- A `url` retornada responde com `Content-Disposition` de anexo
- Com o vídeo ainda em processamento retorna `409` com `error: "VIDEO_NOT_READY"`
- De um rascunho, sem token, retorna `404` com `error: "VIDEO_NOT_FOUND"`

---

### SI-03.16 — Infra: worker como segundo entrypoint e serviço do Compose

**Description:** Empacotar o worker de vídeo como processo separado, reaproveitando entidades e o módulo de storage, com FFmpeg disponível na imagem.

**Technical actions:**

1. Instalar `ffmpeg` (que inclui `ffprobe`) em `nestjs-project/Dockerfile.dev` antes de `USER node` (per `upload-processing/TD-04`)
2. Criar `src/worker.main.ts`, entrypoint que sobe `WorkerModule` como application context, sem servidor HTTP (per `upload-processing/TD-04`)
3. Criar `src/worker/worker.module.ts` importando `ConfigModule`, TypeORM com `Video`, `StorageModule` e `QueueModule`
4. Adicionar o serviço `video-worker` em `compose.yaml`, com a mesma imagem, comando do entrypoint do worker e `depends_on` de `db` e `storage` (per `upload-processing/TD-04`)
5. Adicionar os scripts `start:worker:dev` e de build do worker em `package.json` e o entry em `nest-cli.json`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `WorkerModule` | Unit: compilation test | `src/worker/worker.module.spec.ts` |

**Dependencies:** SI-03.3 + SI-03.6 — o módulo do worker importa storage e fila

**Acceptance criteria:**

- `docker compose ps` lista `video-worker` como `running`, e os logs não mostram erro de conexão com `db` nem com `storage`
- `ffmpeg -version` e `ffprobe -version` executam dentro do container do worker
- O processo do worker não abre porta HTTP
- Parar o container encerra o worker sem job pendente travado

---

### SI-03.17 — Criar FfmpegService (probe e thumbnail)

**Description:** Isolar a chamada a `ffprobe` e `ffmpeg` por `child_process`, lendo a origem por URL presignada para nunca baixar um arquivo de 10GB.

**Technical actions:**

1. Criar `src/worker/ffmpeg.service.ts` com `probe(url)`, executando `ffprobe` via `child_process.spawn` com saída JSON e lendo a URL presignada de GET diretamente (per `upload-processing/TD-04`)
2. Implementar `extractThumbnail(url, atSeconds)` executando `ffmpeg` via `spawn` e gravando um JPEG em arquivo temporário; o instante do frame é fixado nesta SI a partir da duração
3. Tratar saída com código diferente de zero e timeout, sempre removendo os temporários
4. Não usar `fluent-ffmpeg`: a TD não o recomenda até confirmar a manutenção (per `upload-processing/TD-04`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `FfmpegService` | Unit: parsing da saída do ffprobe e erros de processo (spawn mockado) | `src/worker/ffmpeg.service.spec.ts` |
| `FfmpegService` | Integration: ffprobe e ffmpeg reais sobre um vídeo curto gerado no setup do teste | `src/worker/ffmpeg.service.integration-spec.ts` |

**Dependencies:** SI-03.16 — depende do FFmpeg instalado na imagem

**Acceptance criteria:**

- `probe` de um vídeo válido devolve a duração em segundos e os metadados do ffprobe
- `extractThumbnail` de um vídeo válido produz um arquivo JPEG não vazio
- `probe` de um arquivo que não é vídeo rejeita com erro e não deixa processo pendente
- Um processo que estoura o timeout é encerrado e os temporários são removidos

---

### SI-03.18 — Processar vídeo enviado (handler de video.process)

**Description:** Consumir o job de processamento, extrair duração, metadados e thumbnail e deixar o vídeo pronto.

**Technical actions:**

1. Criar `src/worker/video-processing.handler.ts` e registrá-lo com `QueueService.work('video.process', ...)` no `WorkerModule` (per `upload-processing/TD-03`, `upload-processing/TD-04`)
2. Gerar a URL presignada de GET do original, chamar `FfmpegService.probe` e gravar `duration_seconds` e `metadata` em `Video`
3. Extrair o thumbnail, enviá-lo com `StorageService.putObject` e gravar `thumbnail_key`
4. Atualizar `status` para pronto e, na falha definitiva após os retries do pg-boss, marcá-lo como falho (per `upload-processing/TD-07`)
5. Tornar o handler idempotente: reprocessar um vídeo já pronto não altera nada (entrega at-least-once, per `### Events/Messages`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingHandler` | Unit: fluxo, falha e idempotência (mock de repo, storage e ffmpeg) | `src/worker/video-processing.handler.spec.ts` |
| `VideoProcessingHandler` | Integration: processa um vídeo real no storage real e verifica o banco | `src/worker/video-processing.handler.integration-spec.ts` |

**Dependencies:** SI-03.8 + SI-03.17 — consome o job enfileirado na conclusão e usa o FfmpegService

**Acceptance criteria:**

- Um job `video.process` de vídeo válido deixa `duration_seconds` e `metadata` preenchidos e `status` pronto
- O processamento grava `thumbnail_key` e o objeto do thumbnail existe no storage
- Um arquivo que não é vídeo deixa o `status` como falho após esgotar os retries
- Entregar o mesmo job duas vezes mantém o vídeo pronto, sem gerar segundo thumbnail

---

### SI-03.19 — Reaper de uploads abandonados

**Description:** Remover periodicamente os uploads abandonados, mantendo linhas do banco e objetos do storage consistentes e contendo o crescimento de armazenamento.

**Technical actions:**

1. Criar `src/worker/upload-reaper.handler.ts`: seleciona `Video` com `upload_id` aberto e inativo além do limite, aborta o multipart, remove objetos parciais e apaga a linha (per `upload-processing/TD-08`)
2. Registrá-lo com `QueueService.work('video.upload.reap', ...)` e agendar o job recorrente com `QueueService.schedule` no bootstrap do worker (per `upload-processing/TD-08`)
3. Definir em `src/worker/worker.constants.ts` a periodicidade e o limite de inatividade (valores não definidos em nenhuma TD)
4. Garantir idempotência: reexecutar sobre um upload já limpo não falha

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `UploadReaperHandler` | Unit: seleção por inatividade e tolerância a falha do storage (mock) | `src/worker/upload-reaper.handler.spec.ts` |
| `UploadReaperHandler` | Integration: upload abandonado é removido do banco e do storage, upload ativo permanece | `src/worker/upload-reaper.handler.integration-spec.ts` |

**Dependencies:** SI-03.16 — roda no worker e depende do agendador da fila

**Acceptance criteria:**

- Um vídeo com upload aberto além do limite é removido do banco, e o multipart é abortado no storage
- Um vídeo com upload aberto dentro do limite permanece intacto
- Um vídeo com upload concluído nunca é tocado pelo reaper
- Rodar o reaper duas vezes seguidas sobre o mesmo estado não gera erro

---

## Technical Specifications

### Data Model

#### Video

Nova entidade `videos` (módulo `VideosModule`). O PK interno UUID é independente do identificador público (per `upload-processing/TD-05`); `status` e `visibility` são máquinas de estado separadas (per `upload-processing/TD-07`).

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated |
| public_id | varchar(11) | unique, not null — nanoid de 11 caracteres, unicidade garantida pelo banco (per `upload-processing/TD-05`) |
| channel_id | uuid | FK → `channels.id`, not null — dono do vídeo |
| status | varchar | not null — estado de processamento, separado de `visibility` (per `upload-processing/TD-07`) |
| visibility | varchar | not null, default `draft` — pré-cadastro como rascunho ao iniciar o upload (capability "Pré-cadastro automático") |
| original_filename | varchar(255) | not null |
| size_bytes | bigint | not null |
| storage_key | varchar | not null — chave do objeto original no bucket (TD-01) |
| upload_id | varchar | nullable — id do multipart upload S3 enquanto o upload estiver aberto (per `upload-processing/TD-02`); usado por `complete` e pelo reaper (TD-08) |
| thumbnail_key | varchar | nullable — preenchido pelo worker |
| duration_seconds | numeric | nullable — preenchido pelo worker |
| metadata | jsonb | nullable — saída do ffprobe preenchida pelo worker |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now(), atualizado a cada update |

**Relations:** `Channel` has many `Video` (one-to-many); `Video` belongs to `Channel` via `channel_id`.
**Indexes:** unique on `public_id`; index on `channel_id`; index on `(status, created_at)` para a varredura do reaper (per `upload-processing/TD-08`).
**Enumerações:** os valores de `status` e `visibility` não são enumerados em nenhuma TD (TD-07 só decide a separação e o polling). _undetermined — valores de `status` (ex.: uploading, processing, ready, failed) e de `visibility` (ex.: draft; publicação é Fase 04) a fixar no SI da entidade; nenhuma TD os nomeia._

### API Contracts

Fluxo de upload multipart S3 com URLs presignadas por parte: o navegador envia as partes direto ao storage; a API só autentica init/sign/complete (per `upload-processing/TD-02`). Streaming e download usam URL presignada de GET com Range, sem transcodificação (per `upload-processing/TD-06`). O status é consultado por polling (per `upload-processing/TD-07`). Os paths seguem as convenções REST do projeto (substantivos no plural); nenhuma TD fixa os paths literais.

#### POST /videos (SI-03.X)

Inicia o upload: cria o `Video` como rascunho e abre o multipart upload.

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {access_token}

**Request body:**
- filename: string, required — nome original do arquivo
- size_bytes: integer, required — tamanho total; máximo 10GB (capability "até 10GB")
- content_type: string, required — tipo de mídia; formatos aceitos limitados conforme `upload-processing/TD-08`

**Response 201:**
- public_id: string (nanoid, 11 caracteres)
- upload_id: string
- part_size_bytes: integer — _undetermined — tamanho de parte não definido em nenhuma TD (limites do S3: mínimo 5MiB, máximo 10.000 partes)_
- status: string
- visibility: string

**Error responses:**
- 400 validation error: when the request body fails schema validation
- 400 FILE_TOO_LARGE: when `size_bytes` exceeds 10GB
- 415 UNSUPPORTED_VIDEO_FORMAT: when `content_type` is not an accepted format
- 401 UNAUTHORIZED: when the access token is missing or invalid

---

#### POST /videos/:publicId/upload/part-urls (SI-03.X)

Assina URLs de `UploadPart` para as partes pedidas.

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {access_token}

**Request body:**
- part_numbers: integer[], required — números de parte (1..10000) a assinar

**Response 200:**
- urls: array of `{ part_number: integer, url: string }` — URL presignada de PUT por parte

**Error responses:**
- 404 VIDEO_NOT_FOUND: when no video matches `publicId`
- 403 VIDEO_FORBIDDEN: when the video belongs to another channel
- 409 UPLOAD_ALREADY_COMPLETED: when the multipart upload is no longer open
- 400 validation error: when `part_numbers` is empty or out of range

---

#### POST /videos/:publicId/upload/complete (SI-03.X)

Conclui o multipart upload e enfileira o processamento na mesma transação (per `upload-processing/TD-03`).

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer {access_token}

**Request body:**
- parts: array of `{ part_number: integer, etag: string }`, required — ETags coletados pelo navegador (o CORS do bucket deve expor `ETag`, per `upload-processing/TD-02`)

**Response 202:**
- public_id: string
- status: string

**Error responses:**
- 404 VIDEO_NOT_FOUND: when no video matches `publicId`
- 403 VIDEO_FORBIDDEN: when the video belongs to another channel
- 409 UPLOAD_ALREADY_COMPLETED: when the upload was already completed
- 400 UPLOAD_INCOMPLETE: when the storage rejects the part list
- 400 validation error: when `parts` is missing or malformed

---

#### GET /videos/:publicId (SI-03.X)

Consulta de status e metadados, usada por polling (per `upload-processing/TD-07`).

**Request headers:**
- Authorization: Bearer {access_token} — opcional; obrigatório para vídeos em rascunho

**Response 200:**
- public_id: string
- status: string
- visibility: string
- duration_seconds: number | null
- metadata: object | null
- has_thumbnail: boolean

**Error responses:**
- 404 VIDEO_NOT_FOUND: when no video matches `publicId` or it is not visible to the caller

---

#### GET /videos/:publicId/stream (SI-03.X)

Devolve a URL presignada de GET para reprodução com suporte a Range (per `upload-processing/TD-06`).

**Request headers:**
- Authorization: Bearer {access_token} — opcional; obrigatório para vídeos em rascunho

**Response 200:**
- url: string — URL presignada de GET no storage
- expires_in: integer — _undetermined — validade da URL não definida em nenhuma TD_

**Error responses:**
- 404 VIDEO_NOT_FOUND: when no video matches `publicId` or it is not visible to the caller
- 409 VIDEO_NOT_READY: when processing has not finished

---

#### GET /videos/:publicId/download (SI-03.X)

Mesma mecânica do stream, com `Content-Disposition: attachment` na URL presignada (per `upload-processing/TD-06`).

**Request headers:**
- Authorization: Bearer {access_token} — opcional; obrigatório para vídeos em rascunho

**Response 200:**
- url: string — URL presignada de GET com disposição de anexo
- expires_in: integer — _undetermined — validade da URL não definida em nenhuma TD_

**Error responses:**
- 404 VIDEO_NOT_FOUND: when no video matches `publicId` or it is not visible to the caller
- 409 VIDEO_NOT_READY: when processing has not finished

---

#### Validation Rules — Upload de vídeos

- `filename`: required, string não vazia, máximo 255 caracteres
- `size_bytes`: required, inteiro positivo, máximo 10GB
- `content_type`: required, deve pertencer à lista de formatos aceitos (per `upload-processing/TD-08`; lista _undetermined — não enumerada na TD_)
- `part_numbers`: required, inteiros distintos entre 1 e 10000
- `parts[].etag`: required, string não vazia

### Authorization Matrix

O dono é o canal que criou o vídeo. O assistir anônimo vale para vídeos publicados; a publicação em si é da Fase 04, então nesta fase todo vídeo nasce como rascunho e só o dono o acessa.

| Endpoint | Anonymous | Authenticated | Owner |
|----------|-----------|---------------|-------|
| POST /videos | ✗ | ✓ | ✓ |
| POST /videos/:publicId/upload/part-urls | ✗ | ✗ | ✓ |
| POST /videos/:publicId/upload/complete | ✗ | ✗ | ✓ |
| GET /videos/:publicId | ✓ (publicado) | ✓ (publicado) | ✓ |
| GET /videos/:publicId/stream | ✓ (publicado) | ✓ (publicado) | ✓ |
| GET /videos/:publicId/download | ✓ (publicado) | ✓ (publicado) | ✓ |

### Error Catalog

Formato de resposta herdado da Fase 02: `{ statusCode, error, message }` com `error` = código de domínio, emitido por exceções que estendem `DomainException` (per `phase-02-auth/TD-07`).

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| VIDEO_NOT_FOUND | 404 | `publicId` inexistente, ou vídeo em rascunho consultado por quem não é o dono |
| VIDEO_FORBIDDEN | 403 | Operação de upload sobre vídeo de outro canal |
| VIDEO_NOT_READY | 409 | Stream ou download antes do fim do processamento |
| UPLOAD_ALREADY_COMPLETED | 409 | Assinar partes ou concluir um upload já fechado |
| UPLOAD_INCOMPLETE | 400 | O storage recusa a lista de partes ao concluir |
| FILE_TOO_LARGE | 400 | `size_bytes` acima de 10GB |
| UNSUPPORTED_VIDEO_FORMAT | 415 | `content_type` fora dos formatos aceitos (per `upload-processing/TD-08`) |

### Events/Messages

Fila em pg-boss, com enfileiramento transacional junto ao update do `Video` (per `upload-processing/TD-03`). Os nomes das filas são decisão de plano; nenhuma TD os fixa.

#### video.process

**Payload:**

```json
{ "videoId": "uuid" }
```

**Producer:** `VideosService` ao concluir o upload (per `upload-processing/TD-03`)
**Consumer:** processo worker como segundo entrypoint Nest e serviço separado no compose (per `upload-processing/TD-04`); extrai duração e metadados com ffprobe e gera o thumbnail com FFmpeg, ambos via `child_process` lendo uma URL presignada de GET (per `upload-processing/TD-04`)
**Trigger:** `POST /videos/:publicId/upload/complete` concluído com sucesso
**Delivery semantics:** at-least-once (pg-boss com retry); o handler deve ser idempotente (per `upload-processing/TD-03`)

#### video.upload.reap

**Payload:**

```json
{}
```

**Producer:** agendador do pg-boss, job recorrente (per `upload-processing/TD-08`)
**Consumer:** mesmo worker (per `upload-processing/TD-04`); aborta multipart uploads abandonados e remove a linha e os objetos correspondentes
**Trigger:** agendamento periódico; o reaper é o mecanismo primário porque a regra de lifecycle do SeaweedFS só cobre TTL (per `upload-processing/TD-08` e `upload-processing/TD-01`). _undetermined — periodicidade e limite de inatividade não definidos em nenhuma TD._
**Delivery semantics:** at-least-once; a varredura deve ser idempotente (per `upload-processing/TD-08`)

---

## Dependency Map

SI-03.1 (root — storage no Compose)
└── SI-03.2 — depends on SI-03.1 (variáveis de storage definidas antes da config)
    └── SI-03.3 — depends on SI-03.2 (StorageService usa o cliente S3 e o storageConfig)
        ├── SI-03.12 — depends on SI-03.3 + SI-03.4 (assina URLs de reprodução e lê a entidade)
        │   ├── SI-03.13 — depends on SI-03.12 + SI-03.11
        │   ├── SI-03.14 — depends on SI-03.12 + SI-03.13
        │   └── SI-03.15 — depends on SI-03.12 + SI-03.14
        └── SI-03.7 — depends on SI-03.3 + SI-03.4 + SI-03.5 (storage, entidade e gerador de ID)
            └── SI-03.8 — depends on SI-03.6 + SI-03.7 (fila e upload já aberto)
                ├── SI-03.9 — depends on SI-03.7 (controller de início de upload)
                │   └── SI-03.10 — depends on SI-03.8 + SI-03.9
                │       └── SI-03.11 — depends on SI-03.8 + SI-03.10
                └── SI-03.18 — depends on SI-03.8 + SI-03.17 (consome o job da conclusão)
SI-03.4 (root, independente — entidade Video e migration)
SI-03.5 (root, independente — gerador de public_id)
SI-03.6 (root, independente — fila pg-boss)
SI-03.16 — depends on SI-03.3 + SI-03.6 (worker importa storage e fila)
├── SI-03.17 — depends on SI-03.16 (FFmpeg instalado na imagem)
│   └── SI-03.18 — depends on SI-03.8 + SI-03.17
└── SI-03.19 — depends on SI-03.16 (reaper roda no worker)

---

## Deliverables

- [ ] SI-03.1 — Infra: serviço de object storage no Compose
- [ ] SI-03.2 — Infra: cliente S3 e configuração de storage
- [ ] SI-03.3 — Criar StorageService (adaptador S3)
- [ ] SI-03.4 — Criar entidade Video e migration
- [ ] SI-03.5 — Gerar identificador público do vídeo
- [ ] SI-03.6 — Infra: fila de processamento com pg-boss
- [ ] SI-03.7 — Pré-cadastrar vídeo e iniciar o upload
- [ ] SI-03.8 — Assinar partes e concluir upload com enfileiramento transacional
- [ ] SI-03.9 — Endpoint POST /videos
- [ ] SI-03.10 — Endpoint POST /videos/:publicId/upload/part-urls
- [ ] SI-03.11 — Endpoint POST /videos/:publicId/upload/complete
- [ ] SI-03.12 — Consultar vídeo, resolver acesso e URLs de reprodução
- [ ] SI-03.13 — Endpoint GET /videos/:publicId
- [ ] SI-03.14 — Endpoint GET /videos/:publicId/stream
- [ ] SI-03.15 — Endpoint GET /videos/:publicId/download
- [ ] SI-03.16 — Infra: worker como segundo entrypoint e serviço do Compose
- [ ] SI-03.17 — Criar FfmpegService (probe e thumbnail)
- [ ] SI-03.18 — Processar vídeo enviado (handler de video.process)
- [ ] SI-03.19 — Reaper de uploads abandonados

**Full test suites:**

- [ ] Backend tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`docker compose exec nestjs-api npm run lint`)
