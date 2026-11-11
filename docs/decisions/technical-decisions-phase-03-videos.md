---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-11-11
scope_description: "Queue technology for asynchronous video processing (metadata extraction and thumbnail generation) in the Phase 03 video upload pipeline."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend; receives the queue technology decision that the API and the future Video Worker container will use to enqueue/consume video-processing jobs.
- `next-frontend/` — out of scope for this document (no upload/processing UI decision made here).

Object storage (S3 vs. MinIO) and the detailed job payload/idempotency contract are explicitly **out of scope** for this document — they are separate decisions to be made in their own tasks. This document covers only the queue technology choice already flagged as `"TBD"` in `docs/diagrams/software-arch.mermaid`.

---

## TD-01: Tecnologia de Fila para Processamento de Vídeo

**Scope:** Backend

**Capability:** "Serviço de processamento em segundo plano (filas)" / "Processamento automático do vídeo após upload (extração de duração e metadados)" / "Geração automática de thumbnail a partir de um frame do vídeo" (Fase 03 — Upload e Processamento de Vídeos, `docs/project-plan.md`)

**Context:** After a video is pre-registered as a draft and uploaded to object storage, a separate "Video Worker" container (per `docs/diagrams/software-arch.mermaid`) must run FFmpeg/ffprobe to extract duration/metadata and generate a thumbnail, then update the video record directly in the database. The queue must **not** carry the video file itself — only the video ID, storage key, and whatever metadata is needed to process it. Requirements: durable job persistence, retries with backoff, controlled concurrency, recovery after worker crash/restart, idempotency, reasonable observability, and safe handling of jobs that may run for minutes on large (up to 10GB) files, calling out to the FFmpeg binary as a subprocess (CPU-bound work happens outside the Node.js event loop).

Today the repository has no queue infrastructure at all: `nestjs-project/package.json` has no `bullmq`, `pg-boss`, or `amqplib`; `nestjs-project/compose.yaml` only provisions `db` (Postgres 17) and `mailpit`; the API container runs `node:25.6.0-slim`. The Message Queue technology is explicitly marked `"TBD"` in the architecture diagram — this TD resolves that.

**Options:**

### Option A: BullMQ + Redis

Node.js job queue backed by Redis, with first-class, officially documented NestJS integration via `@nestjs/bullmq` (`docs.nestjs.com/application/queues` explicitly recommends it over the older, now-maintenance-mode Bull package).

- **Pros:** Official NestJS module with DI-friendly `@Processor`/`WorkerHost` API; documented support for `attempts`/`backoff` retry configuration; supports running processors in separate forked/sandboxed processes so a crashing or CPU-heavy job doesn't affect the rest of the queue; concurrency is controlled per consumer; largest ecosystem and most mature tooling of the three options for a dedicated Node.js job queue.
- **Cons:** Introduces Redis as a brand-new infrastructure service — nothing in `compose.yaml` today provides it. Enqueuing a job and updating the video's status in Postgres are two separate systems with no shared transaction (classic dual-write problem): if the process crashes between the DB write and the Redis enqueue (or vice-versa), the two can drift unless an outbox pattern is added on top. One more service to run and operate for a project whose only current backing services are `db` and `mailpit`.

### Option B: pg-boss + PostgreSQL

Job queue library that stores all queue state in the existing PostgreSQL database, using `SKIP LOCKED` for safe concurrent job claiming and `LISTEN/NOTIFY` for low-latency dispatch on top of polling.

- **Pros:** Reuses the Postgres 17 instance already running in `nestjs-project/compose.yaml` — no new service to add. Its README documents that jobs can be created "in an existing db transaction," which means the video-draft insert and the processing-job enqueue can be committed atomically in a single transaction, eliminating the dual-write problem that both other options have. Documented features cover automatic retries with exponential backoff, dead-letter queues with redrive, and `SKIP LOCKED`-based concurrent worker claiming without blocking. Requires Node.js ≥ 22.12 per its own documentation — the project's API container already runs `node:25.6.0-slim`, so this is satisfied.
- **Cons:** No official NestJS module exists; it is a plain Node.js client library, so a thin custom wrapper/provider would need to be written (low risk — comparable in shape to how `pg`/TypeORM are already used directly). Smaller community/ecosystem than BullMQ+Redis. Postgres now serves both the API's OLTP traffic and the queue's polling/claim traffic from the same instance, so a separate connection pool is needed to avoid the queue competing with API request traffic for connections.

