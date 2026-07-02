---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5, SI-03.6, SI-03.7, SI-03.10, SI-03.11, SI-03.12
target_file: nestjs-project/test/videos.e2e-spec.ts
---

# Videos Endpoints Test Plan

## Application Overview

Cobre o ciclo HTTP completo de upload e leitura de vídeos da Fase 03: pré-cadastro do vídeo (`POST /videos`), geração de URL pré-assinada por parte do multipart upload (`POST /videos/:id/upload-part-url`), finalização do upload (`POST /videos/:id/complete-upload`), e leitura de metadados/streaming/download (`GET /videos/:id`, `GET /videos/:id/stream`, `GET /videos/:id/download`). Os seis endpoints pertencem ao mesmo recurso (`videos`) e, seguindo a convenção já usada em `auth.e2e-spec.ts`, são exercitados em um único arquivo E2E por domínio, agrupados por SI abaixo.

## Test Scenarios

### 1. POST /videos (initiate upload) — SI-03.5

**Setup:** `beforeEach` trunca as tabelas `videos` e `channels`/`users` relevantes; bootstrap da aplicação via `Test.createTestingModule` com `AppModule` completo (guards/filtros globais reaplicados); cria um usuário autenticado com canal via helper de fixture (reuso do padrão de `auth.e2e-spec.ts`) e obtém o `access_token`.

#### 1.1. initiate-upload-success

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-01T19:53:49Z

**Steps:**
  1. `POST /videos` autenticado, com `Authorization: Bearer <access_token>` e body válido (`originalFileName`, `mimeType: "video/mp4"`, `sizeInBytes` dentro do limite)
    - expect: `201`
    - expect: corpo contém `id` (uuid), `status: "draft"`, `uploadId`
    - expect: um registro `Video` foi persistido no banco com `status: "draft"` e `channel_id` do usuário autenticado

#### 1.2. initiate-upload-requires-auth

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-07-01T19:53:49Z

**Steps:**
  1. `POST /videos` sem header `Authorization`, com o mesmo body válido de 1.1
    - expect: `401`

#### 1.3. initiate-upload-rejects-unsupported-mime-type

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-07-01T19:53:49Z

**Steps:**
  1. `POST /videos` autenticado com `mimeType: "application/pdf"` (fora do allowlist)
    - expect: `400`
    - expect: corpo contém `errorCode: "UNSUPPORTED_MEDIA_TYPE"`

#### 1.4. initiate-upload-rejects-oversized-file

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-07-01T19:53:49Z

**Steps:**
  1. `POST /videos` autenticado com `sizeInBytes` acima de `10737418240` (10GB)
    - expect: `400`
    - expect: corpo contém `errorCode: "FILE_TOO_LARGE"`

---

### 2. POST /videos/:id/upload-part-url — SI-03.6

**Setup:** mesmo bootstrap do Grupo 1; adicionalmente cria um `Video` em `status: "draft"` pertencente ao usuário autenticado (via fixture/repositório direto, sem passar pelo endpoint 1.1) e um segundo usuário/canal para o cenário de acesso cruzado.

#### 2.1. upload-part-url-owner-success

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-01T19:53:49Z

**Steps:**
  1. `POST /videos/:id/upload-part-url` autenticado como dono, com `partNumber: 1`
    - expect: `200`
    - expect: corpo contém `url` (string não vazia)

#### 2.2. upload-part-url-hides-other-owners-video

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-07-01T19:53:49Z

**Steps:**
  1. `POST /videos/:id/upload-part-url` autenticado como o segundo usuário (não-dono), mesmo `id` de vídeo
    - expect: `404`
    - expect: corpo contém `errorCode: "VIDEO_NOT_FOUND"`

#### 2.3. upload-part-url-rejects-invalid-part-number

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-07-01T19:53:49Z

**Steps:**
  1. `POST /videos/:id/upload-part-url` autenticado como dono, com `partNumber: 0`
    - expect: `400`
    - expect: corpo contém `errorCode: "UPLOAD_PART_INVALID"`

---

### 3. POST /videos/:id/complete-upload — SI-03.7

**Setup:** mesmo bootstrap do Grupo 2; vídeo fixture em `status: "draft"` com um `uploadId` de multipart real iniciado contra o MinIO do Compose (a parte é enviada via `PUT` direto à URL pré-assinada antes do teste chamar o endpoint).

#### 3.1. complete-upload-owner-success

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-01T19:53:49Z

