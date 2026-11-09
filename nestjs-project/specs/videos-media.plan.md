---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.11
target_file: test/videos-media.e2e-spec.ts
---

# GET /videos/:id/stream, /download e /thumbnail — Test Plan

## Application Overview

Três rotas públicas (`@Public()`) entregam a mídia de vídeos `READY` via proxy da API, sem expor o storage: `/stream` repassa o header `Range` ao `GetObject` do S3 e devolve `206` com `Content-Range` (ou `200` com o corpo completo sem `Range`), fazendo `pipeline` do stream sem bufferizar; `/download` usa o mesmo caminho com `Content-Disposition: attachment` codificado em RFC 6266/5987; `/thumbnail` serve o JPEG gerado. Vídeos fora de `READY` — inclusive para o owner — retornam `404 VIDEO_NOT_FOUND`; `Range` além do tamanho retorna `416 RANGE_NOT_SATISFIABLE` com `Content-Range: bytes */{size}`.

## Test Scenarios

### 1. Entregar stream, download e thumbnail de vídeos prontos

**Setup:** `beforeAll` cria o app via `Test.createTestingModule({ imports: [AppModule] }).compile()` reproduzindo a config global do `main.ts` (`ValidationPipe`, `ValidationExceptionFilter`, `DomainExceptionFilter`); `beforeEach` roda `cleanAllTables`, cria um usuário confirmado com channel (owner) e seu `access_token`, grava no bucket `streamtube-test` via `StorageService.putObject` um objeto de vídeo (alguns KB, `video/mp4`) e uma thumbnail `image/jpeg`, e semeia via `DataSource` um vídeo `READY` apontando para esses objetos (`size_bytes` = tamanho do objeto, `original_filename` com acentos e aspas, ex.: `vídeo "férias".mp4`) e um vídeo `PROCESSING` do mesmo owner; `afterAll(() => app.close())`.

#### 1.1. stream-com-range-retorna-206-parcial

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. GET /videos/:id/stream (vídeo `READY`) com `Range: bytes=0-1023`
    - expect: status `206`
    - expect: `Content-Range: bytes 0-1023/{size_bytes}` e `Accept-Ranges: bytes`
    - expect: corpo com exatamente 1024 bytes, iguais aos primeiros 1024 bytes do objeto gravado

#### 1.2. stream-sem-range-retorna-200-completo

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. GET /videos/:id/stream (vídeo `READY`) sem `Range`
    - expect: status `200`
    - expect: `Content-Length` igual a `size_bytes` e `Content-Type: video/mp4`
    - expect: corpo com `size_bytes` bytes

#### 1.3. download-com-content-disposition-codificado

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. GET /videos/:id/download (vídeo `READY` com `original_filename` acentuado e com aspas)
    - expect: status `200` (nunca `500`)
    - expect: `Content-Disposition` começa com `attachment`, contém um `filename="..."` ASCII sem aspas internas e `filename*=UTF-8''` seguido do `original_filename` percent-encoded
  2. GET /videos/:id/download com `Range: bytes=0-99`
    - expect: status `206` com `Content-Range: bytes 0-99/{size_bytes}` e 100 bytes de corpo

#### 1.4. stream-range-alem-do-tamanho-retorna-416

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. GET /videos/:id/stream (vídeo `READY`) com `Range: bytes={size_bytes}-`
    - expect: status `416` com `error: "RANGE_NOT_SATISFIABLE"`
    - expect: header `Content-Range: bytes */{size_bytes}`

#### 1.5. thumbnail-de-video-ready-retorna-jpeg

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. GET /videos/:id/thumbnail (vídeo `READY`)
    - expect: status `200` com `Content-Type: image/jpeg`
    - expect: corpo igual ao JPEG gravado no bucket

#### 1.6. midia-de-video-nao-ready-retorna-404-inclusive-owner

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. GET /videos/:id/stream, /download e /thumbnail (vídeo `PROCESSING`) sem token
    - expect: as três retornam `404` com `error: "VIDEO_NOT_FOUND"`
  2. Repetir as três chamadas com o token do owner
    - expect: as três retornam `404` com `error: "VIDEO_NOT_FOUND"`

#### 1.7. respostas-nao-expoem-host-do-minio

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. Coletar as respostas de /stream (200 e 206), /download, /thumbnail, o `416` e os `404` dos cenários anteriores
    - expect: nenhum header (incluindo `Location`) nem corpo de erro contém o hostname do MinIO (`minio`, valor de `S3_ENDPOINT`/`S3_PUBLIC_ENDPOINT`) ou a substring `X-Amz-`
    - expect: nenhuma resposta é um redirect `3xx`
