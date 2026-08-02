# Fase 03 — Upload e Processamento de Vídeos — Plano de Incrementos

> **Status:** planning_ok
> **Data:** 2026-08-01
> **Plano técnico detalhado:** `docs/phases/phase-03-videos.md` (12 SIs, gerado via `plan-phase`)

## 1. Arquitetura (resumo)

Subprojeto: `nestjs-project`. Duas novas peças de infraestrutura entram no Docker Compose — MinIO (object storage, S3-compatible) e Redis (backing store do BullMQ) — e uma segunda aplicação NestJS (`video-worker`) passa a coexistir com a API no mesmo repositório via modo monorepo do Nest CLI, compartilhando entidades e config com `nestjs-api` mas rodando em container próprio, sem superfície HTTP. Dois novos módulos de domínio: `VideosModule` (API — expõe os 3 endpoints) e `VideoProcessingModule` (worker — consome jobs). Dois módulos de infraestrutura compartilhados entre ambos os apps: `StorageModule` (wrapper de `@aws-sdk/client-s3`) e `QueueModule` (`@nestjs/bullmq`). Reaproveita `Channel`/`User` (Fase 02), o guard JWT global e `@Public()`, e o formato de erro `{statusCode, error, message}` já estabelecido na Fase 02.

## 2. Domínio e estados

- **`Video`** (nova entidade — ver Data Model completo em `phase-03-videos.md`): pertence a um `Channel` (many-to-one). Máquina de estados: `draft → processing → ready | failed`. `draft` é o estado do pré-cadastro (criado ao iniciar o upload); `processing` é setado ao completar o upload multipart e enfileirar o job; `ready`/`failed` são setados exclusivamente pelo Video Worker ao final do processamento. Não há transição de volta — uma vez `ready` ou `failed`, o vídeo não é reprocessado automaticamente (decisão de produto confirmada: sem retry automático).

## 3. Endpoints (resumo)

| Método | Rota | Propósito | Detalhe completo |
|--------|------|-----------|-------------------|
| POST | `/videos` | Pré-cadastra o vídeo como rascunho e inicia upload multipart direto ao storage | SI-03.6 |
| POST | `/videos/:id/complete-upload` | Finaliza o upload multipart e enfileira o processamento | SI-03.7 |
| GET | `/videos/:id` | Metadados do vídeo; URLs de streaming/download/thumbnail somente quando `ready` | SI-03.8 |

## 4. Infraestrutura

- **MinIO** (novo serviço `compose.yaml`) — bucket `videos`, CORS liberado para upload direto do frontend, inicializado via serviço `minio-init` (`minio/mc`)
- **Redis** (novo serviço `compose.yaml`) — backing store do BullMQ, fila `video-processing`
- **`video-worker`** (novo serviço `compose.yaml`) — mesma imagem/build da API, comando diferente, sem portas expostas, depende de `db`/`minio`/`redis` saudáveis
- Novas env vars: `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET_VIDEOS`, `STORAGE_FORCE_PATH_STYLE`, `STORAGE_MULTIPART_PART_SIZE_MB`, `STORAGE_PRESIGNED_URL_EXPIRATION_SECONDS`, `REDIS_HOST`, `REDIS_PORT`
- Nenhum sistema externo além dos já existentes (Postgres, Mailpit) mais os dois novos acima

## 5. Estratégia de testes

Camadas seguem `testing-guide-nestjs-project` (carregado durante o planning):

- **Entidade `Video`:** Integration apenas (constraints, defaults, enum)
- **`StorageService`:** Integration apenas contra o MinIO real do Docker Compose — é uma dependência de efeito colateral (side-effect dependency); **não é mockada em unit test**, conforme a regra "mock across module boundaries, not configured/side-effect libs" da skill
- **`VideosService`:** Unit (lógica de branching — transições de estado, cálculo de partes, resposta condicional por status — com `StorageService`/`Queue` mockados) **+** Integration (contrato real de DB, storage e fila)
- **`VideoProcessorService` (worker):** Unit (orquestração/branches de sucesso e falha, com storage/ffmpeg mockados) **+** Integration (fixture real de vídeo pequeno contra MinIO real)
- **Controllers (`VideosController`):** **Nenhum unit test** — cobertura via E2E apenas (`test/videos.e2e-spec.ts`), conforme regra do projeto (controllers são delegação fina)
- **Módulos:** Unit — teste de compilação de DI (`*.module.spec.ts`) para cada módulo com imports configurados
- **E2E:** um spec cobrindo o fluxo HTTP completo por endpoint (SI-03.6/07/08) mais um E2E de fluxo ponta-a-ponta real contra o stack completo (SI-03.12), usando um fixture de vídeo pequeno

## 6. Incrementos

### INC-03.1 — Dependências, config e infraestrutura Docker (MinIO + Redis)
**Mapeia para:** SI-03.1
**Descrição:** Instala dependências de storage/fila/ffmpeg, cria namespaces de config e adiciona MinIO/Redis ao Docker Compose.
**Dependências:** None
**Critério de pronto:** `docker compose ps` mostra `minio` e `redis` saudáveis; app sobe com as novas env vars.

