---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-11-03
scope_description: "Upload de vídeos até 10GB, armazenamento em object storage, processamento assíncrono em fila com FFmpeg (extração de metadados e thumbnail), streaming via HTTP Range, e download de vídeos."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend que implementa todos os endpoints de upload, streaming, download, e o worker de processamento de vídeos. Inclui nova infraestrutura Docker (MinIO + Redis).
- `next-frontend/` — fora do escopo desta fase. Interface de vídeo planejada para fases posteriores.

---

## TD-01: Upload Protocol

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** Arquivos de até 10GB precisam ser enviados ao servidor sem travar a API. A escolha do protocolo impacta a experiência do usuário, a complexidade de implementação e a compatibilidade com o frontend futuro.

**Options:**

### Option A: Multipart upload direto na API NestJS com streaming para MinIO

- O cliente envia um multipart/form-data POST para a API. O NestJS usa `busboy` para receber o stream sem buffer em disco e faz pipe diretamente para o MinIO via SDK. A entidade `Video` é criada como rascunho antes do stream começar.
- **Pros:** Simplicidade de implementação, sem dependências extras além de `@aws-sdk/client-s3` ou `minio`, sem necessidade de Redis para estado de upload, controle centralizado na API.
- **Cons:** Conexões longas (potencial timeout em uploads longos), sem suporte nativo a retomada em caso de falha de conexão, escala horizontal requer sticky sessions ou ajuste de timeout no load balancer.

### Option B: Chunked upload com protocolo tus (resumable)

- O cliente divide o arquivo em chunks e faz uploads parciais usando o protocolo tus. O servidor mantém estado de progresso. Suporta retomada em caso de queda.
- **Pros:** Robustez para conexões instáveis, suporte a retomada de upload, melhor UX para arquivos muito grandes.
- **Cons:** Requer `@tus-io/server` ou implementação manual, maior complexidade, estado de upload persistido em disco/Redis, frontend precisa de client tus.

### Option C: Presigned URLs do MinIO (upload direto cliente → MinIO)

- A API gera uma presigned URL e o cliente faz upload diretamente para o MinIO sem passar pela API. A API recebe apenas metadados e notificação pós-upload via webhook ou polling.
- **Pros:** Máxima escalabilidade, API não fica bloqueada durante o upload, sem limite de tamanho na API.
- **Cons:** Expõe a infraestrutura de armazenamento ao cliente, exige coordenação via webhook ou polling para detectar conclusão, frontend fora do escopo dificulta validação nesta fase.

**Recommendation:** **Option A** — Para esta fase de backend, a abordagem multipart com streaming direto para MinIO é suficiente e bem alinhada com o stack NestJS. O streaming via pipe evita bufferizar o arquivo em disco. O frontend futuro pode evoluir para presigned URLs na Fase 04/05 se necessário.

**Decision:** A (Multipart upload com streaming para MinIO via busboy/multer)

**Implementation note:** Multer uses disk storage in the OS temp directory instead of memory, then pipes the temp file stream to MinIO and removes the file in a `finally` block. For 10GB files this avoids buffering the whole upload in RAM while still keeping a constant-memory stream to storage.

**Libraries:** `@aws-sdk/client-s3@^3.x` (compatível com MinIO via endpoint customizado) ou `minio@^8.x` (SDK nativo)

---

## TD-02: Object Storage

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** O projeto precisa de armazenamento de objetos para vídeos e thumbnails. Para desenvolvimento local com Docker, a escolha deve ser executável em container e compatível com a API S3.

**Options:**

### Option A: MinIO local via Docker

- MinIO é um object storage open-source compatível com a API S3. Roda em container Docker, ideal para desenvolvimento local. Pode ser substituído por S3 real em produção apenas alterando as credenciais.
- **Pros:** Compatível com API S3 (permite migração futura sem mudança de código), roda localmente em Docker, console web de administração, gratuito e open-source.
- **Cons:** Requer container adicional no Docker Compose, não é o ambiente de produção real.

### Option B: AWS S3 real

- Usar S3 diretamente, mesmo em desenvolvimento.
- **Pros:** Ambiente idêntico ao de produção.
- **Cons:** Requer conta AWS e credenciais, gera custos, não adequado para ambiente local de desenvolvimento do desafio, dependência de internet.

