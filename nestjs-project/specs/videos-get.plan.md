---
subproject: backend
runner: jest+supertest
scope: phase-03-upload-processing-backend
si: SI-03.14
target_file: test/videos-get.e2e-spec.ts
---

# GET /videos/:publicId — Test Plan

## Application Overview

O endpoint `GET /videos/:publicId` devolve o estado do vídeo (status, duração, metadados e URL do thumbnail) para o dono, para acompanhar o processamento.

## Test Scenarios

### 1. Consultar o estado do vídeo

**Setup:** `beforeEach` limpa as tabelas de teste (`DELETE FROM`) e sobe o módulo da aplicação com `Test.createTestingModule`, reproduzindo a configuração global do `main.ts` (pipes e filtro de exceções de domínio); usa o Postgres, o MinIO e o Redis reais do compose (`phase-03-upload-processing-backend/TD-11`); cria um usuário de teste e obtém o `access_token` pelo fluxo de autenticação existente

#### 1.1. get-video-proprio

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. Cria no banco de testes um vídeo `ready` com `duration_seconds`, `metadata` e `thumbnail_key` e um thumbnail no storage
  2. GET `/videos/:publicId` com o token do dono
    - expect: resposta `200` com `publicId`, `status`, `durationSeconds`, `metadata` e `thumbnailUrl`

#### 1.2. get-video-em-processamento

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. Cria no banco de testes um vídeo em processamento, sem duração, metadados nem thumbnail
  2. GET `/videos/:publicId` com o token do dono
    - expect: resposta `200`
    - expect: `durationSeconds`, `metadata` e `thumbnailUrl` são `null`

#### 1.3. get-video-inexistente-ou-alheio

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. GET `/videos/:publicId` com o token de outro usuário
  2. GET `/videos/<publicId inexistente>` com o token do dono
    - expect: ambas as respostas são `404` com o código de erro `VIDEO_NOT_FOUND`

#### 1.4. get-video-sem-token

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. GET `/videos/:publicId` sem o header `Authorization`
    - expect: resposta `401`
