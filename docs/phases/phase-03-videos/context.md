---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-07-01T15:40:47-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-01T16:41:33-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-07-01T15:40:47-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-07-01T15:40:47-03:00"
  docs/phases/phase-02-auth/context.md: "2026-07-01T15:40:47-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-07-01T15:40:47-03:00"
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

**Out of scope:** Edição de informações do vídeo, categorias, visibilidade público/unlisted, painel de gerenciamento do canal, página pública do canal (Fase 04); player de vídeo, sugestões, contagem de visualizações (Fase 05); interações sociais (Fase 06). Interface de upload/vídeo no `next-frontend/` — este desafio é escopo de backend apenas (`instrucoes.md`).

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** `nestjs-project/`

**Deferred subprojects:** `next-frontend/` — interface de upload/player de vídeo fica fora do escopo deste desafio (backend-only); nenhuma capacidade desta fase exige trabalho no frontend.

**Sequencing notes:** Depende de: Fase 01 (Configuração Base), Fase 02 (Cadastro, Login e Gerenciamento de Conta — fornece o `Channel` ao qual os vídeos se relacionam).

**Neighbors (for boundary detection only):**

- **Phase 02:** Fase 02 — Cadastro, Login e Gerenciamento de Conta (prior)
- **Phase 04:** Fase 04 — Gerenciamento de Vídeos e Canal (next; depende de Fase 02 e Fase 03)

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | technical-decisions-phase-03-videos.md | Backend | Tecnologia de fila de processamento | decided | A (BullMQ + Redis) | bullmq@^5.79.x, @nestjs/bullmq@^11.0.x, ioredis@^5.11.x |
| phase-03-videos/TD-02 | technical-decisions-phase-03-videos.md | Backend | Estratégia de upload de até 10GB e organização do storage | decided | A (Multipart + URLs pré-assinadas, direto ao storage) | @aws-sdk/client-s3@^3.1078.x, @aws-sdk/s3-request-presigner@^3.1078.x |
| phase-03-videos/TD-03 | technical-decisions-phase-03-videos.md | Backend | Execução do worker e extração de metadados/thumbnail | decided | A (Worker NestJS separado, mesmo monorepo) | fluent-ffmpeg@^2.1.x, @types/fluent-ffmpeg@^2.1.x |
| phase-03-videos/TD-04 | technical-decisions-phase-03-videos.md | Backend | Estratégia de URL única | decided | A (UUID da entidade) | — |
| phase-03-videos/TD-05 | technical-decisions-phase-03-videos.md | Backend | Estratégia de streaming e download | decided | B (Redirect para URL pré-assinada de leitura) | — |
| phase-03-videos/TD-06 | technical-decisions-phase-03-videos.md | Backend | Ciclo de status do vídeo e falha | decided | A (Enum simples dirigido por eventos da fila) | — |
| phase-03-videos/TD-07 | technical-decisions-phase-03-videos.md | Backend | Política de autorização para leitura (streaming/download) | decided | A (Público quando `ready`; dono sempre) | — |
| phase-03-videos/TD-08 | technical-decisions-phase-03-videos.md | Backend | Formatos aceitos e enforcement do limite de 10GB | decided | A (Allowlist ampla + validação do tamanho declarado) | — |

_Source files:_