**Recommendation:** **Option A** — MinIO é a escolha óbvia para desenvolvimento local. O uso do SDK compatível com S3 (`@aws-sdk/client-s3`) garante que a migração para S3 real em produção seja apenas uma mudança de credenciais.

**Decision:** A (MinIO via Docker com SDK S3-compatible)

**Implementation note:** Official MinIO images were removed from Docker Hub/Quay in 2026. `compose.yaml` uses the community mirror `pgsty/minio:latest`, which ships the same server and `mc` CLI, preserving the S3-compatible API and healthcheck.

**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/lib-storage@^3.x` (para uploads multipart)

---

## TD-03: Message Queue

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** O processamento de vídeos com FFmpeg é pesado e deve acontecer em background. Uma fila de mensagens desacopla o upload do processamento e permite retry em caso de falha.

**Options:**

### Option A: BullMQ + Redis

- BullMQ é a biblioteca de filas mais popular para Node.js/NestJS, com integração oficial via `@nestjs/bullmq`. Usa Redis como backend. Suporta prioridades, retry com backoff, rate limiting, eventos de progresso e UI de monitoramento (Bull Board).
- **Pros:** Integração nativa com NestJS via `@nestjs/bullmq`, Redis é familiar no ecossistema Node.js, UI de monitoramento Bull Board, suporte a cron jobs, retry automático com backoff exponencial.
- **Cons:** Requer Redis como infraestrutura adicional, overhead de Redis para casos simples.

### Option B: RabbitMQ

- Broker de mensagens enterprise com suporte a AMQP. Usado em arquiteturas de microserviços.
- **Pros:** Mais robusto para arquiteturas distribu\ídas reais, suporte a múltiplos consumers, DLQ nativo.
- **Cons:** Curva de aprendizado maior, sem integração tão nativa com NestJS quanto BullMQ, mais complexo para este contexto de monorepo.

### Option C: Amazon SQS

- Fila gerenciada da AWS.
- **Pros:** Gerenciado, escalável, sem manutenção.
- **Cons:** Requer conta AWS, dependência de internet, não adequado para ambiente local do desafio.

**Recommendation:** **Option A** — BullMQ + Redis é a escolha mais natural para NestJS. A integração via `@nestjs/bullmq` é primeira classe, e Redis é uma adição comum ao stack. Para esta fase, o overhead é justificado pela facilidade de desenvolvimento e monitoramento.

**Decision:** A (BullMQ + Redis via @nestjs/bullmq)

**Libraries:** `@nestjs/bullmq@^11.x`, `bullmq@^5.x`, `ioredis@^5.x`

---

## TD-04: Video Worker Architecture

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** O processamento FFmpeg precisa rodar em background. A questão é se cria um subprojeto separado ou se o worker fica dentro do NestJS como um processor do BullMQ.

**Options:**

### Option A: Worker como módulo NestJS (BullMQ Processor dentro do nestjs-project)

- O `VideoWorkerModule` com um `@Processor('video-processing')` fica dentro do `nestjs-project`. A mesma aplicação NestJS funciona como API e como worker, consumindo jobs da fila Redis.
- **Pros:** Um único projeto, sem complexidade de múltiplos subprojetos, compartilha entidades TypeORM e serviços, fácil de desenvolver e testar, CI/CD mais simples.
- **Cons:** API e worker rodam no mesmo processo (mas podem escalar separadamente via variável de ambiente para habilitar/desabilitar o worker), acoplamento entre preocupações.

### Option B: Subprojeto separado (video-worker/)

- Um novo diretório `video-worker/` com seu próprio `package.json`, Dockerfile e configuração, conectando à mesma fila Redis e banco PostgreSQL.
- **Pros:** Isolamento real, pode escalar independentemente, falha do worker não afeta a API.
- **Cons:** Duplicação de código (entidades, configs, DTOs), dois projetos para manter, mais complexidade de Docker Compose, out of scope do desafio (backend = API + worker conforme enunciado).

**Recommendation:** **Option A** — Para esta fase, manter o worker dentro do NestJS como um `@Processor` do BullMQ é suficiente e muito mais simples. O NestJS suporta nativamente múltiplos workers na mesma aplicação. Separar em subprojeto é uma evolução arquitetural para fases futuras se necessário.

**Decision:** A (Worker como BullMQ Processor dentro do nestjs-project)

---

## TD-05: URL Única dos Vídeos

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Cada vídeo precisa de um identificador único que apareça na URL. A escolha impacta a UX, segurança e consistência com o projeto.

**Options:**

### Option A: UUID v4 (padrão TypeORM do projeto)

- Usar o UUID v4 gerado automaticamente pelo TypeORM como identificador do vídeo (`@PrimaryGeneratedColumn('uuid')`). O UUID já é o padrão para todas as entidades do projeto (users, channels, tokens).
- **Pros:** Consistente com o padrão existente no projeto, sem dependência extra, globalmente único por design, impossível de enumerar.
- **Cons:** URLs longas (36 caracteres com hifens), não amigáveis para memorização.

### Option B: Nanoid

- Gerar um ID curto e URL-friendly (ex: `V1StGXR8_Z5jdHi6B-myT`) usando a biblioteca `nanoid`.
- **Pros:** URLs curtas e legíveis, URL-friendly por padrão, colisão extremamente improvável com alphabet configurável.
- **Cons:** Adiciona dependência extra, quebra a consistência com o padrão UUID do projeto, requer lógica de verificação de colisão.

**Recommendation:** **Option A** — UUID v4 é o padrão estabelecido no projeto para todas as entidades. Manter consistência é mais importante que URLs curtas nesta fase de backend. A URL de streaming será algo como `/videos/{uuid}/stream`, que é perfeitamente funcional.

**Decision:** A (UUID v4 via TypeORM @PrimaryGeneratedColumn('uuid'))

---

## TD-06: Streaming de Vídeo

**Scope:** Backend

**Capability:** Reprodução via streaming (sem necessidade de download completo)

**Context:** O streaming permite que o usuário comece a assistir antes do download completo. A questão é se a API faz proxy do arquivo ou se o cliente acessa o storage diretamente.

**Options:**

### Option A: NestJS API com HTTP Range Requests (StreamableFile)

- O endpoint `GET /videos/:id/stream` busca o arquivo no MinIO e faz streaming para o cliente usando `StreamableFile` do NestJS com suporte a `Range` headers. O NestJS implementa a lógica de streaming parcial (206 Partial Content).
- **Pros:** Controle de acesso centralizado na API (autenticação e autorização), sem exposição direta do MinIO ao cliente, suporte a vídeos privados/unlisted, compatível com players HTML5 que usam Range requests.
- **Cons:** A API consome bandwidth para fazer proxy, maior latência que acesso direto ao storage.

### Option B: Presigned URLs do MinIO (acesso direto cliente → MinIO)

- A API gera uma presigned URL temporária do MinIO. O cliente acessa o MinIO diretamente para streaming.
- **Pros:** Sem carga na API para streaming, melhor performance, MinIO tem suporte nativo a Range requests.
- **Cons:** Expõe a URL do MinIO ao cliente, harder to implement access control, frontend precisa implementar lógica de renovação de presigned URLs.

**Recommendation:** **Option A** — Manter o controle na API é mais seguro e correto para o escopo desta fase. O frontend futuro pode obter presigned URLs da API para streaming otimizado se necessário. O `StreamableFile` do NestJS com `Range` headers é o padrão recomendado para esta arquitetura.

**Decision:** A (NestJS API com StreamableFile + Range headers)

---

## TD-07: FFmpeg Integration

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** O processamento de vídeo requer FFmpeg/FFprobe. A integração pode ser feita via CLI direto, via wrappers Node.js, ou via binários inclusos no projeto.

**Options:**

### Option A: fluent-ffmpeg + @ffprobe-installer/ffprobe + @ffmpeg-installer/ffmpeg

- Usar `fluent-ffmpeg` como wrapper de alto nível para FFmpeg e FFprobe. Instalar os binários via `@ffmpeg-installer/ffmpeg` e `@ffprobe-installer/ffprobe` (incluem os binários nativos no package).
- **Pros:** API fluente e bem documentada, binários incluídos via npm (sem precisar instalar FFmpeg no sistema/container), cross-platform, suporte a eventos de progresso.
- **Cons:** Binários npm podem não ter todas as features compiladas, tamanho do pacote npm grande.

### Option B: child_process direto com FFmpeg instalado no container

- Executar FFmpeg via `spawn()`/`exec()` no Node.js. FFmpeg instalado diretamente no Dockerfile via `apt-get install ffmpeg`.
- **Pros:** Binário oficial completo com todas as features, sem overhead de wrapper, controle total.
- **Cons:** Mais código boilerplate, parsear saída do FFmpeg manualmente, Dockerfile mais complexo.

### Option C: ffmpeg-static + fluent-ffmpeg

- Usar `ffmpeg-static` (fornece binário estático) e `fluent-ffmpeg` (wrapper). Similar ao Option A mas com pacotes diferentes.
- **Pros:** Similar ao A com binários estáticos confiáveis.
- **Cons:** `ffmpeg-static` não inclui `ffprobe`.

**Recommendation:** **Option A** — `fluent-ffmpeg` com `@ffmpeg-installer` e `@ffprobe-installer` é a abordagem mais comum para NestJS/Node.js. A API fluente facilita extração de metadados e geração de thumbnails. Os binários incluídos simplificam o Dockerfile.

**Decision:** A (fluent-ffmpeg + @ffmpeg-installer/ffmpeg + @ffprobe-installer/ffprobe)

**Libraries:** `fluent-ffmpeg@^2.x`, `@ffmpeg-installer/ffmpeg@^1.x`, `@ffprobe-installer/ffprobe@^1.x`, `@types/fluent-ffmpeg@^2.x`

---

## TD-08: Video Status State Machine

**Scope:** Backend

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload; Processamento automático do vídeo após upload

**Context:** Um vídeo passa por múltiplos estados desde o upload até estar disponível para streaming. O design do estado machine impacta como a API e o worker se coordenam.

**Options:**

### Option A: Status enum com transições simples

- Enum `VideoStatus`: `PENDING_UPLOAD` → `PROCESSING` → `READY` | `ERROR`. A entidade `Video` é criada com `PENDING_UPLOAD` antes do upload começar. Após upload, status vai para `PROCESSING` e um job é publicado. O worker muda para `READY` ou `ERROR`.
- **Pros:** Simples, fácil de entender, suficiente para o escopo desta fase.
- **Cons:** Sem suporte a estados intermediários de processamento detalhados (% de progresso).

### Option B: Status enum com progresso granular

- Adicionar campos como `processing_progress` (0-100%), `processing_stage` (uploading/transcoding/thumbnailing) para feedback mais rico.
- **Pros:** Melhor UX no futuro (progress bar), útil para debug.
- **Cons:** Complexidade desnecessária para esta fase, progresso de FFmpeg requer SSE ou WebSocket no frontend.

**Recommendation:** **Option A** — O enum simples é suficiente para a Fase 03. Estados granulares podem ser adicionados na Fase 04 se o frontend precisar.

**Decision:** A (VideoStatus enum: PENDING_UPLOAD → PROCESSING → READY | ERROR)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Upload Protocol | Multipart + streaming para MinIO | A (Multipart via busboy/multer) |
| TD-02 | Backend | Object Storage | MinIO local Docker | A (MinIO + @aws-sdk/client-s3) |
| TD-03 | Backend | Message Queue | BullMQ + Redis | A (BullMQ + Redis) |
| TD-04 | Backend | Worker Architecture | Worker dentro do NestJS | A (BullMQ Processor no nestjs-project) |
| TD-05 | Backend | URL Única | UUID v4 padrão do projeto | A (TypeORM @PrimaryGeneratedColumn('uuid')) |
| TD-06 | Backend | Streaming | API proxy com Range headers | A (NestJS StreamableFile + Range) |
| TD-07 | Backend | FFmpeg Integration | fluent-ffmpeg + installers | A (fluent-ffmpeg + @ffmpeg-installer) |
| TD-08 | Backend | Video Status | Enum simples PENDING→PROCESSING→READY/ERROR | A (VideoStatus enum) |
