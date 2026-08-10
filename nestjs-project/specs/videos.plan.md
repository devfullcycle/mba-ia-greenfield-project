---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5, SI-03.7
target_file: nestjs-project/test/videos.e2e-spec.ts
---

# Videos Test Plan

## Application Overview

Covers the `/videos` resource end-to-end: creating a draft video and completing a
multipart upload (`POST /videos`, `POST /videos/:id/upload-complete` — SI-03.5), and
retrieving video metadata/stream/download URLs (`GET /videos/:slug`,
`GET /videos/:slug/stream-url`, `GET /videos/:slug/download-url` — SI-03.7). Video
creation requires an authenticated user who owns a channel; retrieval of playable
URLs depends on the video's processing `status` (draft/processing/ready/error).

## Test Scenarios

### 1. Criar rascunho e concluir upload (SI-03.5)

**Setup:** `beforeEach` truncates test tables via `cleanAllTables(dataSource)`; app
bootstrapped via `Test.createTestingModule({ imports: [AppModule] }).compile()`
reproducing `main.ts` global config manually (`ValidationPipe({ whitelist: true,
forbidNonWhitelisted: true, transform: true })`, `DomainExceptionFilter`,
`ValidationExceptionFilter`); reuse the `registerConfirmAndLogin(email, password)`
helper from `test/auth.e2e-spec.ts` (register → capture confirmation token → confirm
→ login) — it returns `{ access_token, refresh_token }` and always creates a channel
for the user (`UsersService.createUserWithChannel`).

#### 1.1. rejects-create-without-authentication

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-12T21:05:11Z

**Steps:**
  1. POST /videos sem header `Authorization`, com body `{title, file_name, file_size, content_type}` válido
    - expect: HTTP 401

#### 1.2. rejects-create-without-channel

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-07-12T21:05:11Z

**Steps:**
  1. `registerConfirmAndLogin('no-channel@example.com')`; em seguida remove o canal criado automaticamente via `ChannelsRepository.delete({ user_id: user.id })` (acesso direto ao repositório do módulo de teste) para simular usuário sem canal
    - expect: canal removido do banco
  2. POST /videos com `Authorization: Bearer <access_token>` e body válido
    - expect: HTTP 403
    - expect: `body.errorCode === "CHANNEL_REQUIRED"`

#### 1.3. rejects-invalid-file-size

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-07-12T21:05:11Z

**Steps:**
  1. `registerConfirmAndLogin('big-file@example.com')` (canal criado automaticamente)
  2. POST /videos com `Authorization` válido e `file_size = 10_737_418_240 + 1` (acima do limite de 10GB)
    - expect: HTTP 400

#### 1.4. creates-draft-and-returns-multipart-urls

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-07-12T21:05:11Z

**Steps:**
  1. `registerConfirmAndLogin('creator@example.com')`
  2. POST /videos com `Authorization` válido e body `{title: 'My Video', file_name: 'video.mp4', file_size: 250_000_000, content_type: 'video/mp4'}`
    - expect: HTTP 201
    - expect: `body.id` é um uuid válido
    - expect: `body.slug` tem 11 caracteres (base64url)
    - expect: `body.parts` é um array não-vazio
    - expect: `body.part_size === 100_000_000`

#### 1.5. rejects-upload-complete-wrong-owner

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-07-12T21:05:11Z

**Steps:**
  1. `registerConfirmAndLogin('owner-a@example.com')`; POST /videos com body válido → captura `id` do draft
  2. `registerConfirmAndLogin('owner-b@example.com')` (usuário distinto)
  3. POST /videos/:id/upload-complete usando o `id` do draft do usuário A, mas `Authorization` do usuário B, body `{parts: [{part_number: 1, etag: 'abc'}]}`
    - expect: HTTP 403
    - expect: `body.errorCode === "VIDEO_ACCESS_DENIED"`

#### 1.6. rejects-upload-complete-invalid-status

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-07-12T21:05:11Z

