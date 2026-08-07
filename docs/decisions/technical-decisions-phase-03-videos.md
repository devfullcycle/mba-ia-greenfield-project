---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-06-26
scope_description: "Upload de vídeos de até 10GB, object storage, fila de processamento, worker FFmpeg, URL única, streaming e download (Fase 03)"
---

# Technical Decisions — Fase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend que ganha o módulo de vídeos, o serviço de storage, a publicação na fila e o worker. Todas as TDs abaixo recaem aqui.
- `next-frontend/` — fora de escopo nesta fase (a interface de vídeo é de fases posteriores). Nenhuma TD abre decisão de frontend; os contratos REST/streaming definidos aqui serão consumidos por ele no futuro, mas não há escolha técnica de frontend em aberto agora.

A infraestrutura nova (object storage, fila e worker) sobe via `nestjs-project/compose.yaml`, junto com a stack atual (`db`, `mailpit`). O object storage **não** é uma decisão em aberto — o projeto já aponta para S3-compatível, e localmente isso é MinIO. O que se decide aqui é *como* usá-lo (TD-02), não *qual* usar.

---

## TD-01: Tecnologia da fila de processamento

**Scope:** Backend
**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** O `project-plan.md` e o diagrama de arquitetura deixam a fila explicitamente como `TBD` — é a principal decisão de stack da fase. O processamento de vídeo é pesado (ffprobe + extração de frame), de duração variável, precisa de retentativas com backoff em caso de falha, controle de concorrência (não saturar CPU com N jobs FFmpeg simultâneos) e um worker dedicado que a consome. A escolha precisa ser consistente entre o produtor (API) e o consumidor (worker), e a infra precisa subir no Compose.

**Options:**

- **Opção A — BullMQ (Redis) + `@nestjs/bullmq`.** Fila madura, padrão de mercado para jobs em background em Node. Integração oficial NestJS (`@nestjs/bullmq`) com `@Processor`/`@Process` declarativos, retentativas com backoff exponencial, `concurrency` por worker, jobs atrasados, e observabilidade via bull-board. Custo: adiciona Redis à stack (um serviço a mais no Compose) e a durabilidade depende da persistência do Redis (AOF/RDB).
- **Opção B — pg-boss (PostgreSQL).** Fila sobre o Postgres que já existe — zero infra nova. Enfileiramento transacional (publica o job na mesma transação que cria o vídeo). Bom para throughput baixo/médio. Custo: sem integração NestJS de primeira classe (wiring manual), concorrência e visibilidade menos ergonômicas que BullMQ, e acoplar fila + dados no mesmo Postgres concorre por conexões/IO sob carga.
- **Opção C — RabbitMQ / SQS.** Broker AMQP dedicado (ou serviço gerenciado). Robusto e desacoplado, mas é a opção mais pesada de operar localmente e traz semântica (exchanges, bindings, ack/nack) acima do necessário para uma única fila de processamento de vídeo. Overkill para o escopo.

**Recommendation:** Opção A — BullMQ + Redis via `@nestjs/bullmq`. É a escolha canônica para processamento de vídeo em background no ecossistema NestJS: o modelo de Worker com `concurrency` configurável resolve diretamente o requisito de "worker que consome a fila sem saturar o sistema", o backoff/retry cobre o ciclo de status `processing → error`, e a integração oficial mantém o código alinhado às convenções do projeto (módulos, DI, decorators). O preço — um serviço Redis no Compose — é baixo e bem compreendido. pg-boss seria atraente pelo "zero infra", mas o desafio pede explicitamente "fila e worker reais subindo no Compose" e a ergonomia de worker/concorrência do BullMQ é superior para este caso de uso.

**Decision:** Opção A — BullMQ + Redis, integrado via `@nestjs/bullmq`.

**Libraries:** `@nestjs/bullmq@^11.0.4`, `bullmq@^5.79.1`

---

## TD-02: Organização do object storage (buckets, chaves, SDK)

