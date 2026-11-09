# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 0/13 completed

### SI-03.1 — Infra: Dependências, Configuração e Serviços Redis/MinIO no Compose
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.2 — Criar StorageModule com Clientes S3 Interno e Público
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.3 — Criar Entidade Video, Migration e Gerador de public_id
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.4 — Infra: Fila video-processing e Processo video-worker
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.5 — Endpoint POST /videos/uploads (Início do Upload e Pré-cadastro em Rascunho)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.6 — Endpoints POST /videos/:id/uploads/parts e DELETE /videos/:id/uploads (Renovação e Abort)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.7 — Endpoint POST /videos/:id/uploads/complete (Finalização e Enfileiramento)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.8 — Processar Vídeo no Worker (Metadados, Thumbnail e Política de Falha)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.9 — Reconciliar Vídeos Presos em PROCESSING
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.10 — Endpoint GET /videos/:id (Metadados com Autenticação Opcional)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.11 — Endpoints GET /videos/:id/stream, /download e /thumbnail (Proxy com Range)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.12 — Criar Cliente de Upload scripts/upload-video.ts
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

### SI-03.13 — Fluxo Completo de Upload, Processamento e Streaming (prova de entrega)
- **Status:** pending
- **Tests:** no tests
- **Observations:** none

## Validações do planejamento

Vereditos dos validadores independentes (subagente novo por ciclo, conforme o "Modelo de execução" de `docs/Desafio 5 — plano detalhado.md`).

- 2026-11-05 — Etapa 1 Research (`technical-decisions-phase-03-videos.md`) — APROVADO — 1 ciclo. Observação: o Scope Repo-wide do TD-05 é discutível.
- 2026-11-08 — Etapas 2-3 Contexto, validação e resolução (`context.md`, `validation.md`, `library-refs.md`) — validador independente não executado; o merge foi feito a pedido do responsável (commit 3e0f878).
- 2026-11-09 — Etapa 4 Build (`phase-03-videos.md`) — APROVADO — 5 ciclos (limite de 3 estendido pelo responsável). Ciclos 1 a 4 reprovados com 2 bloqueantes cada, todos corrigidos:
  - Ciclo 1: fixtures criadas depois do SI que as usa; falha de rede classificada como erro permanente (contrariava o TD-09).
  - Ciclo 2: URLs assinadas para `localhost:9000` inalcançáveis de dentro dos containers (resolvido com `--storage-connect`); teste do reconciler virando no-op.
  - Ciclo 3: `ThrottlerGuard` global da Fase 02 bloqueando as rotas de vídeo (`@SkipThrottle()`); `scripts/` fora do `exclude` do `tsconfig.build.json`.
  - Ciclo 4: volume anônimo sobre o `dist` do worker (`EBUSY`), trocado por `dist-worker`; `@Generated` em `seq` quebrando `public_id = Sqids(seq)`; ação de lifecycle não suportada pelo MinIO.
  - Ciclo 5: aprovado; não bloqueantes para tratar no `/implement`: `"dist-worker"` no `exclude` do tsconfig, `default nextval` na entidade, `MaxLength(127)` em `mime_type`, `VIDEO_PUBLIC_ID_ALPHABET`/`REDIS_*` no `.env.example`, `load` dos configs novos no `ConfigModule`.

**Desvio registrado — TD-04:** o TD pede "bucket lifecycle aborts incomplete multipart after 1 day". O MinIO não implementa a ação de lifecycle `AbortIncompleteMultipartUpload`; o plano (SI-03.1) usa `MINIO_API_STALE_UPLOADS_EXPIRY=24h`, mecanismo nativo do MinIO com o mesmo efeito (uploads incompletos são abortados após ~1 dia). A revisão formal no `technical-decisions-phase-03-videos.md` fica para o fechamento da fase: editar o doc agora alteraria o mtime das fontes e invalidaria `context.md`, `validation.md` e o plano (staleness do pipeline).