- `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase)

_Nenhum documento ad-hoc tem `3 ∈ related_phases`._

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-02, phase-03-videos/TD-08 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02, phase-03-videos/TD-08 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-02, phase-03-videos/TD-06 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-03, phase-03-videos/TD-06 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-03 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-04 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-05, phase-03-videos/TD-07 |
| Download do vídeo pelo usuário | phase-03-videos/TD-05, phase-03-videos/TD-07 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** O projeto é 100% Node.js/NestJS nesta fase, e o `@nestjs/bullmq` reaproveita o mesmo padrão de módulos/DI já usado em `auth/`, `mail/` etc. Redis também é uma peça de infra mínima comparado ao overhead operacional do RabbitMQ para um único fluxo de fila.

**Libraries:** bullmq@^5.79.x, @nestjs/bullmq@^11.0.x, ioredis@^5.11.x

### phase-03-videos/TD-02

**Recommendation:** É o padrão recomendado pela documentação da AWS para arquivos grandes (thresholds de multipart a partir de 100MB) e é a única estratégia que garante, por construção, que o upload de 10GB não consome recursos da API. Chave de storage sugerida: `videos/{channelId}/{videoId}/original.<ext>` e `videos/{channelId}/{videoId}/thumbnail.jpg`, usando o SDK `@aws-sdk/client-s3` (v3, modular) — compatível com MinIO e com S3 real em produção sem mudança de código.

**Libraries:** @aws-sdk/client-s3@^3.1078.x, @aws-sdk/s3-request-presigner@^3.1078.x

### phase-03-videos/TD-03

**Recommendation:** Reaproveita a entidade e o repositório do módulo `videos/` sem duplicação, mantendo um único ponto de verdade para o schema de vídeos, com o custo de bootstrap do Nest sendo desprezível para um worker sem HTTP. `fluent-ffmpeg` chama `ffprobe` para duração/metadados e o método `screenshots` para extrair o frame do thumbnail, contra o binário `ffmpeg` instalado na imagem do worker.

**Libraries:** fluent-ffmpeg@^2.1.x, @types/fluent-ffmpeg@^2.1.x (dev)

### phase-03-videos/TD-04

**Recommendation:** O UUID já satisfaz literalmente a capacidade ("URL única, sem conflito") sem introduzir uma decisão de design que nenhuma capacidade desta fase pede. Fica registrado que a Fase 05 pode revisitar isso se precisar de um identificador público mais curto para a página de visualização.

**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** Mantém a mesma filosofia de TD-02 (API nunca no caminho dos bytes) e delega range/streaming a uma camada (S3/MinIO) que já implementa isso corretamente, evitando reintroduzir na leitura o gargalo que a fase pede para evitar na escrita.

**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** Cobre literalmente o ciclo "rascunho → processando → pronto/erro" citado no `docs/project-plan.md`, sem granularidade que nenhum consumidor (não há UI nesta fase) vai usar. Falha definitiva (`failed`) é reportada no registro do vídeo; reprocessamento manual é responsabilidade de uma fase futura.

**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** É a única opção que satisfaz o princípio de acesso anônimo já estabelecido no README sem precisar do modelo de visibilidade (unlisted/público) que só chega na Fase 04, e sem expor conteúdo ainda não pronto de outros usuários. Regra: público quando `status = ready`; dono do canal sempre, independente do status; caso contrário 404.

**Libraries:** —

### phase-03-videos/TD-08

**Recommendation:** Allowlist ampla (`video/mp4`, `video/quicktime`, `video/webm`, `video/x-matroska`) cobre os formatos reais que clientes de vídeo produzem, compatíveis com o worker (TD-03), e evita gastar storage/fila com uploads fora do limite de 10GB ou de formato não suportado — validado no `initiate-upload` a partir do `mimeType`/`sizeInBytes` declarados; a validade real do conteúdo continua sendo o `ffprobe` no worker.

**Libraries:** —

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, zero custom wiring, native string-to-number coercion.

**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — Clear file boundaries per domain, typed injection via `ConfigType<typeof xxxConfig>`, natural scalability.

**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — `data-source.ts` imports the factory, calls `dotenv.config()`, then calls the factory. Zero duplication.

**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — Backend-only project, no shared schemas with frontend needed. class-validator is the documented NestJS approach, already used extensively via decorators (TypeORM entities, NestJS DI).

**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Machine-readable error codes the Next.js frontend can switch on, without RFC 9457 overhead. Simple `{ statusCode, error, message }` format with domain codes.

**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration via guard system, scoping rate limiting per module via `APP_GUARD`, `@SkipThrottle()` for exemptions.

**Libraries:** `@nestjs/throttler@^6.x`

### openapi-docs-nestjs/TD-01

**Recommendation:** Option A (`@nestjs/swagger` + CLI plugin) — é a única opção que preserva as decisões anteriores (`class-validator` em phase-02-auth/TD-06) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores existentes para inferir schemas.

**Libraries:** `@nestjs/swagger`

### openapi-docs-nestjs/TD-02

**Recommendation:** Option C (Runtime UI + `openapi.json` exportado) — custo marginal sobre runtime-only é apenas um npm script; fundação correta para futura integração do frontend (codegen offline) sem perder a UI interativa de dev/QA.

**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** Option B (Apenas em dev/staging via env flag `SWAGGER_ENABLED`) — alinha com a postura defensiva já estabelecida na Fase 02 (rate limiting); `openapi.json` commitado cobre consumidores legítimos sem expor `/api/docs` em produção.

**Libraries:** —

## Inherited Conventions

- Backend config usa `@nestjs/config` com factories namespaced `registerAs(name, () => ({...}))` — um arquivo por domínio em `src/config/`. _(from phase 01)_
- Env vars são validadas por um schema Joi em `src/config/env.validation.ts`, passado a `ConfigModule.forRoot({ validationSchema, validationOptions: { allowUnknown: true, abortEarly: false } })`. _(from phase 01)_
- Config é injetada via `ConfigType<typeof xxxConfig>` + `@Inject(xxxConfig.KEY)`; a mesma factory é importável como função pura fora do DI (ex.: TypeORM CLI). _(from phase 01)_
- `data-source.ts` carrega `.env` via `import 'dotenv/config'`, depois importa e chama a factory de config do banco diretamente — nunca duplica parâmetros de conexão entre `AppModule` e `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` (não `forRoot`), com `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` retornando `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_
- Migrations em `src/database/migrations/`, nomeadas `<timestamp>-DescriçãoPascalCase.ts`, geradas via `npm run migration:generate` / aplicadas via `npm run migration:run`. _(from phase 01)_
- Módulo por domínio (`AuthModule`, `ChannelsModule`, ...) registrado em `AppModule`; controller lida com HTTP, service com regra de negócio, entidade TypeORM própria por domínio. Módulos sem endpoint HTTP (ex.: `ChannelsModule`) não têm controller. _(from phase 02)_
- DTOs usam `class-validator` + `class-transformer`; `ValidationPipe` global (`main.ts`) aplica a validação a toda a API. _(from phase 02 — phase-02-auth/TD-06)_
- Erros de domínio são lançados como exceções de domínio (não `HttpException` diretamente) e mapeados para o formato `{ statusCode, error, message }` por um filtro de exceção global (`common/`). Services nunca lançam exceção HTTP diretamente. _(from phase 02 — phase-02-auth/TD-07)_
- `JwtAuthGuard` é global (`APP_GUARD`); rotas públicas usam o decorator `@Public()` para opt-out. Usuário autenticado é injetado via `@CurrentUser()`. _(from phase 02)_
- Rate limiting via `@nestjs/throttler`, escopado por módulo com `APP_GUARD` e `@SkipThrottle()` para exceções pontuais. _(from phase 02 — phase-02-auth/TD-08)_
- Endpoints são documentados via `@nestjs/swagger` (decorators `@ApiTags`, `@ApiOperation`, `@ApiResponse`, etc.); Swagger UI habilitada só fora de produção (`SWAGGER_ENABLED`), `openapi.json` exportado via `npm run openapi:export`. _(from openapi-docs-nestjs ad-hoc TDs)_
- Testes seguem os sufixos `*.spec.ts` (unit), `*.integration-spec.ts` (integração com DB real), `*.e2e-spec.ts` (E2E via supertest, em `test/`), sempre com `--runInBand` para integração/E2E. _(from phase 01/02, formalizado em `nestjs-project/CLAUDE.md`)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred (no momento do context.md original) | phase-01-configuracao-base | `next-frontend/` não estava inicializado nessa fase. _Nota: já implementado em fase posterior (ver `next-frontend/app/`); não é uma lacuna ativa para a Fase 03, que é backend-only._ |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred (no momento do context.md original) | phase-02-auth | `next-frontend/` não estava inicializado nessa fase. _Nota: já implementado em fase posterior (ver `next-frontend/app/(auth)/`); não é uma lacuna ativa para a Fase 03._ |

