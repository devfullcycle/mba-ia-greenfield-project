# Research: Phase 03 — Upload e Processamento de Vídeos

**Date**: 2026-06-27 | **Plan**: [plan.md](plan.md)

Resolve todas as decisões técnicas marcadas como abertas no spec. Cada seção registra o que foi escolhido, por que, e quais alternativas foram avaliadas.

---

## Decisão 1: Tecnologia de Fila de Processamento

**Decision**: **BullMQ + Redis**

**Rationale**:
- NestJS 11 tem suporte oficial de primeira classe via `@nestjs/bullmq` — integração nativa com o sistema de módulos e injeção de dependências
- API TypeScript nativa (sem monkey-patching nem wrappers em JavaScript puro)
- Retry com `attempts` + `backoff` configuráveis por job — cobre FR-008 (3 tentativas, intervalo fixo) sem código manual
- Controle de concorrência por worker — evita sobrecarga de CPU durante processamento paralelo de vídeos
- Filas com nome, separação lógica de dead-letter e prioridade
- Redis é leve, bem suportado em Docker e já é dependência comum em projetos NestJS de produção
- Maturidade: BullMQ é a evolução do Bull v4, ativamente mantido pela empresa Taskforce.sh

**Alternatives Considered**:
- **RabbitMQ (AMQP)**: Mais enterprise-focused, excellente para topologias complexas (fanout, exchange routing), mas requer `@golevelup/nestjs-rabbitmq` ou configuração manual pesada para retry e dead-letter. Overhead maior para o caso de uso simples de processamento de vídeo.
- **pg-boss (fila sobre PostgreSQL)**: Elimina o Redis, mas performance cai sob carga média-alta e recursos avançados (prioridade, rate limiting) são mais limitados. Adicionar complexidade ao PostgreSQL sem ganho claro.
- **Bull v4** (predecessor): Descontinuado em favor do BullMQ pela mesma equipe. Não usar em projetos novos.
- **SQS / AWS managed queue**: Exige conectividade com AWS mesmo em dev — inviável sem infraestrutura adicional.

**Configuration defaults**:
- Intervalo fixo entre tentativas: **5 segundos** (`backoff: { type: 'fixed', delay: 5000 }`)
- Máximo de tentativas: **3** (`attempts: 3`)
- Concorrência do worker: **2** (2 vídeos processados em paralelo por instância do worker)
- Lock timeout do job: **300.000 ms (5 minutos)** (`lockDuration: 300_000` nas WorkerOptions) — o TTL padrão do BullMQ é 30 segundos; para vídeos de até 10 GB o FFmpeg pode levar vários minutos, tornando o padrão insuficiente e causando jobs "orphaned" (perdidos sem unlock). O worker deve configurar `@Processor(VIDEO_QUEUE_NAME, { lockDuration: 300_000 })` e o BullMQ renovará automaticamente o lock enquanto o job estiver em execução.

---

## Decisão 2: Estratégia de Upload (sem bytes pela API)

**Decision**: **URL pré-assinada PUT para upload direto ao MinIO**

**Rationale**:
- O cliente obtém uma URL temporária assinada diretamente da API; usa essa URL para enviar o arquivo diretamente ao MinIO sem passar pela API
- Nenhum byte de vídeo transita pelo processo Node.js — API permanece responsiva para outras requisições (cobre FR-001 e SC-001)
- **MinIO suporta objetos de até 5 TiB em operações PUT únicas** (não segue a limitação de 5 GB do S3 padrão para single-part PUT). Para o limite de 10 GB do spec, uma URL pré-assinada única é suficiente em ambiente local com MinIO
- Fluxo simples: `POST /videos` (pré-registro) → API retorna `{ id, uploadUrl }` → cliente faz PUT → cliente chama `POST /videos/:id/upload-complete` → API enfileira processamento
- Validade da URL pré-assinada: **15 minutos** (suficiente para upload de 10 GB em conexão razoável, sem janela demasiadamente longa)

**Alternatives Considered**:
- **S3 Multipart Upload**: Necessário para AWS S3 real em arquivos > 5 GB (S3 limita single PUT a 5 GB). Para MinIO local, desnecessário — adiciona complexidade (initiate/part/complete) sem benefício no ambiente de dev. Pode ser adicionado como melhoria futura para produção com S3 real.
- **Upload via API como proxy**: Cliente envia o arquivo para a API, que faz streaming para o MinIO. Passa todos os bytes pelo Node.js — viola FR-001, consome toda a memória/CPU da API para uploads grandes. Descartado.
- **TUS protocol**: Protocolo de upload resumível (resiliente a falhas de rede). Adiciona complexidade de cliente e servidor. Atraente para redes instáveis, mas fora do escopo desta fase.
- **MinIO Client SDK (mc)**: Apenas para operações administrativas/CLI, não para API programática.

**AWS SDK configurado para MinIO**:
```
endpoint: http://minio:9000   (Docker Compose service name — nunca localhost)
forcePathStyle: true          (MinIO requer path-style, não virtual-hosted)
region: us-east-1             (qualquer valor; MinIO ignora, mas SDK exige)
```

---

