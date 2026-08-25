---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-08-21
scope_description: "Fila de processamento, estratégia de upload de arquivos grandes (10GB), execução de FFmpeg/ffprobe no worker, ciclo de status do vídeo, identificador único de URL e entrega (streaming/download) para a Fase 03."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — recebe o módulo de vídeos completo: fila de processamento, upload direto ao storage, worker de processamento (FFmpeg/ffprobe), ciclo de status, identificador único e entrega (streaming/download). Todos os TDs deste documento incidem aqui.
- `next-frontend/` — **sem decisão aberta neste documento.** A interface de vídeo está explicitamente fora do escopo da Fase 03 (enunciado do curso: *"Este é um desafio de backend: a entrega é a API, o worker, a infraestrutura e os artefatos do processo... a interface de vídeo não faz parte do escopo desta fase"*). Os endpoints desta fase são consumidos diretamente via HTTP (testes e2e/Postman), não pelo BFF do Next.js.

---

## TD-01: Message Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** O diagrama de arquitetura (`docs/diagrams/software-arch.mermaid`) já fixa um container `Message Queue` entre a API e o Video Worker — a existência da fila não está em aberto, apenas a tecnologia (`"TBD"` literal no diagrama). É a decisão de stack mais aberta da fase, citada explicitamente no enunciado do curso.

**Options:**

### Option A: RabbitMQ (via `@nestjs/microservices`, transporte RMQ)
- Broker de mensagens dedicado. A API publica jobs via `ClientProxy.emit()` (fire-and-forget); o worker consome como uma aplicação NestJS híbrida (`NestFactory.createMicroservice()` com `Transport.RMQ`). Suporta exchanges, dead-letter exchange (DLX) e acks/nacks explícitos.
- **Pros:** É a leitura mais literal do nome do container no diagrama ("Message Queue" é um broker, não uma lib de job queue). Transporte oficial do NestJS (`@nestjs/microservices`, mantido pelo core team — compatibilidade com `@nestjs/core ^11.0.0` confirmada). A imagem `rabbitmq:management` já inclui uma UI administrativa (porta 15672) sem dependência extra. Modelo de entrega maduro (ack/nack, DLX) dá base natural para retry/reprocessamento (ver TD-04).
- **Cons:** Mais peças para configurar corretamente (exchange, binding, routing key, durabilidade da queue) — superfície maior de erro de configuração do que uma lib de job queue. Curva de aprendizado de AMQP maior. Retry com backoff não é uma flag única — precisa ser montado via DLX + TTL de requeue.

### Option B: BullMQ + Redis (via `@nestjs/bullmq`)
- Lib de job queue apoiada em Redis. `@nestjs/bullmq` expõe producers/consumers como classes injetáveis via DI.
- **Pros:** Também é módulo oficial do NestJS (`@nestjs/bullmq` v11.0.4, compatível com `@nestjs/core ^11.0.0`). DX voltada a jobs: retries com backoff exponencial, delayed jobs e concorrência configuráveis em poucas linhas. Ecossistema/documentação extensos.
- **Cons:** Introduz Redis como infraestrutura nova só para isso — nada mais no stack hoje usa Redis. Semanticamente "empresta" um cache-store para função de fila, em vez de um broker dedicado. Precisaria de Bull Board (dependência extra) para ter uma UI equivalente à do RabbitMQ, que já vem de graça na imagem.

### Option C: pg-boss (fila sobre PostgreSQL)
- Usa `SKIP LOCKED` sobre uma tabela dedicada no Postgres já existente no Compose.
- **Pros:** Zero infraestrutura nova — reaproveita o Postgres já provisionado. Job e mudança de status do vídeo poderiam compartilhar a mesma transação.
- **Cons:** Sem integração oficial com NestJS (só wrappers de comunidade, ex. `@wavezync/nestjs-pgboss`) — risco de manutenção maior que as opções A/B, ambas oficiais. Throughput inferior a um broker dedicado (irrelevante na escala do projeto, mas não é o caso de uso principal do Postgres). Menor alinhamento com o nome literal do container no diagrama.

**Recommendation:** **Option A (RabbitMQ)** — é a leitura mais direta do container "Message Queue" do diagrama, tem transporte oficial do NestJS tanto quanto BullMQ (não é mais arriscada nesse quesito), e ganha de graça uma UI administrativa que as outras opções não têm sem dependência adicional. O custo de configuração de AMQP é real, mas proporcional ao valor didático de demonstrar mensageria "de verdade" em vez de uma lib de job queue.

**Decision:** A (RabbitMQ via `@nestjs/microservices`)