**Scope:** Backend
**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** O storage é dado (S3-compatível; MinIO local, S3 em produção). A decisão é como organizá-lo: quantos buckets, qual layout de chaves, qual SDK e como gerar URLs pré-assinadas. Precisa servir três fluxos: upload direto do cliente (TD-03), leitura por range para streaming (TD-08) e leitura completa para download (TD-09), além da escrita do thumbnail pelo worker (TD-06).

**Options:**

- **Opção A — Bucket único com chaves prefixadas por vídeo + AWS SDK v3.** Um bucket privado (`streamtube-videos`) com layout determinístico: `videos/{videoId}/source` (original) e `videos/{videoId}/thumbnail.jpg`. SDK `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, apontando o `endpoint` para o MinIO e `forcePathStyle: true`. Trocar para S3 em produção é só mudar `endpoint`/credenciais. Simples de raciocinar (tudo de um vídeo sob um prefixo), fácil de limpar (delete por prefixo).
- **Opção B — Dois buckets separados (vídeos e thumbnails).** Separa políticas de lifecycle/ACL por tipo de objeto. Custo: mais configuração, e a relação vídeo↔thumbnail deixa de ser localidade de chave. Ganho marginal para o escopo desta fase.
- **Opção C — SDK alternativo (`minio` client).** Cliente nativo do MinIO. Custo: acopla o código ao MinIO; a promessa "MinIO em dev, S3 em prod sem mudar código" se perde. O AWS SDK fala com ambos.

**Recommendation:** Opção A — bucket único privado, chaves prefixadas por `videoId`, AWS SDK v3 com `forcePathStyle`. É a organização que mantém a portabilidade MinIO↔S3 (requisito implícito do projeto) e dá localidade natural entre o vídeo e seu thumbnail. URLs pré-assinadas (`s3-request-presigner`) cobrem upload e download sem expor credenciais nem deixar o bucket público. O bucket é criado/garantido na inicialização (idempotente).

**Decision:** Opção A — bucket único `streamtube-videos` (privado), chaves `videos/{videoId}/source` e `videos/{videoId}/thumbnail.jpg`, AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`) com `endpoint` MinIO e `forcePathStyle: true`.

**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

---

## TD-03: Estratégia de upload de até 10GB sem travar a API

**Scope:** Backend
**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** É o requisito de arquitetura central da fase e tem reprova automática associada: passar o arquivo de 10GB pela API (multipart/form-data convencional) trava o sistema (memória, event loop, timeouts). O arquivo precisa ir do cliente **direto** ao object storage, com a API apenas orquestrando.

**Options:**

- **Opção A — Presigned PUT único.** A API gera uma URL pré-assinada de `PutObject`; o cliente faz um único PUT direto ao storage. Simples. Limitação fatal aqui: o S3 limita `PutObject` único a **5GB** — não atende 10GB. (MinIO é mais permissivo, mas o contrato precisa valer para S3, o alvo de produção.)
- **Opção B — Presigned Multipart Upload (direto ao storage).** A API inicia um `CreateMultipartUpload`, devolve ao cliente um `uploadId` e URLs pré-assinadas por parte (`UploadPart`); o cliente sobe as partes direto ao storage e a API finaliza com `CompleteMultipartUpload`. Suporta objetos enormes (até 5TB), partes paralelas e — de quebra — **retomada** (re-subir só a parte que falhou). Nenhum byte do arquivo passa pela API. Custo: handshake de 3 passos (initiate → upload parts → complete) e o cliente precisa fatiar o arquivo.
- **Opção C — tus (upload resumível).** Protocolo aberto de upload resumível (`@tus/server`). Excelente UX de retomada. Custo: o servidor tus normalmente recebe os bytes (a API/serviço tus fica no caminho do arquivo), salvo configuração avançada com storage S3 — o que reintroduz o risco que queremos evitar e adiciona uma dependência de protocolo nova fora das convenções do projeto.

**Recommendation:** Opção B — Presigned Multipart Upload direto ao storage. É a única opção que atende 10GB de forma nativa (o limite de 5GB do PUT único reprova a Opção A para o alvo S3) mantendo o arquivo **inteiramente fora da API**. O handshake de 3 passos mapeia limpo para o contrato REST: `POST /videos` (cria rascunho + initiate + devolve URLs de parte), `POST /videos/:id/complete` (CompleteMultipartUpload + dispara processamento). A retomada por parte é um bônus alinhado ao "permitir retomar em caso de falha de conexão" do `project-plan.md`. Os testes e2e exercitam o fluxo subindo as partes ao MinIO com o próprio AWS SDK (sem navegador).

