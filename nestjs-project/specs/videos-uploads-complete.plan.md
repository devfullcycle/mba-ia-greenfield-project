---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.7
target_file: test/videos-uploads-complete.e2e-spec.ts
---

# POST /videos/:id/uploads/complete — Test Plan

## Application Overview

`POST /videos/:id/uploads/complete` finaliza o multipart com a lista de `{ part_number, etag }` enviada pelo cliente, grava `status = 'PROCESSING'` e confirma a transação **antes** de enfileirar o job `process-video` (`jobId` = UUID do vídeo) na fila `video-processing`. Responde `202 { id, status: "PROCESSING" }` mesmo quando o enqueue falha (Redis indisponível) — o banco é a fonte da verdade e o reconciler re-enfileira depois. ETags rejeitados pelo storage viram `400 INVALID_UPLOAD_PARTS` sem alterar o status; vídeos fora de `DRAFT` recebem `409`.

## Test Scenarios

### 1. Finalizar upload multipart e enfileirar processamento

**Setup:** `beforeAll` cria o app via `Test.createTestingModule({ imports: [AppModule] }).compile()` reproduzindo a config global do `main.ts` (`ValidationPipe`, `ValidationExceptionFilter`, `DomainExceptionFilter`); `beforeEach` roda `cleanAllTables`, faz `obliterate` da fila `video-processing` (prefixo `streamtube-test`), cria um usuário confirmado com channel, inicia um `DRAFT` via `POST /videos/uploads` com `size_bytes` ≤ 5 MiB (1 parte) e faz `PUT` real do chunk na URL pré-assinada, guardando o `ETag`; bucket `streamtube-test`; `afterAll(() => app.close())`.

#### 1.1. completar-upload-retorna-202-e-monta-objeto

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. POST /videos/:id/uploads/complete como owner com `{ parts: [{ part_number: 1, etag: <ETag do PUT> }] }`
    - expect: status `202` com body `{ id: <public_id>, status: "PROCESSING" }`
    - expect: `HeadObject` em `storage_key` (via `StorageService`) retorna `ContentLength` igual a `size_bytes`
    - expect: a linha em `videos` tem `status = 'PROCESSING'`

#### 1.2. completar-upload-enfileira-job-process-video

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. POST /videos/:id/uploads/complete como owner com os ETags corretos
    - expect: status `202`
  2. Consultar a fila `video-processing` via `queue.getJob(<UUID do vídeo>)`
    - expect: existe um job com `name = 'process-video'`, `id` igual ao UUID interno do vídeo e `data` igual a `{ videoId: <UUID> }`

#### 1.3. completar-upload-com-enqueue-falhando-ainda-retorna-202

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. Com o app montado via `overrideProvider(VideoProcessingQueue)` cujo `enqueue` rejeita (simula Redis indisponível; a parada real do Redis fica na verificação manual do SI-03.9), POST /videos/:id/uploads/complete como owner com os ETags corretos
    - expect: status `202` com `status: "PROCESSING"`
    - expect: a linha em `videos` fica `status = 'PROCESSING'`

#### 1.4. completar-upload-etag-incorreto-mantem-draft

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. POST /videos/:id/uploads/complete como owner com `{ parts: [{ part_number: 1, etag: "\"etag-invalido\"" }] }`
    - expect: status `400` com `error: "INVALID_UPLOAD_PARTS"`
    - expect: a linha em `videos` permanece `status = 'DRAFT'`
    - expect: nenhum job para o vídeo na fila `video-processing`

#### 1.5. completar-upload-repetido-retorna-409

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. POST /videos/:id/uploads/complete como owner com os ETags corretos
    - expect: status `202`
  2. Repetir POST /videos/:id/uploads/complete com o mesmo body
    - expect: status `409` com `error: "VIDEO_NOT_IN_DRAFT"`

#### 1.6. completar-upload-parts-vazio-retorna-validation-error

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. POST /videos/:id/uploads/complete como owner com `{ parts: [] }`
    - expect: status `400` com `error: "VALIDATION_ERROR"`
    - expect: a linha em `videos` permanece `status = 'DRAFT'`