---

## TD-02: Large File Upload Strategy (10GB)

**Scope:** Backend

**Capability:** Transversal — covers: "Serviço de armazenamento de arquivos (vídeos e thumbnails)", "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance"

**Context:** O Object Storage (S3/MinIO) já é dado pela arquitetura — não é uma escolha em aberto. O que precisa ser decidido é como os bytes do arquivo chegam até lá sem que a API os manuseie diretamente (requisito explícito: "sem impacto na performance"), e como o storage é organizado (buckets/chaves) para vídeo original e thumbnail.

**Options:**

### Option A: Presigned Multipart Upload (cliente → storage direto, em chunks)
- A API chama `CreateMultipartUploadCommand`, gera uma URL pré-assinada por chunk (`UploadPartCommand`, ~10MB por parte — dentro do piso de 5MB e do teto de 10.000 partes do S3/MinIO, resultando em ~1.000 partes para 10GB). O cliente sobe cada chunk direto no storage; a API finaliza com `CompleteMultipartUploadCommand`.
- **Pros:** A API nunca toca nos bytes do arquivo — footprint de CPU/memória constante independente do tamanho. Chunks individuais podem ser reenviados sem reiniciar a transferência inteira de 10GB. Recurso nativo do S3/MinIO, sem servidor de protocolo adicional.
- **Cons:** O cliente precisa gerenciar a lógica de chunking e rastrear os ETags de cada parte. Mais round-trips que um PUT único. Uploads multipart abandonados precisam de política de expiração ou endpoint explícito de abort para não desperdiçar espaço no storage.

### Option B: Presigned PUT único (sem chunking)
- Uma única URL pré-assinada (`PutObjectCommand`) para o arquivo inteiro.
- **Pros:** Implementação mais simples possível — uma URL, uma requisição.
- **Cons:** Sem possibilidade de retomada — qualquer interrupção de rede durante uma transferência de 10GB obriga reiniciar do zero. Muitos clientes/proxies HTTP impõem limites práticos de tamanho de corpo bem abaixo de 10GB. Uma falha desperdiça a transferência inteira.

### Option C: tus (protocolo de upload resumível)
- Protocolo aberto com servidor dedicado (ex. `tusd`) na frente do storage.
- **Pros:** Resumibilidade nativa por offset de byte, protocolo bem especificado, bibliotecas cliente disponíveis.
- **Cons:** Introduz um componente de servidor inteiro (tusd) que não existe em nenhum lugar do diagrama de arquitetura do projeto (Frontend/API/Worker/DB/Storage/Queue) — precisaria de adaptador próprio para o S3/MinIO. O diagrama já implica upload direto ao storage via URL assinada (`Rel(frontend, storage, "Streams", "HTTPS")`), então o tus adiciona uma camada que o desenho não pede.

### Option D: Proxy de upload pela API (multer/busboy em streaming até o storage)
- O cliente envia para a API, que faz streaming do corpo até o S3/MinIO sem bufferizar em disco/memória.
- **Pros:** Código mais simples do lado do cliente — um PUT para um endpoint comum.
- **Cons:** Todo byte de um arquivo de 10GB transita pelo processo da API — mesmo em streaming (sem buffer), isso ocupa uma conexão/worker da API pela duração inteira da transferência, violando diretamente o requisito "sem impacto na performance" e o critério de reprova automática do enunciado sobre travar o sistema com o arquivo de 10GB.

**Recommendation:** **Option A (Presigned Multipart)** — é a única opção que mantém a API sem estado em relação aos bytes do arquivo, oferecendo retry por chunk numa transferência de 10GB sujeita a conexões instáveis; casa com a relação direta cliente↔storage do diagrama. D é exatamente o antipadrão que os critérios de aceite do enunciado alertam; C introduz um componente fora do diagrama; B não tem resumibilidade na escala de 10GB.

**Organização de bucket/chave** (parte desta decisão, não um TD separado): um bucket para originais e um para thumbnails (ou um bucket único com prefixos) — o padrão exato de chave (ex. `videos/{channelId}/{videoId}/original.<ext>`) é resolvido pelo `implement` seguindo convenções vizinhas, não é um fork estratégico.

**Dependency:** o momento exato em que o registro de rascunho é criado no banco depende da TD-04 (Ciclo de Status do Vídeo).

**Decision:** A (Presigned Multipart Upload)

---

## TD-03: Video Processing & Thumbnail Generation (estratégia de execução do FFmpeg)

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** O worker precisa rodar `ffprobe` (metadados: duração, resolução, codec, bitrate) e `ffmpeg` (extração de um frame para thumbnail) sobre o arquivo já 100% enviado. A pesquisa encontrou um dado que muda a recomendação óbvia: o wrapper Node.js historicamente dominante para isso está descontinuado.