**Decision:** Opção B — Presigned Multipart Upload (initiate na criação do rascunho, partes direto ao storage, complete dispara o processamento).

**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

---

## TD-04: Pré-cadastro do rascunho e gatilho do processamento

**Scope:** Backend
**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** Como o upload vai direto ao storage (TD-03), a API não "vê" o arquivo chegar. Precisa-se de (a) um registro do vídeo criado no instante em que o upload inicia, em status rascunho, e (b) um gatilho confiável que, ao término do upload, mude o status e enfileire o processamento.

**Options:**

- **Opção A — Rascunho na initiate + endpoint explícito de complete.** `POST /videos` cria a linha do vídeo (`status=draft`, dono = canal do usuário, `storage_key`, `upload_id`, `public_id`) e inicia o multipart. Quando o cliente termina de subir as partes, chama `POST /videos/:id/complete` com os ETags; a API faz `CompleteMultipartUpload`, valida que o objeto existe (`HeadObject`), seta `status=processing` e publica o job na fila. Determinístico e testável.
- **Opção B — Notificações de evento do bucket (MinIO/S3 → webhook).** O storage notifica a API quando o objeto é criado, que então enfileira. Desacopla o cliente do "complete". Custo: configurar bucket notifications no MinIO, expor um webhook, lidar com entrega não-confiável e com o `CompleteMultipartUpload` (multipart não fica visível até ser finalizado de qualquer forma). Mais partes móveis para o mesmo resultado.

**Recommendation:** Opção A — rascunho na initiate + complete explícito. Dá um ciclo de vida claro e auditável (`draft` existe desde o primeiro byte do upload), um ponto único e testável onde o processamento é disparado, e não depende de configuração de eventos do storage. A finalização do multipart já é obrigatória; reaproveitá-la como gatilho é o caminho de menor atrito. Bucket notifications ficam como evolução futura, não necessária agora.

**Decision:** Opção A — `POST /videos` cria rascunho + initiate multipart; `POST /videos/:id/complete` finaliza, marca `processing` e enfileira o job.

**Libraries:** —

---

## TD-05: Como o worker roda (deployment)

**Scope:** Backend
**Capability:** Transversal — covers: Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** O diagrama de arquitetura modela o "Video Worker (FFmpeg)" como um container próprio, separado da API. Precisa-se decidir se é um serviço/codebase separado ou o mesmo app NestJS rodando em outro modo, e como ele tem FFmpeg disponível.

**Options:**

- **Opção A — Container separado, mesmo codebase NestJS, bootstrap de worker.** Um segundo serviço no Compose (`video-worker`) que builda a mesma imagem do backend (mais FFmpeg instalado) e sobe por um entrypoint dedicado (`main.worker.ts`) que cria um contexto NestJS standalone só com o módulo de processamento (consumer BullMQ + storage + repositório de vídeos). Reaproveita entidades, repositórios e o serviço de storage; sem duplicação de código. A API **não** processa vídeo (não tem FFmpeg, não consome a fila).
- **Opção B — Processo separado, projeto/serviço autônomo.** Um worker em projeto Node próprio. Custo: duplica configuração, entidades e acesso ao banco; diverge das convenções do monorepo. Sem ganho que justifique.
- **Opção C — Mesmo processo da API (in-process worker).** A API também consome a fila. Custo: FFmpeg na imagem da API, contenção de CPU/memória entre servir HTTP e processar vídeo, e quebra do isolamento que o diagrama prevê. Reprovaria o requisito de "worker subindo no Compose" como componente real.

**Recommendation:** Opção A — container `video-worker` separado, mesmo codebase, bootstrap próprio. Honra o diagrama (worker é container distinto), isola o trabalho pesado de FFmpeg da API que precisa ficar responsiva, e evita duplicação reusando o módulo de domínio. O processador BullMQ vive num módulo importado tanto pela API (que só publica) quanto pelo bootstrap do worker (que consome), com a concorrência de consumo configurada apenas no worker.

