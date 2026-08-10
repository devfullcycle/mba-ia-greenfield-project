# Design Checklist: Phase 03 — Upload e Processamento de Vídeos

**Purpose**: Auditoria formal de qualidade dos artefatos de design (contratos, modelo de dados, plano, research) — usada pelo autor antes de iniciar a implementação para identificar lacunas, ambiguidades e inconsistências nos requisitos escritos.
**Created**: 2026-06-27
**Feature**: [spec.md](../spec.md) | [plan.md](../plan.md) | [data-model.md](../data-model.md) | [contracts/videos-api.md](../contracts/videos-api.md)

> Este checklist é um "unit test para requisitos escritos": cada item pergunta se os requisitos estão **completos, claros, consistentes e mensuráveis** — não se a implementação funciona.

---

## Completude dos Contratos da API

- [x] CHK001 — O contrato de `POST /videos` especifica o comportamento quando o usuário autenticado não possui canal (cenário US1 Scenario 4)? A distinção entre "sem canal" (403) e "sem autenticação" (401) está documentada? [Completeness, Contracts §1, Spec §US1 Scenario 4] → **Resolvido**: contracts §1 documenta 403 para "sem canal ativo" e 401 para token ausente — distinção clara.
- [x] CHK002 — A validade da URL pré-assinada (15 minutos, conforme research.md §2) está documentada no contrato de `POST /videos` como parte da resposta ou das notas do endpoint? [Completeness, Contracts §1, Research §2, Gap] → **Resolvido**: contracts §1 response: "upload_url: ...válida por 15 min".
- [x] CHK003 — O contrato de `POST /videos/:id/upload-complete` especifica o comportamento para chamadas idempotentes (endpoint chamado duas vezes para o mesmo vídeo)? [Completeness, Contracts §2, Spec §Edge Cases] → **Resolvido**: contracts §2: "400 Bad Request — Vídeo não está em status draft (ex.: já foi confirmado)".
- [x] CHK004 — O contrato de `GET /videos/:id/stream` especifica como o `Content-Type` da resposta é determinado pelo servidor (qual mime-type é servido, dado que o formato não é conhecido em tempo de design)? [Completeness, Contracts §4, Gap] → **Resolvido**: Content-Type propagado do MinIO via `StorageService.getObject()` (tasks T034/T035); reflete o mime_type enviado no PUT pré-assinado pelo cliente.
- [x] CHK005 — O contrato de `GET /videos/:id/stream` especifica o comportamento quando o vídeo tem status `error` (além de `draft` e `processing`)? [Completeness, Contracts §4] → **Resolvido**: contracts §4: "409 Conflict — Vídeo não está em status ready" — cobre `error`, `draft` e `processing`.
- [x] CHK006 — O contrato de `GET /videos/:id/download` especifica a extensão de arquivo usada no `Content-Disposition` (e.g., `video.mp4`) — como o servidor determina a extensão se ela não está explicitamente armazenada? [Clarity, Contracts §5, Gap] → **Resolvido**: tasks T049: "derivar extensão do storageKey" (ex.: `videos/{id}/original.mp4` → `.mp4`).
- [x] CHK007 — O contrato de `GET /channels/:channelId/videos` especifica o comportamento quando um usuário autenticado (não-dono) tenta acessar a listagem de outro canal? [Completeness, Contracts §6, Spec §FR-017] → **Resolvido**: contracts §6: "403 Forbidden — Canal pertence a outro usuário".
- [x] CHK008 — Os parâmetros de paginação (`page`, `limit`) têm valores mínimos e máximos documentados no contrato? O comportamento com `limit=0` ou `page=0` está definido? [Completeness, Contracts §6] → **Aceito**: DTO (tasks T039) enforça `@Min(1)` e `@Max(100)` — valores inválidos retornam 400 automaticamente. Contracts documentam defaults (20) e máximo (100).
- [x] CHK009 — O contrato de `DELETE /videos/:id` especifica o comportamento quando o `storage_key` é nulo (vídeo `draft` cujo upload nunca foi feito)? A exclusão de arquivos inexistentes é tratada graciosamente? [Completeness, Contracts §8, Gap] → **Resolvido**: storage_key é NOT NULL desde o pré-registro (FR-002 atualizado); tasks T043: "tolerante a NoSuchKey" para storageKey e thumbnailKey.
- [x] CHK010 — O código de resposta `200 OK` de `POST /videos/:id/upload-complete` é adequado para indicar processamento assíncrono, ou deveria ser `202 Accepted`? A escolha está justificada nos artefatos? [Clarity, Contracts §2] → **Aceito**: 200 OK é pragmático — o enfileiramento BullMQ é síncrono; o response confirma que o job foi enfileirado. Sem ambiguidade semântica para o cliente.
- [x] CHK011 — São os cenários de falha de infraestrutura (MinIO indisponível, Redis indisponível) durante chamadas de API especificados em algum artefato? [Completeness, Gap] → **Aceito**: MinIO indisponível → S3 SDK lança NetworkingError → propagado como 500. Redis indisponível → documentado em data-model.md e contracts §2 (500, status permanece draft). Comportamento padrão de infraestrutura.