**Options:**

### Option A: `child_process` puro (spawn direto dos binários `ffmpeg`/`ffprobe`)
- O worker invoca o CLI do `ffmpeg`/`ffprobe` (instalados na imagem Docker do worker) via `child_process.spawn` do Node, parseando a saída JSON (`ffprobe -print_format json -show_format -show_streams`) para metadados e rodando um comando simples (`-ss <timestamp> -frames:v 1`) para a thumbnail.
- **Pros:** Zero dependência de wrapper Node (nenhum risco de abandono de pacote). Controle total sobre as flags exatas do CLI. Padrão bem documentado. Única dependência real é o binário `ffmpeg` na imagem do worker.
- **Cons:** Sem API fluente — construção de comando e parsing de stdout/stderr são manuais. Tratamento de erro (exit code não-zero, JSON malformado) fica a cargo da implementação.

### Option B: `fluent-ffmpeg` (+ `ffprobe-static`/`ffmpeg-static`)
- O wrapper historicamente dominante — API fluente (`.screenshots()`, `.ffprobe()`), ~2M downloads semanais no auge.
- **Pros:** API familiar e amplamente documentada, muito conteúdo de referência disponível (tutoriais, StackOverflow).
- **Cons:** **O repositório foi arquivado em 22/05/2025** e já estava sem manutenção significativa desde ~2020 — sem correções de bugs ou compatibilidade com versões futuras do FFmpeg. Adotar uma dependência arquivada num projeto greenfield contraria a postura que o próprio projeto já adotou em outra decisão (`openapi-docs-nestjs/TD-01` descartou uma opção por risco de mudança de stack; aqui o risco é pior — abandono ativo, não apenas divergência).

### Option C: `mediaforge` (wrapper TypeScript moderno, sucessor declarado do fluent-ffmpeg)
- Wrapper mais novo, posicionado explicitamente como substituto do fluent-ffmpeg, zero bindings nativos, usa o binário do sistema.
- **Pros:** TypeScript-first, publicado ativamente (v1.0.0, lançado há poucos dias no momento desta pesquisa).
- **Cons:** **Imaturo demais para confiar neste projeto** — v1.0.0 recém-publicado, nenhum outro pacote do npm depende dele ainda, sem histórico de adoção/downloads para avaliar estabilidade.

**Recommendation:** **Option A (`child_process` puro)** — é a única opção sem uma bandeira vermelha de risco de dependência. `fluent-ffmpeg` está arquivado (desqualificado pelo próprio precedente do projeto de evitar tooling sem manutenção), e `mediaforge` é novo demais para ter histórico. `child_process` é nativo do Node, não uma dependência de terceiros — nada para ficar abandonado. As necessidades do worker (extrair metadados JSON, capturar um frame) são simples o bastante para que uma API fluente agregue pouco sobre duas invocações diretas de CLI.

**Decision:** A (`child_process` puro)

---

## TD-04: Video Status Lifecycle & Processing Failure Handling

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** Define os estados do vídeo e o que acontece quando o processamento falha. Depende da TD-01 (a tecnologia de fila determina quais primitivas de retry estão disponíveis — DLX+TTL no RabbitMQ) e da TD-02 (a estratégia de upload determina o momento exato em que o registro "rascunho" é criado: no endpoint que já solicita as URLs pré-assinadas, não em uma chamada separada).

**Options:**

### Option A: Ciclo mínimo de 3 estados (`rascunho` → `processando` → `pronto`/`erro`), sem retry automático
- Uma única tentativa de processamento; falhas (worker crash, arquivo corrompido, `ffmpeg` retornando erro) levam direto a `erro`, permanente até reprocessamento manual.
- **Pros:** Casa literalmente com o ciclo de exemplo do `project-plan.md` ("rascunho → processando → pronto/erro"). Mais simples de implementar e testar. Sem risco de loop de retry infinito ou efeitos colaterais duplicados (thumbnail enviada duas vezes) por retentativas automáticas.
- **Cons:** Uma falha transitória (OOM momentâneo do worker, soluço passageiro do storage) falha permanentemente um vídeo que teria sucesso numa nova tentativa — sem recuperação automática.

