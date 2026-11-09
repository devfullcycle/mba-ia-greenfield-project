---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5
target_file: test/videos-uploads.e2e-spec.ts
---

# POST /videos/uploads — Test Plan

## Application Overview

`POST /videos/uploads` inicia um upload multipart pré-assinado no object storage (MinIO) e, no mesmo passo, pré-cadastra o vídeo como `DRAFT` no canal do usuário autenticado. A API calcula o plano de partes (`part_size = max(5 MiB, ceil(size_bytes / 10000))`, teto de 100 MiB), cria o multipart, reserva o `seq` e gera o `public_id` (Sqids), e devolve uma URL `PUT` pré-assinada por parte, válida por 6h — nenhum byte de vídeo passa pela API. A rota exige autenticação, valida o body com `ValidationPipe` e é isenta do throttler global (`@SkipThrottle()`).

## Test Scenarios

### 1. Iniciar upload multipart e pré-cadastrar vídeo em rascunho

**Setup:** `beforeAll` cria o app via `Test.createTestingModule({ imports: [AppModule] }).compile()` reproduzindo a config global do `main.ts` (`ValidationPipe`, `ValidationExceptionFilter`, `DomainExceptionFilter`); `beforeEach` roda `cleanAllTables` (inclui `videos` antes de `channels`) e registra/confirma/loga um usuário com channel para obter o `access_token`; bucket `streamtube-test` (via `test/setup-test-env.ts`); `afterAll(() => app.close())`.

#### 1.1. iniciar-upload-10gb-retorna-draft-com-urls

**Covers AC:** #1, #2, #6
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. POST /videos/uploads com `Authorization: Bearer <access_token>` e body `{ original_filename: "a.mp4", mime_type: "video/mp4", size_bytes: 10737418240 }`
    - expect: status `201`
    - expect: body com `status: "DRAFT"`, `part_size` ≤ 104857600 e `part_count` ≤ 10000
    - expect: `parts.length === part_count`, cada item com `part_number` sequencial a partir de 1 e `url` não vazia
    - expect: `expires_at` é um ISO-8601 ~6h no futuro (tolerância de alguns segundos)
    - expect: `id` tem ≥ 10 caracteres e não casa o regex de UUID
  2. Consultar a tabela `videos` via `DataSource`
    - expect: existe exatamente uma linha com `status = 'DRAFT'`, `channel_id` igual ao channel do usuário, `title = 'a.mp4'`, `public_id` igual ao `id` retornado e `upload_id` preenchido

#### 1.2. iniciar-upload-validacao-rejeita-body-invalido

**Covers AC:** #3, #4
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. POST /videos/uploads autenticado com `{ original_filename: "a.pdf", mime_type: "application/pdf", size_bytes: 1024 }`
    - expect: status `400` com `error: "VALIDATION_ERROR"`
  2. POST /videos/uploads autenticado com `{ original_filename: "a.mp4", mime_type: "video/mp4", size_bytes: 10737418241 }`
    - expect: status `400` com `error: "VALIDATION_ERROR"`
    - expect: nenhuma linha criada em `videos` após as duas chamadas

#### 1.3. iniciar-upload-sem-token-retorna-401

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. POST /videos/uploads sem header `Authorization`, com body válido
    - expect: status `401`
    - expect: nenhuma linha criada em `videos`

#### 1.4. iniciar-upload-isento-do-throttler

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-11-09T23:19:04Z

**Steps:**
  1. Disparar 15 chamadas autenticadas e sequenciais a POST /videos/uploads com body válido (`size_bytes` pequeno)
    - expect: todas retornam `201`; nenhuma retorna `429`
