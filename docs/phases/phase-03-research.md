# Fase 03 — Upload e Processamento de Vídeos — Research

> **Status:** research_ok (todas as decisões resolvidas pelo usuário em 2026-08-01)
> **Data:** 2026-08-01

## 1. Requisitos e critérios de aceite

Fonte: `docs/project-plan.md`, seção "### Fase 03 — Upload e Processamento de Vídeos" (linhas 67-83). Depende de Fase 01 (config) e Fase 02 (auth/users/channels), ambas `completed`.

### 1.1 Serviço de armazenamento de arquivos (vídeos e thumbnails)
- **Requisito:** existir um serviço de object storage (S3 ou MinIO, conforme `docs/diagrams/software-arch.mermaid`) capaz de guardar arquivos de vídeo e thumbnails gerados.
- **Constraints:** nenhum serviço de storage existe hoje em `compose.yaml` — precisa ser adicionado (MinIO local, S3-compatible).
- **Dependências:** nenhuma de fases anteriores (é infraestrutura nova).
- **AC (grosso):** um objeto pode ser gravado e lido do storage a partir da API/worker rodando em container.

### 1.2 Serviço de processamento em segundo plano (filas)
- **Requisito:** processamento de vídeo (extração de metadados, geração de thumbnail) não pode bloquear a requisição HTTP de upload — deve rodar de forma assíncrona via fila de jobs.
- **Constraints:** o diagrama de arquitetura já reserva um container "Message Queue" (tecnologia "TBD") e um container "Video Worker" separado da API.
- **Dependências:** depende do vídeo já estar persistido no storage (1.1) e do registro de rascunho existir (1.4).
- **AC (grosso):** ao concluir o upload, um job é enfileirado e processado por um worker sem que o cliente HTTP precise esperar o processamento terminar.

### 1.3 Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- **Requisito:** o endpoint/fluxo de upload aceita arquivos de até 10GB.
- **Constraints (hard, explícita no project-plan):** "sem impacto na performance" — a API não pode degradar sob upload de arquivos grandes ou uploads concorrentes.
- **Dependências:** requer o serviço de storage (1.1) já disponível.
- **AC (grosso):** um upload de arquivo de até 10GB é concluído com sucesso; a API permanece responsiva a outras requisições durante o upload.

### 1.4 Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- **Requisito:** ao iniciar o upload, um registro de vídeo é criado imediatamente em estado de rascunho (não é necessário aguardar o upload terminar para o registro existir).
- **Constraints:** o registro precisa de um identificador único desde já (ver 1.7).
- **Dependências:** requer `Channel` (Fase 02) — o vídeo pertence a um canal/usuário autenticado.
- **AC (grosso):** ao iniciar o upload, existe uma entidade `Video` persistida em estado de rascunho, associada ao canal do usuário autenticado.

### 1.5 Processamento automático do vídeo após upload (extração de duração e metadados)
- **Requisito:** após o upload ser concluído, o sistema extrai automaticamente duração e metadados do vídeo.
- **Constraints:** requer FFmpeg (ou equivalente) disponível no ambiente de processamento.
- **Dependências:** depende de 1.2 (fila) e do arquivo já estar no storage (1.1/1.3 concluídos).
- **AC (grosso):** após o processamento, o registro do vídeo contém duração e metadados extraídos do arquivo real.

### 1.6 Geração automática de thumbnail a partir de um frame do vídeo
- **Requisito:** um thumbnail é gerado automaticamente a partir de um frame do vídeo processado.
- **Constraints:** roda como parte do mesmo pipeline de processamento (1.5); precisa ser salvo no storage (1.1).
- **Dependências:** depende de 1.1, 1.2, 1.5.
- **AC (grosso):** após o processamento, existe uma imagem de thumbnail acessível associada ao vídeo.

### 1.7 URL única por vídeo, sem conflito com outros vídeos
- **Requisito:** cada vídeo tem uma URL/identificador único, sem colisão possível entre vídeos de diferentes usuários.
- **Constraints:** deve ser gerado no pré-cadastro (1.4), antes do processamento.
- **Dependências:** nenhuma além de 1.4.
- **AC (grosso):** duas requisições de criação de vídeo nunca produzem o mesmo identificador/URL.