**Steps:**
  1. `registerConfirmAndLogin('bad-status@example.com')`; POST /videos com body válido → captura `id`
  2. Atualiza diretamente o `status` do vídeo no banco para `'processing'` via `VideoRepository` (bypass da API)
  3. POST /videos/:id/upload-complete com `Authorization` do proprietário e body de `parts` válido
    - expect: HTTP 409
    - expect: `body.errorCode === "VIDEO_INVALID_STATUS"`

#### 1.7. completes-upload-and-publishes-job

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-07-12T21:05:11Z

**Steps:**
  1. `registerConfirmAndLogin('completer@example.com')`; POST /videos com body válido → captura `id` e `parts`
  2. POST /videos/:id/upload-complete com `Authorization` do proprietário e body `{parts: [{part_number: 1, etag: 'etag-1'}]}` correspondendo às parts retornadas
    - expect: HTTP 204
  3. Consulta o vídeo no banco via `VideoRepository`
    - expect: `video.status === 'processing'`
  4. Consulta a fila `video-processing` (via `getQueueToken('video-processing')` injetado no módulo de teste, `queue.getJobs(['waiting', 'active', 'completed'])`)
    - expect: existe um job com nome `'process-video'` e `payload.videoId === id`

---

### 2. Endpoints de recuperação (streaming e download) (SI-03.7)

**Setup:** mesmo bootstrap de app e truncamento de `beforeEach` da seção 1; vídeos são
persistidos diretamente via `VideoRepository` (bypass do fluxo de upload) associados
a um canal existente, com o `status` necessário para cada cenário (`draft`,
`processing`, `ready`).

#### 2.1. returns-404-for-unknown-slug

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-12T21:05:11Z

**Steps:**
  1. GET /videos/slug-inexistente (nenhum vídeo criado com esse slug)
    - expect: HTTP 404
    - expect: `body.errorCode === "VIDEO_NOT_FOUND"`

#### 2.2. returns-draft-video-with-null-thumbnail

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-07-12T21:05:11Z

**Steps:**
  1. `registerConfirmAndLogin('draft-owner@example.com')`; cria vídeo via `VideoRepository` com `status: 'draft'` e `thumbnail_key: null` associado ao canal do usuário
  2. GET /videos/:slug (sem `Authorization` — endpoint público)
    - expect: HTTP 200
    - expect: `body.status === "draft"`
    - expect: `body.thumbnail_url === null`

#### 2.3. rejects-stream-url-when-not-ready

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-07-12T21:05:11Z

**Steps:**
  1. Cria vídeo via `VideoRepository` com `status: 'processing'`
  2. GET /videos/:slug/stream-url
    - expect: HTTP 409
    - expect: `body.errorCode === "VIDEO_NOT_READY"`

#### 2.4. returns-stream-url-for-ready-video

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-07-12T21:05:11Z

**Steps:**
  1. Cria vídeo via `VideoRepository` com `status: 'ready'`
  2. GET /videos/:slug/stream-url
    - expect: HTTP 200
    - expect: `body.url` é uma string não-vazia
    - expect: `body.expires_at` é uma string ISO-8601 válida

#### 2.5. rejects-unauthenticated-download-url

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-07-12T21:05:11Z

**Steps:**
  1. Cria vídeo via `VideoRepository` com `status: 'ready'`
  2. GET /videos/:slug/download-url sem header `Authorization`
    - expect: HTTP 401

#### 2.6. returns-download-url-with-content-disposition

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-07-12T21:05:11Z

**Steps:**
  1. `registerConfirmAndLogin('downloader@example.com')`; cria vídeo via `VideoRepository` com `status: 'ready'` associado ao canal do usuário autenticado
  2. GET /videos/:slug/download-url com `Authorization: Bearer <access_token>`
    - expect: HTTP 200
    - expect: `body.url` contém o parâmetro de presign que instrui `Content-Disposition: attachment` (e.g. `response-content-disposition=attachment...` na query string)
