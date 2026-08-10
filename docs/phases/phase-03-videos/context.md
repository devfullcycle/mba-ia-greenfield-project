---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-07-11T10:18:28-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-11T11:51:46-03:00"
  docs/decisions/technical-decisions-phase-02-auth.md: "2026-07-11T10:18:28-03:00"
  docs/decisions/technical-decisions-phase-01-configuracao-base.md: "2026-07-11T10:18:28-03:00"
  docs/phases/phase-02-auth/phase-02-auth.md: "2026-07-11T10:18:28-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-07-11T11:52:06-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities**

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** Edição de informações do vídeo, publicação, painel do canal, comentários, likes e demais funcionalidades de fases posteriores.

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** `nestjs-project/`

**Deferred subprojects:** `next-frontend/` — A interface do frontend de vídeo fica diferida para uma fase posterior. Embora a estratégia de upload seja Cross-layer (contrato de upload direto de chunks), nenhuma nova tela UI está em escopo nesta fase.

**Sequencing notes:** Depende de Fase 01 — Configuração Base do Projeto e Fase 02 — Cadastro, Login e Gerenciamento de Conta.

**Neighbors (for boundary detection only):** Fase 02 (prior), Fase 04 — Gerenciamento de Vídeos e Canal (next).

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | technical-decisions-phase-03-videos.md | Backend | Background Job Queue Technology | decided | A (BullMQ) | @nestjs/bullmq@^3.1.0, bullmq@^5.30.0 |
| phase-03-videos/TD-02 | technical-decisions-phase-03-videos.md | Cross-layer | 10GB Upload Strategy | decided | A (Direct Multipart Presigned URLs) | @aws-sdk/client-s3@^3.1085.0, @aws-sdk/s3-request-presigner@^3.1085.0 |
| phase-03-videos/TD-03 | technical-decisions-phase-03-videos.md | Backend | Video Worker and Processing Architecture | decided | A (Separate NestJS Worker Container) | fluent-ffmpeg@^2.1.3 |
| phase-03-videos/TD-04 | technical-decisions-phase-03-videos.md | Backend | Unique URL Identification | decided | A (NanoID / Short Unique ID) | nanoid@^3.3.8 |
| phase-03-videos/TD-05 | technical-decisions-phase-03-videos.md | Backend | Streaming and Download Transport Strategy | decided | A (HTTP Range Requests via API) | — |
| phase-03-videos/TD-06 | technical-decisions-phase-03-videos.md | Backend | Video Status Lifecycle | decided | A (Enum status field in database) | — |

_Source files:_

- `docs/decisions/technical-decisions-phase-03-videos.md`

## Capability Coverage

| Capability | Covered by |
|------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-02, phase-03-videos/TD-05 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-03 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-06 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-03 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-03 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-04 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-05 |
| Download do vídeo pelo usuário | phase-03-videos/TD-05 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** BullMQ (Redis-based) — It is the industry standard for NestJS ecosystems, officially supported via `@nestjs/bullmq`, and provides excellent performance and job lifecycle management. Redis is lightweight and easy to add to `compose.yaml`.

**Libraries:** `@nestjs/bullmq@^3.1.0, bullmq@^5.30.0`

### phase-03-videos/TD-02

**Recommendation:** Direct Multipart Presigned URLs (Option A) — It is the only option that handles 10GB files reliably (S3 Single Put limit is 5GB) and guarantees zero impact on the NestJS API event loop.

**Libraries:** `@aws-sdk/client-s3@^3.1085.0, @aws-sdk/s3-request-presigner@^3.1085.0`

### phase-03-videos/TD-03

**Recommendation:** Separate NestJS Worker Container (Option A) — Isolating CPU-heavy video processing in a dedicated worker container guarantees the API remains responsive and stable.

**Libraries:** `fluent-ffmpeg@^2.1.3`

### phase-03-videos/TD-04

**Recommendation:** NanoID / Short Unique ID (Option A) — It provides short, user-friendly, YouTube-like URLs while securing the resource from enumeration.

**Libraries:** `nanoid@^3.3.8`

### phase-03-videos/TD-05

**Recommendation:** HTTP Range Requests via NestJS API (Option A) — It provides superior security and architectural abstraction, allowing the backend to fully control access controls and view count analytics before bytes are served.

**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** Enum status field in database (Option A) — It perfectly satisfies the requirements, keeps the schema clean, and is easy to query.

**Libraries:** —