**Decision:** Opção A — serviço `video-worker` no Compose, mesma imagem + FFmpeg, entrypoint `main.worker.ts` com contexto NestJS standalone consumindo a fila.

**Libraries:** `@nestjs/bullmq@^11.0.4`; FFmpeg (binários de sistema na imagem do worker)

---

## TD-06: Extração de metadados e geração de thumbnail (FFmpeg/ffprobe)

**Scope:** Backend
**Capability:** Transversal — covers: Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** No worker, para cada job: obter o original do storage, extrair duração e metadados (codec, resolução, bitrate), gerar um thumbnail a partir de um frame, subir o thumbnail ao storage e atualizar o banco. Decide-se como invocar FFmpeg/ffprobe.

**Options:**

- **Opção A — Binários de sistema `ffmpeg`/`ffprobe` via `child_process` (wrapper fino).** FFmpeg instalado na imagem do worker (apt). `ffprobe -print_format json -show_format -show_streams` para metadados; `ffmpeg -ss <t> -i <in> -frames:v 1 thumb.jpg` para o frame. Um service fino encapsula o spawn e o parse. Zero dependência npm extra, controle total das flags, fácil de mockar em unit e de exercitar de verdade em integração com um mp4 minúsculo.
- **Opção B — `fluent-ffmpeg` (wrapper npm).** API encadeável mais legível sobre os mesmos binários. Custo: a lib está praticamente sem manutenção (releases esparsos), e ainda assim exige FFmpeg de sistema instalado — ou seja, adiciona uma dependência de risco sem remover a necessidade do binário. Para o que precisamos (probe + 1 frame), a ergonomia extra não compensa o risco.
- **Opção C — `ffmpeg-static`/`ffprobe-static` (binários via npm).** Dispensa instalar FFmpeg no Dockerfile. Custo: binários baixados no `npm install` (tamanho, variação por plataforma/arquitetura), menos previsível que o pacote do sistema. Numa imagem Docker controlada, instalar via apt é mais transparente.

**Recommendation:** Opção A — binários de sistema via `child_process`, com FFmpeg instalado no Dockerfile do worker. É a abordagem mais robusta e auditável: sem dependência npm não-mantida no caminho crítico, flags explícitas, e fácil de testar em três níveis (unit com spawn mockado; integração rodando ffprobe/ffmpeg de verdade sobre um fixture mp4 pequeno; e2e do fluxo completo). O wrapper fino mantém o código limpo sem terceirizar o controle a uma lib estagnada.

**Decision:** Opção A — `ffmpeg`/`ffprobe` de sistema (instalados na imagem do worker) invocados por um service wrapper sobre `node:child_process`.

**Libraries:** — (FFmpeg de sistema via `node:child_process`, sem dependência npm)

---

## TD-07: Estratégia de URL única por vídeo

**Scope:** Backend
**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Cada vídeo precisa de um identificador público curto e único, usado na URL de reprodução/compartilhamento, que nunca conflite com outro. Não deve expor o `id` interno (uuid) nem ser adivinhável sequencialmente.

**Options:**

- **Opção A — `nanoid` em coluna `public_id` única + retry em colisão.** Id curto, URL-safe (`A-Za-z0-9_-`), ~11–12 chars com espaço de colisão desprezível. Coluna `public_id` com `UNIQUE`; em colisão (praticamente impossível), o `INSERT` falha e regenera-se. **Atenção de compatibilidade:** `nanoid` v5+ é ESM-puro e este backend roda em CommonJS (ts-node-commonjs, TypeORM CLI em CJS) — `require` quebraria. Fixa-se `nanoid@3`, a linha CommonJS.
- **Opção B — `uuid` v4 como id público.** Reusa o padrão de uuid do projeto. Custo: URLs longas e feias (36 chars), contra o "URL curta e única" do `project-plan.md`.
- **Opção C — Hashids a partir de um id numérico sequencial.** Codifica um inteiro em string curta. Custo: exige um id numérico sequencial paralelo ao uuid (coluna a mais), e Hashids é reversível/adivinhável se o salt vazar. Mais peças para o mesmo fim.

