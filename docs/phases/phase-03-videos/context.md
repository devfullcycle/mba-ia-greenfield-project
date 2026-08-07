---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-06-26T19:13:04-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-06-26T19:55:55-03:00"
  docs/phases/phase-02-auth/phase-02-auth.md: "2026-06-26T19:55:54-03:00"
  docs/phases/phase-01-configuracao-base/phase-01-configuracao-base.md: "2026-06-26T19:55:54-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities**

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** Gerenciamento/edição de vídeos e visibilidade (Fase 04), página de visualização e player (Fase 05), interações sociais — likes, comentários, inscrições (Fase 06). Qualquer superfície de UI de vídeo no `next-frontend/`.

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando e URLs únicas geradas. Entidade/tabela de vídeos ligada ao canal. Object storage, fila e worker subindo via Docker Compose junto com o backend.

**Affected subprojects:** `nestjs-project/`

**Deferred subprojects:** `next-frontend/` — nenhuma superfície de UI de vídeo nesta fase; os contratos REST e de streaming definidos aqui serão consumidos por fases posteriores do frontend.

**Sequencing notes:** Depends on Fase 01 — Configuração Base e Fase 02 — Cadastro, Login e Gerenciamento de Conta (o vídeo pertence ao canal criado na Fase 02; endpoints de upload exigem usuário autenticado).

**Neighbors (for boundary detection only):** Fase 02 — Cadastro, Login e Gerenciamento de Conta (prior), Fase 04 — Gerenciamento de Vídeos (next).

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | technical-decisions-phase-03-videos.md | Backend | Tecnologia da fila de processamento | decided | A (BullMQ + Redis) | `@nestjs/bullmq`, `bullmq`, Redis (infra) |
| phase-03-videos/TD-02 | technical-decisions-phase-03-videos.md | Backend | Organização do object storage | decided | A (bucket único, AWS SDK v3, MinIO) | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, MinIO (infra) |
| phase-03-videos/TD-03 | technical-decisions-phase-03-videos.md | Backend | Estratégia de upload de até 10GB | decided | B (Presigned Multipart Upload direto ao storage) | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` |
| phase-03-videos/TD-04 | technical-decisions-phase-03-videos.md | Backend | Pré-cadastro do rascunho e gatilho do processamento | decided | A (rascunho na initiate + complete explícito) | — |
| phase-03-videos/TD-05 | technical-decisions-phase-03-videos.md | Backend | Deployment do worker | decided | A (container separado, mesmo codebase) | `@nestjs/bullmq`, FFmpeg (infra) |
| phase-03-videos/TD-06 | technical-decisions-phase-03-videos.md | Backend | Extração de metadados e thumbnail | decided | A (ffmpeg/ffprobe de sistema via child_process) | FFmpeg (infra), `node:child_process` |
| phase-03-videos/TD-07 | technical-decisions-phase-03-videos.md | Backend | Estratégia de URL única | decided | A (`public_id` via `nanoid@3` + retry) | `nanoid@^3.x` (linha CommonJS) |
| phase-03-videos/TD-08 | technical-decisions-phase-03-videos.md | Backend | Estratégia de streaming | decided | A (range-proxy → 206 Partial Content) | `@aws-sdk/client-s3` |
| phase-03-videos/TD-09 | technical-decisions-phase-03-videos.md | Backend | Estratégia de download | decided | A (URL pré-assinada de GetObject) | `@aws-sdk/s3-request-presigner` |
| phase-03-videos/TD-10 | technical-decisions-phase-03-videos.md | Backend | Ciclo de status do vídeo e tratamento de falha | decided | A (`draft\|processing\|ready\|error`, retry antes de error) | `bullmq` |

_Source files:_

- `docs/decisions/technical-decisions-phase-03-videos.md`

## Capability Coverage

| Capability | Covered by |
|------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-02 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-05 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-03 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-04, phase-03-videos/TD-10 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-06, phase-03-videos/TD-10 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-06 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-07 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-08 |
| Download do vídeo pelo usuário | phase-03-videos/TD-09 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** Opção A (BullMQ + Redis via `@nestjs/bullmq`) — escolha canônica para processamento de vídeo em background no NestJS. O modelo de Worker com `concurrency` configurável resolve o requisito do worker sem saturar a CPU; backoff/retry cobrem o ciclo `processing → error`; a integração oficial mantém o código nas convenções do projeto. Custo: um serviço Redis no Compose, baixo e bem compreendido. pg-boss evitaria infra nova, mas o desafio pede fila/worker reais no Compose e a ergonomia de worker do BullMQ é superior.

**Libraries:** `@nestjs/bullmq`, `bullmq`; Redis (infra de Compose)

### phase-03-videos/TD-02

**Recommendation:** Opção A (bucket único privado, chaves por `videoId`, AWS SDK v3 com `forcePathStyle`) — mantém a portabilidade MinIO↔S3 (o AWS SDK fala com ambos), dá localidade natural entre o vídeo e seu thumbnail e permite limpeza por prefixo. URLs pré-assinadas cobrem upload e download sem expor credenciais nem deixar o bucket público. O bucket é garantido na inicialização (idempotente).

**Libraries:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`; MinIO (infra de Compose)