### 1.8 Reprodução via streaming (sem necessidade de download completo)
- **Requisito:** o vídeo pode ser reproduzido via streaming — o cliente não precisa baixar o arquivo inteiro antes de começar a assistir (suporte a seek/scrubbing).
- **Constraints (arquitetural, já decidida em fase anterior):** `docs/diagrams/software-arch.mermaid` já define `Rel(frontend, storage, "Streams", "HTTPS")` — o frontend consome o stream diretamente do storage, não via proxy da API.
- **Dependências:** depende do vídeo já estar processado/pronto (1.5) e no storage (1.1).
- **AC (grosso):** o cliente consegue iniciar reprodução e buscar (seek) para um ponto arbitrário do vídeo sem baixar o arquivo completo antes.

### 1.9 Download do vídeo pelo usuário
- **Requisito:** o usuário pode baixar o arquivo de vídeo original.
- **Constraints:** nenhuma constraint adicional além de já estar no storage.
- **Dependências:** depende de 1.1.
- **AC (grosso):** uma requisição de download retorna o arquivo de vídeo completo e íntegro.

**Fora de escopo desta fase (confirmado por exclusão em `docs/project-plan.md`):** listagem/gerenciamento de vídeos, edição de metadados, exclusão de vídeo — esses itens aparecem explicitamente na "Fase 04 — Gerenciamento de Vídeos e Canal", não na Fase 03.

---

## 2. Auditoria do código existente

Levantamento feito via agente de exploração read-only sobre `nestjs-project/src/`.

- **Módulos existentes:** `auth`, `channels`, `common`, `config`, `database`, `mail`, `users` (+ `app.module.ts` na raiz). Padrão de pastas: arquivos `x.module.ts`/`x.service.ts`/`x.controller.ts` na raiz do módulo, `entities/` para `*.entity.ts`, `dto/` para DTOs de request, `decorators/` e `guards/` (hoje só em `auth`). `common/exceptions` e `common/filters` são compartilhados entre módulos.
- **`channels` e `users` não têm controller hoje** — são módulos internos (service + entity), consumidos por `auth`. Um futuro `VideosModule` seria o segundo módulo a expor endpoints HTTP diretamente.
- **`Channel` entity** (`src/channels/entities/channel.entity.ts`): tabela `channels`, PK `id: uuid`. Relação `@OneToOne(User)` via `user_id` (um canal por usuário). Um `Video` deve usar `@ManyToOne(Channel)` + `channel_id: uuid`, com `@OneToMany` inverso em `Channel`.
- **`User` entity**: PK `id: uuid`, sem campo de "owner" direto — a cadeia de posse é `User → Channel → Video`; a posse de um vídeo deve ser resolvida via `channel.user_id`, não diretamente em `User`.
- **Convenções de endpoint** (`auth.controller.ts`, `main.ts`): `@Controller('auth')` sem prefixo de versão. `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform: true`) com DTOs `class-validator`. Guard JWT é **global via `APP_GUARD`** — toda rota é protegida por padrão, opt-out via `@Public()`. Usuário atual via `@CurrentUser()`. Erros nunca via try/catch no controller — `DomainException` (base abstrata em `src/common/exceptions/domain.exception.ts`) capturada globalmente por `DomainExceptionFilter` → `{statusCode, error, message}`.
- **Migrations** (`src/database/migrations/`): 2 arquivos, nomeados `<timestamp>-<PascalCaseDescription>.ts`, conteúdo SQL puro via `queryRunner.query()` — saída verbatim de `npm run migration:generate`. Convenção do projeto: **sempre gerar via CLI**, nunca escrever à mão (exceto migrations de dados).
- **Config** (`src/config/`): `app.config.ts`, `database.config.ts`, `auth.config.ts`, `mail.config.ts` + `env.validation.ts` (Joi). Todos usam `registerAs('<namespace>', () => ({...}))` + `ConfigType<typeof xConfig>` + `@Inject(xConfig.KEY)`. Um futuro `storage.config.ts` / `queue.config.ts` deve seguir exatamente esse formato e ser adicionado ao `env.validation.ts`.
- **Upload/storage/fila/ffmpeg:** nenhum hit para `multer|MulterModule|S3Client|minio|Minio|bullmq|BullModule|@nestjs/bull|ffmpeg|fluent-ffmpeg` em `src/` nem em `package.json`. Fase 03 parte de uma base limpa nesses pontos.
- **Testes:** trio `*.spec.ts` (unit) + `*.integration-spec.ts` (DB real) + `*.module.spec.ts` (wiring), colocados junto ao código-fonte, seguindo `channels` e `users` como referência. Nenhum e2e ainda escrito para esses módulos (apenas `auth.e2e-spec.ts` existe hoje em `test/`).

