---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.6
target_file: test/videos-uploads-renew-abort.e2e-spec.ts
---

# POST /videos/:id/uploads/parts e DELETE /videos/:id/uploads — Test Plan

## Application Overview

Duas rotas owner-only sobre um vídeo em `DRAFT`: `POST /videos/:id/uploads/parts` renova URLs pré-assinadas de partes (upload retomado ou URLs expiradas), validando que cada `part_number` está dentro do `part_count` derivado do plano de partes; `DELETE /videos/:id/uploads` aborta o multipart no storage e remove a linha `DRAFT`. Ambas aplicam a regra de ownership "404, nunca 403" (vídeo de outro usuário é indistinguível de um id inexistente) e recusam vídeos fora de `DRAFT` com `409 VIDEO_NOT_IN_DRAFT`. `:id` é sempre o `public_id`.

## Test Scenarios

### 1. Renovar URLs de parte e abortar upload em rascunho

**Setup:** `beforeAll` cria o app via `Test.createTestingModule({ imports: [AppModule] }).compile()` reproduzindo a config global do `main.ts` (`ValidationPipe`, `ValidationExceptionFilter`, `DomainExceptionFilter`); `beforeEach` roda `cleanAllTables`, cria dois usuários confirmados com channel (owner e outro) com seus `access_token`s, e o owner cria um `DRAFT` via `POST /videos/uploads` (`size_bytes` ≈ 12 MiB → 3 partes); bucket `streamtube-test`; `afterAll(() => app.close())`.

#### 1.1. renovar-partes-owner-draft-retorna-urls

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. POST /videos/:id/uploads/parts como owner com `{ part_numbers: [1, 2] }`
    - expect: status `200`
    - expect: `parts` com dois itens (`part_number` 1 e 2), cada um com `url` não vazia
    - expect: `expires_at` é um ISO-8601 ~6h no futuro

#### 1.2. renovar-partes-fora-do-intervalo-retorna-invalid-upload-parts

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. POST /videos/:id/uploads/parts como owner com `{ part_numbers: [<part_count + 1>] }`
    - expect: status `400` com `error: "INVALID_UPLOAD_PARTS"`

#### 1.3. nao-owner-recebe-404-identico-a-inexistente

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. POST /videos/:id/uploads/parts com o token do outro usuário e `{ part_numbers: [1] }`
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
  2. DELETE /videos/:id/uploads com o token do outro usuário
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
    - expect: a linha `DRAFT` continua existindo em `videos`
  3. POST /videos/:id/uploads/parts como owner com um `public_id` inexistente (bem formado)
    - expect: status `404` com body (`statusCode`, `error`, `message`) idêntico ao do passo 1

#### 1.4. abortar-upload-owner-remove-rascunho

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. DELETE /videos/:id/uploads como owner
    - expect: status `204` sem body
    - expect: a linha do vídeo não existe mais em `videos`
  2. DELETE /videos/:id/uploads como owner com o mesmo id
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`

#### 1.5. rotas-recusam-video-fora-de-draft

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. Atualizar via `DataSource` o vídeo do owner para `status = 'PROCESSING'`
  2. POST /videos/:id/uploads/parts como owner com `{ part_numbers: [1] }`
    - expect: status `409` com `error: "VIDEO_NOT_IN_DRAFT"`
  3. DELETE /videos/:id/uploads como owner
    - expect: status `409` com `error: "VIDEO_NOT_IN_DRAFT"`
    - expect: a linha continua em `videos` com `status = 'PROCESSING'`

#### 1.6. rotas-sem-token-retornam-401

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. POST /videos/:id/uploads/parts sem header `Authorization`, com `{ part_numbers: [1] }`
    - expect: status `401`
  2. DELETE /videos/:id/uploads sem header `Authorization`
    - expect: status `401`