**Steps:**
  1. `POST /videos/:id/complete-upload` autenticado como dono, com `parts` contendo o `partNumber`/`etag` da parte enviada
    - expect: `200`
    - expect: corpo contém `id`, `status: "uploaded"`
    - expect: exatamente um job `process-video` foi publicado na fila `video-processing` com `{ videoId: id }`

#### 3.2. complete-upload-rejects-double-completion

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-07-01T19:53:49Z

**Steps:**
  1. Repetir a chamada de 3.1 (`POST /videos/:id/complete-upload`) para o mesmo vídeo já `uploaded`
    - expect: `409`
    - expect: corpo contém `errorCode: "INVALID_VIDEO_STATUS_TRANSITION"`

#### 3.3. complete-upload-hides-other-owners-video

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-07-01T19:53:49Z

**Steps:**
  1. `POST /videos/:id/complete-upload` autenticado como o segundo usuário (não-dono)
    - expect: `404`
    - expect: corpo contém `errorCode: "VIDEO_NOT_FOUND"`

---

### 4. GET /videos/:id — SI-03.10

**Setup:** mesmo bootstrap do Grupo 1; cria três vídeos fixture pertencentes ao usuário autenticado: um em `status: "ready"`, um em `status: "processing"`, e usa o segundo usuário como requisitante não-dono/anônimo.

#### 4.1. get-video-anonymous-when-ready

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-01T19:53:49Z

**Steps:**
  1. `GET /videos/:id` sem header `Authorization`, para o vídeo em `status: "ready"`
    - expect: `200`
    - expect: corpo contém os metadados do vídeo (`id`, `title`, `status: "ready"`, `durationSeconds`)

#### 4.2. get-video-anonymous-hidden-when-not-ready

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-07-01T19:53:49Z

**Steps:**
  1. `GET /videos/:id` sem header `Authorization`, para o vídeo em `status: "processing"`
    - expect: `404`
    - expect: corpo contém `errorCode: "VIDEO_NOT_FOUND"`

#### 4.3. get-video-owner-any-status

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-07-01T19:53:49Z

**Steps:**
  1. `GET /videos/:id` autenticado como dono, para o vídeo em `status: "processing"`
    - expect: `200`
    - expect: corpo contém `status: "processing"`

---

### 5. GET /videos/:id/stream — SI-03.11

**Setup:** mesmo bootstrap do Grupo 4; o vídeo `ready` tem um objeto real no bucket do MinIO do Compose (fixture de vídeo pequeno já processado).

#### 5.1. stream-redirects-when-ready

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-01T19:53:49Z

**Steps:**
  1. `GET /videos/:id/stream` sem autenticação, para o vídeo `ready` (sem seguir redirect automaticamente)
    - expect: `302`
    - expect: header `Location` presente e apontando para o endpoint do storage (MinIO) configurado

#### 5.2. stream-hidden-when-not-ready

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-07-01T19:53:49Z

**Steps:**
  1. `GET /videos/:id/stream` autenticado como não-dono, para o vídeo em `status: "processing"`
    - expect: `404`
    - expect: corpo contém `errorCode: "VIDEO_NOT_FOUND"`

#### 5.3. stream-location-supports-range-requests

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-07-01T19:53:49Z

**Steps:**
  1. `GET /videos/:id/stream` sem autenticação, para o vídeo `ready`; seguir o `Location` retornado
    - expect: `302` no primeiro salto, com `Location` válido
  2. Requisição direta ao `Location` com header `Range: bytes=0-99`
    - expect: `206 Partial Content`
    - expect: header `Content-Range` presente na resposta

---

### 6. GET /videos/:id/download — SI-03.12

**Setup:** mesmo bootstrap do Grupo 5.

#### 6.1. download-redirects-with-attachment-disposition

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-01T19:53:49Z

**Steps:**
  1. `GET /videos/:id/download` sem autenticação, para o vídeo `ready` (sem seguir redirect automaticamente)
    - expect: `302`
    - expect: header `Location` presente
  2. Requisição direta ao `Location` retornado
    - expect: resposta contém `Content-Disposition: attachment` (ou parâmetro `response-content-disposition=attachment` refletido pelo storage)

#### 6.2. download-hidden-when-not-ready

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-07-01T19:53:49Z

**Steps:**
  1. `GET /videos/:id/download` autenticado como não-dono, para o vídeo em `status: "processing"`
    - expect: `404`
    - expect: corpo contém `errorCode: "VIDEO_NOT_FOUND"`
