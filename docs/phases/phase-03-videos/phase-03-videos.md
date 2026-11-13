# Phase 03 — Upload e Processamento de Vídeos

## Objective

Entregar upload multipart de vídeos de até 10 GB, processamento assíncrono com storage MinIO, fila BullMQ/Redis, worker FFmpeg/ffprobe, thumbnail, URL única, streaming parcial e download no backend.

---

## Step Implementations

### SI-03.1 — Infraestrutura de storage, fila e worker

**Description:** Adicionar MinIO e Redis ao Compose e preparar as configurações NestJS para storage, fila e processamento.

**Technical actions:**

- Instalar `@nestjs/bullmq@^11.0.5`, `bullmq@^5.81.5`, `minio@^8.0.7` e tipos necessários, mantendo compatibilidade com NestJS 11.
- Criar namespaces de configuração para MinIO, Redis, vídeo e worker, com validação Joi e valores Docker compatíveis.
- Adicionar serviços `minio`, `redis` e `video-worker` ao Compose; o worker deve usar a mesma rede e imagem/base com FFmpeg e ffprobe.
- Configurar healthchecks, buckets e variáveis sem credenciais reais no repositório; atualizar `.env.example`.
- Criar entrypoint do worker que inicializa apenas o consumidor BullMQ, sem iniciar o servidor HTTP.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/config/video.config.spec.ts` | Unit | Defaults, parsing e validação das configurações de storage, fila e worker |
| `test/video-infrastructure.e2e-spec.ts` | E2E | Serviços necessários estão acessíveis e o worker pode conectar à fila/storage |

**Dependencies:** None

**Acceptance criteria:**

- `docker compose up -d` inicia PostgreSQL, Mailpit, MinIO, Redis, API e worker sem erro de configuração.
- MinIO responde na console/API local e Redis aceita conexão na rede do Compose.
- O worker inicia sem abrir uma porta HTTP e permanece consumindo a fila.
- A aplicação rejeita configuração inválida de storage/fila durante o bootstrap.

---

### SI-03.2 — Entidade Video e migration

**Description:** Criar a entidade de vídeo associada ao canal, estados do ciclo de vida, chaves de storage e metadados processados.

**Technical actions:**

- Criar `Video` com UUID, `channel_id`, título opcional, status, `storage_key`, `thumbnail_key`, tamanho, MIME type, duração, metadados JSONB, erro, timestamps e identificadores de multipart.
- Criar enum persistido para `DRAFT`, `UPLOADING`, `UPLOADED`, `PROCESSING`, `READY`, `ERROR` e `CANCELLED`.
- Definir relação many-to-one com `Channel`, índices para UUID público, canal/status e storage key, e constraints de integridade.
- Gerar e revisar migration sem `synchronize`, incluindo FK e índices.
- Registrar entidade e módulo `VideosModule` no `AppModule`.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/entities/video.entity.integration-spec.ts` | Integration | Defaults, estados, FK com canal, nullable fields e índices/constraints |
| `src/database/migrations.integration-spec.ts` | Integration | Migration cria a tabela `videos` e reverte corretamente |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- Migration cria `videos` com FK para `channels` e estados válidos.
- Um vídeo novo recebe UUID e status `DRAFT`.
- Um vídeo não pode apontar para canal inexistente.
- Chaves de storage e dados de processamento podem permanecer nulos antes do upload.

---

### SI-03.3 — Serviço de object storage e multipart

**Description:** Encapsular MinIO/S3 e implementar criação, assinatura, conclusão, aborto e leitura parcial de multipart uploads.

**Technical actions:**

