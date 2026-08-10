# Implementation Sanity Checklist: Phase 03 — Upload e Processamento de Vídeos

**Purpose**: Checklist de sanidade para o autor — valida que os requisitos em todos os 4 domínios críticos (Worker, Infraestrutura, Autorização, Contratos) estão completos, claros e consistentes antes de, durante e após a implementação.
**Created**: 2026-06-29
**Feature**: [spec.md](../spec.md) | [plan.md](../plan.md) | [data-model.md](../data-model.md) | [contracts/videos-api.md](../contracts/videos-api.md)

> **Uso**: Este checklist é um "unit test para requisitos escritos". Cada item pergunta se o **requisito está bem definido nos artefatos** — não se a implementação funciona. Marcar `[x]` significa "o requisito está especificado de forma clara e inequívoca nos artefatos".

---

## Worker & Processamento Assíncrono

### Retry e Falha

- [ ] CHK001 — Os parâmetros de retry (3 tentativas, 5s de intervalo fixo, de research.md §1) estão documentados consistentemente em research.md §1, spec §FR-008 e tasks.md T025? [Consistency, Research §1, Spec §FR-008]
- [ ] CHK002 — O comportamento após o esgotamento das 3 tentativas está especificado com semântica completa de transição de estado (`status→error`, truncamento de `errorCause` em 2048 chars, ausência de status parcial)? [Completeness, Data-Model §Máquina de Estados]
- [ ] CHK003 — O cenário de BullMQ lock timeout (job de processamento durando mais que o TTL de lock do BullMQ) está endereçado em algum artefato? [Gap, Research §1]
- [ ] CHK004 — O cenário "arquivo de vídeo removido do MinIO entre o upload e o início do processamento pelo worker" está documentado como exceção tratável em algum artefato? [Edge Case, Spec §Edge Cases]
- [ ] CHK005 — Está especificado o comportamento quando thumbnail é gerada com sucesso, mas o upload da thumbnail ao MinIO falha — qual é o estado resultante do vídeo e o `errorCause`? [Completeness, Gap]

### Idempotência e Ordem de Execução

- [ ] CHK006 — A regra de idempotência do worker ("verificar se status ainda é `processing` antes de agir") está formalizada como requisito funcional (FR) ou apenas como nota de implementação em data-model.md? [Completeness, Data-Model §Idempotência]
- [ ] CHK007 — Os sub-cenários de falha dentro do pipeline do worker estão especificados com falha independente (ffprobe falha → relança; thumbnail gerada mas BD update falha → qual estado persiste)? [Clarity, Spec §Edge Cases]
- [ ] CHK008 — A concorrência do worker (2 vídeos em paralelo por instância, research.md §4) está formalizada como requisito de configuração ou apenas como decisão de implementação? [Completeness, Research §4]

### Metadados e Convenções de Nomenclatura

- [ ] CHK009 — O schema de `processing_metadata` (`{ width, height, codec, bitrate_kbps }`) está documentado de forma consistente em data-model.md §Video e contracts §3? [Consistency, Data-Model §processing_metadata, Contracts §3]
- [ ] CHK010 — A convenção de nomenclatura dos objetos no storage (`videos/{uuid}/original.{ext}`, `videos/{uuid}/thumbnail.jpg`) está especificada em um artefato que tanto a API quanto o worker podem referenciar de forma unívoca? [Consistency, Data-Model §storage_key, tasks.md T019/T027]
- [ ] CHK011 — A regra de arredondamento para `duration_seconds` em vídeos com duração fracionária (ex.: 90.5s → 90 ou 91) está especificada em data-model.md? [Clarity, Data-Model §duration_seconds]

---

## Infraestrutura & Deploy

### Variáveis de Ambiente

- [ ] CHK012 — Todas as variáveis de ambiente necessárias para os novos serviços (`STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`) estão listadas em um único artefato autoritativo (`.env.example` ou `compose.yaml`)? [Completeness, Spec §FR-012, Gap]
- [ ] CHK013 — Os valores padrão para desenvolvimento (`minio:9000`, `redis:6379`) usam consistentemente os nomes de serviço do Docker Compose — não `localhost`? [Consistency, CLAUDE.md §Docker Networking]
- [ ] CHK014 — O comportamento de `REDIS_PASSWORD` quando ausente (campo opcional sem quebrar o serviço) está especificado com valor default explícito ou semântica null-safe? [Clarity, tasks.md T009]

### Bootstrap e Startup Order

- [ ] CHK015 — O requisito de criação automática do bucket MinIO no startup (`StorageService.onModuleInit`) está formalizado como requisito funcional ou apenas como nota de implementação em tasks.md T013? [Completeness, tasks.md T013, Gap]
- [ ] CHK016 — Os health checks para os 3 novos serviços (Redis: `redis-cli ping`; MinIO: `mc ready /data`) estão especificados no compose.yaml para garantir a ordem correta de startup? [Completeness, Spec §SC-006, tasks.md T004/T005]
- [ ] CHK017 — As condições de `depends_on` do serviço `video-worker` (aguardar `redis`, `db` e `minio` saudáveis) estão especificadas como requisito em tasks.md T007? [Completeness, tasks.md T007]
- [ ] CHK018 — O requisito de espaço em disco temporário no container do worker para processar vídeos de até 10 GB está estimado ou mencionado em algum artefato de infraestrutura? [Gap]

### Dockerfile.worker

