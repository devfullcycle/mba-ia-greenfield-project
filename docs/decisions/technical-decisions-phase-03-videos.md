---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-07-01
scope_description: "Upload de vídeos até 10GB, fila e worker de processamento assíncrono, thumbnail automático, URL única, streaming e download."
---

# Technical Decisions — Fase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — todas as decisões desta fase: módulo de vídeos, storage, fila e worker de processamento.
- `next-frontend/` — sem decisão em aberto. A interface de vídeo (upload UI, player) está fora do escopo deste desafio (`instrucoes.md`: "Este é um desafio de backend"); nenhuma capacidade da Fase 03 exige trabalho no frontend.

---

## TD-01: Tecnologia de fila de processamento

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** O `docs/project-plan.md` deixa a tecnologia de fila explicitamente em aberto ("TBD"). É a única decisão de stack genuinamente aberta da fase — object storage já é dado (S3-compatível/MinIO). A fila recebe o job de processamento assim que o upload é concluído e alimenta o worker (extração de metadados + thumbnail).

**Options:**

### Option A: BullMQ + Redis
- Biblioteca de filas em Node.js sobre Redis, com `@nestjs/bullmq` para integração idiomática (decorators `@Processor`, `@Queue`), suporte nativo a retries com backoff exponencial, rate limiting e jobs atrasados.
- **Pros:** integração de primeira classe com NestJS (mesmo padrão de DI dos outros módulos); Redis é uma peça de infra leve e comum, fácil de subir no Compose; API de retry/backoff pronta para o ciclo de falha do processamento.
- **Cons:** mais um serviço stateful (Redis) na infra; não é multi-linguagem (não seria reaproveitável se um worker em outra stack for necessário no futuro).

### Option B: RabbitMQ
- Message broker AMQP completo, integrado via `@nestjs/microservices` (transporte RMQ) ou `@golevelup/nestjs-rabbitmq`.
- **Pros:** broker maduro, multi-linguagem, roteamento avançado (exchanges/routing keys), útil se o worker de vídeo (ou futuros consumidores) precisar rodar em outra stack.
- **Cons:** mais complexo de configurar (exchanges, filas, bindings) para um único fluxo de processamento; sem necessidade de multi-linguagem nesta fase, a complexidade extra não se paga.

**Recommendation:** Option A (BullMQ + Redis) — o projeto é 100% Node.js/NestJS nesta fase, e o `@nestjs/bullmq` reaproveita o mesmo padrão de módulos/DI já usado em `auth/`, `mail/` etc. Redis também é uma peça de infra mínima comparado ao overhead operacional do RabbitMQ para um único fluxo de fila.

**Decision:** Option A — BullMQ + Redis
**Libraries:** bullmq@^5.79.x, @nestjs/bullmq@^11.0.x, ioredis@^5.11.x (dependência transitiva do BullMQ)

---

## TD-02: Estratégia de upload de até 10GB e organização do storage

**Scope:** Backend

**Capability:** Transversal — covers: "Serviço de armazenamento de arquivos (vídeos e thumbnails)", "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload"

**Context:** O object storage (S3-compatível/MinIO) já é dado pelo projeto — a decisão aqui é *como* usá-lo: como o arquivo chega até o storage sem travar a API, e como buckets/chaves são organizados. Passar um arquivo de 10GB pelo body da API (buffer em memória ou disco local do container) é o caminho de reprova automática explícito do desafio.

**Options:**

### Option A: Upload direto ao storage via multipart + URLs pré-assinadas
- O cliente chama `POST /videos` (pré-cadastra o vídeo como rascunho, cria a `key` no bucket e inicia um S3 Multipart Upload), recebe uma URL pré-assinada por parte (`UploadPart`), envia os bytes **diretamente ao MinIO/S3** (nunca pela API), e finaliza com `POST /videos/:id/complete-upload` (a API chama `CompleteMultipartUpload`).
- **Pros:** a API nunca vê os bytes do vídeo — zero impacto de memória/CPU na API durante o upload; escala para 10GB+ nativamente (limite de 5TB do S3 multipart); MinIO implementa a mesma API S3 de multipart, então o código não muda ao trocar por S3 real em produção.
- **Cons:** exige orquestrar 3 chamadas (initiate → upload das partes → complete) em vez de um único `POST`; sem frontend nesta fase, o fluxo precisa ser exercitado via testes/cliente HTTP direto (não há UI de upload).