### Option B: Ciclo de 3 estados com retry automático limitado (N tentativas com backoff, via mecanismo nativo da fila escolhida em TD-01)
- Mesmos 3 estados finais, mas o job é reenfileirado automaticamente (ex.: RabbitMQ com DLX+TTL de requeue, ou equivalente) até N tentativas antes de cair definitivamente em `erro`.
- **Pros:** Falhas transitórias se autorecuperam sem intervenção manual. O mecanismo de retry é nativo da fila escolhida — custo de implementação marginal baixo. A DLQ ainda captura falhas permanentes para inspeção.
- **Cons:** Exige cuidado com idempotência (uma tentativa repetida não pode gerar thumbnail duplicada ou sobrescrever metadados de forma inconsistente). Mais peças em jogo (contagem de tentativas, configuração de backoff).

### Option C: Ciclo de 4 estados, separando `rascunho` (registro criado) de um estado intermediário `enviando`/`em_andamento` (upload em progresso, antes da confirmação)
- Adiciona um estado só para o intervalo entre "URLs de upload emitidas" e "upload confirmado via `/complete`".
- **Pros:** Nomeia explicitamente a janela em que o cliente está enviando chunks.
- **Cons:** Não corresponde a nenhuma diferença observável pelo sistema — nada muda entre "URLs emitidas" e "chunks sendo enviados" do ponto de vista do backend; é granularidade sem função. Diverge do ciclo de exemplo de 3 estados que o próprio `project-plan.md` já sugere, sem ganho concreto.

**Recommendation:** **Option B (3 estados + retry automático limitado)** — falhas transitórias são plausíveis e caras de forçar reupload manual num arquivo de até 10GB; o mecanismo de retry aproveita o que TD-01 já traz, então o custo de implementação marginal é baixo. Option C foi considerada e descartada por não introduzir nenhuma distinção funcional real (discutido e confirmado em conversa prévia com o usuário).

**Decision:** A (Ciclo mínimo de 3 estados, sem retry automático)

**Note:** Decision deliberately diverged from the Recommendation — Option A (no automatic retry) was preferred over Option B for simplicity: it matches the literal 3-state example cycle in `project-plan.md`, and avoids the idempotency care (duplicate thumbnail/metadata writes on a retried job) that automatic retry would require. Falhas transitórias exigem reprocessamento manual em vez de retry automático.

---

## TD-05: Unique Video Identifier Strategy

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** A seção "Pontos de Atenção" do `project-plan.md` acrescenta uma restrição além do texto literal da capability: *"cada vídeo precisa de uma URL **curta** e única"* — ou seja, o identificador usado na URL pública precisa ser não só livre de colisão, mas também razoavelmente curto, não apenas único.

**Options:**

### Option A: UUID v4 (reaproveitar o padrão de chave primária de `users`/`channels`, `uuid_generate_v4()`)
- **Pros:** Zero dependência nova (a extensão `uuid-ossp` já está habilitada desde as migrations de Fase 01/02). Consistente com toda outra entidade do schema. Probabilidade de colisão desprezível.
- **Cons:** 36 caracteres — não atende ao ponto de atenção "URL curta". Pouco amigável para leitura/compartilhamento (hífens, sem diferenciação visual de outros IDs).

### Option B: `nanoid` como identificador público dedicado (coluna separada da chave primária UUID)
- A chave primária no banco continua UUID (consistente com `users`/`channels`), mas uma segunda coluna (ex. `public_id`, gerada via `nanoid` na inserção, ~10-12 caracteres de alfabeto URL-safe) é o que aparece na URL pública (`/videos/:publicId`) e recebe a constraint de unicidade.
- **Pros:** Atende diretamente ao "curta" — nanoid em 10-12 caracteres é próximo do próprio esquema do YouTube (11 caracteres). Alfabeto URL-safe por padrão. Relacionamentos internos (worker, migrations, FKs) continuam usando UUID — é aditivo, não substitui o padrão existente do schema.
- **Cons:** Uma coluna extra + um índice único extra. Dois identificadores por vídeo (UUID interno vs. nanoid público) para manter consistentes no código e nos contratos de API.

### Option C: Inteiro auto-incremento ofuscado/codificado (ex. `hashids`)
- **Pros:** Representação mais curta possível para IDs iniciais.
- **Cons:** Inteiros sequenciais vazam informação de volume/crescimento mesmo codificados (codificação reversível, e o tamanho cresce com o contador). Quebra o padrão UUID que toda outra entidade do schema usa. Adiciona uma dependência nova (`hashids`) para algo que o nanoid resolve de forma mais simples.

**Recommendation:** **Option B (nanoid como identificador público, ao lado do UUID de chave primária)** — atende diretamente ao ponto de atenção "URL curta" do próprio `project-plan.md` sem abandonar o padrão UUID que o resto do schema já usa; a Option A sozinha não cumpre "curta" apesar de cumprir "única"; a Option C reintroduz vazamento de informação sequencial sem vantagem real sobre o nanoid.