**Recommendation:** Opção A — `nanoid@3` numa coluna `public_id` única, com retry em colisão garantido pela constraint. Entrega URLs curtas e não-sequenciais, com unicidade garantida no banco (a constraint é a fonte da verdade; o retry é a rede de segurança). A fixação em `nanoid@3` é deliberada e documentada pela incompatibilidade ESM/CommonJS — registrada aqui para o `plan-resolve` pinar a versão correta.

**Decision:** Opção A — coluna `public_id` única gerada por `nanoid@3` (linha CommonJS), com retry em colisão amparado pela constraint `UNIQUE`.

**Libraries:** `nanoid@^3.3.15` (linha CommonJS — v5+ é ESM-only)

---

## TD-08: Estratégia de streaming (range / 206)

**Scope:** Backend
**Capability:** Reprodução via streaming (sem necessidade de download completo)

**Context:** O vídeo precisa começar a tocar sem baixar o arquivo inteiro — o player envia requisições `Range` e espera `206 Partial Content`. Decide-se se a API serve esses ranges (proxy) ou se delega ao storage via URL pré-assinada. Importante: o requisito de "não travar com 10GB" é sobre o **upload** (subida do arquivo inteiro de uma vez); streaming lê **blocos pequenos** sob demanda, então proxiar ranges não recria aquele problema.

**Options:**

- **Opção A — Endpoint de streaming na API com suporte a `Range` → `206`.** `GET /videos/:publicId/stream` lê o header `Range`, repassa o range ao storage (`GetObject` com `Range`) e devolve `206` com `Content-Range`/`Accept-Ranges`/`Content-Length` da fatia. Acesso anônimo para vídeos públicos. Vantagens: contrato único e testável via supertest (Range → 206), bucket permanece privado, e o controle de acesso/visibilidade fica na API. Custo: a API fica no caminho dos bytes do range (mitigado por ser streaming de blocos, não o arquivo todo; e por CDN em produção).
- **Opção B — URL pré-assinada de `GetObject` → cliente streama direto do storage.** A API devolve uma URL pré-assinada; o player faz Range direto no storage (S3/MinIO suportam range nativamente). Casa com o diagrama (`frontend → storage: Streams`) e tira a API do caminho dos bytes. Custo: difícil de exercitar em e2e sem navegador, expõe uma URL temporária, e o controle de acesso por vídeo precisa ser embutido na assinatura/expiração.

**Recommendation:** Opção A como contrato primário, com a Opção B reconhecida como caminho de escala em produção. A API range-proxy é a escolha demonstrável e testável (e2e com header `Range` afirmando `206` + `Content-Range`), mantém o storage privado e centraliza visibilidade/acesso — exatamente o que o desafio pede provar nesta fase. O diagrama mostra streaming direto do storage como otimização; documenta-se o trade-off (API no caminho do range) e deixa-se o presigned-direto como evolução, sem reescrever o contrato.

**Decision:** Opção A — `GET /videos/:publicId/stream` com suporte a `Range`, respondendo `206 Partial Content` e proxiando o range do storage (presigned-direto fica como evolução futura).

**Libraries:** `@aws-sdk/client-s3@^3.x`

---

## TD-09: Estratégia de download

**Scope:** Backend
**Capability:** Download do vídeo pelo usuário

**Context:** O usuário pode baixar o arquivo do vídeo. Diferente do streaming (blocos), download é o arquivo **inteiro** — e aqui passar 10GB pela API recriaria o problema do upload. Decide-se como entregar o arquivo completo sem onerar a API.

**Options:**

- **Opção A — URL pré-assinada de `GetObject` (redirect 302 ou JSON).** `GET /videos/:publicId/download` valida acesso e devolve/redireciona para uma URL pré-assinada temporária; o cliente baixa o arquivo inteiro **direto do storage**. A API sai do caminho dos bytes do arquivo completo. Custo: expõe uma URL temporária (mitigado por expiração curta) e o teste e2e verifica o 302/URL, não o stream completo.
- **Opção B — Proxy de download pela API (`Content-Disposition: attachment`).** A API faz pipe do `GetObject` inteiro. Custo: coloca a transferência do arquivo de até 10GB **inteiro** na API — o anti-padrão que a fase combate. Reprovável em espírito.

