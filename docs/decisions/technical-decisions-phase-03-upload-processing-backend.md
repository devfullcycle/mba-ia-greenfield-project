---
scope_type: phase
related_phases: [3]
status: pending
date: 2026-11-28
scope_description: "Backend do upload e processamento de vídeos: object storage, protocolo de upload de até 10GB, fila e worker de processamento (ffprobe/ffmpeg), ciclo de vida do vídeo, URL pública única, streaming e download."
covers_capabilities:
  - "Serviço de armazenamento de arquivos (vídeos e thumbnails)"
  - "Serviço de processamento em segundo plano (filas)"
  - "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance"
  - "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload"
  - "Processamento automático do vídeo após upload (extração de duração e metadados)"
  - "Geração automática de thumbnail a partir de um frame do vídeo"
  - "URL única por vídeo, sem conflito com outros vídeos"
  - "Reprodução via streaming (sem necessidade de download completo)"
  - "Download do vídeo pelo usuário"
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos (backend)

_Subprojects in scope:_

- `nestjs-project/` — cobre todos os TDs: módulo de vídeos, integração com storage, fila, worker e endpoints de upload, streaming e download.
- `next-frontend/` — sem TD próprio. A Fase 03 não tem bullet de UI. O lado cliente dos TDs `Cross-layer` (TD-02, TD-06, TD-08, TD-09) é descrito nas Options de cada um. Se a tela de upload for necessária, ela entra como slice irmão.

_Inherited (não reabertas):_ Joi + `registerAs` para config, class-validator, filtro de erro de domínio, `@nestjs/throttler`, guards JWT customizados, `@nestjs/swagger` com `openapi.json` exportado, Postgres 17 + TypeORM (Fases 01 e 02).

_Versões instaladas (`nestjs-project/package.json`):_ NestJS 11, TypeORM 0.3.28, pg 8.20, Joi 18. Não há dependência de storage, fila ou ffmpeg ainda. Toda a documentação de libs abaixo foi consultada via Context7 e fontes primárias, sem divergência de versão a sinalizar, pois as libs novas ainda não estão instaladas. O baseline instalado tem vulnerabilidades e defasagem de major, tratadas em TD-12.

---

## TD-01: Object storage e ambiente local

**Scope:** Repo-wide

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** Hoje o `compose.yaml` tem só `nestjs-api`, `db` e `mailpit`. O diagrama `docs/diagrams/software-arch.mermaid` prevê "Object Storage (S3/MinIO)". A escolha define o contrato de acesso (API S3 ou filesystem) usado em dev, teste e produção, e condiciona TD-02, TD-06 e TD-10.

**Options:**

### Option A: MinIO no compose, acessado via API S3
- Serviço `minio` no compose, com o cliente `@aws-sdk/client-s3` apontando para `endpoint` custom e `forcePathStyle: true`.
- **Pros:** o mesmo código e o mesmo contrato servem em dev, teste e produção (S3 real ou outro compatível). Presigned URLs e multipart funcionam como no S3. Alinhado ao diagrama.
- **Cons:** mais um container. Há diferenças de compatibilidade a conhecer, por exemplo o lifecycle `AbortIncompleteMultipartUpload` não é suportado via `PutBucketLifecycle` (ver TD-10).

### Option B: Filesystem em volume Docker
- Arquivos gravados em volume montado, servidos pela API.
- **Pros:** zero infra nova. Simples de depurar.
- **Cons:** sem presigned URL nem multipart nativo, então a API entra no caminho dos bytes (conflita com "sem impacto na performance"). Não escala para múltiplas instâncias. Exige reescrever tudo na migração para S3.

### Option C: S3 real (AWS) também em dev
- Dev e CI usam um bucket real.
- **Pros:** fidelidade total com produção.
- **Cons:** custo, credenciais em dev, dependência de rede e testes não herméticos. Conflita com "tudo roda em Docker".

**Recommendation:** **Option A (MinIO via API S3)** — um contrato S3 serve em dev e produção e o diagrama já prevê "S3 or MinIO". Fica registrada a ressalva de lifecycle no TD-10.

