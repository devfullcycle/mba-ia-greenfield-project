---
subproject: backend
runner: jest+supertest
scope: phase-03-upload-processing
si: SI-03.13
target_file: nestjs-project/test/videos-get-status.e2e-spec.ts
---

# GET /videos/:publicId Test Plan

## Application Overview

Retorna status e metadados do vídeo para o polling de progresso; rascunhos só são visíveis ao dono.

## Test Scenarios

### 1. Consulta de status

**Setup:** `beforeEach` limpa as tabelas; sobe `AppModule` com pipes e filtros globais; cria o dono com canal e um vídeo em rascunho; para o cenário pós-processamento, insere um vídeo pronto com duração e thumbnail.

#### 1.1. owner-reads-draft

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. GET /videos/:publicId autenticado como dono
    - expect: status 200
    - expect: body com `public_id`, `status`, `visibility`, `duration_seconds`, `metadata` e `has_thumbnail`

#### 1.2. anonymous-cannot-see-draft

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. GET /videos/:publicId sem token
    - expect: status 404
    - expect: body com `error: "VIDEO_NOT_FOUND"`

#### 1.3. unknown-video-is-not-found

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. GET /videos/inexistente como dono
    - expect: status 404
    - expect: body com `error: "VIDEO_NOT_FOUND"`

#### 1.4. processed-video-exposes-duration-and-thumbnail

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. GET /videos/:publicId do vídeo já processado, como dono
    - expect: status 200
    - expect: `duration_seconds` preenchido
    - expect: `has_thumbnail` true