## Decisão 3: Estratégia de Streaming (Range Requests)

**Decision**: **API proxia o stream do MinIO com suporte a range requests**

**Rationale**:
- A API lê o arquivo do MinIO com `GetObjectCommand` passando o header `Range` recebido do cliente, e serve o stream resultante com os headers corretos (206 Partial Content, Content-Range, Accept-Ranges)
- Mantém credenciais do storage no servidor — nenhuma exposição de URL assinada de acesso longo para o cliente
- Permite controle de acesso granular por endpoint (streaming público, download autenticado) sem depender de políticas de bucket
- Simples de implementar com Node.js streams (pipe direto da resposta do S3 SDK para a resposta HTTP)
- Para ambiente local com Docker Compose, a latência de proxy é desprezível

**Alternatives Considered**:
- **Redirect para URL pré-assinada GET do MinIO**: Mais eficiente em produção (evita overhead de proxy), mas expõe a URL do MinIO ao cliente (problema se MinIO não for acessível publicamente ou se a URL vazar). Em Docker local, o MinIO estaria em `http://minio:9000` — acessível apenas dentro da rede Docker, não pelo browser do usuário. Descartado para local dev; candidato a melhoria de produção futura.
- **CDN + arquivo público**: Requer infraestrutura de CDN (CloudFront, etc.) — fora do escopo desta fase. Seria a abordagem correta para produção em escala.
- **Servir arquivos diretamente do sistema de arquivos local**: Sem MinIO, não escalável, não persistente entre reinicializações de container.

---

## Decisão 4: Estratégia do Worker (Processamento de Vídeo)

**Decision**: **NestJS standalone application no mesmo `nestjs-project`, executado em container Docker separado**

**Rationale**:
- Mesmo `package.json`, mesmas entidades TypeORM, mesmos configs — zero duplicação de código
- Entry point separado (`src/worker.ts` → `NestFactory.createApplicationContext`) — sem servidor HTTP, apenas consumidores BullMQ
- Container Docker separado com FFmpeg instalado na imagem (via `Dockerfile.worker`) — isolamento de CPU de forma que o processamento de vídeo não afeta a performance da API
- Escalável independentemente: múltiplas réplicas do worker podem ser adicionadas ao Compose sem alterar a API
- Padrão bem estabelecido no ecossistema NestJS para workers com BullMQ

**Alternatives Considered**:
- **Worker no mesmo processo da API**: FFmpeg é CPU-intensivo; rodá-lo no mesmo processo bloqueia o event loop da API durante o processamento. Viola SC-001.
- **Script Node.js puro (sem NestJS)**: Perde injeção de dependências, TypeORM, ConfigModule e todas as regras de código do projeto. Duplicação inevitável.
- **Aplicação NestJS completamente separada (próprio `package.json`)**: Overcomplexidade — duplicaria dependências, configs e pipeline de CI sem ganho de isolamento real sobre o entry-point separado.

---

## Decisão 5: Identificador Único da URL do Vídeo

**Decision**: **UUID v4 como identificador (o próprio `id` do registro)**

**Rationale**:
- UUID v4 tem probabilidade de colisão desprezível (2^122 combinações) — cobre SC-005
- Consistente com os padrões existentes: `User.id`, `Channel.id` e todos os tokens usam UUID
- Nenhuma lógica de geração extra necessária — `@PrimaryGeneratedColumn('uuid')` gera automaticamente no TypeORM
- Imutável por definição (chave primária não muda) — cobre US5 scenario 2 ("ao alterar o título, o identificador permanece o mesmo")
- URL resultante: `GET /videos/{uuid}` — inequívoco e não adivinhável por força bruta

**Alternatives Considered**:
- **Nanoid / CUID2**: Mais curto e legível em URL, mas requer lógica de geração extra e verificação de unicidade. Ganho estético sem benefício funcional para esta fase.
- **Slug derivado do título**: Legível, mas requer sanitização, unicidade por colisão e geração de sufixo randômico (como o `Channel.nickname`). Muda a experiência se o título for renomeado (ou exige desacoplamento entre slug e título — mesma complexidade do nanoid). Descartado.

---

## Decisão 6: Tamanho de Página Padrão para Listagem

**Decision**: **20 itens por página** (`limit` padrão = 20, máximo = 100)

**Rationale**:
- Padrão amplamente adotado em APIs REST (GitHub, Twitter, Stripe usam 20-30 por padrão)
- Equilibra latência de query e volume de dados por resposta
- Configurável via query param `?limit=N` com cap de 100 para evitar queries excessivamente grandes

---

## Resumo das Decisões

| Item | Escolha |
|------|---------|
| Fila | BullMQ + Redis |
| Retry | 3 tentativas, intervalo fixo de 5s |
| Upload | URL pré-assinada PUT (MinIO single-part) |
| Validade da URL | 15 minutos |
| Streaming | API proxy com range requests |
| Worker | NestJS standalone, container separado |
| Identificador URL | UUID v4 (mesmo campo `id`) |
| Paginação padrão | 20 itens/página, max 100 |
| SDK Storage | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` |
| FFmpeg | `fluent-ffmpeg` + `@ffprobe-installer/ffprobe` |