- Criar interface/provider de storage para manter a API independente do cliente MinIO.
- Implementar criação de multipart upload, URLs pré-assinadas por parte, conclusão e aborto com chaves derivadas do UUID.
- Implementar `statObject`, `getObject` por intervalo e upload de thumbnail.
- Configurar limites de partes, tamanho mínimo, expiração e validação de MIME/type sem carregar o objeto inteiro em memória.
- Cobrir erros de storage com exceções de domínio e garantir que secrets não apareçam em logs ou respostas.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/storage/storage.service.spec.ts` | Unit | Chaves, assinatura, validação de partes e mapeamento de erros |
| `src/videos/storage/storage.service.integration-spec.ts` | Integration | Multipart, conclusão, abort, stat e leitura parcial contra MinIO real |

**Dependencies:** SI-03.1, SI-03.2

**Acceptance criteria:**

- A API gera URLs pré-assinadas sem receber o conteúdo do vídeo.
- Upload multipart pode ser concluído e abortado no MinIO.
- Uma leitura parcial retorna somente o intervalo solicitado.
- Falhas do MinIO produzem erro de domínio sem expor credenciais.

---

### SI-03.4 — Criação de vídeo e início do upload

**Description:** Criar o pré-cadastro e os endpoints que iniciam e continuam um upload multipart autenticado pelo dono do canal.

**Technical actions:**

- Criar DTOs para pré-cadastro, início, assinatura de partes e cancelamento, com whitelist e validações globais.
- Implementar `VideosService` com criação transacional do vídeo e do multipart, status `DRAFT`/`UPLOADING` e autorização pelo canal do usuário autenticado.
- Criar endpoints para criar vídeo, iniciar upload e obter URLs pré-assinadas por parte.
- Garantir idempotência por `video_id`/`upload_id` e rejeitar operações em status incompatível.
- Retornar UUID público e dados necessários ao cliente sem devolver secrets de storage.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | Ownership, transitions, idempotency e criação do multipart |
| `test/videos-upload.e2e-spec.ts` | E2E | Criação, início, presigned parts, validação e respostas de autorização |

**Dependencies:** SI-03.2, SI-03.3

**Acceptance criteria:**

- `POST /videos` retorna `201` com UUID e status `DRAFT`.
- `POST /videos/:id/upload` muda o vídeo para `UPLOADING` e retorna upload ID.
- `POST /videos/:id/upload/parts` retorna URLs pré-assinadas sem receber o arquivo.
- Usuário de outro canal recebe `403` e não obtém URLs de upload.
- Repetição idempotente não cria múltiplos vídeos ou multipart uploads.

---

### SI-03.5 — Conclusão do upload e publicação do job

**Description:** Confirmar o multipart, atualizar o estado e publicar um job de processamento na fila.

**Technical actions:**

- Criar endpoint de conclusão com lista validada de partes e ETag.
- Verificar o objeto no storage antes de marcar `UPLOADED`.
- Publicar job `video.process` com UUID, storage key, channel ID e tentativa inicial.
- Tornar a conclusão idempotente e impedir publicação duplicada para o mesmo upload.
- Adicionar eventos/mensagens e política de retry/backoff do job.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/processing/video.queue.spec.ts` | Unit | Payload, retry, idempotência e transição para `UPLOADED` |
| `test/videos-processing.e2e-spec.ts` | E2E | Conclusão retorna `202` e o job fica disponível para o worker |

**Dependencies:** SI-03.4

**Acceptance criteria:**

- `POST /videos/:id/upload/complete` retorna `202` e status `UPLOADED`.
- Uma conclusão válida publica exatamente um job de processamento.
- Partes ausentes ou ETags inválidos retornam `400` sem enfileirar o job.
- Repetir a conclusão não duplica o job.

---

### SI-03.6 — Worker de processamento, metadados e thumbnail

**Description:** Implementar o consumidor BullMQ que processa o vídeo fora da API e persiste o resultado.

**Technical actions:**