---

## 3. Alternativas comparadas

Havia múltiplas decisões técnicas reais em aberto (biblioteca de storage, estratégia de upload de arquivos grandes, tecnologia de fila, biblioteca de processamento de vídeo, estratégia de entrega/streaming, modelo de deployment do worker). A comparação detalhada foi produzida em:

`docs/decisions/technical-decisions-phase-03-videos.md`

Resumo (ver documento para trade-offs completos):

| ID | Decisão | Recomendação |
|----|---------|--------------|
| TD-01 | Biblioteca cliente de Object Storage | `@aws-sdk/client-s3` (compatível com MinIO e S3 real) |
| TD-02 | Estratégia de upload para arquivos de até 10GB | Upload direto ao storage via URLs pré-assinadas |
| TD-03 | Tecnologia de fila de processamento em segundo plano | BullMQ + Redis |
| TD-04 | Biblioteca de processamento de vídeo | `fluent-ffmpeg` + `ffmpeg-static`/`ffprobe-static` |
| TD-05 | Estratégia de entrega de vídeo (streaming/download) | URLs de GET pré-assinadas |
| TD-06 | Modelo de deployment do worker | Aplicação NestJS separada (Nest CLI monorepo), container próprio |

**Todas as 6 decisões foram confirmadas pelo usuário em 2026-08-01, seguindo a recomendação em todos os casos** — ver `Decisions Summary` no documento de decisões para o registro formal.

---

## 4. Decisões de produto/escopo ainda não tomadas

> Todas as 6 decisões abaixo foram respondidas pelo usuário em 2026-08-01. Mantidas aqui como registro de contexto para o planning.

1. **Visibilidade de vídeo em rascunho/processando:** um vídeo ainda não "pronto" (uploading/processing) pode ser acessado via sua URL única por qualquer pessoa (mesmo antes de estar pronto para reprodução)? Ou deve retornar algum estado explícito (ex.: "ainda processando") até ficar pronto?
   **Decisão do usuário:** Bloqueado até ficar pronto — a API retorna estado explícito (não pronto para streaming/download) enquanto o vídeo não estiver `ready`.
2. **Falha de processamento:** se a extração de metadados/thumbnail falhar (arquivo corrompido, formato não suportado pelo FFmpeg), o vídeo fica em um estado "failed" visível ao dono? Há retry automático? Quantas tentativas antes de desistir?
   **Decisão do usuário:** Marca como `failed`, visível ao dono, sem retry automático nesta fase (MVP).
3. **Modelo de acesso ao vídeo pronto:** dado que o overview do projeto diz "anonymous users can watch freely", isso vale para **qualquer** vídeo pronto cuja URL alguém possua (acesso por posse do link/UUID), sem checagem adicional de propriedade/publicação? Ou existe alguma noção de "publicado" vs "não publicado" que esta fase precisa modelar (mesmo que a gestão completa de publicação só chegue na Fase 04)?
   **Decisão do usuário:** Qualquer um com a URL/UUID pode assistir, uma vez `ready` — sem checagem adicional de publicação nesta fase (modelo de publicação granular fica para a Fase 04).