### INC-03.2 — Monorepo Nest CLI e scaffold do Video Worker
**Mapeia para:** SI-03.2
**Descrição:** Converte o projeto para modo monorepo do Nest CLI e cria a segunda aplicação `video-worker`.
**Dependências:** INC-03.1
**Critério de pronto:** `docker compose up -d video-worker` sobe um container do worker conectado ao banco; `nestjs-api` continua funcionando normalmente.

### INC-03.3 — Entidade `Video` e migration
**Mapeia para:** SI-03.3
**Descrição:** Cria a entidade `Video`, seu enum de status e gera a migration.
**Dependências:** INC-03.1
**Critério de pronto:** `npm run migration:run` cria a tabela `videos` com FK para `channels` e enum de status.

### INC-03.4 — `StorageModule`/`StorageService`
**Mapeia para:** SI-03.4
**Descrição:** Wrapper de `@aws-sdk/client-s3` para multipart upload, URLs pré-assinadas e leitura/escrita de objetos.
**Dependências:** INC-03.1
**Critério de pronto:** operações de multipart e presigned URL funcionam contra o MinIO real (testes de integração passando).

### INC-03.5 — `QueueModule` (BullMQ compartilhado)
**Mapeia para:** SI-03.5
**Descrição:** Registra a fila `video-processing`, compartilhada entre API (produtor) e worker (consumidor).
**Dependências:** INC-03.1
**Critério de pronto:** API conecta ao Redis sem erros; um job de teste enfileirado é visível no Redis.

### INC-03.6 — `POST /videos` (pré-cadastro + iniciação do upload)
**Mapeia para:** SI-03.6
**Descrição:** Endpoint que cria o rascunho do vídeo e inicia o upload multipart, retornando URLs pré-assinadas por parte.
**Dependências:** INC-03.3, INC-03.4
**Critério de pronto:** 201 com `id`/`uploadId`/`parts` para requisição autenticada válida; 401 sem token; 400 para tamanho/mimetype inválidos.

### INC-03.7 — `POST /videos/:id/complete-upload` (finalização + enfileiramento)
**Mapeia para:** SI-03.7
**Descrição:** Endpoint que finaliza o multipart upload e enfileira o job de processamento.
**Dependências:** INC-03.5, INC-03.6
**Critério de pronto:** 200 com `status: 'processing'`; job real visível na fila; 403/404/409 nos branches de erro.

### INC-03.8 — `GET /videos/:id` (metadados + URLs condicionais)
**Mapeia para:** SI-03.8
**Descrição:** Endpoint público que retorna metadados e, apenas quando `ready`, URLs de streaming/download/thumbnail.
**Dependências:** INC-03.3, INC-03.4
**Critério de pronto:** resposta varia corretamente por status; URL de streaming suporta `Range` requests.

### INC-03.9 — Worker: registro do processor BullMQ (esqueleto)
**Mapeia para:** SI-03.9
**Descrição:** Registra o consumidor da fila `video-processing` no worker, sem lógica de FFmpeg ainda.
**Dependências:** INC-03.2, INC-03.3, INC-03.5
**Critério de pronto:** job enfileirado pela API é recebido pelo worker (log observável).

### INC-03.10 — Worker: extração de metadados e geração de thumbnail (FFmpeg)
**Mapeia para:** SI-03.10
**Descrição:** Implementa o pipeline real: download do original, `ffprobe` para duração, `screenshots` para thumbnail, upload do thumbnail.
**Dependências:** INC-03.9, INC-03.4
**Critério de pronto:** vídeo processado com sucesso vira `ready` com `duration_seconds` e `thumbnail_key` populados.

### INC-03.11 — Worker: tratamento de falha
**Mapeia para:** SI-03.11
**Descrição:** Captura erros do pipeline de processamento e marca o vídeo como `failed` com motivo, sem retry automático.
**Dependências:** INC-03.10
**Critério de pronto:** arquivo corrompido resulta em `status: 'failed'` com `failure_reason`; job não é reprocessado pelo BullMQ.

### INC-03.12 — E2E do fluxo completo upload → processamento → pronto
**Mapeia para:** SI-03.12
**Descrição:** Teste E2E cobrindo o pipeline inteiro contra o stack real (Postgres, MinIO, Redis, worker).
**Dependências:** INC-03.6, INC-03.7, INC-03.8, INC-03.11
**Critério de pronto:** fluxo completo passa em `--runInBand` junto com a suíte E2E existente da Fase 02, sem regressões.

## 7. Ordem de execução

```
INC-03.1 (sem deps)
├── INC-03.2
├── INC-03.3
│   ├── INC-03.4
│   │   ├── INC-03.6 (também depende de INC-03.3)
│   │   │   └── INC-03.7 (também depende de INC-03.5)
│   │   ├── INC-03.8 (também depende de INC-03.3)
│   │   └── INC-03.9 (também depende de INC-03.2, INC-03.3, INC-03.5)
│   │       └── INC-03.10 (também depende de INC-03.4)
│   │           └── INC-03.11
│   │               └── INC-03.12 (também depende de INC-03.6, INC-03.7, INC-03.8)
└── INC-03.5
    ├── INC-03.7
    └── INC-03.9
```

Ordem de execução linear recomendada (respeitando as dependências acima): INC-03.1 → INC-03.2 → INC-03.3 → INC-03.4 → INC-03.5 → INC-03.6 → INC-03.7 → INC-03.8 → INC-03.9 → INC-03.10 → INC-03.11 → INC-03.12.
