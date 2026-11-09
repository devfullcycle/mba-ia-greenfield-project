---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.10
target_file: test/videos-metadata.e2e-spec.ts
---

# GET /videos/:id — Test Plan

## Application Overview

`GET /videos/:id` expõe os metadados do vídeo pela URL única (`public_id`). É uma rota pública com autenticação opcional (`@OptionalAuth()`): token ausente ou inválido é tratado como anônimo (nunca `401`), token válido identifica o viewer. A matriz de visibilidade é "owner vê qualquer status; demais só `READY`; oculto é `404 VIDEO_NOT_FOUND`, idêntico a inexistente". URLs de mídia (`stream_url`, `download_url`, `thumbnail_url`) só aparecem quando `READY`; o UUID interno, `storage_key` e `upload_id` nunca são serializados. A rota é isenta do throttler global.

## Test Scenarios

### 1. Consultar metadados do vídeo com autenticação opcional

**Setup:** `beforeAll` cria o app via `Test.createTestingModule({ imports: [AppModule] }).compile()` reproduzindo a config global do `main.ts` (`ValidationPipe`, `ValidationExceptionFilter`, `DomainExceptionFilter`); `beforeEach` roda `cleanAllTables`, cria dois usuários confirmados com channel (owner e outro) com seus `access_token`s, e semeia via `DataSource` vídeos do owner em `READY` (com `duration_seconds`, `width`, `height`, `codec`, `thumbnail_key`), `DRAFT`, `PROCESSING` e `ERROR` (`seq` via `reserveSeq()` + `public_id` via `VideoPublicIdService.encode`); `afterAll(() => app.close())`.

#### 1.1. anonimo-ve-video-ready-com-urls-de-midia

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. GET /videos/:id (vídeo `READY`) sem header `Authorization`
    - expect: status `200`
    - expect: `duration_seconds`, `width`, `height` e `codec` preenchidos
    - expect: `stream_url = /videos/{id}/stream`, `download_url = /videos/{id}/download`, `thumbnail_url = /videos/{id}/thumbnail`

#### 1.2. video-oculto-retorna-404-para-anonimo-e-nao-owner

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. Para cada vídeo `DRAFT`, `PROCESSING` e `ERROR`: GET /videos/:id sem token
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
  2. Para cada vídeo `DRAFT`, `PROCESSING` e `ERROR`: GET /videos/:id com o token do outro usuário
    - expect: status `404` com `error: "VIDEO_NOT_FOUND"`
  3. GET /videos/:id com um `public_id` inexistente (bem formado)
    - expect: status `404` com body (`statusCode`, `error`, `message`) idêntico ao dos passos 1 e 2

#### 1.3. owner-ve-video-processing-sem-urls

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. GET /videos/:id (vídeo `PROCESSING`) com o token do owner
    - expect: status `200` com `status: "PROCESSING"`
    - expect: `stream_url`, `download_url` e `thumbnail_url` são `null`

#### 1.4. token-invalido-tratado-como-anonimo

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. GET /videos/:id (vídeo `READY`) com `Authorization: Bearer invalido`
    - expect: status `200` (sem `401`)
    - expect: body com `status: "READY"`

#### 1.5. resposta-nao-expoe-campos-internos

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. GET /videos/:id (vídeo `READY`) sem token e GET /videos/:id (vídeo `PROCESSING`) como owner
    - expect: `id` igual ao `public_id`, diferente do UUID interno
    - expect: o body serializado (`JSON.stringify`) não contém o UUID interno, nem as chaves `storage_key`, `upload_id`, `seq` ou `thumbnail_key`

#### 1.6. leitura-anonima-isenta-do-throttler

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. Disparar 20 chamadas anônimas e sequenciais a GET /videos/:id (vídeo `READY`)
    - expect: todas retornam `200`; nenhuma retorna `429`
