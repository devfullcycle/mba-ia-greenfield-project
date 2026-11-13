# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

> **Phase:** 03 — Upload e Processamento de Vídeos
> **Status:** Finalized
> **Date:** 2026-11-13

Este documento registra as decisões técnicas da Fase 03. As escolhas devem ser refletidas no contexto, na validação, no plano e no código.

---

## TD-01: Tecnologia da fila

**Contexto:** A Fase 03 exige processamento assíncrono de vídeos e um worker separado. O plano original deixa a tecnologia da fila em aberto.

**Opções consideradas:**

### Option A: BullMQ + Redis
- Fila baseada em Redis, com integração para NestJS e workers Node.js separados.
- **Prós:** integração natural com NestJS, retries, jobs persistentes, concorrência configurável e baixo atrito operacional para esta fase.
- **Contras:** adiciona Redis à infraestrutura e exige política de retenção/limpeza dos jobs.

### Option B: RabbitMQ
- Broker de mensagens com exchanges, filas e confirmações de entrega.
- **Prós:** roteamento e semântica de mensageria mais ampla.
- **Contras:** maior complexidade operacional para o escopo atual e integração menos direta com o worker Node.js previsto.

**Recomendação:** **BullMQ + Redis** — atende ao processamento assíncrono, retries e worker separado com menor complexidade operacional.

**Decisão:** **A — BullMQ + Redis**.

