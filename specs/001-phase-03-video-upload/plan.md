# Implementation Plan: Phase 03 — Upload e Processamento de Vídeos

**Branch**: `feature/phase-03-video-upload` | **Date**: 2026-06-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-phase-03-video-upload/spec.md`

## Summary

Implementar o ciclo completo de vídeos no StreamTube: upload direto ao storage (sem bytes pela API), processamento assíncrono com FFmpeg (metadados + thumbnail), streaming com range requests, download autenticado e CRUD de gerenciamento. O backend NestJS recebe uma nova feature `videos`, uma fila BullMQ + Redis e um worker standalone compartilhando o mesmo projeto NestJS. Detalhes das decisões técnicas em [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript, Node.js 22 — NestJS 11 (projeto existente)

**Primary Dependencies (new)**:
- `@nestjs/bullmq` + `bullmq` — fila de processamento com retry nativo
- `ioredis` — cliente Redis para BullMQ
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` — interação com MinIO via protocolo S3
- `fluent-ffmpeg` + `@ffprobe-installer/ffprobe` — extração de metadados e geração de thumbnail no worker

**Storage**: PostgreSQL (entidade Video + migration) e MinIO / S3-compatible (arquivos de vídeo e thumbnails)

**Testing**: Jest — `*.spec.ts` (unit), `*.integration-spec.ts` (TypeORM + BD real), `*.e2e-spec.ts` (Supertest + stack completa)

**Target Platform**: Linux (Docker container); API e worker rodam no mesmo Docker Compose

**Project Type**: Web service REST (NestJS API) + worker standalone (NestJS sem HTTP, mesmo projeto)

**Performance Goals**: API não bloqueante durante upload de 10 GB; streaming range requests com latência aceitável para player web

**Constraints**:
- Nenhum byte de vídeo passa pela API (upload via URL pré-assinada ao MinIO)
- Worker usa FFmpeg instalado na imagem Docker do worker
- Todas as variáveis de ambiente via Docker Compose service names (não `localhost`)
- Migration versionada obrigatória para qualquer mudança de schema

**Scale/Scope**: Backend NestJS único (nestjs-project) + novo serviço Docker para Redis + novo serviço Docker para worker

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

A constituição do projeto não está preenchida (arquivo template). Os princípios aplicáveis derivam do `CLAUDE.md` raiz e das regras em `.claude/rules/`:

| Gate | Status | Observação |
|------|--------|-----------|
| Single Responsibility (módulo `videos` gerencia apenas vídeos) | ✅ PASS | Worker é um entry-point separado; entidade Video fica em `videos/entities/` |
| TypeScript strict (sem erros em `tsc --noEmit`) | ✅ PASS | Configuração existente; novas dependências precisam de `@types/*` |
| Pirâmide de testes (unit + integration + e2e) | ✅ PASS | Padrão do projeto; todos os três níveis exigidos pelo Definition of Done |
| Migration versionada para Video entity | ✅ PASS | FR-013 exige isso explicitamente; regra em `typeorm-migrations.md` |
| Docker Compose single-command (SC-006) | ✅ PASS | Redis e worker adicionados ao `compose.yaml` existente |
| Sem bytes de vídeo na API (FR-001) | ✅ PASS | Upload via URL pré-assinada — decisão de research |
| Endpoints protegidos por JWT global guard | ✅ PASS | `@Public()` nos endpoints públicos; padrão já existente |

**Nenhuma violação detectada. Gates passam antes e após o design.**

## Project Structure

### Documentation (this feature)

```text
specs/001-phase-03-video-upload/
├── plan.md              # Este arquivo (/speckit-plan)
├── research.md          # Phase 0: decisões técnicas
├── data-model.md        # Phase 1: modelo de dados e contratos de estado
├── quickstart.md        # Phase 1: guia de validação end-to-end
├── contracts/
│   └── videos-api.md    # Phase 1: contratos REST da API de vídeos
└── tasks.md             # Phase 2: output de /speckit-tasks (ainda não criado)
```

### Source Code (repository root)

```text
nestjs-project/
├── compose.yaml                          # Modificar: adicionar redis e video-worker services
├── src/
│   ├── config/
│   │   ├── storage.config.ts             # NOVO: MinIO/S3 config (bucket, endpoint, credenciais)
│   │   └── queue.config.ts               # NOVO: Redis/BullMQ config (host, port, password)
│   ├── videos/
│   │   ├── videos.module.ts              # NOVO
│   │   ├── videos.controller.ts          # NOVO: endpoints upload, stream, download, CRUD
│   │   ├── videos.service.ts             # NOVO: lógica de negócio
│   │   ├── videos.constants.ts           # NOVO: VIDEO_QUEUE_NAME, VideoStatus enum, etc.
│   │   ├── dto/
│   │   │   ├── initiate-upload.dto.ts    # NOVO: title, fileSize, mimeType
│   │   │   ├── update-video.dto.ts       # NOVO: title (obrigatório)
│   │   │   └── list-videos-query.dto.ts  # NOVO: page, limit
│   │   ├── entities/
│   │   │   ├── video.entity.ts                     # NOVO
│   │   │   └── video.entity.integration-spec.ts    # NOVO
│   │   ├── videos.controller.spec.ts     # NOVO
│   │   ├── videos.service.spec.ts        # NOVO
│   │   └── videos.service.integration-spec.ts  # NOVO
│   ├── storage/
│   │   ├── storage.module.ts             # NOVO: módulo global para cliente S3
│   │   └── storage.service.ts            # NOVO: presigned URLs, put, get, delete
│   ├── video-processing/
│   │   ├── video-processing.module.ts    # NOVO: módulo do worker (BullMQ processor)
│   │   ├── video-processing.processor.ts # NOVO: consumer da fila com retry
│   │   └── video-processing.processor.spec.ts  # NOVO
│   ├── database/
│   │   └── migrations/
│   │       └── TIMESTAMP-CreateVideos.ts # NOVO: migration gerada via CLI
│   └── worker.ts                         # NOVO: entry point standalone do worker
└── Dockerfile.worker                     # NOVO: imagem com FFmpeg instalado
```

**Structure Decision**: Opção web-service com worker standalone dentro do mesmo `nestjs-project`. O worker compartilha entidades, configs e a camada de acesso ao banco — sem duplicação de código. O Docker Compose cria serviços distintos para API, worker e Redis, mantendo isolamento de processo e escalabilidade independente.

## Complexity Tracking

> Sem violações de gates — tabela não aplicável.
