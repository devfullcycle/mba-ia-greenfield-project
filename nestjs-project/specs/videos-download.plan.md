---
subproject: backend
runner: jest+supertest
scope: phase-03-upload-processing
si: SI-03.15
target_file: nestjs-project/test/videos-download.e2e-spec.ts
---

# GET /videos/:publicId/download Test Plan

## Application Overview

Devolve a URL presignada que força o download do arquivo do vídeo (`Content-Disposition` de anexo).

## Test Scenarios

### 1. URL de download

**Setup:** `beforeEach` limpa as tabelas; sobe `AppModule` com pipes e filtros globais; cria o dono com canal; envia um arquivo de vídeo real ao storage e insere um vídeo pronto apontando para ele; mantém também um vídeo em processamento e um rascunho.

#### 1.1. owner-gets-download-url

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. GET /videos/:publicId/download do vídeo pronto, como dono
    - expect: status 200
    - expect: body com `url` e `expires_in`

#### 1.2. download-url-forces-attachment

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. GET na `url` devolvida
    - expect: status 200
    - expect: header `Content-Disposition` de anexo

#### 1.3. processing-video-is-not-ready

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. GET /videos/:publicId/download do vídeo ainda em processamento, como dono
    - expect: status 409
    - expect: body com `error: "VIDEO_NOT_READY"`

#### 1.4. anonymous-cannot-download-draft

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. GET /videos/:publicId/download de um rascunho, sem token
    - expect: status 404
    - expect: body com `error: "VIDEO_NOT_FOUND"`