- Criar processor do job `video.process` com transição atômica `UPLOADED → PROCESSING`.
- Baixar o objeto para diretório temporário controlado, executar `ffprobe`, extrair duração/metadados e gerar thumbnail com FFmpeg.
- Fazer upload da thumbnail, persistir metadados e mudar para `READY`.
- Em falha, registrar erro sanitizado, mudar para `ERROR` e aplicar retries limitados sem processar vídeo cancelado.
- Remover arquivos temporários em sucesso e falha; tornar reprocessamento seguro e idempotente.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/processing/video.processor.spec.ts` | Unit | Transições, comandos, retries, limpeza e falhas |
| `src/videos/processing/video.processor.integration-spec.ts` | Integration | Worker real com Redis/MinIO e fixture de vídeo pequena |
| `test/videos-worker.e2e-spec.ts` | E2E | Upload concluído chega a `READY` com duração, metadados e thumbnail |

**Dependencies:** SI-03.5

**Acceptance criteria:**

- Job válido muda o vídeo para `PROCESSING` e depois `READY`.
- Duração/metadados são persistidos e a thumbnail existe no MinIO.
- Falha de FFmpeg/ffprobe produz `ERROR` sem deixar arquivo temporário.
- Retry não cria thumbnails duplicadas nem corrompe o estado.
- O processamento ocorre no worker, não no processo HTTP da API.

---

### SI-03.7 — Streaming e download

**Description:** Expor reprodução parcial e download do vídeo pronto com autorização e contrato HTTP correto.

**Technical actions:**

- Criar endpoints públicos de streaming/download por UUID, respeitando apenas vídeos `READY`.
- Parsear e validar `Range`, obter intervalo no storage e responder `206` com `Content-Range`, `Accept-Ranges`, `Content-Length` e `Content-Type`.
- Responder `416` para intervalos inválidos e `404`/erro de domínio para vídeo inexistente ou não pronto.
- Implementar download com `Content-Disposition: attachment` sem carregar o objeto inteiro em memória.
- Cobrir acesso anônimo somente para vídeos prontos e preservar o guard global para endpoints de gerenciamento.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/streaming/range.util.spec.ts` | Unit | Parsing, normalização e rejeição de ranges |
| `test/videos-streaming.e2e-spec.ts` | E2E | `200`, `206`, `416`, download, vídeo não pronto e headers |

**Dependencies:** SI-03.6

**Acceptance criteria:**

- `GET /videos/:id/stream` sem `Range` retorna o vídeo pronto com headers corretos.
- `GET /videos/:id/stream` com `Range` retorna `206 Partial Content` e somente o intervalo solicitado.
- Range inválido retorna `416 Range Not Satisfiable`.
- `GET /videos/:id/download` retorna `Content-Disposition: attachment`.
- Vídeo em `DRAFT`, `PROCESSING` ou `ERROR` não é reproduzido nem baixado como pronto.

---

### SI-03.8 — Validação final e documentação operacional

**Description:** Consolidar testes, documentação da arquitetura de vídeos e o progresso da fase.

**Technical actions:**

- Atualizar `CLAUDE.md` e `nestjs-project/CLAUDE.md` com módulos, endpoints, storage, fila e worker existentes.
- Atualizar o diagrama de arquitetura se os nomes finais de serviços diferirem do documento atual.
- Criar `progress.md` com cada SI, testes e observações verificáveis.
- Executar suíte completa, E2E, type-check, build e lint em ambiente Docker.
- Revisar diff, segredos, `git diff --check` e coerência entre artefatos e código.

**Dependencies:** SI-03.7

**Acceptance criteria:**

- `npm test` e `npm run test:e2e` passam em Compose.
- `npx tsc --noEmit` e `npm run lint` retornam código 0.
- `npm run build` passa e inclui o worker/artefatos necessários.
- `progress.md` marca somente SIs realmente validados como concluídos.
- A documentação não cita arquivos, serviços ou endpoints inexistentes.

---

## Technical Specifications

### Data Model

#### Video

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK, generated | Identificador público único |
| channel_id | uuid | FK `channels.id`, not null | Dono do vídeo |
| title | varchar(200) | nullable | Pode ser definido na criação |
| status | enum | not null | `DRAFT`, `UPLOADING`, `UPLOADED`, `PROCESSING`, `READY`, `ERROR`, `CANCELLED` |
| storage_key | varchar(500) | nullable, unique | Objeto fonte |
| thumbnail_key | varchar(500) | nullable | Thumbnail processada |
| upload_id | varchar(255) | nullable, unique | Multipart no storage |
| mime_type | varchar(100) | nullable | Tipo validado |
| file_size | bigint | nullable | Tamanho confirmado |
| duration_seconds | numeric | nullable | Extraído pelo ffprobe |
| metadata | jsonb | nullable | Metadados sanitizados |
| processing_error | text | nullable | Erro sanitizado, sem secrets |
| created_at | timestamp | not null | |
| updated_at | timestamp | not null | |

**Relations:** `Video` many-to-one `Channel`; o canal é o dono do vídeo.
**Indexes:** `(channel_id, status)`, `(status)`, `(storage_key)` unique, `(upload_id)` unique.

### API Contracts

#### POST `/videos` (SI-03.4)

Authenticated JSON: `title?`, `mime_type`, `file_size`.

Response `201`: `{ id, status, upload_id? }`.

Errors: `400` validation; `403` channel ownership; `409` conflicting upload.