### phase-03-videos/TD-03

**Recommendation:** Opção B (Presigned Multipart Upload direto ao storage) — única opção que atende 10GB nativamente (o PUT único do S3 limita a 5GB) mantendo o arquivo fora da API. O handshake de 3 passos mapeia para `POST /videos` (rascunho + initiate) e `POST /videos/:id/complete` (CompleteMultipartUpload → processamento). A retomada por parte alinha-se ao "permitir retomar em caso de falha de conexão" do plano. Testes e2e sobem as partes ao MinIO com o próprio AWS SDK.

**Libraries:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`

### phase-03-videos/TD-04

**Recommendation:** Opção A (rascunho na initiate + complete explícito) — ciclo de vida claro e auditável (`draft` existe desde o primeiro byte do upload), ponto único e testável onde o processamento é disparado, sem depender de configuração de eventos do storage. A finalização do multipart já é obrigatória; reaproveitá-la como gatilho é o caminho de menor atrito. Bucket notifications ficam como evolução futura.

**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** Opção A (container `video-worker` separado, mesmo codebase, bootstrap próprio) — honra o diagrama (worker é container distinto), isola o trabalho pesado de FFmpeg da API responsiva e reusa o módulo de domínio sem duplicação. O processador BullMQ vive num módulo importado pela API (que só publica) e pelo bootstrap do worker (que consome), com a concorrência configurada apenas no worker.

**Libraries:** `@nestjs/bullmq`; FFmpeg (instalado na imagem do worker)

### phase-03-videos/TD-06

**Recommendation:** Opção A (ffmpeg/ffprobe de sistema via `child_process`) — abordagem robusta e auditável, sem dependência npm não-mantida no caminho crítico; flags explícitas (`ffprobe -print_format json -show_format -show_streams` para metadados; `ffmpeg -ss <t> -i <in> -frames:v 1` para o frame). Testável em três níveis (unit com spawn mockado; integração com ffprobe/ffmpeg reais sobre um mp4 pequeno; e2e do fluxo completo).

**Libraries:** FFmpeg (binários de sistema na imagem do worker), `node:child_process`

### phase-03-videos/TD-07

**Recommendation:** Opção A (`public_id` via `nanoid@3` + retry em colisão) — id curto, URL-safe, não sequencial, com unicidade garantida por constraint `UNIQUE` (fonte da verdade; retry como rede de segurança). A fixação em `nanoid@3` é deliberada e documentada: `nanoid` v5+ é ESM-puro e o backend roda em CommonJS (ts-node-commonjs, TypeORM CLI), então a linha CJS (v3) é a compatível.

**Libraries:** `nanoid@^3.x` (linha CommonJS)

### phase-03-videos/TD-08

**Recommendation:** Opção A (range-proxy → 206) como contrato primário; presigned-direto reconhecido como caminho de escala. A API lê `Range`, repassa ao storage (`GetObject` com Range) e devolve `206` com `Content-Range`/`Accept-Ranges`. Streaming lê blocos pequenos, então não recria o problema do upload de 10GB. Demonstrável e testável via supertest (Range → 206), mantém o storage privado e centraliza visibilidade/acesso.

**Libraries:** `@aws-sdk/client-s3`

### phase-03-videos/TD-09

**Recommendation:** Opção A (URL pré-assinada de `GetObject`) — mantém a transferência do arquivo completo (até 10GB) fora da API, coerente com o princípio do upload. A distinção é deliberada: streaming proxia ranges pequenos pela API por testabilidade/controle; o download do arquivo inteiro delega ao storage para não reintroduzir o gargalo.

**Libraries:** `@aws-sdk/s3-request-presigner`

### phase-03-videos/TD-10

**Recommendation:** Opção A (`draft | processing | ready | error`, retry antes de `error`) — ciclo que o desafio descreve, cada transição com gatilho claro no código (initiate, complete, worker-sucesso, worker-falha). O BullMQ cuida das retentativas com backoff exponencial; só após esgotá-las o vídeo vira `error` com `failure_reason`, evitando marcar falha em problemas transitórios.

**Libraries:** `bullmq`

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, zero custom wiring, native string-to-number coercion.

**Libraries:** `joi@^17.x` (instalado: `joi@^18.x`)

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — Clear file boundaries per domain, typed injection via `ConfigType<typeof xxxConfig>`, natural scalability.

**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — `data-source.ts` imports the factory, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code.

**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Machine-readable domain error codes no formato `{ statusCode, error, message }`; filtro `@Catch(DomainException)` registrado globalmente. A Fase 03 reusa esse contrato de erro para todas as exceções do módulo de vídeos.

**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — rate limiting nativo via guard. A Fase 03 reusa o throttler já configurado; endpoints de vídeo herdam os limites globais salvo necessidade específica.

**Libraries:** `@nestjs/throttler@^6.x`

_(As demais TDs das Fases 01–02 — hashing, auth library, refresh token, e-mail, validation — permanecem como constraints herdadas e não são reabertas. O guard JWT global e o decorator `@CurrentUser()` da Fase 02 são reusados pelos endpoints autenticados de vídeo.)_

## Inherited Conventions

- Backend config usa `@nestjs/config` com factories `registerAs(name, () => ({...}))` — um arquivo por domínio em `src/config/`. _(from phase 01)_
- Variáveis de ambiente validadas por um schema Joi em `src/config/env.validation.ts`, passado a `ConfigModule.forRoot({ validationSchema, validationOptions: { allowUnknown: true, abortEarly: false } })`. _(from phase 01)_
- Config injetada via `ConfigType<typeof xxxConfig>` + `@Inject(xxxConfig.KEY)`; a mesma factory é importável como função pura para contextos sem DI (TypeORM CLI). _(from phase 01)_
- `data-source.ts` carrega `.env` via `import 'dotenv/config'` no topo, depois importa a factory e a chama. Parâmetros de conexão sempre da factory `databaseConfig` — nunca duplicados. _(from phase 01)_
- `TypeOrmModule.forRootAsync` (não `forRoot`), com `imports: [ConfigModule]`, `inject`, `useFactory` retornando `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_
- Módulos de domínio por feature: cada um importa `TypeOrmModule.forFeature([...entities])` e faz `exports: [TypeOrmModule]` (ou os providers próprios) para outros módulos reusarem os repositórios. _(from phase 02)_
- SRP de propriedade de entidade entre domínios: a entidade, seu `Repository<T>`, sua lógica de transação/`DataSource` e helpers vivem dentro do próprio módulo do domínio. Serviços delegam criação cross-domain passando IDs, não possuindo a entidade do outro domínio. Compensação via try/catch (delete + re-throw) quando fora de uma transação compartilhada. _(from phase 02)_
- Entidades: PK UUID (`@PrimaryGeneratedColumn('uuid')`); `@CreateDateColumn`/`@UpdateDateColumn` para timestamps; colunas sensíveis com `select: false`; índices únicos declarados explicitamente; enums PostgreSQL para colunas enum; relações FK pela coluna `*_id` do lado dono. _(from phase 02)_
- `ValidationPipe` global em `src/main.ts` com `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true` (valida `@Query()` e `@Body()` contra DTOs). DTOs com decorators class-validator, um arquivo por operação em `src/<module>/dto/`. _(from phase 02)_
- Guard JWT global `JwtAuthGuard` registrado via `APP_GUARD` (todas as rotas exigem auth por padrão); opt-out com `@Public()`; usuário autenticado extraído por `@CurrentUser()` (payload `{ sub, email }`). _(from phase 02)_
- Exceções de domínio: base abstrata `DomainException extends Error` com `errorCode: string` e `httpStatus: number`; subclasses concretas por erro; filtro `@Catch(DomainException)` registrado globalmente retornando `{ statusCode, error, message }`. _(from phase 02)_
- Migrations geradas via `npm run migration:generate -- src/database/migrations/<Name>` (revisar SQL gerado), aplicadas via `npm run migration:run`; vivem em `src/database/migrations/`; `synchronize: false`. Existe padrão de teste de integração do runner (`migrations.integration-spec.ts`) que roda `runMigrations()` + `undoLastMigration()` verificando apply/revert. _(from phase 02)_
- Testes em pirâmide: `.spec.ts` (unit, colaboradores mockados), `.integration-spec.ts` (DB/serviços reais, ao lado do fonte), `test/*.e2e-spec.ts` (HTTP via supertest). Cobertura por SI registrada em `progress.md`. _(from phase 02)_

