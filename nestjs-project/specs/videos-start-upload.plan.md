---
subproject: backend
runner: jest+supertest
scope: phase-03-upload-processing
si: SI-03.9
target_file: nestjs-project/test/videos-start-upload.e2e-spec.ts
---

# POST /videos Test Plan

## Application Overview

Inicia o upload: autentica o usuário, pré-cadastra o `Video` como rascunho e abre o multipart upload no storage, devolvendo `public_id`, `upload_id` e o tamanho de parte.

## Test Scenarios

### 1. Início de upload

**Setup:** `beforeEach` limpa as tabelas (`cleanAllTables`); sobe `AppModule` com `ValidationPipe`, `DomainExceptionFilter` e `ValidationExceptionFilter`; cria usuário confirmado com canal e obtém access token.

#### 1.1. start-upload-returns-draft-with-upload-id

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. POST /videos autenticado com `filename`, `size_bytes` e `content_type` válidos
    - expect: status 201
    - expect: body contém `public_id` (11 caracteres), `upload_id`, `part_size_bytes`, `status` e `visibility`
    - expect: o vídeo existe no banco com `visibility` de rascunho

#### 1.2. start-upload-without-token-is-unauthorized

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. POST /videos sem header Authorization
    - expect: status 401
    - expect: nenhum vídeo criado no banco

#### 1.3. start-upload-rejects-file-too-large

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. POST /videos autenticado com `size_bytes` acima de 10GB
    - expect: status 400
    - expect: body com `error: "FILE_TOO_LARGE"`

#### 1.4. start-upload-rejects-unsupported-format

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. POST /videos autenticado com `content_type` fora da lista aceita
    - expect: status 415
    - expect: body com `error: "UNSUPPORTED_VIDEO_FORMAT"`

#### 1.5. start-upload-validates-body

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-21T14:45:33Z

**Steps:**
  1. POST /videos autenticado com body sem `filename`
    - expect: status 400
    - expect: body no formato de erro de validação