#### POST `/videos/:id/upload` (SI-03.4)

Authenticated JSON: `part_size`, `total_parts`.

Response `200`: `{ video_id, upload_id, status }`.

#### POST `/videos/:id/upload/parts` (SI-03.4)

Authenticated JSON: `part_numbers[]`.

Response `200`: `{ parts: [{ part_number, url, expires_at }] }`.

#### POST `/videos/:id/upload/complete` (SI-03.5)

Authenticated JSON: `parts[]` com `part_number` e `etag`.

Response `200`: `{ id, status: "PROCESSING", queued: true }`; if queue publication fails, `{ id, status: "UPLOADED", queued: false, queue_error }`.

#### POST `/videos/:id/upload/cancel` (SI-03.4)

Authenticated; response `204`, status `CANCELLED`.

#### GET `/videos/:id/stream` (SI-03.7)

Public para vídeos `READY`; aceita `Range: bytes=start-end`.

Response `200` ou `206`; `416` para range inválido; `404` para ID inexistente; `409` para vídeo não pronto.

#### GET `/videos/:id/download` (SI-03.7)

Public para vídeos `READY`; responde conteúdo com `Content-Disposition: attachment`.

### Authorization Matrix

| Endpoint | Public | Authenticated | Role |
|---|---:|---:|---|
| `POST /videos` |  | ✓ | Dono do canal |
| `POST /videos/:id/upload` |  | ✓ | Dono do vídeo |
| `POST /videos/:id/upload/parts` |  | ✓ | Dono do vídeo |
| `POST /videos/:id/upload/complete` |  | ✓ | Dono do vídeo |
| `POST /videos/:id/upload/cancel` |  | ✓ | Dono do vídeo |
| `GET /videos/:id/stream` | ✓ |  | Somente `READY` |
| `GET /videos/:id/download` | ✓ |  | Somente `READY` |

### Error Catalog

| Code | HTTP | Message | Trigger |
|---|---:|---|---|
| `VIDEO_NOT_FOUND` | 404 | Video not found | UUID inexistente |
| `VIDEO_NOT_READY` | 409 | Video is not ready | Tentativa de stream/download antes de `READY` |
| `VIDEO_UPLOAD_CONFLICT` | 409 | Video upload is already in progress | Multipart incompatível ou duplicado |
| `VIDEO_UPLOAD_INVALID` | 400 | Invalid video upload | Partes, ETags ou tamanho inválidos |
| `VIDEO_UPLOAD_FORBIDDEN` | 403 | You do not own this video | Usuário não é dono do canal |
| `VIDEO_PROCESSING_FAILED` | 422 | Video processing failed | Worker não consegue processar a mídia |
| `VIDEO_RANGE_INVALID` | 416 | Requested range is not satisfiable | Range fora do tamanho do objeto |

### Events/Messages

| Event | Payload | Publisher | Consumer | Delivery |
|---|---|---|---|---|
| `video.process` | `{ videoId, channelId, storageKey, attempt }` | `VideosService` | `VideoProcessor` | acknowledged job with retry/backoff |
| `video.processing.failed` | `{ videoId, attempt, errorCode }` | `VideoProcessor` | persistence/observability | acknowledged |

## Dependency Map

```text
SI-03.1
└── SI-03.2
    └── SI-03.3
        └── SI-03.4
            └── SI-03.5
                └── SI-03.6
                    └── SI-03.7
                        └── SI-03.8
```

## Deliverables

- [ ] MinIO, Redis e worker sobem via Docker Compose.
- [ ] Entidade `Video` e migration ligadas ao canal.
- [ ] Upload multipart direto ao storage com pré-cadastro.
- [ ] Fila BullMQ e worker separado com FFmpeg/ffprobe.
- [ ] Metadados e thumbnail persistidos após processamento.
- [ ] UUID público e estados completos do ciclo de vida.
- [ ] Streaming `Range`/`206` e download funcionais.
- [ ] Testes unitários, integração e E2E aprovados.
- [ ] `npm test` passa em Compose.
- [ ] `npm run test:e2e` passa em Compose.
- [ ] `npx tsc --noEmit` retorna código 0.
- [ ] `npm run lint` retorna código 0.
- [ ] `npm run build` passa.
- [ ] `progress.md` e `CLAUDE.md` atualizados com o estado real.