**Decision:** B (`nanoid` público + UUID interno)

---

## TD-06: Video Delivery Strategy (Streaming & Download)

**Scope:** Backend

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** O diagrama de arquitetura já fixa `Rel(frontend, storage, "Streams", "HTTPS")` — o cliente lê os bytes do vídeo direto do storage, não através do processo da API. A questão em aberto é o mecanismo concreto que a API usa para direcionar o cliente a esse caminho direto, e como o suporte a Range/206 é obtido.

**Options:**

### Option A: Redirect 302 para uma URL de leitura pré-assinada de curta duração (por requisição)
- `GET /videos/:id/stream` e `GET /videos/:id/download` na API geram uma URL pré-assinada (`GetObjectCommand`, expiração curta, ex. 15min) e respondem com 302; o elemento `<video>` do navegador (ou um clique de download) então conversa direto com o MinIO/S3, que já serve nativamente requisições `Range` com `206 Partial Content` — sem código de range manual. Download usa o mesmo mecanismo com override `response-content-disposition=attachment` embutido na URL assinada.
- **Pros:** Zero bytes de vídeo passam pelo processo da API — casa com a relação direta frontend↔storage do diagrama. Range/206 é responsabilidade nativa da camada de storage (implementações S3-compatíveis já fazem isso). Um único mecanismo cobre streaming e download (só muda um parâmetro de query).
- **Cons:** A expiração da URL pré-assinada precisa ser calibrada para não expirar no meio de uma reprodução pausada por muito tempo (mitigável reemitindo `/stream` na expiração — padrão comum). A URL é tecnicamente compartilhável durante sua janela curta de validade (aceitável, já é verdade para qualquer acesso a storage via URL assinada).

### Option B: API faz proxy/streaming dos bytes ela mesma (lê do storage, encaminha para a resposta HTTP, implementando Range/206 manualmente)
- **Pros:** A API mantém controle total da resposta (poderia impor checagens de autorização adicionais por range de byte). Sem preocupação com expiração de URL assinada.
- **Cons:** **Todo byte de toda visualização/download passa a transitar pelo processo da API** — exatamente o antipadrão que o próprio diagrama de arquitetura evita ao desenhar `frontend → storage` direto em vez de `frontend → API → storage`. Reimplementar corretamente a semântica HTTP Range/206 (multi-range, `Accept-Ranges`, `Content-Range`) não é trivial e o storage já faz isso corretamente. Não escala independente da capacidade da API.

### Option C: Bucket público/leitura anônima (sem assinatura nenhuma)
- **Pros:** Mais simples possível — URL plana, sem lógica de expiração.
- **Cons:** Nenhum controle de acesso — qualquer vídeo se torna pública e incondicionalmente acessível assim que sua chave é conhecida, o que fecha a porta para requisitos futuros já previstos no roadmap (Fase 04 introduz visibilidade `unlisted`, Fase 06 introduz interações que pressupõem algum controle) — trava uma postura de segurança que o próprio roadmap do projeto já contradiz.

**Recommendation:** **Option A (redirect 302 para URL de leitura pré-assinada)** — é a única opção consistente com a relação direta ao storage do diagrama de arquitetura, ganha suporte nativo a Range/206 de graça da camada de storage, e preserva a capacidade de controlar acesso por requisição (necessário quando a visibilidade `unlisted` da Fase 04 chegar) — ao contrário do bucket permanentemente público da Option C.

**Decision:** A (Redirect 302 para presigned GET URL)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Message Queue Technology | A (RabbitMQ via `@nestjs/microservices`) | A (RabbitMQ) |
| TD-02 | Backend | Large File Upload Strategy (10GB) | A (Presigned Multipart Upload) | A (Presigned Multipart Upload) |
| TD-03 | Backend | Video Processing & Thumbnail Generation | A (`child_process` puro — `fluent-ffmpeg` está arquivado) | A (`child_process` puro) |
| TD-04 | Backend | Video Status Lifecycle & Failure Handling | B (3 estados + retry automático limitado) | A (3 estados, sem retry automático) |
| TD-05 | Backend | Unique Video Identifier Strategy | B (`nanoid` público + UUID interno) | B (`nanoid` público + UUID interno) |
| TD-06 | Backend | Video Delivery Strategy (Streaming & Download) | A (Redirect 302 para presigned GET URL) | A (Redirect 302 para presigned GET URL) |