**Referências:**
- [NestJS — Queues](https://docs.nestjs.com/techniques/queues)
- [BullMQ — NestJS integration](https://docs.bullmq.io/guide/nestjs)

---

## TD-02: Estratégia de upload de arquivos grandes

**Contexto:** O upload pode atingir 10 GB e não deve manter o arquivo inteiro passando pela API ou bloquear o processo HTTP.

### Option A: Upload direto multipart para MinIO/S3 com URLs pré-assinadas
- A API cria o rascunho e inicia um multipart upload. O cliente envia as partes diretamente ao storage usando URLs pré-assinadas; ao concluir, a API recebe a confirmação e enfileira o processamento.
- **Prós:** API não transporta nem mantém o arquivo de 10 GB; suporta retomada por partes; reduz uso de memória e banda do backend.
- **Contras:** exige coordenação de multipart, expiração de URLs e limpeza de uploads incompletos.

### Option B: Upload em chunks para a API e retransmissão ao storage
- O cliente envia partes à API, que retransmite cada parte ao storage.
- **Prós:** controle centralizado de autenticação e progresso.
- **Contras:** a API continua no caminho dos dados, consumindo banda e recursos; aumenta o acoplamento e o risco operacional.

**Recomendação:** **Option A** — é a única alternativa compatível com o requisito de não sobrecarregar a API com arquivos de até 10 GB.

**Decisão:** **A — Upload multipart direto ao MinIO/S3 via URLs pré-assinadas.**

**Referências:**
- [AWS — Presigned URL upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [MinIO JavaScript SDK](https://docs.min.io/aistor/developers/sdk/javascript/)

---

## TD-03: Worker e processamento de vídeo

**Contexto:** Extração de duração/metadados e geração de thumbnail são operações pesadas e devem ocorrer fora do processo HTTP.

### Option A: Container worker separado com BullMQ, ffprobe e FFmpeg
- O worker consome jobs, baixa o objeto temporariamente, executa `ffprobe` para metadados e `FFmpeg` para a thumbnail, envia o resultado ao storage e atualiza o vídeo.
- **Prós:** isolamento de CPU/memória, escala independente, ferramentas especializadas e observabilidade por job.
- **Contras:** exige imagem Docker própria e controle de arquivos temporários.

### Option B: Processar dentro da API
- A API executa FFmpeg após o upload.
- **Prós:** menos containers.
- **Contras:** mistura processamento pesado com tráfego HTTP e viola o requisito de processamento em segundo plano.

**Recomendação:** **Option A**.

**Decisão:** **A — Worker separado em container com BullMQ, FFmpeg e ffprobe.**

**Referências:**
- [FFprobe documentation](https://ffmpeg.org/ffprobe.html)
- [FFmpeg documentation](https://ffmpeg.org/ffmpeg.html)

---

## TD-04: Identificador de URL do vídeo

**Contexto:** Cada vídeo precisa de uma URL única, sem conflito entre usuários.

### Option A: UUID como identificador público
- Gerar UUID no pré-cadastro e usar esse identificador na URL.
- **Prós:** unicidade forte, geração local e ausência de colisão prática.
- **Contras:** URL menos amigável para leitura humana.

### Option B: Slug derivado do título
- Derivar um slug do título e resolver colisões com sufixos.
- **Prós:** URL mais legível.
- **Contras:** exige tratamento de concorrência, alterações de título e colisões.

**Recomendação:** **Option A**, podendo ser combinado posteriormente com slug apenas como apresentação.

**Decisão:** **A — UUID como identificador público único do vídeo.**

---

## TD-05: Streaming e download

**Contexto:** O vídeo deve iniciar a reprodução sem download completo e também permitir download.

### Option A: Endpoint de streaming com suporte a Range
- Ler `Range`, buscar o intervalo correspondente no storage e responder `206 Partial Content` com `Content-Range`, `Accept-Ranges` e `Content-Length`.
- **Prós:** compatível com players HTTP, retomada e reprodução progressiva.
- **Contras:** exige validação cuidadosa dos intervalos e tratamento de respostas parciais do storage.

### Option B: Redirecionamento direto para URL do storage
- A API gera uma URL temporária para o objeto e redireciona o cliente.
- **Prós:** reduz tráfego na API.
- **Contras:** dificulta autorização fina, controle do contrato HTTP e uniformidade do download/streaming.

**Recomendação:** **Option A** para o contrato público da API; o plano deve definir como o serviço acessará os intervalos no storage.

**Decisão:** **A — Streaming e download por endpoint HTTP com `Range`/`206 Partial Content`.**

**Referências:**
- [MDN — HTTP range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)
- [MDN — 206 Partial Content](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/206)

---

## TD-06: Ciclo de vida do vídeo

**Contexto:** O vídeo nasce antes do upload terminar e precisa representar claramente o processamento e as falhas.

### Option A: `DRAFT → PROCESSING → READY | ERROR`
- O pré-cadastro cria `DRAFT`; a conclusão do multipart publica o job; o worker muda para `PROCESSING`, depois `READY` ou `ERROR`.
- **Prós:** simples, explícito e suficiente para os requisitos da fase.
- **Contras:** estados intermediários de upload e retry precisam ser registrados por metadados do job.

### Option B: Máquina de estados mais detalhada
- Adicionar estados como `UPLOADING`, `UPLOADED`, `PROCESSING`, `READY`, `ERROR`, `CANCELLED`.
- **Prós:** maior observabilidade e controle de recuperação.
- **Contras:** aumenta a superfície de regras e testes nesta fase.

**Recomendação:** **Option B** se o fluxo de multipart exigir retomada e cancelamento observáveis; caso contrário, Option A com campos de progresso é suficiente.

**Decisão:** **B — Máquina de estados detalhada com `DRAFT`, `UPLOADING`, `UPLOADED`, `PROCESSING`, `READY`, `ERROR` e `CANCELLED`.**

---

## Decisões Summary

| ID | Decisão | Recomendação | Escolha |
|----|---------|--------------|---------|
| TD-01 | Tecnologia da fila | BullMQ + Redis | **A — decidido** |
| TD-02 | Upload de arquivos grandes | Multipart direto via URLs pré-assinadas | **A — decidido** |
| TD-03 | Worker e processamento | Container separado com FFmpeg/ffprobe | **A — decidido** |
| TD-04 | URL única | UUID público | **A — decidido** |
| TD-05 | Streaming/download | HTTP Range com `206 Partial Content` | **A — decidido** |
| TD-06 | Ciclo de status | Máquina de estados explícita | **B — decidido** |