### Option B: Proxy de streaming pela API (multipart/form-data com stream, sem buffer completo)
- A API recebe o upload via `multipart/form-data`, faz streaming do corpo da requisição direto para o storage (sem materializar o arquivo inteiro em memória/disco), usando um stream pipe entre o request e o `PutObject`/upload multipart do SDK.
- **Pros:** um único endpoint, sem orquestração de múltiplas chamadas.
- **Cons:** o arquivo ainda atravessa o processo da API (ocupa uma conexão HTTP e parte do event loop por toda a duração do upload de até 10GB); mais frágil a timeouts de proxy/load balancer em uploads muito longos; não é o padrão recomendado pela própria AWS para arquivos grandes.

**Recommendation:** Option A — é o padrão recomendado pela documentação da AWS para arquivos grandes (thresholds de multipart a partir de 100MB) e é a única estratégia que garante, por construção, que o upload de 10GB não consome recursos da API. Chave de storage sugerida: `videos/{channelId}/{videoId}/original.<ext>` e `videos/{channelId}/{videoId}/thumbnail.jpg`, usando o SDK `@aws-sdk/client-s3` (v3, modular) — compatível com MinIO (mesmo protocolo S3) e com S3 real em produção sem mudança de código, apenas de endpoint/credenciais.

**Decision:** Option A — Upload direto ao storage via multipart + URLs pré-assinadas
**Libraries:** @aws-sdk/client-s3@^3.1078.x, @aws-sdk/s3-request-presigner@^3.1078.x

---

## TD-03: Execução do worker e extração de metadados/thumbnail

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** Depende de TD-01 (o worker consome a fila escolhida). É preciso decidir se o worker é um processo/container separado da API (exigido pelo desafio: "não ter fila, worker e storage reais subindo no Compose" é reprova automática) e como ele extrai duração/metadados e gera o thumbnail.

**Options:**

### Option A: Worker NestJS separado (novo entrypoint, mesmo monorepo `nestjs-project/`)
- Uma segunda aplicação Nest (`src/main-worker.ts`, bootstrap via `NestFactory.createApplicationContext`) roda em container próprio no Compose, registra o `Processor`/`Worker` do BullMQ para a fila de vídeos, e reaproveita o mesmo módulo `videos/` (entidade, repositório, TypeORM) da API. Extração via `fluent-ffmpeg` (wrapper) chamando o binário `ffmpeg`/`ffprobe` instalado na imagem do worker (`apt-get install ffmpeg` no Dockerfile do worker).
- **Pros:** reaproveita a mesma entidade `Video`, o mesmo `DataSource` TypeORM e os mesmos padrões de módulo/DI já usados no projeto (`auth/`, `channels/`) — sem duplicar código de acesso a dados; um único `package.json`/`node_modules`.
- **Cons:** a imagem do worker carrega o overhead do framework Nest mesmo sem expor HTTP (mínimo, pois `createApplicationContext` não sobe um servidor HTTP).

### Option B: Worker standalone (script Node puro, fora do framework Nest)
- Um processo Node simples, sem NestJS, consumindo a fila diretamente via `bullmq` (`Worker` class) e acessando o banco com uma camada de dados própria (TypeORM `DataSource` manual, sem DI).
- **Pros:** processo mais leve, sem overhead de bootstrap do Nest.
- **Cons:** duplica a definição da entidade `Video` (ou exige um pacote compartilhado, que não existe no monorepo) e os padrões de acesso a dados já estabelecidos — quebra "Continuidade, não retrabalho" e o Single Responsibility ao criar um segundo jeito de acessar o mesmo dado.

**Recommendation:** Option A — reaproveita a entidade e o repositório do módulo `videos/` sem duplicação, mantendo um único ponto de verdade para o schema de vídeos, com o custo de bootstrap do Nest sendo desprezível para um worker sem HTTP. `fluent-ffmpeg` (wrapper mais usado do ecossistema Node) chama `ffprobe` para duração/metadados e o método `screenshots` para extrair o frame do thumbnail, contra o binário `ffmpeg` instalado na imagem (não a variante `ffmpeg-static`, já que o Dockerfile controla o ambiente de forma determinística).

**Decision:** Option A — Worker NestJS separado (novo entrypoint, mesmo monorepo)
**Libraries:** fluent-ffmpeg@^2.1.x, @types/fluent-ffmpeg@^2.1.x (dev)

---