- [ ] CHK019 — A versão mínima do FFmpeg está especificada como requisito, ou é aceito "qualquer versão disponível via apt-get"? A decisão está documentada? [Clarity, tasks.md T006]
- [ ] CHK020 — O requisito de limpeza de arquivos temporários em `/tmp/{videoId}` pelo worker (em bloco `finally`) está especificado como comportamento obrigatório nos artefatos? [Completeness, tasks.md T027]

---

## Segurança & Autorização

### Consistência 401 vs 403

- [ ] CHK021 — A regra formal de diferenciação entre `401 Unauthorized` (token ausente ou inválido) e `403 Forbidden` (token válido, permissão insuficiente) está documentada em contracts/videos-api.md §Autenticação ou em documento global de auth? [Completeness, Contracts §Autenticação]
- [ ] CHK022 — A ordem dos checks de autorização está especificada: a API verifica existência do recurso (404) antes ou depois da verificação de ownership (403)? O que retorna para um vídeo inexistente em uma chamada OWNER? [Clarity, Contracts §2/§7/§8]
- [ ] CHK023 — A definição de "OWNER" (usuário autenticado + `channel.userId === authenticatedUser.id`) está formalizada como definição reutilizável em contracts §Autenticação? [Clarity, Contracts §Autenticação]

### Cenários Específicos de Autorização

- [ ] CHK024 — O requisito de que QUALQUER usuário autenticado (não apenas o dono) pode baixar vídeos de QUALQUER canal está formalmente declarado em contracts §5 e spec §FR-010? [Completeness, Contracts §5, Spec §FR-010]
- [ ] CHK025 — A distinção entre "usuário sem canal" (403 em `POST /videos`) e "usuário com canal errado" (403 em endpoints OWNER) está documentada como comportamentos distintos em contracts §1 e §2? [Clarity, Contracts §1, Spec §US1 Scenario 4]
- [ ] CHK026 — O cenário de race condition "canal deletado enquanto token ainda é válido" está documentado como assumption ou edge case explícito em algum artefato? [Coverage, Spec §Assumptions]
- [ ] CHK027 — O requisito que `GET /channels/:channelId/videos` é restrito ao OWNER (não público, não AUTH genérico) está especificado consistentemente em contracts §6 e spec §FR-017? [Consistency, Contracts §6, Spec §FR-017]

---

## Contratos de API

### Formato e Derivação de Campos de Resposta

- [ ] CHK028 — A regra de derivação do `Content-Type` na resposta de streaming (`GET /videos/:id/stream`) está especificada: o servidor usa o `mime_type` do MinIO ou lê os metadados do objeto? [Clarity, Contracts §4, Gap]
- [ ] CHK029 — A regra de derivação da extensão de arquivo no `Content-Disposition` do download (`GET /videos/:id/download`) está especificada: a extensão vem de `storage_key` ou é re-derivada do `mime_type`? [Clarity, Contracts §5, Gap]
- [ ] CHK030 — A fórmula de construção de `thumbnail_url` (`${storageEndpoint}/${bucket}/${thumbnailKey}`) está especificada de forma consistente entre contracts §3 e tasks.md T032? [Consistency, Contracts §3, tasks.md T032]
- [ ] CHK031 — A validade da URL pré-assinada (15 minutos, research.md §2) está documentada em contracts §1 como parte do contrato de resposta do `POST /videos`? [Completeness, Contracts §1, Research §2]

### Comportamentos Limítrofes e Idempotência

- [ ] CHK032 — O comportamento de `POST /videos/:id/upload-complete` quando chamado duas vezes (idempotência) está especificado em contracts §2? O que retorna quando `status` já é `processing`? [Completeness, Contracts §2, Spec §Edge Cases]
- [ ] CHK033 — A justificativa para retornar `200 OK` (em vez de `202 Accepted`) em `POST /videos/:id/upload-complete` está documentada em algum artefato? [Clarity, Contracts §2]
- [ ] CHK034 — O comportamento de `DELETE /videos/:id` quando `storage_key` ou `thumbnail_key` não existe no MinIO (tolerância a `NoSuchKey`) está especificado em contracts §8? [Completeness, Contracts §8]
- [ ] CHK035 — O comportamento de `DELETE /videos/:id` para cancelar um job BullMQ que já está sendo **executado** pelo worker (não apenas enfileirado) está especificado? [Clarity, Contracts §8, Spec §US6 Scenario 4]

### Consistência Entre Artefatos

- [ ] CHK036 — A convenção de nomenclatura `videos/{uuid}/original.{ext}` está especificada de forma consistente entre contracts §1 (campo `storage_key` na resposta), data-model.md §storage_key e tasks.md T019? [Consistency, Contracts §1, Data-Model §storage_key]
- [ ] CHK037 — O limite de 255 caracteres para `title` está consistente entre contracts §1 (body do POST), contracts §7 (body do PATCH), data-model.md §title e DTOs em tasks.md T018/T040? [Consistency, Contracts §1/§7, Data-Model §title]
- [ ] CHK038 — Os constraints dos parâmetros de paginação (`page` min=1, `limit` min=1/max=100, defaults=1/20) estão documentados em contracts §6 de forma completa? [Completeness, Contracts §6, Research §6]

---

## Notes

- Marcar como concluído: `[x]`. Adicionar observações inline quando relevante.
- Itens `[Gap]` indicam ausência de requisito nos artefatos — decidir documentar ou aceitar o risco antes de implementar.
- Itens `[Consistency]` indicam que múltiplos artefatos cobrem o mesmo tópico — verificar alinhamento entre eles.
- Itens `[Clarity]` indicam texto ambíguo que pode gerar interpretações conflitantes entre API e worker.
