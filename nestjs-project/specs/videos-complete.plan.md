---
subproject: backend
runner: jest+supertest
scope: phase-03-upload-processing-backend
si: SI-03.10
target_file: test/videos-complete.e2e-spec.ts
---

# POST /videos/:publicId/complete — Test Plan

## Application Overview

O endpoint `POST /videos/:publicId/complete` conclui o upload: a API finaliza o multipart, confere o tamanho do objeto no storage e enfileira o processamento do vídeo.

## Test Scenarios

### 1. Concluir o upload e enfileirar o processamento

**Setup:** `beforeEach` limpa as tabelas de teste (`DELETE FROM`) e sobe o módulo da aplicação com `Test.createTestingModule`, reproduzindo a configuração global do `main.ts` (pipes e filtro de exceções de domínio); usa o Postgres, o MinIO e o Redis reais do compose (`phase-03-upload-processing-backend/TD-11`); cria um usuário de teste e obtém o `access_token` pelo fluxo de autenticação existente

#### 1.1. complete-upload-valido

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. Inicia o upload, pede as URLs presigned e envia as partes ao storage
  2. POST `/videos/:publicId/complete` com as partes enviadas (`partNumber` e `etag`) e o token do dono
    - expect: resposta `202` com `publicId` e o novo `status`
    - expect: a fila `video-processing` recebe um job `video.process` com o `videoId` do vídeo

#### 1.2. complete-tamanho-divergente

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. Inicia o upload declarando um `sizeBytes` e envia ao storage um objeto de tamanho diferente
  2. POST `/videos/:publicId/complete` com as partes enviadas e o token do dono
    - expect: resposta `422` com o código de erro `UPLOAD_SIZE_MISMATCH`

#### 1.3. complete-video-inexistente-ou-alheio

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. POST `/videos/:publicId/complete` com o token de outro usuário
  2. POST `/videos/<publicId inexistente>/complete` com o token do dono
    - expect: ambas as respostas são `404` com o código de erro `VIDEO_NOT_FOUND`

#### 1.4. complete-estado-invalido

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. Conclui o upload com sucesso
  2. POST `/videos/:publicId/complete` de novo com o token do dono
    - expect: resposta `409` com o código de erro `INVALID_VIDEO_STATE`

#### 1.5. complete-partes-invalidas

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. POST `/videos/:publicId/complete` com `parts` vazio
  2. POST `/videos/:publicId/complete` com uma parte sem `etag`
    - expect: ambas as respostas são `400`

#### 1.6. complete-sem-token

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. POST `/videos/:publicId/complete` sem o header `Authorization`
    - expect: resposta `401`