## TD-04: Estratégia de URL única por vídeo

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Cada vídeo precisa de um identificador de URL que nunca colida com outro. Não há, nesta fase, requisito de URL amigável/legível (isso pertenceria a uma fase de listagem/SEO, fora do escopo atual).

**Options:**

### Option A: UUID da entidade como identificador de URL
- O `id` (UUID v4, gerado pelo Postgres/TypeORM como chave primária) é usado diretamente como identificador nas rotas (`GET /videos/:id`, `GET /videos/:id/stream`, `GET /videos/:id/download`).
- **Pros:** unicidade garantida pela própria chave primária, sem trabalho extra; consistente com o padrão já usado em `User`/`Channel` no projeto.
- **Cons:** não é uma URL "amigável"/curta — irrelevante para o escopo atual (backend puro, sem página pública de vídeo nesta fase).

### Option B: Slug curto dedicado (nanoid/short-code), independente do UUID interno
- Uma coluna adicional (`slug`, ex.: nanoid de 8-10 caracteres) é gerada no pré-cadastro e usada como identificador público, com índice único.
- **Pros:** URLs mais curtas; desacopla o identificador público do id interno (útil se a Fase 05 quiser esconder o UUID).
- **Cons:** trabalho e superfície de decisão adicionais (tamanho do slug, alfabeto, colisão) sem nenhuma capacidade desta fase exigindo isso — a Fase 05 (página de visualização) é quem trataria de URL pública/compartilhável, e pode reabrir esta decisão então.

**Recommendation:** Option A — o UUID já satisfaz literalmente a capacidade ("URL única, sem conflito") sem introduzir uma decisão de design que nenhuma capacidade desta fase pede. Fica registrado que a Fase 05 pode revisitar isso se precisar de um identificador público mais curto para a página de visualização.

**Decision:** Option A — UUID da entidade como identificador de URL

---

## TD-05: Estratégia de streaming e download

**Scope:** Backend

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** Depende de TD-02 (o mesmo SDK/organização de storage é reaproveitado para leitura). O vídeo precisa ser reproduzido sem exigir download completo (seek/range) e também precisa estar disponível para download integral.

**Options:**

### Option A: Proxy pela API com suporte a `Range`/`206 Partial Content`
- A API lê o header `Range` da requisição, busca o range correspondente no storage (`GetObject` com `Range`) e retorna `206 Partial Content` com `Content-Range`/`Accept-Ranges`; o download usa o mesmo endpoint sem `Range` (200 completo, `Content-Disposition: attachment`).
- **Pros:** a API controla toda a autorização por requisição (ex.: checar status/visibilidade antes de cada byte).
- **Cons:** os bytes do vídeo atravessam o processo da API a cada reprodução/download — para vídeos de até 10GB, isso reintroduz na leitura o mesmo problema de carga que a Option A do TD-02 evita na escrita.

### Option B: Redirect para URL pré-assinada de leitura (`GetObject` pré-assinado)
- A API valida a autorização (o vídeo existe, está `ready`) e responde com um redirect (`302`/`307`) para uma URL pré-assinada de leitura no MinIO/S3, com TTL curto; o próprio MinIO/S3 responde a `Range` nativamente, então o `<video>` consegue fazer seek sem qualquer trabalho adicional da API. O endpoint de download usa a mesma URL pré-assinada, adicionando `response-content-disposition=attachment` como parâmetro da assinatura.
- **Pros:** consistente com a estratégia de upload (TD-02) — a API nunca fica no caminho dos bytes, nem para escrita nem para leitura; suporte a `Range` é responsabilidade do storage (S3/MinIO já implementam isso corretamente); menor custo de banda/CPU na API.
- **Cons:** a autorização só é verificada no momento da geração do redirect (aceitável nesta fase — não há visibilidade "unlisted" ainda, isso é Fase 04); TTL da URL pré-assinada precisa ser generoso o suficiente para vídeos longos sem virar um risco de exposição prolongada.

**Recommendation:** Option B — mantém a mesma filosofia de TD-02 (API nunca no caminho dos bytes) e delega range/streaming a uma camada (S3/MinIO) que já implementa isso corretamente, evitando reintroduzir na leitura o gargalo que a fase pede para evitar na escrita.

**Decision:** Option B — Redirect para URL pré-assinada de leitura

---

