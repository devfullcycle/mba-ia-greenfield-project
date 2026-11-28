---
subproject: backend
runner: jest+supertest
scope: phase-03-upload-processing-backend
si: SI-03.8
target_file: test/videos-init.e2e-spec.ts
---

# POST /videos — Test Plan

## Application Overview

O endpoint `POST /videos` inicia o upload: valida o tamanho declarado (máximo de 10GB), pré-cadastra o vídeo como rascunho com um `publicId` único e abre o multipart no storage. Exige autenticação.

## Test Scenarios

### 1. Iniciar o upload e pré-cadastrar o vídeo

**Setup:** `beforeEach` limpa as tabelas de teste (`DELETE FROM`) e sobe o módulo da aplicação com `Test.createTestingModule`, reproduzindo a configuração global do `main.ts` (pipes e filtro de exceções de domínio); usa o Postgres, o MinIO e o Redis reais do compose (`phase-03-upload-processing-backend/TD-11`); cria um usuário de teste e obtém o `access_token` pelo fluxo de autenticação existente

#### 1.1. init-upload-valido

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. POST `/videos` com `Authorization: Bearer <access_token>` e corpo `{ "sizeBytes": 5242880, "contentType": "video/mp4" }`
    - expect: resposta `201` com `publicId` (string), `status`, `partSizeBytes` e `partCount`
    - expect: existe um registro em `videos` com `public_id` igual ao retornado

#### 1.2. init-tamanho-acima-do-limite

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. POST `/videos` com `sizeBytes` igual a `10737418241` (10GB + 1 byte) e token válido
    - expect: resposta `400` com o código de erro `UPLOAD_SIZE_EXCEEDED`
    - expect: nenhum registro novo em `videos`

#### 1.3. init-corpo-invalido

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. POST `/videos` com token válido e corpo sem `sizeBytes`
  2. POST `/videos` com token válido e `sizeBytes` negativo
    - expect: ambas as respostas são `400` com erro de validação

#### 1.4. init-sem-token

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-28T05:47:40Z

**Steps:**
  1. POST `/videos` sem o header `Authorization`
    - expect: resposta `401`