**Decision:** A (MinIO no compose, via API S3)
**Libraries:** `@aws-sdk/client-s3`

---

## TD-02: Protocolo de upload de até 10GB — contract e handshake FE↔BE

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** 10GB não pode passar por buffer em memória nem monopolizar a API. O protocolo define o handshake entre backend e frontend (quem inicia, quem envia as partes, como retomar). Depende de TD-01.

**Options:**

### Option A: Presigned S3 multipart direto ao storage
- A API inicia o multipart (`CreateMultipartUpload`), devolve ao cliente uma presigned URL por parte (`UploadPart`) e depois finaliza (`CompleteMultipartUpload`). O frontend divide o arquivo e envia as partes direto ao storage, em paralelo e com retry por parte. Com limite de 10.000 partes, 10GB com partes de 64–100MiB dá ~100–160 partes.
- **Pros:** a API fica fora do caminho dos dados. Retomada por parte via `ListParts`. Paralelismo no cliente.
- **Cons:** o cliente implementa a lógica de partes (mais código no frontend). O presigner fixa `UNSIGNED-PAYLOAD`, então a integridade da parte depende de enviar `Content-MD5` ou `Checksum*`. Exige CORS no bucket e URLs assinadas com o host público do storage (ver Nota).

### Option B: Multipart/stream pela API
- O cliente envia o arquivo à API (`multipart/form-data` ou stream), que repassa ao storage.
- **Pros:** frontend simples. Autorização e validação ficam centralizadas.
- **Cons:** toda a banda de 10GB passa pela API, que é o oposto de "sem impacto na performance". Sem retomada nativa. Conexões de horas e risco de timeout em proxies.

### Option C: tus (`@tus/server` com `@tus/s3-store`)
- Protocolo aberto de upload resumível. O servidor tus roda no backend e grava no S3 via multipart (partSize padrão 8MiB, `maxSize` configurável, hooks `onUploadFinish`). O cliente usa `tus-js-client`.
- **Pros:** retomada padronizada e clientes prontos. Menos lógica de partes no frontend.
- **Cons:** os bytes passam pelo processo do servidor tus. O `locker` padrão é em memória, então várias instâncias precisam de um locker compartilhado. É uma dependência extra e um segundo protocolo ao lado da API REST.

**Recommendation:** **Option A (presigned multipart)** — mantém a API fora do caminho dos 10GB e dá retomada por parte, usando só o SDK S3 já necessário pelo TD-01. O contrato (endpoints `init`, `part-urls` e `complete` e o shape das respostas) entra no `openapi.json`. Option C é a alternativa se a simplicidade do cliente pesar mais que manter a API fora do caminho dos dados.

**Nota técnica (contrato de env var):** presigned URLs só validam se a assinatura usar o mesmo host que o cliente acessa. O cliente (navegador) não resolve o nome do serviço Docker (`minio`), mas a API alcança o storage por ele. Isso exige duas configurações: endpoint interno (nome do serviço, para a API) e endpoint público (para assinar URLs). A chave de env do endpoint público precisa existir em schema Joi, `compose.yaml` e `.env.example`.