---

## Clareza dos Contratos da API

- [x] CHK012 — O campo `thumbnail_url` retornado por `GET /videos/:id` é uma URL completa (http://...) ou uma chave de objeto? Como o servidor monta essa URL? Está especificado? [Clarity, Contracts §3, Ambiguity] → **Resolvido**: definido como URL HTTP completa gerada pelo servidor a partir de thumbnail_key.
- [x] CHK013 — O campo `processing_metadata` (jsonb) em `GET /videos/:id` tem o schema dos campos retornados especificado (e.g., resolução, codec, bitrate)? Ou é opaco para o cliente? [Clarity, Contracts §3, Data-Model §Video, Gap] → **Resolvido**: schema mínimo `{ width, height, codec, bitrate_kbps }` documentado em data-model.md e contracts.
- [x] CHK014 — O campo `upload_key` retornado por `POST /videos` está claramente diferenciado do `id` do vídeo? A semântica (caminho no storage vs. identificador interno) está documentada para o cliente? [Clarity, Contracts §1] → **Resolvido**: contracts §1 response distingue `id: uuid` (identificador) de `storage_key: string` (caminho no storage) com semânticas explícitas.
- [x] CHK015 — A definição de "OWNER" usada nos contratos (AUTH + dono do canal) está formalizada em uma seção de autenticação no próprio documento de contratos, ou apenas implícita? [Clarity, Contracts §Auth] → **Resolvido**: contracts §Autenticação formaliza: "[OWNER] requerem AUTH + que `channel.userId === auth.userId`".
- [x] CHK016 — O contrato de `PATCH /videos/:id` especifica se todos os campos do body são opcionais (PATCH semântico) ou obrigatórios? A ausência do campo `title` resulta em 400 ou é ignorada? [Clarity, Contracts §7] → **Resolvido**: contracts §7 body: "title: string (1-255 chars, **obrigatório**)" — ausência retorna 400.

---

## Completude do Modelo de Dados

- [x] CHK017 — O campo `storage_key` na entidade Video é declarado como nullable no data-model.md, mas o contrato de `POST /videos` retorna `upload_key` — o que indica que a chave é pré-determinada pela API no momento do pré-registro. Essa inconsistência (nullable vs. preenchido imediatamente) está resolvida? [Conflict, Data-Model §storage_key, Contracts §1] → **Resolvido**: storage_key agora é NOT NULL, preenchido no pré-registro.
- [x] CHK018 — O schema esperado de `processing_metadata` (jsonb) — quais campos o worker deve persistir e em qual formato — está especificado no data-model.md ou em algum artefato? [Completeness, Data-Model §Video, Gap] → **Resolvido**: data-model.md §processing_metadata e FR-005 (atualizado): schema mínimo `{ width, height, codec, bitrate_kbps }`.
- [x] CHK019 — O campo `error_cause` tem comprimento máximo definido? É um campo interno (não exposto ao usuário final) ou retornado em `GET /videos/:id`? [Clarity, Data-Model §Video, Ambiguity] → **Resolvido**: varchar(2048), campo interno, não exposto ao usuário final.
- [x] CHK020 — A convenção de nomenclatura dos objetos no storage (`videos/{id}/original.mp4`, `videos/{id}/thumbnail.jpg`) está especificada como requisito de forma que o worker e a API usem a mesma convenção? [Completeness, Data-Model §Video, Gap] → **Resolvido**: data-model.md §storage_key: "ex.: `videos/{id}/original.mp4`"; §thumbnailKey: "ex.: `videos/{id}/thumbnail.jpg`".
- [x] CHK021 — A duração em segundos é armazenada como `integer` — é especificado o arredondamento para vídeos com duração fracionada (e.g., 90.5s → 90 ou 91)? [Clarity, Data-Model §duration_seconds] → **Aceito**: arredondamento por truncamento (`Math.floor`) — convenção padrão para duração em segundos inteiros. Decisão implícita de implementação.
- [x] CHK022 — Os índices planejados (`idx_videos_channel_id_created_at`) cobrem as queries de paginação com `ORDER BY created_at DESC` e `WHERE channel_id = ?`? A ordem dos campos no índice composto está especificada? [Completeness, Data-Model §Índices] → **Resolvido**: índice declarado como `(channel_id, created_at DESC)` com nota sobre ordem relevante.
- [x] CHK023 — A constraint de FK `channel_id → channels.id` com `ON DELETE RESTRICT` é consistente com a possibilidade de um criador ter vídeos e querer excluir o canal? Existe restrição de negócio para esse cenário? [Consistency, Data-Model §Constraints, Gap] → **Resolvido**: data-model.md §Constraints: "ON DELETE RESTRICT — canal não pode ser deletado enquanto tiver vídeos" (restrição de negócio intencional).

---

## Clareza da Máquina de Estados

- [x] CHK024 — A transição `draft → processing` ocorre via `POST /videos/:id/upload-complete`. O que acontece se essa chamada for feita quando o status já é `processing` ou `ready`? A máquina de estados trata esse caso? [Completeness, Data-Model §Máquina de Estados, Spec §Edge Cases] → **Resolvido**: contracts §2: "400 Bad Request — Vídeo não está em status draft (ex.: já foi confirmado)"; data-model.md lista transições proibidas completamente.
- [x] CHK025 — O cancelamento por DELETE está representado como transição válida a partir de todos os estados (`draft`, `processing`, `ready`, `error`)? A máquina de estados e o contrato de DELETE estão alinhados? [Consistency, Data-Model §Máquina de Estados, Contracts §8] → **Resolvido**: data-model.md §Máquina de Estados: "DELETE (qualquer status pode ser deletado pelo dono)" documentado explicitamente.
- [x] CHK026 — A regra de idempotência do worker ("verificar se o status ainda é `processing` antes de iniciar") está documentada como requisito funcional (FR) ou apenas como nota de implementação no data-model? [Completeness, Data-Model §Idempotência, Spec §Edge Cases] → **Resolvido**: data-model.md §Idempotência documenta a regra; classificada como nota de implementação intencionalmente — é invariante interno do worker, não contrato de API.
- [x] CHK027 — As transições proibidas da máquina de estados (`ready → qualquer`, `error → qualquer`) estão listadas de forma completa? O que acontece se uma chamada externa tentar forçar uma transição proibida? [Completeness, Data-Model §Máquina de Estados] → **Resolvido**: data-model.md §Transições proibidas: `ready→qualquer` e `error→qualquer` listadas; chamadas que forçam transição proibida recebem BadRequestException.

---

## Consistência de Autorização

- [x] CHK028 — A distinção entre `401 Unauthorized` e `403 Forbidden` está aplicada consistentemente em todos os 8 endpoints? A regra (401 = sem token, 403 = token válido mas sem permissão) está documentada? [Consistency, Contracts §Auth] → **Resolvido**: contracts §Autenticação documenta a regra; cada endpoint lista 401 e 403 com semânticas distintas.
- [x] CHK029 — FR-017 proíbe edição/exclusão de vídeos de outros canais → os endpoints `PATCH /videos/:id` e `DELETE /videos/:id` têm 403 documentado. A listagem `GET /channels/:channelId/videos` também proíbe acesso não-dono? [Consistency, Spec §FR-017, Contracts §6] → **Resolvido**: contracts §6: "403 Forbidden — Canal pertence a outro usuário" documentado no GET /channels/:channelId/videos.
- [x] CHK030 — US1 Scenario 4 menciona "usuário autenticado sem canal" → o que define um canal como ativo ou necessário para upload? A condição de "canal necessário" está especificada na entidade Channel? [Clarity, Spec §US1 Scenario 4, Ambiguity] → **Aceito**: "canal ativo" = canal existente com `channel.userId === auth.userId`. Sem campo `status` em Channel nesta fase; ausência do canal → ForbiddenException.
- [x] CHK031 — O endpoint `GET /videos/:id/download` requer qualquer usuário autenticado (AUTH) — há restrição de que o usuário deve ser dono do canal? Ou qualquer usuário autenticado pode baixar vídeos `ready` de qualquer canal? [Clarity, Spec §FR-010, Contracts §5] → **Resolvido**: contracts §5: [AUTH] — qualquer usuário autenticado pode baixar (não apenas OWNER).
- [x] CHK032 — O cenário de race condition de autorização (usuário cria token, canal é deletado, usuário tenta upload) está documentado como edge case ou assumption? [Completeness, Spec §Assumptions, Gap] → **Aceito**: cenário improvável — ON DELETE RESTRICT impede exclusão de canal com vídeos (CHK023). Se removido por outro meio, FK constraint resulta em 500.

---

## Requisitos do Worker e Processamento Assíncrono

- [x] CHK033 — O intervalo de 5 segundos entre tentativas (research.md §1) está registrado como requisito funcional em algum artefato, ou permanece apenas como decisão de configuração de pesquisa? [Completeness, Spec §FR-008, Research §1] → **Resolvido**: FR-008 atualizado: "intervalo fixo de **5 segundos**" (`backoff: { type: 'fixed', delay: 5000 }`).
- [x] CHK034 — O comportamento de cancelamento de job BullMQ para DELETE de vídeo em `processing` — "cancela a tarefa se ainda possível" — especifica o que acontece quando o job já está sendo executado pelo worker (não apenas enfileirado)? [Clarity, Spec §US6 Scenario 4, Spec §Edge Cases] → **Resolvido**: FR-016 atualizado: "best-effort — jobs em execução ativa não são interrompidos; worker descartará ao não encontrar o registro do vídeo".
- [x] CHK035 — O destino dos arquivos de vídeo no storage após falha definitiva (status `error`) está especificado? O arquivo bruto enviado pelo cliente é mantido ou removido? [Completeness, Spec §FR-008, Gap] → **Aceito**: arquivo bruto no MinIO mantido após status=ERROR (sem cleanup task nesta fase), consistente com spec §Assumptions (limpeza out-of-scope).
- [x] CHK036 — O timeout máximo de um job de processamento no BullMQ está especificado? O que acontece se o processamento durar mais do que o lock timeout do BullMQ? [Completeness, Gap] → **Resolvido**: research.md §1 (atualizado) e tasks T027 documentam `lockDuration: 300_000` ms (5 minutos) nas WorkerOptions — suporta processamento de vídeos grandes sem risco de job orphaned.
- [x] CHK037 — O cenário em que o arquivo de vídeo foi removido do MinIO entre o upload e o início do processamento pelo worker está coberto como falha tratável? [Completeness, Spec §Edge Cases, Gap] → **Aceito**: ffprobe falha ao acessar arquivo ausente → erro relançado → retry → após 3 tentativas → status=ERROR. Coberto pelo mecanismo de retry + error flow.
- [x] CHK038 — O que acontece quando o worker gera a thumbnail com sucesso mas falha ao fazer upload dessa thumbnail para o MinIO? Esse sub-cenário está coberto como erro tratável dentro das 3 tentativas? [Completeness, Spec §Edge Cases] → **Resolvido**: spec §Edge Cases: "thumbnail gerada mas upload ao MinIO falha → relança erro → retry → após 3 tentativas → status=ERROR; sucesso parcial não aceito como ready".
- [x] CHK039 — A mensagem de fila `VideoProcessingJob` inclui `bucketName` como campo explícito. A justificativa para não obtê-lo da configuração está documentada? [Clarity, Data-Model §Mensagem de Fila] → **Resolvido**: data-model.md §VideoProcessingJob: "storageKey e bucketName incluídos para evitar lookup extra no worker".

---

## Requisitos Não-Funcionais e Infraestrutura

- [x] CHK040 — SC-001 define "sem timeout" para uploads de 10 GB, mas não quantifica tempo máximo aceitável de processamento do vídeo pelo worker — há uma métrica de SLA de processamento definida? [Measurability, Spec §SC-001, Gap] → **Aceito**: SLA de processamento é out-of-scope nesta fase. SC-001 cobre apenas o upload (via URL pré-assinada). Processamento assíncrono sem SLA definido.
- [x] CHK041 — SC-004 menciona streaming "com suporte a range requests" mas não quantifica latência de início de reprodução — essa métrica está intencionalmente ausente ou é uma lacuna? [Measurability, Spec §SC-004] → **Aceito**: latência de startup depende de rede e buffering do cliente — fora do controle da API. SC-004 valida o mecanismo (range requests), não a latência.
- [x] CHK042 — O criador do bucket MinIO está especificado — a aplicação cria o bucket automaticamente no startup, ou ele deve ser pré-criado? Há um requisito de bootstrap documentado? [Completeness, Research §2, Gap] → **Resolvido**: tasks T013: `StorageService.onModuleInit()` cria bucket automaticamente se não existir (HeadBucketCommand + CreateBucketCommand) — idempotente.
- [x] CHK043 — As variáveis de ambiente necessárias para os novos serviços Docker (Redis host/port, MinIO endpoint/credenciais/bucket) estão listadas explicitamente em algum artefato de configuração? [Completeness, Plan §Source Code, Spec §FR-012, Gap] → **Resolvido**: tasks T010 lista todas as envs: STORAGE_ENDPOINT, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY, STORAGE_BUCKET, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD.
- [x] CHK044 — SC-006 exige "um único comando de inicialização" — os health checks dos novos serviços (Redis, MinIO, worker) estão especificados para garantir ordem de startup correta? [Completeness, Spec §SC-006, Gap] → **Resolvido**: tasks T004: health check `mc ready /data` (MinIO); T005: `redis-cli ping` (Redis); T007: `depends_on` com condições de saúde.
- [x] CHK045 — O espaço em disco temporário necessário no container do worker para processar um vídeo de 10 GB com FFmpeg está estimado ou mencionado como requisito de infraestrutura? [Completeness, Gap] → **Aceito**: espaço transitório — arquivo removido em `finally` (tasks T027). Requer ~20 GB livres no host Docker. Pré-requisito de deploy fora do escopo desta fase.
- [x] CHK046 — O `Dockerfile.worker` está planejado com FFmpeg — há requisito de versão mínima do FFmpeg ou apenas "qualquer versão disponível no base image"? [Clarity, Plan §Source Code] → **Aceito**: FFmpeg mais recente via apt-get na imagem `node:22-slim`. `fluent-ffmpeg` + `@ffprobe-installer/ffprobe` encapsulam compatibilidade de versão.

---

## Cobertura de Edge Cases e Fluxos de Falha

- [x] CHK047 — O edge case de URL pré-assinada expirada (cliente demora mais de 15 min para iniciar o upload) está documentado? O que o cliente deve fazer nesse cenário? [Completeness, Research §2, Gap] → **Aceito**: URL expirada → cliente recebe 403 do MinIO diretamente. Responsabilidade do cliente re-chamar `POST /videos` para nova URL. Cenário de UX do cliente, não da API.
- [x] CHK048 — O edge case de MinIO indisponível no momento de `POST /videos` (geração da URL pré-assinada) está coberto como falha tratável com resposta de erro? [Completeness, Gap] → **Aceito**: S3 SDK lança NetworkingError → propagado como 500 Internal Server Error. Mesmo tratamento de CHK011 — comportamento padrão de infraestrutura.
- [x] CHK049 — O edge case de Redis/fila indisponível no momento de `POST /videos/:id/upload-complete` está especificado? O status do vídeo muda para `processing` antes ou depois do enfileiramento? [Completeness, Spec §FR-004, Gap] → **Resolvido**: enfileiramento ocorre primeiro; falha retorna 500 e status permanece `draft`. Documentado em data-model.md e contracts §2.
- [x] CHK050 — A política de out-of-scope para limpeza de drafts abandonados (spec §Edge Cases item 1) está documentada com clareza suficiente para que o desenvolvedor saiba que NÃO deve implementar esse cleanup? [Clarity, Spec §Edge Cases, Spec §Assumptions] → **Resolvido**: spec §Assumptions: "limpeza de rascunhos abandonados é out-of-scope" — desenvolvedor NÃO deve implementar cleanup de drafts.
- [x] CHK051 — O edge case de arquivo vazio ou corrompido especifica em qual etapa do worker a detecção ocorre (ffprobe, ffmpeg, ou upload) para que o teste de integração possa simulá-la corretamente? [Clarity, Spec §Edge Cases] → **Resolvido**: tasks T027: ffprobe é a primeira etapa (passo 3) — arquivo corrompido falha no ffprobe → erro relançado → retry → após 3 tentativas → status=ERROR.
- [x] CHK052 — O comportamento de DELETE de vídeo com `thumbnail_key` nulo (processamento falhou antes de gerar thumbnail) está especificado — a exclusão de arquivos inexistentes no storage é tolerada? [Completeness, Contracts §8, Gap] → **Resolvido**: tasks T043: "remover storageKey e thumbnailKey do MinIO (tolerante a NoSuchKey)" — exclusão de arquivo inexistente é graciosamente ignorada.

---

## Consistência Entre Artefatos

- [x] CHK053 — O tamanho de página padrão definido em research.md (20 itens) está refletido no contrato de `GET /channels/:channelId/videos` como valor padrão explícito do parâmetro `limit`? [Consistency, Contracts §6, Research §6] → **Resolvido**: contracts §6: "limit | integer | 20 | Itens por página (máx. 100)" e "page | integer | 1" documentados.
- [x] CHK054 — O requisito FR-013 (migration versionada) está alinhado entre spec.md, data-model.md (seção Migration) e plan.md (Source Code)? [Consistency, Spec §FR-013, Data-Model §Migration, Plan §Source Code] → **Resolvido**: FR-013, data-model.md §Migration e plan.md §Constraints todos exigem migration versionada — consistentes.
- [x] CHK055 — O limite de 255 caracteres para `title` está consistente entre data-model.md (`varchar(255)`) e contracts/videos-api.md (`1-255 chars` no request body)? [Consistency, Data-Model §title, Contracts §1 e §7] → **Resolvido**: data-model.md: varchar(255); contracts §1 e §7: "1-255 chars, obrigatório" — consistentes.
- [x] CHK056 — A decisão de usar o UUID `id` como identificador de URL (research.md §5) elimina a ambiguidade do spec que fala em "identificador único da URL" como conceito independente do PK? O spec foi atualizado para refletir essa decisão? [Consistency, Spec §US5, Research §5] → **Resolvido**: adicionada assumption em spec.md: UUID `id` É o identificador da URL; não existe campo slug separado.
- [x] CHK057 — FR-012 exige que storage, fila e worker "subam com a stack existente" — o plan.md lista os novos serviços Docker mas os `env vars` necessários estão explicitados em algum artefato (e.g., `compose.yaml` documentado ou `.env.example`)? [Completeness, Spec §FR-012, Plan §Source Code, Gap] → **Resolvido**: tasks T010 documenta atualização de `.env.example` e adição de `environment:` no serviço `nestjs-api` do compose.yaml.
- [x] CHK058 — A propriedade `storage_key` na entidade Video e o campo `upload_key` retornado no contrato de `POST /videos` referem-se ao mesmo valor? A terminologia está unificada entre os artefatos? [Consistency, Data-Model §storage_key, Contracts §1, Ambiguity] → **Resolvido**: campo renomeado para `storage_key` no contrato; terminologia unificada.

---

## Notes

- Itens `→ **Resolvido**` têm cobertura explícita em algum artefato (spec, data-model, contracts, tasks, research).
- Itens `→ **Aceito**` representam riscos conscientes com justificativa documentada — decisão intencional de não especificar.
- Itens marcados `[Gap]` originais foram todos endereçados (resolvidos ou aceitos) nesta revisão.
- Marcar como concluído: `[x]`. Adicionar observações inline quando relevante.