## UI Inventory

_Nenhuma capacidade desta fase contém sinalização de UI (`Tela`, `Página`, `Login`, etc.) — Fase 03 é puramente backend (`instrucoes.md`: "desafio de backend"). Nenhuma inventory de tela é necessária; seção omitida por design._

## Non-UI / Deferred Capabilities

| Capability | Status | Rationale | TD refs |
|-----------|--------|-----------|---------|
| _(nenhuma capacidade da Fase 03 é diferida — todas as 9 têm TD cobrindo, ver Capability Coverage)_ | — | — | — |

## Testing Requirements

Referência: Skill `testing-guide-nestjs-project`. Tabela de layers por tipo de artefato relevante para esta fase:

| Artefato desta fase | Layers exigidos |
|---|---|
| `Video` entity (`*.entity.ts`) | Integration: constraints (FK para `Channel`, enum de status, `select: false` se aplicável) |
| `VideosService` (branching: iniciar upload, completar upload, transição de status) | Unit: lógica de branch (repo mockado) + Integration: contrato com o banco |
| `StorageService` (adapter para `@aws-sdk/client-s3`, presigned URLs) | Integration: contra o MinIO real do Compose — "serviço com dependência de efeito colateral (storage)" usa capture/adapter real, não mock |
| `VideosModule`, `QueueModule` (imports configurados: `TypeOrmModule.forFeature`, `BullModule.registerQueue`) | Unit: teste de compilação do módulo (DI wiring) |
| `VideosController` (upload, complete-upload, status, stream, download) | E2E apenas — não escrever unit test de controller |
| DTOs (`initiate-upload.dto.ts`, `complete-upload.dto.ts`) | E2E: um teste de wiring de validação por endpoint |
| `VideoProcessor` (BullMQ `@Processor`, consome o job de processamento) | Integration: contra Redis real do Compose + banco real — mesma lógica de "serviço com dependência externa configurada", não mockar BullMQ |
| Worker (entrypoint `main-worker.ts`, ffmpeg/ffprobe) | Integration: exercitando o binário `ffmpeg` real dentro do container do worker, contra um arquivo de vídeo de fixture pequeno |
| Migration `CreateVideos` | Integration: implícito via testes de entidade/repositório que dependem do schema aplicado |

_A `testing-guide-nestjs-project` ainda não tem uma linha dedicada a "Queue Processor"/"Storage Adapter" como tipos de artefato nomeados — o mapeamento acima é uma extensão direta das linhas existentes da tabela (§3: "Service with configured lib", "Service with side-effect dep (email, storage)"), aplicando o mesmo princípio (infra real do Compose, sem mock do que pode ser exercitado de verdade) aos novos artefatos desta fase. Isso será formalizado durante a Etapa 6 (implementação) SI a SI, não é uma lacuna que bloqueia o planejamento._
