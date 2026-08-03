# Fase 03 — Upload e Processamento de Vídeos — Context

> **Consolidado em:** 2026-08-03, a partir de `docs/phases/phase-03-research.md` e `docs/phases/phase-03-plan.md` (ambos removidos após esta consolidação — conteúdo integralmente preservado abaixo). Datas de pesquisa/decisão originais preservadas.
> **Pesquisa original:** 2026-08-01 · **Status:** research_ok / planning_ok (todas as decisões resolvidas pelo usuário em 2026-08-01)

## Objetivo

Upload de arquivos de vídeo grandes sem travar o sistema, processamento automático do vídeo (extração de duração/metadados e geração de thumbnail) e geração de URL única por vídeo, com reprodução via streaming e download — conforme `docs/project-plan.md`, seção "Fase 03 — Upload e Processamento de Vídeos" (linhas 67-83).

## Escopo

Nove capacidades, listadas em detalhe em "Requisitos" abaixo:

1. Serviço de armazenamento de arquivos (vídeos e thumbnails)
2. Serviço de processamento em segundo plano (filas)
3. Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
4. Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
5. Processamento automático do vídeo após upload (extração de duração e metadados)
6. Geração automática de thumbnail a partir de um frame do vídeo
7. URL única por vídeo, sem conflito com outros vídeos
8. Reprodução via streaming (sem necessidade de download completo)
9. Download do vídeo pelo usuário

**Arquitetura resultante (resumo):** subprojeto `nestjs-project`. Duas novas peças de infraestrutura no Docker Compose — MinIO (object storage, S3-compatible) e Redis (backing store do BullMQ) — e uma segunda aplicação NestJS (`video-worker`) coexistindo com a API no mesmo repositório via modo monorepo do Nest CLI, compartilhando entidades e config com `nestjs-api` mas rodando em container próprio, sem superfície HTTP. Dois novos módulos de domínio: `VideosModule` (API — expõe os 3 endpoints) e `VideoProcessingModule` (worker — consome jobs). Dois módulos de infraestrutura compartilhados entre ambos os apps: `StorageModule` (wrapper de `@aws-sdk/client-s3`) e `QueueModule` (`@nestjs/bullmq`). Reaproveita `Channel`/`User` (Fase 02), o guard JWT global e `@Public()`, e o formato de erro `{statusCode, error, message}` já estabelecido na Fase 02.

## Estado herdado das Fases 01 e 02

Levantamento feito via agente de exploração read-only sobre `nestjs-project/src/` antes do início da Fase 03:

- **Módulos existentes:** `auth`, `channels`, `common`, `config`, `database`, `mail`, `users` (+ `app.module.ts` na raiz). Padrão de pastas: arquivos `x.module.ts`/`x.service.ts`/`x.controller.ts` na raiz do módulo, `entities/` para `*.entity.ts`, `dto/` para DTOs de request, `decorators/` e `guards/` (hoje só em `auth`). `common/exceptions` e `common/filters` são compartilhados entre módulos.
- **`channels` e `users` não tinham controller** — eram módulos internos (service + entity), consumidos por `auth`. O `VideosModule` seria o segundo módulo a expor endpoints HTTP diretamente.
- **`Channel` entity** (`src/channels/entities/channel.entity.ts`): tabela `channels`, PK `id: uuid`. Relação `@OneToOne(User)` via `user_id` (um canal por usuário). `Video` usa `@ManyToOne(Channel)` + `channel_id: uuid`, com `@OneToMany` inverso em `Channel`.
- **`User` entity**: PK `id: uuid`, sem campo de "owner" direto — a cadeia de posse é `User → Channel → Video`; a posse de um vídeo é resolvida via `channel.user_id`, não diretamente em `User`.
- **Convenções de endpoint** (`auth.controller.ts`, `main.ts`): `@Controller('auth')` sem prefixo de versão. `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform: true`) com DTOs `class-validator`. Guard JWT é **global via `APP_GUARD`** — toda rota é protegida por padrão, opt-out via `@Public()`. Usuário atual via `@CurrentUser()`. Erros nunca via try/catch no controller — `DomainException` (base abstrata em `src/common/exceptions/domain.exception.ts`) capturada globalmente por `DomainExceptionFilter` → `{statusCode, error, message}`.
- **Migrations** (`src/database/migrations/`): nomeadas `<timestamp>-<PascalCaseDescription>.ts`, conteúdo SQL puro via `queryRunner.query()`, saída verbatim de `npm run migration:generate`. Convenção do projeto: sempre gerar via CLI, nunca escrever à mão (exceto migrations de dados).
- **Config** (`src/config/`): `app.config.ts`, `database.config.ts`, `auth.config.ts`, `mail.config.ts` + `env.validation.ts` (Joi), todos via `registerAs('<namespace>', () => ({...}))` + `ConfigType<typeof xConfig>` + `@Inject(xConfig.KEY)`.
- **Upload/storage/fila/ffmpeg:** nenhum hit para `multer|MulterModule|S3Client|minio|Minio|bullmq|BullModule|@nestjs/bull|ffmpeg|fluent-ffmpeg` em `src/` nem em `package.json` antes da Fase 03 — partida de base limpa nesses pontos.
- **Testes:** trio `*.spec.ts` (unit) + `*.integration-spec.ts` (DB real) + `*.module.spec.ts` (wiring), colocados junto ao código-fonte. Nenhum e2e existia para vídeos antes desta fase (apenas `auth.e2e-spec.ts`).

## Requisitos

Fonte: `docs/project-plan.md`, seção Fase 03. Depende de Fase 01 (config) e Fase 02 (auth/users/channels), ambas `completed`.

### 1. Serviço de armazenamento de arquivos (vídeos e thumbnails)
- **Requisito:** existir um serviço de object storage (S3 ou MinIO) capaz de guardar arquivos de vídeo e thumbnails gerados.
- **Restrições:** nenhum serviço de storage existia em `compose.yaml` — precisou ser adicionado (MinIO local, S3-compatible).
- **Critério de aceite:** um objeto pode ser gravado e lido do storage a partir da API/worker rodando em container.

### 2. Serviço de processamento em segundo plano (filas)
- **Requisito:** processamento de vídeo (extração de metadados, geração de thumbnail) não pode bloquear a requisição HTTP de upload — deve rodar de forma assíncrona via fila de jobs.
- **Restrições:** o diagrama de arquitetura já reservava um container "Message Queue" (tecnologia "TBD") e um container "Video Worker" separado da API.
- **Critério de aceite:** ao concluir o upload, um job é enfileirado e processado por um worker sem que o cliente HTTP precise esperar o processamento terminar.

### 3. Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- **Requisito:** o endpoint/fluxo de upload aceita arquivos de até 10GB.
- **Restrições (hard, explícita no project-plan):** "sem impacto na performance" — a API não pode degradar sob upload de arquivos grandes ou uploads concorrentes.
- **Critério de aceite:** um upload de arquivo de até 10GB é concluído com sucesso; a API permanece responsiva a outras requisições durante o upload.

### 4. Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- **Requisito:** ao iniciar o upload, um registro de vídeo é criado imediatamente em estado de rascunho.
- **Restrições:** o registro precisa de um identificador único desde já (ver item 7).
- **Critério de aceite:** ao iniciar o upload, existe uma entidade `Video` persistida em estado de rascunho, associada ao canal do usuário autenticado.

### 5. Processamento automático do vídeo após upload (extração de duração e metadados)
- **Requisito:** após o upload ser concluído, o sistema extrai automaticamente duração e metadados do vídeo.
- **Restrições:** requer FFmpeg (ou equivalente) disponível no ambiente de processamento.
- **Critério de aceite:** após o processamento, o registro do vídeo contém duração e metadados extraídos do arquivo real.