**Recommendation:** Opção A — download via URL pré-assinada. Mantém a transferência do arquivo completo (que pode ser os 10GB) fora da API, coerente com o princípio que rege o upload. O streaming (TD-08) proxia ranges pequenos pela API por testabilidade/controle; o download do arquivo inteiro delega ao storage justamente para não reintroduzir o gargalo. A distinção é deliberada: range pequeno proxiado vs. arquivo inteiro delegado.

**Decision:** Opção A — `GET /videos/:publicId/download` devolve/redireciona para URL pré-assinada de `GetObject` (download direto do storage).

**Libraries:** `@aws-sdk/s3-request-presigner@^3.x`

---

## TD-10: Ciclo de status do vídeo e tratamento de falha

**Scope:** Backend
**Capability:** Transversal — covers: Pré-cadastro automático do vídeo como rascunho ao iniciar o upload; Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** O vídeo transita por estados ao longo do upload e do processamento, e o banco precisa refletir isso (inclusive falha). Define-se o conjunto de estados, as transições e o que acontece quando o processamento falha.

**Options:**

- **Opção A — Enum `draft → processing → ready | error`, com retry/backoff na fila.** `draft` ao iniciar o upload (TD-04); `processing` ao finalizar o upload e enfileirar; `ready` quando o worker conclui (duração, metadados e `thumbnail_key` preenchidos); `error` quando o processamento falha após esgotar as retentativas do BullMQ (com `failure_reason` persistido). Estados mínimos e suficientes para a fase.
- **Opção B — Ciclo granular (`draft → uploading → uploaded → queued → processing → ready → failed`).** Mais observável. Custo: estados como `uploading`/`queued` não são observáveis de forma confiável pela API (upload é direto ao storage) e inflam a máquina de estados sem requisito que os peça. Complexidade sem retorno nesta fase.

**Recommendation:** Opção A — `draft | processing | ready | error`. É o ciclo que o desafio descreve ("rascunho → processando → pronto/erro") e cada transição tem um gatilho claro e auditável no código (initiate, complete, worker-sucesso, worker-falha). O BullMQ cuida das retentativas com backoff exponencial; só após esgotá-las o vídeo vira `error` com a razão registrada, evitando marcar falha em problemas transitórios. Estados mais finos ficam para fases futuras se a UI exigir.

**Decision:** Opção A — enum `draft | processing | ready | error`; falha vira `error` + `failure_reason` apenas após o BullMQ esgotar as retentativas (backoff exponencial).

**Libraries:** `bullmq@^5.79.1`

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|----------------|--------|
| TD-01 | Backend | Tecnologia da fila | BullMQ + Redis (`@nestjs/bullmq`) | **BullMQ + Redis** |
| TD-02 | Backend | Organização do object storage | Bucket único privado, chaves por `videoId`, AWS SDK v3 | **AWS SDK v3 + MinIO, bucket único** |
| TD-03 | Backend | Upload de 10GB | Presigned Multipart Upload direto ao storage | **Presigned Multipart** |
| TD-04 | Backend | Pré-cadastro + gatilho | Rascunho na initiate + `complete` explícito enfileira | **Initiate + complete** |
| TD-05 | Backend | Deployment do worker | Container separado, mesmo codebase, bootstrap próprio | **`video-worker` separado** |
| TD-06 | Backend | Metadados + thumbnail | `ffmpeg`/`ffprobe` de sistema via `child_process` | **FFmpeg de sistema (spawn)** |
| TD-07 | Backend | URL única | `public_id` único via `nanoid@3` + retry | **`nanoid@3` / `public_id`** |
| TD-08 | Backend | Streaming | Endpoint API com `Range` → `206` (proxy de range) | **Range-proxy 206** |
| TD-09 | Backend | Download | URL pré-assinada de `GetObject` (direto do storage) | **Presigned download** |
| TD-10 | Backend | Ciclo de status + falha | `draft\|processing\|ready\|error`, retry antes de `error` | **Enum 4 estados** |