## TD-06: Ciclo de status do vídeo e comportamento em falha

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** Depende de TD-01 (retries do worker) e TD-03 (o que pode falhar durante a extração). É preciso um ciclo de status claro e um comportamento definido quando o processamento falha (ex.: arquivo corrompido, ffmpeg não reconhece o formato).

**Options:**

### Option A: Enum simples de status, dirigido pelos eventos do job da fila
- `VideoStatus`: `draft` (criado, upload em andamento) → `uploaded` (multipart completo, job enfileirado) → `processing` (worker pegou o job) → `ready` (metadados + thumbnail salvos) | `failed` (esgotou as tentativas). Transições `processing`/`ready`/`failed` são disparadas pelos listeners `active`/`completed`/`failed` do BullMQ; retries com backoff exponencial (ex.: 3 tentativas) antes de marcar `failed` definitivamente.
- **Pros:** cobre exatamente o ciclo pedido pelo desafio (rascunho → processando → pronto/erro); simples de implementar e testar; erro final fica visível no registro do vídeo para o usuário decidir o que fazer.
- **Cons:** não guarda histórico de tentativas anteriores (apenas o status atual) — aceitável, pois não há capacidade nesta fase pedindo auditoria/histórico.

### Option B: Enum granular por sub-etapa
- Adiciona estados intermediários (`extracting_metadata`, `generating_thumbnail`) para feedback mais fino de progresso.
- **Pros:** granularidade maior, útil se uma UI de progresso existisse.
- **Cons:** nenhuma capacidade desta fase (backend-only, sem UI de vídeo) consome esse detalhe; complexidade de estado sem consumidor.

**Recommendation:** Option A — cobre literalmente o ciclo "rascunho → processando → pronto/erro" citado no `docs/project-plan.md`, sem granularidade que nenhum consumidor (não há UI nesta fase) vai usar. Falha definitiva (`failed`) é reportada no registro do vídeo; reprocessamento manual, se necessário, é responsabilidade de uma fase futura (não pedido aqui).

**Decision:** Option A — Enum simples de status, dirigido pelos eventos do job da fila

---

## TD-07: Política de autorização para leitura (streaming/download)

**Scope:** Backend

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** TD-05 decide o *mecanismo* de entrega (redirect para URL pré-assinada), mas não define quem pode acionar `GET /videos/:id/stream` e `GET /videos/:id/download`, nem se isso depende do `status` do vídeo. A Fase 03 ainda não tem o conceito de visibilidade público/unlisted (isso é Fase 04) — então é preciso uma regra mínima para esta fase. Identificado durante `/plan-validate` (AMB-1).

**Options:**

### Option A: Público quando `ready`; dono sempre, independente de status
- Qualquer requisição (anônima ou autenticada) a `stream`/`download` é atendida se `video.status === 'ready'`. Se o requisitante autenticado for o dono do canal do vídeo, o acesso é permitido em qualquer status (útil para conferir o resultado do processamento). Em qualquer outro caso (não-dono, status != ready), retorna 404 (não expõe a existência do vídeo a quem não deveria vê-lo).
- **Pros:** Alinhado ao princípio do produto ("usuários anônimos podem assistir livremente" — `README.md`); protege rascunhos/vídeos em processamento de terceiros sem precisar do modelo de visibilidade da Fase 04; dono sempre pode inspecionar seu próprio conteúdo.
- **Cons:** Requer resolver o usuário autenticado (quando presente) mesmo em uma rota que também aceita anônimos — o guard precisa ser opcional, não obrigatório.

### Option B: Sempre restrito ao dono autenticado
- Todo acesso a `stream`/`download` exige `JwtAuthGuard` + checagem de ownership, independente do `status`.
- **Pros:** Mais simples de implementar (guard binário, sem caminho anônimo).
- **Cons:** Contradiz o princípio de produto do StreamTube (anônimos assistem livremente) — adiaria esse comportamento inteiro para a Fase 04, quando nenhuma capacidade desta fase pede isso; a Fase 03 já entrega vídeos "prontos" e a leitura pública é o comportamento esperado pelo README.

**Recommendation:** Option A — é a única opção que satisfaz o princípio de acesso anônimo já estabelecido no README sem precisar do modelo de visibilidade (unlisted/público) que só chega na Fase 04, e sem expor conteúdo ainda não pronto de outros usuários.

**Decision:** Option A — Público quando `ready`; dono sempre, independente de status

---

## TD-08: Formatos de vídeo aceitos e ponto de enforcement do limite de 10GB

