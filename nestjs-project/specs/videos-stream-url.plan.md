---
subproject: backend
runner: jest+supertest
scope: phase-03-upload-processing-backend
si: SI-03.15
target_file: test/videos-stream-url.e2e-spec.ts
---

# GET /videos/:publicId/stream-url — Test Plan

## Application Overview

O endpoint `GET /videos/:publicId/stream-url` entrega ao dono a URL presigned para reproduzir o vídeo por HTTP Range direto do storage, sem baixar o arquivo inteiro.

## Test Scenarios

### 1. Obter a URL de streaming

**Setup:** `beforeEach` limpa as tabelas de teste (`DELETE FROM`) e sobe o módulo da aplicação com `Test.createTestingModule`, reproduzindo a configuração global do `main.ts` (pipes e filtro de exceções de domínio); usa o Postgres, o MinIO e o Redis reais do compose (`phase-03-upload-processing-backend/TD-11`); cria um usuário de teste e obtém o `access_token` pelo fluxo de autenticação existente

#### 1.1. stream-url-video-pronto

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. Cria no banco de testes um vídeo `ready` com o objeto no storage
  2. GET `/videos/:publicId/stream-url` com o token do dono
  3. GET na `url` retornada com o header `Range: bytes=0-99`
    - expect: resposta `200` com `url` e `expiresInSeconds`
    - expect: a requisição com Range à `url` responde `206`

#### 1.2. stream-url-video-nao-pronto

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. Cria no banco de testes um vídeo que ainda não está `ready`
  2. GET `/videos/:publicId/stream-url` com o token do dono
    - expect: resposta `409` com o código de erro `VIDEO_NOT_READY`

#### 1.3. stream-url-inexistente-ou-alheio

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. GET `/videos/:publicId/stream-url` com o token de outro usuário
  2. GET `/videos/<publicId inexistente>/stream-url` com o token do dono
    - expect: ambas as respostas são `404` com o código de erro `VIDEO_NOT_FOUND`

#### 1.4. stream-url-sem-token

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. GET `/videos/:publicId/stream-url` sem o header `Authorization`
    - expect: resposta `401`