### Option C: RabbitMQ

General-purpose message broker. In NestJS it is typically reached either through `@nestjs/microservices`' RMQ transport or directly via `amqplib`.

- **Pros:** Industry-standard, mature message broker with native consumer `prefetch` (a built-in primitive for limiting how many CPU-heavy jobs a worker pulls concurrently) and dead-letter exchanges. Strong decoupling between producer and consumer, well suited to larger multi-service architectures.
- **Cons:** `@nestjs/microservices`' RMQ transport is built around request/response and event patterns, not a "job with persisted status" model — there is no built-in concept of job status, retry count, or idempotency tracking; that state would still need to be modeled in Postgres regardless of using RabbitMQ, so the broker only adds transport, not the retry/status machinery the project actually needs. Exponential backoff/delayed retry is not native to RabbitMQ core and typically requires an additional plugin (e.g., a delayed-message-exchange plugin). Achieving manual ack/nack control for a job-worker pattern generally means dropping down to `amqplib` directly rather than using NestJS's microservice decorators. Requires standing up and operating a new broker service, the heaviest operational addition of the three options for the project's current size.

**Recommendation:** **Option B (pg-boss + PostgreSQL)** — it is the only option that requires no new infrastructure service (Postgres 17 is already running), and its documented ability to enqueue a job inside the same database transaction as the video-draft write directly removes the dual-write risk that both BullMQ+Redis and RabbitMQ carry. It also natively provides the retry/backoff, dead-letter, and safe-concurrency behavior the Context requires, without needing an extra plugin (RabbitMQ) or a second data store (BullMQ+Redis). The Node.js ≥ 22.12 requirement is already met by the project's `node:25.6.0-slim` image. BullMQ+Redis is the strongest option for a project that will scale into a multi-service, high-throughput system, but that is not a documented requirement here, and adding Redis purely for the queue is not justified against pg-boss meeting the same functional requirements on existing infrastructure. RabbitMQ is the weakest fit because it does not reduce the amount of custom status/idempotency code needed on top of Postgres, while adding the most new operational surface.

**Decision:** **B (pg-boss + PostgreSQL)**

**Pontos que exigem prova de conceito antes da implementação** (não respondidos pela documentação oficial, apenas pela observação do comportamento real neste ambiente):
- Tempo real de execução de `ffprobe` + geração de thumbnail para um arquivo próximo de 10GB nesta infraestrutura, necessário para calibrar o `expireInSeconds` do job e evitar que pg-boss o considere "travado" e o reenfileire prematuramente.
- Comportamento do pool de conexões do pg-boss sob uploads concorrentes, para confirmar que um pool dedicado (separado do pool usado pela API via TypeORM) é suficiente para evitar contenção.
- Confirmação, apenas na implementação, de que a versão do pacote `pg-boss` instalada não traz nenhuma dependência nativa incompatível com a imagem `node:25.6.0-slim`.

---

## Decisions Summary

| ID | Decision | Recommendation | Choice |
|----|----------|---------------|--------|
| TD-01 | Tecnologia de Fila para Processamento de Vídeo | pg-boss + PostgreSQL | **B (pg-boss + PostgreSQL)** |

---

## New Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `pg-boss` | `^12.x` | Job queue backed by the existing PostgreSQL instance, used to enqueue/consume video-processing jobs |

No new infrastructure services (e.g., Redis, RabbitMQ) are required — this decision reuses the `db` (Postgres 17) service already defined in `nestjs-project/compose.yaml`.

## Files to Create/Modify

Nenhum arquivo de código é criado ou modificado nesta etapa — esta é uma decisão de pesquisa/arquitetura. A tabela abaixo é prospectiva, para orientar a futura task de implementação:

| File | Action | Purpose |
|------|--------|---------|
| `nestjs-project/src/queue/` (módulo a definir) | Create (future) | Wrapper/provider fino em torno do cliente `pg-boss`, exposto via DI ao restante da aplicação |
| `nestjs-project/package.json` | Modify (future) | Adicionar dependência `pg-boss` |