**Scope:** Backend

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Serviço de armazenamento de arquivos (vídeos e thumbnails)"

**Context:** TD-02 decide o *mecanismo* de upload (multipart + presigned, direto ao storage), mas não decide quais formatos de vídeo são aceitos nem onde o limite de 10GB é validado antes de gastar recursos de storage/fila com um upload inválido. Identificado durante `/plan-validate` (MD-1).

**Options:**

### Option A: Allowlist ampla (mp4, mov, webm, mkv) + validação do tamanho declarado no `initiate-upload`
- `POST /videos` recebe `mimeType` e `sizeInBytes` declarados pelo cliente; rejeita com erro de domínio (400) se `mimeType` não está em `{video/mp4, video/quicktime, video/webm, video/x-matroska}` ou se `sizeInBytes > 10 * 1024^3`. Só então o multipart upload é iniciado no storage.
- **Pros:** Cobre os formatos mais comuns produzidos por navegadores/celulares (mov do iPhone, webm) e que o `ffmpeg`/`ffprobe` do worker (TD-03) processa nativamente; nenhum recurso de storage é gasto com upload que já se sabe inválido antes de começar.
- **Cons:** Validação é baseada no que o cliente declara (MIME/tamanho podem ser falsificados) — a validação definitiva do conteúdo real continua sendo o `ffprobe` no worker (que já falha e marca `failed` se o arquivo não for um vídeo válido, por TD-06); o enforcement aqui é uma barreira de custo/UX, não uma garantia de segurança de conteúdo.

### Option B: Allowlist restrita a `video/mp4`
- Mesmo mecanismo de validação no `initiate-upload`, mas só aceita `video/mp4`.
- **Pros:** Superfície mínima para documentar e testar.
- **Cons:** Rejeita formatos comuns (`.mov` de iPhone, `.webm`, `.mkv`) que o worker conseguiria processar sem problema, sem ganho real de segurança ou simplicidade de implementação (a validação de MIME é a mesma checagem, só com uma lista menor).

### Option C: Sem validação de formato/tamanho na API
- Qualquer arquivo é aceito no `initiate-upload`; a validade do vídeo só é verificada pelo worker via `ffprobe` (falha → `status: failed`, por TD-06).
- **Pros:** API mais simples, zero lista para manter.
- **Cons:** Gasta bucket/fila/worker com uploads claramente inválidos (ex.: um PDF de 10GB) antes de descobrir o problema — desperdício de recursos que uma checagem trivial de MIME/tamanho evitaria de graça.

**Recommendation:** Option A — cobre os formatos reais que os clientes de vídeo produzem, compatíveis com o worker (TD-03), e evita gastar storage/fila com uploads claramente fora do limite ou de formato não suportado, sem pretender ser uma garantia de segurança de conteúdo (que continua sendo o `ffprobe` no worker).

**Decision:** Option A — Allowlist ampla (mp4, mov, webm, mkv) + validação do tamanho declarado no `initiate-upload`

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice | Libraries |
|----|-------|----------|---------------|--------|-----------|
| TD-01 | Backend | Tecnologia de fila | BullMQ + Redis | Option A | bullmq@^5.79.x, @nestjs/bullmq@^11.0.x, ioredis@^5.11.x |
| TD-02 | Backend | Estratégia de upload de 10GB e organização do storage | Multipart + URLs pré-assinadas (direto ao storage) | Option A | @aws-sdk/client-s3@^3.1078.x, @aws-sdk/s3-request-presigner@^3.1078.x |
| TD-03 | Backend | Execução do worker e extração de metadados/thumbnail | Worker NestJS separado (mesmo monorepo) + fluent-ffmpeg | Option A | fluent-ffmpeg@^2.1.x, @types/fluent-ffmpeg@^2.1.x |
| TD-04 | Backend | Estratégia de URL única | UUID da entidade | Option A | — |
| TD-05 | Backend | Estratégia de streaming e download | Redirect para URL pré-assinada de leitura | Option B | — |
| TD-06 | Backend | Ciclo de status do vídeo e falha | Enum simples dirigido por eventos da fila | Option A | — |
| TD-07 | Backend | Política de autorização para leitura (streaming/download) | Público quando `ready`; dono sempre | Option A | — |
| TD-08 | Backend | Formatos aceitos e enforcement do limite de 10GB | Allowlist ampla + validação do tamanho declarado | Option A | — |
