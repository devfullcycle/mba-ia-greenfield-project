---
subproject: backend
runner: jest+supertest
scope: phase-03-upload-processing
si: SI-03.10
target_file: nestjs-project/test/videos-part-urls.e2e-spec.ts
---

# POST /videos/:publicId/upload/part-urls Test Plan

## Application Overview

Assina URLs presignadas de `UploadPart` para o dono do vídeo enviar as partes direto ao storage.

## Test Scenarios

### 1. Assinatura de partes

**Setup:** `beforeEach` limpa as tabelas; sobe `AppModule` com pipes e filtros globais; cria dois usuários com canal (dono e outro) e um vídeo iniciado via `POST /videos` pelo dono.

#### 1.1. owner-gets-part-urls

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. POST /videos/:publicId/upload/part-urls como dono com `part_numbers: [1, 2]`
    - expect: status 200
    - expect: `urls` com duas entradas `{ part_number, url }`

#### 1.2. other-user-is-forbidden

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. POST /videos/:publicId/upload/part-urls autenticado como outro usuário
    - expect: status 403
    - expect: body com `error: "VIDEO_FORBIDDEN"`

#### 1.3. unknown-video-is-not-found

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. POST /videos/inexistente/upload/part-urls como dono
    - expect: status 404
    - expect: body com `error: "VIDEO_NOT_FOUND"`

#### 1.4. completed-upload-conflicts

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. Concluir o upload do vídeo (partes enviadas e `complete` chamado)
  2. POST /videos/:publicId/upload/part-urls como dono
    - expect: status 409
    - expect: body com `error: "UPLOAD_ALREADY_COMPLETED"`

#### 1.5. empty-part-numbers-fails-validation

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. POST /videos/:publicId/upload/part-urls como dono com `part_numbers: []`
    - expect: status 400
    - expect: body no formato de erro de validação
