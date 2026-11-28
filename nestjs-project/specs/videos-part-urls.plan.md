---
subproject: backend
runner: jest+supertest
scope: phase-03-upload-processing-backend
si: SI-03.9
target_file: test/videos-part-urls.e2e-spec.ts
---

# POST /videos/:publicId/part-urls — Test Plan

## Application Overview

O endpoint `POST /videos/:publicId/part-urls` entrega as URLs presigned de upload por parte, assinadas com o host público do storage, para o dono de um vídeo em estado de upload.

## Test Scenarios

### 1. Gerar as URLs presigned de upload por parte

**Setup:** `beforeEach` limpa as tabelas de teste (`DELETE FROM`) e sobe o módulo da aplicação com `Test.createTestingModule`, reproduzindo a configuração global do `main.ts` (pipes e filtro de exceções de domínio); usa o Postgres, o MinIO e o Redis reais do compose (`phase-03-upload-processing-backend/TD-11`); cria um usuário de teste e obtém o `access_token` pelo fluxo de autenticação existente

#### 1.1. part-urls-validas

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. Inicia um upload com `POST /videos` e guarda o `publicId`
  2. POST `/videos/:publicId/part-urls` com `{ "partNumbers": [1, 2] }` e o token do dono
    - expect: resposta `200` com `parts` contendo 2 itens
    - expect: cada item tem `partNumber` e `url`

#### 1.2. part-urls-video-inexistente-ou-alheio

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. POST `/videos/:publicId/part-urls` com o token de outro usuário para um vídeo existente
  2. POST `/videos/<publicId inexistente>/part-urls` com o token do dono
    - expect: ambas as respostas são `404` com o código de erro `VIDEO_NOT_FOUND`

#### 1.3. part-urls-estado-invalido

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. Coloca o vídeo fora do estado de upload no banco de testes
  2. POST `/videos/:publicId/part-urls` com `{ "partNumbers": [1] }` e o token do dono
    - expect: resposta `409` com o código de erro `INVALID_VIDEO_STATE`

#### 1.4. part-urls-partes-invalidas

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. POST `/videos/:publicId/part-urls` sem `partNumbers`
  2. POST `/videos/:publicId/part-urls` com `partNumbers` fora do intervalo `1..partCount`
    - expect: ambas as respostas são `400`

#### 1.5. part-urls-sem-token

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. POST `/videos/:publicId/part-urls` sem o header `Authorization`
    - expect: resposta `401`