## Inherited Deferred Capabilities

_As capacidades de UI das Fases 01–02 (telas de cadastro, login, confirmação, recuperação) estão diferidas para o subprojeto frontend e não constituem trabalho de backend da Fase 03. Informativo apenas._

## Non-UI / Deferred Capabilities

| Capability | Status | Rationale | TD refs |
|------------|--------|-----------|---------|
| Superfícies de UI de vídeo (upload, player, painel) | deferred | `next-frontend/` não recebe UI de vídeo nesta fase; os contratos REST/streaming aqui definidos serão consumidos por fases posteriores. | TD-03, TD-08, TD-09 (contratos consumidos depois) |

## Testing Requirements

Consultar a Skill `testing-guide-nestjs-project` para os requisitos de camada por tipo de artefato em `nestjs-project/`. A Fase 03 introduz: entidade `Video` + migration, serviço de storage (S3/MinIO), produtor e consumidor de fila (BullMQ), worker FFmpeg, e endpoints de upload/streaming/download. Cobertura esperada:

- **Unit (`.spec.ts`)**: geração de `public_id` (colisão/retry), montagem de chaves de storage, máquina de status (transições válidas/ inválidas), wrapper FFmpeg com `child_process` mockado, mapeamento de exceções de domínio.
- **Integração (`.integration-spec.ts`)**: serviço de storage contra MinIO real (put/get/presign/multipart), produtor/consumidor BullMQ contra Redis real, extração de metadados/thumbnail com ffprobe/ffmpeg reais sobre um fixture mp4 pequeno, migration runner (apply/revert).
- **E2E (`test/*.e2e-spec.ts`)**: fluxo completo via supertest — `POST /videos` (rascunho + URLs de parte), upload das partes ao MinIO via AWS SDK, `POST /videos/:id/complete`, espera do processamento, `GET /videos/:publicId/stream` com header `Range` afirmando `206`, e `GET /videos/:publicId/download` afirmando URL pré-assinada/redirect.

Não mockar o que pode ser exercitado de verdade com a infra do Compose (MinIO, Redis, Postgres, FFmpeg). Cobertura por SI registrada em `progress.md`.