**Decision:** A (Presigned S3 multipart direto ao storage), considerando os requisitos da fase: upload de até 10GB sem segurar a API durante o envio; pré-cadastro automático do vídeo como rascunho ao iniciar o upload; processamento automático após o upload (duração e metadados); thumbnail automática a partir de um frame; URL única por vídeo; streaming sem download completo; download pelo usuário
**Libraries:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`

---

## TD-03: Fila de jobs de processamento

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** O processamento (ffprobe, ffmpeg) deve rodar fora da requisição. O diagrama marca a fila como "TBD". A escolha afeta infraestrutura (Redis novo ou não), retries e detecção de worker morto em jobs longos.

**Options:**

### Option A: BullMQ + Redis (`@nestjs/bullmq`)
- Integração Nest madura (`@Processor`, `WorkerHost`, `registerQueueAsync` com `ConfigService`). Retries e backoff via `defaultJobOptions.attempts/backoff`. Jobs com falha ficam como `failed` e disparam eventos (`@OnWorkerEvent('failed')`).
- **Pros:** o ecossistema Nest mais comum para filas. Concorrência, rate limit e eventos prontos.
- **Cons:** adiciona o Redis ao compose e ao ambiente de teste. Jobs longos exigem atenção a lock/stalled. Um segundo store além do Postgres.

### Option B: pg-boss (Postgres)
- Fila sobre o Postgres que já existe. `retryLimit`, `retryDelay`, `retryBackoff`, `expireInSeconds` (padrão 15 min) e `heartbeatSeconds` para detectar worker morto sem esperar a expiração.
- **Pros:** sem infra nova. Job e linha do vídeo no mesmo banco. A doc cita justamente o caso de job de vídeo longo, com heartbeat.
- **Cons:** sem wrapper Nest oficial (precisa de provider próprio). Carga de fila no banco principal. Handlers precisam ser idempotentes, pois um job pode rodar duas vezes se o worker só parecer morto.

### Option C: RabbitMQ
- Broker dedicado com ack/nack, DLQ e roteamento.
- **Pros:** semântica de mensageria robusta e desacoplamento total.
- **Cons:** o mais pesado dos três. Para um único tipo de job é excesso, e exige mais operação.

**Recommendation:** _sem recomendação forte_ — as duas primeiras são equivalentes para este volume. Inclino a **Option A (BullMQ)** pela integração Nest mais madura, se o custo de um Redis no compose for aceitável. Escolha **Option B (pg-boss)** se a prioridade for zero infra nova. A decisão é de preferência de equipe.

**Decision:** A (BullMQ + Redis via `@nestjs/bullmq`)
**Libraries:** `@nestjs/bullmq`, `bullmq`

---

## TD-04: Topologia do worker

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** O worker roda ffmpeg/ffprobe, que consomem CPU e precisam do binário instalado. O diagrama já prevê "Video Worker (FFmpeg)" como container separado. Depende de TD-03.

**Options:**

### Option A: Mesmo codebase, 2º entrypoint em container próprio
- Um `main-worker.ts` cria um standalone application context (`NestFactory.createApplicationContext`) sem HTTP, e o compose sobe um serviço `video-worker` com ffmpeg na imagem, reaproveitando entities, config e módulos.
- **Pros:** isola CPU/ffmpeg da API. Reusa entities, Joi e TypeORM sem duplicar. Escala o worker de forma independente.
- **Cons:** imagem e entrypoint adicionais. Exige cuidado para o worker não carregar módulos HTTP desnecessários.

### Option B: Processor dentro do processo da API
- O consumidor da fila roda no mesmo processo da API.
- **Pros:** sem container novo, o mais simples.
- **Cons:** ffmpeg compete por CPU com as requisições, o que quebra "sem impacto na performance". A API precisa do binário ffmpeg. Um crash do worker derruba a API.

### Option C: Sub-projeto separado
- Novo diretório com seu próprio `package.json`.
- **Pros:** isolamento máximo de dependências.
- **Cons:** duplica entities, config e migrations ou exige pacote compartilhado, o que traz tooling de monorepo que o projeto ainda não tem.

**Recommendation:** **Option A** — isola CPU/ffmpeg da API sem duplicar entities nem config, e bate com o container "Video Worker" do diagrama.

**Decision:** A (mesmo codebase, 2º entrypoint em container próprio)

---

## TD-05: Extração de metadados e thumbnail

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** O worker precisa extrair duração e metadados e gerar uma thumbnail. Há que escolher como invocar o ffmpeg/ffprobe e qual frame usar. Depende de TD-04 (onde roda).

**Options:**

### Option A: `child_process.spawn` direto com ffprobe/ffmpeg
- `ffprobe -show_format -show_streams -of json` para metadados e `ffmpeg -ss <t> -i in -frames:v 1 out.jpg` para o frame. `-ss` antes de `-i` faz seek rápido (vai ao ponto de seek mais próximo antes da posição).
- **Pros:** sem dependência extra. Controle total de argumentos, timeout e stderr. Sem lib morta no caminho crítico.
- **Cons:** você escreve o parsing do JSON e o tratamento de erro e de processo.

### Option B: `fluent-ffmpeg`
- API fluente sobre o ffmpeg.
- **Pros:** API conveniente e muitos exemplos.
- **Cons:** **o repositório está arquivado desde 22/05/2025 e a própria README o marca como deprecated e sem manutenção.** Não recebe correções para versões novas do ffmpeg. Não recomendado para código novo.

### Option C: Serviço externo de mídia
- Terceirizar a extração para um serviço gerenciado.
- **Pros:** zero binário local.
- **Cons:** custo, latência e saída de dados do projeto, inclusive para arquivos de até 10GB. Contraria o diagrama, que prevê FFmpeg no worker.

**Escolha de frame (sub-decisão):** frame fixo (ex.: 1s) é simples e previsível, mas vídeos curtos ou abertura preta geram thumbnail ruim. Percentual da duração (ex.: 10%) exige o ffprobe antes, o que já acontece neste fluxo. O filtro `thumbnail` do ffmpeg escolhe um frame representativo, mas lê um lote de frames (`n`, padrão 100) e custa mais.

**Recommendation:** **Option A (`spawn` direto)**, com o frame a ~10% da duração, aproveitando a duração que o ffprobe já retorna. Evita uma dependência arquivada e mantém o controle de timeout.

**Decision:** A (`child_process.spawn` direto com ffprobe/ffmpeg)

---

## TD-06: Entrega de streaming e download — contract de URLs

**Scope:** Cross-layer

**Capability:** Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** O player precisa começar sem baixar o arquivo inteiro, e o usuário precisa baixar o original. O frontend consome uma URL, então o contrato de como ela é obtida é compartilhado. Depende de TD-01.

**Options:**

### Option A: Presigned GET + HTTP Range direto do storage
- A API autoriza e devolve uma presigned URL de `GetObject`. O `<video>` do navegador faz requisições Range direto ao storage. Para download, a URL inclui `ResponseContentDisposition: attachment`.
- **Pros:** a API fica fora do caminho dos bytes. Range cobre "sem download completo". O mesmo mecanismo serve streaming e download.
- **Cons:** a URL expira, então o frontend precisa renovar em reprodução longa. Exige CORS e host público assinado (mesma nota do TD-02). Para o MP4 tocar cedo, o arquivo precisa ter o `moov` no início (`+faststart`), o que pode exigir um passo de remux no worker.

### Option B: Proxy da API com Range
- A API lê do storage e repassa os bytes respeitando `Range`.
- **Pros:** URL estável e controle de acesso total por requisição.
- **Cons:** toda a reprodução passa pela API (banda e CPU). Precisa implementar Range corretamente.

### Option C: HLS (transcode em segmentos)
- O worker gera playlist e segmentos para streaming adaptativo.
- **Pros:** o melhor playback em redes ruins e bitrate adaptativo.
- **Cons:** transcode pesado, mais armazenamento e complexidade de worker. Nenhum bullet da fase exige isso. Fora de escopo.

**Recommendation:** **Option A (presigned GET + Range)** — mantém a API fora do caminho dos bytes e `Content-Disposition` cobre o download. HLS fica fora de escopo. Se o remux `+faststart` for necessário, ele entra no TD-05 como passo do worker.

**Decision:** A (presigned GET + HTTP Range direto do storage)
**Libraries:** `@aws-sdk/s3-request-presigner`

---

## TD-07: Modelo de dados e ciclo de vida do vídeo

**Scope:** Backend

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** O vídeo nasce como rascunho no início do upload, antes de o arquivo existir. O modelo define os estados que o frontend lê (progresso, "processando", "pronto", "falhou").

**Options:**

### Option A: Tabela `videos` com status enum
- Uma tabela com coluna `status` (`uploading → uploaded → processing → ready | failed`) e campos de metadados anuláveis até o processamento.
- **Pros:** simples, uma entity. O status é o contrato que o frontend consome.
- **Cons:** dados de upload (`uploadId`, partes) e de processamento (tentativas, erro) ficam misturados na entity do vídeo.

### Option B: `videos` + tabela de upload/processing job
- O vídeo guarda o estado de negócio e uma tabela à parte guarda o upload multipart e as tentativas de processamento.
- **Pros:** separa responsabilidades e mantém histórico de tentativas.
- **Cons:** mais tabelas, joins e migrations para um fluxo que hoje é linear.

### Option C: State machine explícita
- Transições validadas por uma máquina de estados (ex.: lib ou classe dedicada), rejeitando transições inválidas.
- **Pros:** impede estados inconsistentes e documenta as transições.
- **Cons:** mais código para um conjunto pequeno de estados. Pode ser feita como convenção dentro da Option A.

**Recommendation:** **Option A (tabela `videos` + status enum)**, com as transições validadas no service. Os valores do enum são o contrato lido pelo frontend e entram no `openapi.json`. Visibilidade e publicação ficam para a Fase 04.

**Decision:** A (tabela `videos` com status enum)

---

## TD-08: Identificador público único da URL — contract do id

**Scope:** Cross-layer

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** A URL pública do vídeo é compartilhada com o frontend e usada em rotas. O id precisa existir desde o início do upload, quando ainda não há título.

**Options:**

### Option A: UUID (a própria PK)
- Expõe o UUID da tabela.
- **Pros:** sem colisão na prática e nenhuma coluna extra.
- **Cons:** URL longa e pouco amigável. Acopla o identificador público à PK.

### Option B: Id curto aleatório (nanoid, ~11 caracteres) com unique index
- Coluna separada `public_id`, gerada no pré-cadastro, com índice único e retry em caso de colisão.
- **Pros:** URL curta e compartilhável. Desacopla o id público da PK. Existe desde o início do upload.
- **Cons:** coluna e índice extras. Precisa de tratamento de colisão (raro) e de uma dependência de geração.

### Option C: Slug de título + sufixo
- Slug derivado do título mais um sufixo para unicidade.
- **Pros:** URL legível e boa para SEO.
- **Cons:** o título não existe no início do upload, então o slug mudaria ou ficaria vazio. Edição de título (Fase 04) quebra links.

**Recommendation:** **Option B (id curto separado da PK)** — gerado no pré-cadastro, com unique index, e estável mesmo se o título mudar. O slug puro não serve porque o título não existe no início do upload. O shape do campo `publicId` entra no contrato da API.

**Decision:** B (id curto aleatório com unique index)
**Libraries:** `nanoid`

---

## TD-09: Gatilho de conclusão do upload — contract do `complete`

**Scope:** Cross-layer

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** É preciso saber quando o upload terminou para enfileirar o processamento. Depende de TD-02 (protocolo) e TD-03 (fila).

**Options:**

### Option A: Endpoint explícito `complete`
- O frontend chama `complete` ao enviar a última parte. A API finaliza o multipart, verifica o objeto (`HeadObject`), muda o status e enfileira o job.
- **Pros:** o fluxo é explícito e fácil de testar. A API valida tamanho e existência antes de enfileirar. Sem infra extra.
- **Cons:** depende do cliente chamar. Se o navegador fechar antes, o upload fica órfão (coberto pela limpeza do TD-10).

### Option B: Notificação de evento do bucket
- O storage notifica a API (webhook/fila) quando o objeto é criado.
- **Pros:** independe do cliente. Resiliente a fechamento do navegador.
- **Cons:** configuração de notificações no MinIO/S3 e mais uma peça de infra. Dificulta testes locais e diverge entre MinIO e S3.

### Option C: Hooks do tus
- Com TD-02 Option C, `onUploadFinish` dispara o enfileiramento.
- **Pros:** nativo ao protocolo.
- **Cons:** só existe se o TD-02 escolher tus.

**Recommendation:** **Option A (endpoint `complete`)** — a API verifica o objeto antes de enfileirar, sem infra adicional. Os uploads órfãos são tratados no TD-10.

**Decision:** A (endpoint explícito `complete`)

---

## TD-10: Limites, validação e limpeza

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** Com presigned upload, o limite de 10GB não é imposto por quem recebe os bytes. É preciso validar tamanho e conteúdo, e limpar uploads abandonados e vídeos `failed`. Depende de TD-02 e TD-05.

**Options:**

### Option A: Validação completa em camadas
- Tamanho declarado no `init`, checagem do `ContentLength` real no `complete` (`HeadObject`), validação do arquivo no worker via ffprobe (é mesmo um vídeo, codec, duração), e limpeza de multipart abandonado. Jobs com retry/backoff e estado `failed` com motivo.
- **Pros:** o limite de 10GB é aplicável de verdade. Arquivos não-vídeo são rejeitados. Estados terminais claros para o usuário.
- **Cons:** mais lógica em três pontos (init, complete, worker).

### Option B: Job agendado de limpeza
- Um job periódico lista e aborta multiparts antigos e remove vídeos `failed` ou órfãos.
- **Pros:** funciona igual em MinIO e S3. Necessário no MinIO porque a ação de lifecycle `AbortIncompleteMultipartUpload` não é suportada via `PutBucketLifecycle` segundo a documentação. Em S3 real, a regra de lifecycle faria o mesmo sem código.
- **Cons:** mais um job a manter. `ListMultipartUploads` no MinIO exige o nome exato do objeto como prefixo, o que limita a listagem geral.

### Option C: Mínimo, sem limpeza
- Só valida tamanho no `init`.
- **Pros:** menor esforço.
- **Cons:** o 10GB não é aplicável (o cliente pode enviar mais), partes órfãs acumulam custo e vídeos corrompidos chegam ao estado `ready`.

**Recommendation:** **Option A, com o job de limpeza da Option B como parte dela** — sem validação o limite de 10GB não existe com presigned upload, e a limpeza precisa de job próprio porque o MinIO não suporta o lifecycle de abort. Em produção com S3 real, a regra de lifecycle pode substituir o job.

**Decision:** A (validação em camadas, com o job de limpeza da Option B incluso)

---

## TD-11: Estratégia de testes (storage, fila e ffmpeg)

**Scope:** Backend

**Capability:** Transversal — covers: Serviço de armazenamento de arquivos (vídeos e thumbnails); Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** Storage, fila e ffmpeg são dependências externas lentas ou não determinísticas. É preciso fixar o que roda real e o que é mock. A política atual do projeto usa infraestrutura real em integration e mock em unit.

**Options:**

### Option A: Infra real em tudo (MinIO + fila reais no compose de teste)
- **Pros:** máxima fidelidade.
- **Cons:** testes unitários ficam lentos e dependem de containers. Quebra a pirâmide de testes.

### Option B: Mocks do client S3 e da fila
- **Pros:** rápido e hermético.
- **Cons:** não detecta incompatibilidades reais (presigned, multipart, host público). Falsa confiança.

### Option C: Híbrido
- Unit com mocks do client S3 e da fila. Integration com MinIO e fila reais. ffmpeg com um vídeo fixture curto no integration do worker.
- **Pros:** alinhado à política atual e à pirâmide. Pega problemas de compatibilidade onde importam.
- **Cons:** o compose de teste ganha MinIO (e Redis, se TD-03 escolher BullMQ) e o binário ffmpeg precisa estar na imagem de teste.

**Recommendation:** **Option C (híbrido)** — segue a política atual (integration real, unit com mock) e cobre os pontos onde o mock esconderia bugs, como a assinatura de presigned URL com host público.

**Decision:** C (híbrido)

---

## TD-12: Baseline de dependências do backend (defasagem e vulnerabilidades) antes de instalar as libs da fase

**Scope:** Backend

**Capability:** Transversal — covers: Serviço de armazenamento de arquivos (vídeos e thumbnails); Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** Esta fase instala libs novas (`@aws-sdk/*`, fila de TD-03, imagem do worker de TD-04 com ffmpeg). Elas serão instaladas sobre um baseline que hoje falha na auditoria. Medido em `nestjs-project/` em 2026-11-28 (Node 22.6 no host, `node:25.6.0-slim` no `Dockerfile.dev`):

- `npm install --dry-run` **não falha** (resolve a árvore, só adiciona binários opcionais de plataforma). A "falha crítica" que aparece na instalação é a do **`npm audit`: 62 vulnerabilidades (3 critical, 24 high, 34 moderate, 1 low)**. Foi a leitura que adotei do pedido. Se o erro que você viu for outro (por exemplo ao rodar `npm ci` no container), me envie a saída.
- **Critical:** `handlebars` 4.7.9 (direta; injeção de JS em `compile`, corrigida na 4.7.10), `liquidjs` ≤10.27.1 (RCE; transitiva de `@nestjs-modules/mailer`) e `proxy-addr` ≤2.0.7 (spoofing de IP; transitiva de `express`, via `@nestjs/platform-express`).
- **High diretas:** `@nestjs/core` ≤11.1.17, `@nestjs/platform-express` ≤11.1.27, `@nestjs/config` (via `lodash`) e `joi` 18.0–18.3.0 (prototype pollution). Todas têm correção **dentro de 11.x** e dentro dos ranges `^` já declarados (`@nestjs/core` 11.1.16→11.2.12, `joi` →18.3.2, `@nestjs/config` →4.0.4, `handlebars` →4.7.10, `@nestjs-modules/mailer` →2.3.10).
- **High transitivas** (`nodemailer`, `multer`, `path-to-regexp`, `undici`, `body-parser`, `svgo`, `postcss` etc.) vêm quase todas de `@nestjs-modules/mailer` (mjml, preview-email) e `@nestjs/platform-express`. O `npm audit` marca `fixAvailable: true` para todas, exceto `picomatch`, que só some com `@nestjs/cli` 12 (major). Não simulei o resultado final do `npm audit fix` (o `--dry-run` não mostra o estado pós-correção), então o residual exato é estimativa.
- **Defasagem de major:** `@nestjs/*` 11→12, `@nestjs/cli` 11→12, `@nestjs-modules/mailer` 2→4, `@nestjs/config` 4→12, `typescript` 5→7, `argon2` 0.41→0.45, `class-validator` 0.14→0.15. Deprecations no lockfile: `glob` antigos (jest, typeorm, mjml) e `inflight`.
- **Restrições do Nest 12** (doc oficial, via Context7): pacotes **ESM-only**; Jest só carrega esses pacotes no **Node 24.9+** (senão `ERR_REQUIRE_ASYNC_MODULE`) ou migra para Vitest; exige **TypeScript 6** (o `@nestjs/schematics` 12 recusa TS 5 como peer) e Node ≥20.19 / ≥22.12 para rodar. O host atual (Node 22.6) está **abaixo** desse piso, enquanto o container (25.6) passa. `nest upgrade` automatiza parte da migração, mas exige Node ≥22.22.3.
- `@nestjs/bullmq` e demais libs de TD-03 declaram peer em `@nestjs/common`; a major do Nest escolhida aqui fixa quais versões delas entram.

Depende de nada, mas condiciona TD-03 e TD-04 (peers de fila e imagem do worker) e TD-11 (ambiente de teste).

**Options:**

### Option A: Correções dentro das majors atuais (Nest 11), antes das libs novas
- `npm audit fix` / `npm update` dentro dos ranges `^`, depois `npm audit` e a suíte completa. Fica em Nest 11, TS 5, Jest 30 e Node atual. Residuais de dev (por exemplo `picomatch` via CLI) são avaliados um a um, e só vira `overrides` se não houver correção.
- **Pros:** elimina os 3 critical e as high diretas com risco baixo (só minor/patch). Sem mudança de Node, de módulo ou de runner de testes. Cabe em uma tarefa pequena e isolada, antes de TD-01..TD-11.
- **Cons:** mantém a defasagem de major. Parte das high transitivas de dev pode sobrar. Adia a migração para o Nest 12, que ficará mais cara depois.

### Option B: A + migração para Nest 12 na própria fase
- Além de A: `nest upgrade` (Nest 12, CLI 12, TS 6, mailer 4, config 12), Node ≥24.9 no host e no `Dockerfile.dev`, e Jest ajustado (ou Vitest).
- **Pros:** zera quase todo o passivo e instala as libs novas já sobre a major atual.
- **Cons:** mistura uma migração de framework com a entrega de upload, contra o limite de escopo do projeto. ESM-only e TS 6 podem quebrar a suíte atual. Exige subir o Node do host. Aumenta bastante o risco da fase.

### Option C: Só `overrides` pontuais nas transitivas críticas
- Fixar por `overrides` no `package.json` as versões corrigidas de `liquidjs`, `proxy-addr` e `handlebars`, sem atualizar os pacotes diretos.
- **Pros:** menor mudança de código e de lockfile.
- **Cons:** deixa as high diretas (`@nestjs/core`, `@nestjs/platform-express`, `joi`, `@nestjs/config`) vulneráveis. `overrides` esconde a defasagem e pode divergir dos peers dos pacotes pai.

**Recommendation:** **Option A**, executada como tarefa própria (branch `bugfix/` ou `feature/` a partir de `dev`) **antes** de qualquer lib nova da fase, com `npm audit` e a suíte completa verdes como critério. A migração para o Nest 12 fica como decisão separada (`/research` próprio), porque exige Node ≥24.9 e TS 6 e não é pré-requisito de nenhum bullet da fase. Se você preferir fazer a Option B, a ordem natural é B antes de TD-03.

**Decision:** B (Option A + migração para Nest 12 na própria fase)
**Libraries:** `@nestjs/core@^12`, `@nestjs/common@^12`, `@nestjs/platform-express@^12`, `@nestjs/testing@^12`, `@nestjs/cli@^12`, `@nestjs-modules/mailer@^4`, `typescript@^6`

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Repo-wide | Object storage e ambiente local | A — MinIO via API S3 | _[pending]_ |
| TD-02 | Cross-layer | Protocolo de upload de até 10GB (contract) | A — Presigned S3 multipart | _[pending]_ |
| TD-03 | Backend | Fila de jobs de processamento | A (BullMQ) ou B (pg-boss) — sem recomendação forte | _[pending]_ |
| TD-04 | Backend | Topologia do worker | A — Mesmo codebase, container próprio | _[pending]_ |
| TD-05 | Backend | Extração de metadados e thumbnail | A — `spawn` direto, frame a ~10% | _[pending]_ |
| TD-06 | Cross-layer | Entrega de streaming e download (contract de URLs) | A — Presigned GET + Range | _[pending]_ |
| TD-07 | Backend | Modelo de dados e ciclo de vida do vídeo | A — `videos` com status enum | _[pending]_ |
| TD-08 | Cross-layer | Identificador público único (contract do id) | B — Id curto separado da PK | _[pending]_ |
| TD-09 | Cross-layer | Gatilho de conclusão do upload (contract do `complete`) | A — Endpoint `complete` | _[pending]_ |
| TD-10 | Backend | Limites, validação e limpeza | A — Validação em camadas + job de limpeza | _[pending]_ |
| TD-11 | Backend | Estratégia de testes (storage, fila, ffmpeg) | C — Híbrido | _[pending]_ |
| TD-12 | Backend | Baseline de dependências (defasagem e vulnerabilidades) | A — Correções dentro das majors atuais, antes das libs novas | _[pending]_ |

**Dependências entre TDs:** TD-02 → TD-01 · TD-04 → TD-03 · TD-05 → TD-04 · TD-06 → TD-01 · TD-09 → TD-02, TD-03 · TD-10 → TD-02, TD-05 · TD-12 condiciona TD-03, TD-04 e TD-11 (deve ser aplicado antes de instalar as libs da fase).
