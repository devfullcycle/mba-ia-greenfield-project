---
subproject: backend
runner: jest+supertest
scope: phase-03-upload-processing
si: SI-03.11
target_file: nestjs-project/test/videos-complete-upload.e2e-spec.ts
---

# POST /videos/:publicId/upload/complete Test Plan

## Application Overview

Conclui o multipart upload e enfileira o processamento (`video.process`) na mesma transação, respondendo 202.

## Test Scenarios

### 1. Conclusão de upload

**Setup:** `beforeEach` limpa as tabelas; sobe `AppModule` com pipes e filtros globais; cria dono e outro usuário com canal; inicia o upload, assina as partes e envia uma parte real ao storage para obter o `ETag`.

#### 1.1. owner-completes-upload

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. POST /videos/:publicId/upload/complete como dono com a lista de partes `{ part_number, etag }`
    - expect: status 202
    - expect: body com `public_id` e `status`
    - expect: um job `video.process` com o `videoId` existe na fila

#### 1.2. other-user-is-forbidden

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. POST /videos/:publicId/upload/complete autenticado como outro usuário
    - expect: status 403
    - expect: body com `error: "VIDEO_FORBIDDEN"`

#### 1.3. second-complete-conflicts

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. POST /videos/:publicId/upload/complete como dono (sucesso)
  2. POST /videos/:publicId/upload/complete novamente
    - expect: status 409
    - expect: body com `error: "UPLOAD_ALREADY_COMPLETED"`

#### 1.4. rejected-parts-list-is-incomplete

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. POST /videos/:publicId/upload/complete como dono com `etag` que o storage não reconhece
    - expect: status 400
    - expect: body com `error: "UPLOAD_INCOMPLETE"`

#### 1.5. missing-parts-fails-validation

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. POST /videos/:publicId/upload/complete como dono sem `parts`
    - expect: status 400
    - expect: body no formato de erro de validação