### 6. Geração automática de thumbnail a partir de um frame do vídeo
- **Requisito:** um thumbnail é gerado automaticamente a partir de um frame do vídeo processado.
- **Restrições:** roda como parte do mesmo pipeline de processamento (item 5); precisa ser salvo no storage (item 1).
- **Critério de aceite:** após o processamento, existe uma imagem de thumbnail acessível associada ao vídeo.

### 7. URL única por vídeo, sem conflito com outros vídeos
- **Requisito:** cada vídeo tem uma URL/identificador único, sem colisão possível entre vídeos de diferentes usuários.
- **Restrições:** deve ser gerado no pré-cadastro (item 4), antes do processamento.
- **Critério de aceite:** duas requisições de criação de vídeo nunca produzem o mesmo identificador/URL.

### 8. Reprodução via streaming (sem necessidade de download completo)
- **Requisito:** o vídeo pode ser reproduzido via streaming — o cliente não precisa baixar o arquivo inteiro antes de começar a assistir (suporte a seek/scrubbing).
- **Restrições (arquitetural, decidida na Fase 01):** `docs/diagrams/software-arch.mermaid` já define `Rel(frontend, storage, "Streams", "HTTPS")` — o frontend consome o stream diretamente do storage, não via proxy da API.
- **Critério de aceite:** o cliente consegue iniciar reprodução e buscar (seek) para um ponto arbitrário do vídeo sem baixar o arquivo completo antes.

### 9. Download do vídeo pelo usuário
- **Requisito:** o usuário pode baixar o arquivo de vídeo original.
- **Restrições:** nenhuma constraint adicional além de já estar no storage.
- **Critério de aceite:** uma requisição de download retorna o arquivo de vídeo completo e íntegro.

## Restrições

- **Performance sob upload grande:** ver item 3 acima — restrição hard do enunciado.
- **CORS/bucket policy para upload direto:** como a estratégia de upload direto via presigned URL foi confirmada (TD-02), o bucket MinIO precisou de configuração de CORS liberando o cliente. MinIO Community Edition não suporta `mc cors set` por bucket (feature paga AIStor) — resolvido via `MINIO_API_CORS_ALLOW_ORIGIN=*` a nível de servidor (registrado em `progress.md`, INC-03.1).
- **Redis como nova infraestrutura:** com BullMQ confirmado (TD-03), `compose.yaml` ganhou um novo serviço `redis`.
- **Máquina de estados do vídeo:** `draft → processing → ready | failed`, sem transição de volta — uma vez `ready` ou `failed`, o vídeo não é reprocessado automaticamente (decisão de produto: sem retry automático).
- **Modelo de monorepo Nest para o worker:** primeira vez que o projeto usa o modo monorepo do Nest CLI — compartilhamento de entidades/config entre `nestjs-api` e `video-worker` via import relativo direto, sem usar `libs/` do Nest CLI (mantém o escopo pequeno e o acoplamento explícito).
- **Tamanho de imagem Docker:** `fluent-ffmpeg` + binários estáticos do FFmpeg aumentam o tamanho da imagem do worker.
- **Context7 MCP indisponível no ambiente de pesquisa (2026-08-01):** o `CLAUDE.md` da raiz exige consulta ao MCP `context7` antes de implementar qualquer feature envolvendo bibliotecas. A ferramenta não estava configurada neste ambiente — a pesquisa da Fase 03 usou WebSearch como fallback documentado (alternativa válida quando o Context7 não está disponível, conforme o próprio skill de pesquisa). Ver `library-refs.md` para o registro explícito de quais referências foram de fato consultadas via Context7 (nenhuma) vs. quais ficam marcadas como "referência a confirmar".

## Decisões já resolvidas

Seis decisões técnicas (TD-01 a TD-06), com trade-offs completos em `docs/decisions/technical-decisions-phase-03-videos.md`:

| ID | Decisão | Escolha confirmada |
|----|---------|--------------|
| TD-01 | Biblioteca cliente de Object Storage | `@aws-sdk/client-s3` (compatível com MinIO e S3 real) |
| TD-02 | Estratégia de upload para arquivos de até 10GB | Upload direto ao storage via URLs pré-assinadas (multipart) |
| TD-03 | Tecnologia de fila de processamento em segundo plano | BullMQ + Redis |
| TD-04 | Biblioteca de processamento de vídeo | `fluent-ffmpeg` + `ffmpeg-static`/`ffprobe-static` |
| TD-05 | Estratégia de entrega de vídeo (streaming/download) | URLs de GET pré-assinadas |
| TD-06 | Modelo de deployment do worker | Aplicação NestJS separada (Nest CLI monorepo), container próprio |

Todas as 6 confirmadas pelo usuário em 2026-08-01, seguindo a recomendação em todos os casos.

Seis decisões de produto/escopo, também confirmadas em 2026-08-01:

1. **Visibilidade de vídeo em rascunho/processando:** bloqueado até ficar pronto — a API retorna estado explícito (não pronto para streaming/download) enquanto o vídeo não estiver `ready`.
2. **Falha de processamento:** marca como `failed`, visível ao dono, sem retry automático nesta fase (MVP).
3. **Modelo de acesso ao vídeo pronto:** qualquer um com a URL/UUID pode assistir, uma vez `ready` — sem checagem adicional de publicação nesta fase (modelo de publicação granular fica para uma fase futura, fora do escopo deste projeto).
4. **Upload abandonado:** sem limpeza automática nesta fase — adiado para tarefa de manutenção separada.
5. **Descoberta da URL pelo uploader:** a resposta do endpoint de criação/pré-cadastro do vídeo já retorna o identificador/URL final. Suficiente para esta fase (não há "listar meus vídeos").
6. **Formatos de vídeo aceitos:** qualquer formato decodificável pelo FFmpeg é aceito — sem allowlist no pré-cadastro; formatos inválidos falham no processamento (estado `failed`).

**Estratégia de testes** (decidida no planning, validada contra `testing-guide-nestjs-project`):
- Entidade `Video`: integration apenas (constraints, defaults, enum).
- `StorageService`: integration apenas contra o MinIO real — dependência de efeito colateral, não mockada em unit test.
- `VideosService`: unit (branching de estado, cálculo de partes, resposta condicional — com `StorageService`/`Queue` mockados) + integration (contrato real de DB/storage/fila).
- `VideoProcessorService` (worker): unit (orquestração/branches de sucesso e falha, storage/ffmpeg mockados) + integration (fixture real contra MinIO real).
- Controllers: nenhum unit test — cobertura via E2E apenas (controllers são delegação fina).
- Módulos: unit — teste de compilação de DI (`*.module.spec.ts`).
- E2E: um spec por endpoint mais um E2E de fluxo ponta-a-ponta real contra o stack completo.

## Critérios de aceite

Ver critério de aceite específico de cada requisito acima (Seção "Requisitos"). Consolidado em **Deliverables** — ver `docs/phases/phase-03-videos/phase-03-videos.md` §Deliverables — e comprovado ao vivo em `docs/phases/phase-03-videos/validation.md`.

**Entregáveis do enunciado** (`docs/project-plan.md`): upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas — todos comprovados, ver `validation.md`.

## Fora de escopo

Confirmado por exclusão em `docs/project-plan.md`: listagem/gerenciamento de vídeos, edição de metadados, exclusão de vídeo — esses itens pertenceriam a uma "Fase 04 — Gerenciamento de Vídeos e Canal" que **não existe neste projeto** (o desafio foi encerrado oficialmente na Fase 03, por decisão explícita do usuário). Consequências diretas desse recorte, já auditadas:

- **Ausência de campo `title` de negócio na entidade `Video`:** o enunciado da Fase 03 não exige um título de vídeo distinto do `original_filename` — apenas "processamento automático" e "URL única". Título/edição de metadados de negócio ficariam na Fase 04 inexistente. Portanto a ausência de `title` é uma decisão de escopo coerente com o enunciado real, não uma lacuna do modelo de dados.
