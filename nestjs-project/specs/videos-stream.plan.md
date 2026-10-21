---
subproject: backend
runner: jest+supertest
scope: phase-03-upload-processing
si: SI-03.14
target_file: nestjs-project/test/videos-stream.e2e-spec.ts
---

# GET /videos/:publicId/stream Test Plan

## Application Overview

Devolve a URL presignada de GET para reprodução em streaming com suporte a `Range`.

## Test Scenarios

### 1. URL de streaming

**Setup:** `beforeEach` limpa as tabelas; sobe `AppModule` com pipes e filtros globais; cria o dono com canal; envia um arquivo de vídeo real ao storage e insere um vídeo pronto apontando para ele; mantém também um vídeo em processamento e um rascunho.

#### 1.1. owner-gets-stream-url

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. GET /videos/:publicId/stream do vídeo pronto, como dono
    - expect: status 200
    - expect: body com `url` e `expires_in`

#### 1.2. stream-url-serves-range

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. GET na `url` devolvida com header `Range: bytes=0-99`
    - expect: status 206
    - expect: 100 bytes no corpo

#### 1.3. processing-video-is-not-ready

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. GET /videos/:publicId/stream do vídeo ainda em processamento, como dono
    - expect: status 409
    - expect: body com `error: "VIDEO_NOT_READY"`

#### 1.4. anonymous-cannot-stream-draft

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. GET /videos/:publicId/stream de um rascunho, sem token
    - expect: status 404
    - expect: body com `error: "VIDEO_NOT_FOUND"`