4. **Upload abandonado:** se um upload é iniciado (rascunho criado, URLs pré-assinadas emitidas) e nunca é concluído, existe um TTL/limpeza automática do registro de rascunho e das partes de upload não finalizadas no storage? Quem define esse prazo?
   **Decisão do usuário:** Sem limpeza automática nesta fase — adiado para fase futura ou tarefa de manutenção separada.
5. **Descoberta da URL pelo uploader:** como a Fase 03 não inclui "listar meus vídeos" (isso é Fase 04), a única forma do uploader saber a URL do próprio vídeo é a resposta do endpoint que inicia o upload/pré-cadastro? Isso precisa ficar explícito no design da API antes do planning.
   **Decisão do usuário:** Sim — a resposta do endpoint de criação/pré-cadastro do vídeo já retorna o identificador/URL final. Suficiente para esta fase.
6. **Formatos de vídeo aceitos:** existe alguma restrição de container/codec na entrada (ex.: apenas mp4) ou qualquer formato decodificável pelo FFmpeg é aceito? Isso afeta a validação no pré-cadastro e o tratamento de erro em 1.5.
   **Decisão do usuário:** Qualquer formato decodificável pelo FFmpeg é aceito — sem allowlist no pré-cadastro; formatos inválidos falham no processamento (estado `failed`, conforme decisão 2).

---

## 5. Gaps e riscos

- **CORS/bucket policy para upload direto:** se TD-02 (upload direto via presigned URL) for confirmado, o bucket MinIO precisa de configuração de CORS liberando o frontend — isso precisa entrar no setup de infraestrutura (ex.: script de inicialização do MinIO no `compose.yaml`), não é automático.
- **Redis como nova infraestrutura:** se TD-03 (BullMQ) for confirmado, `compose.yaml` ganha um novo serviço `redis` — a seção "Environment Startup Verification" do `CLAUDE.md` do `nestjs-project` precisa ganhar um passo de verificação de prontidão para Redis, análogo ao `pg_isready` do Postgres.
- **Máquina de estados do vídeo:** nenhuma decisão de produto (Seção 4) define os estados possíveis do vídeo — isso precisa ser explicitado no planning antes de desenhar a entidade `Video` (ex.: `draft → uploading → uploaded → processing → ready | failed`).
- **Modelo de monorepo Nest para o worker:** se TD-06 (app separada) for confirmado, é a primeira vez que o projeto usa o modo monorepo do Nest CLI — vale validar rapidamente no planning que o compartilhamento de entidades/config entre `api` e `video-worker` funciona como esperado antes de comprometer o desenho de módulos.
- **Tamanho de imagem Docker:** `fluent-ffmpeg` + binários estáticos do FFmpeg podem aumentar consideravelmente o tamanho da imagem do worker — pode justificar um Dockerfile multi-stage dedicado ao worker, separado do Dockerfile da API.
- **Content7 MCP indisponível neste ambiente:** o `CLAUDE.md` da raiz exige consulta ao MCP `context7` antes de implementar qualquer feature envolvendo bibliotecas. A ferramenta não está configurada neste ambiente — esta pesquisa usou WebSearch como fallback (documentado pelo próprio skill `research` como alternativa válida quando o Context7 não está disponível). **Flag para o usuário:** confirmar se o Context7 deve ser configurado antes do planning/implementação, ou se o fallback via WebSearch é aceitável para esta fase.

---

## Fontes consultadas

- `docs/project-plan.md` (seção Fase 03, linhas 67-83)
- `docs/diagrams/software-arch.mermaid`
- `docs/decisions/technical-decisions-phase-01-config.md`
- `docs/decisions/technical-decisions-phase-02-auth.md`
- `docs/phases/phase-02-auth.progress.md`
- `nestjs-project/compose.yaml`, `nestjs-project/package.json`
- Auditoria de código via agente Explore sobre `nestjs-project/src/` (módulos, entidades, convenções, migrations, config, testes)
- WebSearch: estratégias de upload de arquivos grandes no NestJS, BullMQ vs pg-boss, fluent-ffmpeg vs child_process, presigned URL vs proxy de upload
