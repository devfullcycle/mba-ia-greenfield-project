---
kind: task
name: task-openapi-docs-nestjs
test_specs_aware: true
sources_mtime:
  docs/tasks/task-openapi-docs-nestjs/context.md: "2026-05-12T15:45:10-03:00"
  docs/tasks/task-openapi-docs-nestjs/library-refs.md: "2026-05-12T14:29:23-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-05-12T15:39:23-03:00"
---

# task-openapi-docs-nestjs

## Objective

Implementar documentação OpenAPI no projeto NestJS — tooling, estratégia do artefato e política de exposição em produção.

---

## Step Implementations

### SI-1 — Instalar `@nestjs/swagger` + configurar CLI plugin

**Description:** Trazer o tooling oficial decidido em `openapi-docs-nestjs/TD-01` (`@nestjs/swagger` + CLI plugin com `classValidatorShim`) para o `nestjs-project/` — a fundação que SI-2/SI-3/SI-4 consomem.

**Technical actions:**

1. Instalar `@nestjs/swagger@^11.0.0` em `nestjs-project/package.json` (compatível com `@nestjs/core ^11.0.1` instalado — per `openapi-docs-nestjs/TD-01`).
2. Adicionar bloco `compilerOptions.plugins` em `nestjs-project/nest-cli.json` com `name: "@nestjs/swagger"` e `options: { classValidatorShim: true, introspectComments: true, dtoFileNameSuffix: [".dto.ts", ".entity.ts"] }` (per `openapi-docs-nestjs/TD-01` Recommendation — preserva stack `class-validator` já fixado em `phase-02-auth/TD-06`).

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- `npx tsc --noEmit` no `nestjs-project/` retorna código `0` após a instalação (lib instala sem regressão de tipos).
- `npm run build` emite `metadata.ts` ao lado de `dist/` (sinal de que o CLI plugin executou contra os DTOs existentes).
- `node -e "require('@nestjs/swagger')"` carrega sem erro dentro do container `nestjs-api`.

---

### SI-2 — Configuração `swagger.config.ts` + flag `SWAGGER_ENABLED`

**Description:** Materializar a política de exposição decidida em `openapi-docs-nestjs/TD-03` como um config namespace dedicado, alinhado ao padrão `registerAs(...)` herdado de phase 02 (`Inherited Conventions`). SI-3 lê este config para gatilhar o mount.

**Technical actions:**

1. Criar `nestjs-project/src/config/swagger.config.ts` exportando `registerAs('swagger', () => ({ enabled: process.env.SWAGGER_ENABLED === 'true' }))` — segue o padrão `Inherited Conventions` (config-per-domain em `src/config/`).
2. Adicionar entrada `SWAGGER_ENABLED: Joi.string().valid('true','false').default('false')` ao schema em `nestjs-project/src/config/env.validation.ts` — Joi rejeita valores fora do par `true|false`, default fechado por segurança (alinha com `openapi-docs-nestjs/TD-03` postura defensiva).
3. Registrar `swaggerConfig` em `load: [...]` do `ConfigModule.forRoot(...)` em `nestjs-project/src/app.module.ts` (junto aos outros configs do projeto).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `swagger.config.ts` | Unit: real lib (`@nestjs/config`) com test config — verifica que `enabled` é `true` quando `SWAGGER_ENABLED='true'` e `false` em qualquer outro valor (per Testing Requirements → "Service with configured lib") | `src/config/swagger.config.spec.ts` |
| `env.validation.ts` | Integration: Joi schema com `SWAGGER_ENABLED` inválido falha boot; com `'true'`/`'false'` passa (per Testing Requirements → "Module with configured imports") | `src/config/env.validation.integration-spec.ts` |

**Dependencies:** SI-1 _(a lib precisa estar instalada para `app.module.ts` compilar com o config registrado)_

**Acceptance criteria:**

- Carregar `swaggerConfig` via `@Inject(swaggerConfig.KEY)` retorna `{ enabled: true }` quando `SWAGGER_ENABLED=true` está no ambiente.
- Boot da aplicação com `SWAGGER_ENABLED=invalid` falha imediatamente com erro de validação Joi referindo a chave `SWAGGER_ENABLED`.
- Boot da aplicação sem `SWAGGER_ENABLED` no env funciona — Joi aplica o default `'false'`, sem erro.

---

### SI-3 — Montar Swagger UI runtime condicional em `main.ts`

**Description:** Implementar a parte runtime de `openapi-docs-nestjs/TD-02` (Option C) gated pela flag definida em SI-2 — `DocumentBuilder` + `SwaggerModule.setup('api/docs', ...)` mounted apenas quando `swagger.enabled === true`, conforme `openapi-docs-nestjs/TD-03`. Os três endpoints `### API Contracts` (`/api/docs`, `/api/docs-json`, `/api/docs-yaml`) passam a existir.

**Technical actions:**

1. Em `nestjs-project/src/main.ts`, após `NestFactory.create(AppModule)` e antes de `app.listen(...)`, ler `app.get(swaggerConfig.KEY).enabled` e, quando `true`, instanciar `DocumentBuilder().setTitle('StreamTube API').setDescription('API REST do StreamTube').setVersion('1.0').addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token').build()` (per `openapi-docs-nestjs/TD-02` + library-refs § 1).
2. Carregar `await SwaggerModule.loadPluginMetadata((await import('./metadata')).default)` antes de `createDocument` — sem isso, o output do CLI plugin (SI-1) não é injetado no documento (per library-refs § 3).
3. Chamar `SwaggerModule.setup('api/docs', app, document, { customSiteTitle: 'StreamTube API Docs', swaggerOptions: { persistAuthorization: true } })` dentro do branch `if (enabled)` — `## Technical Specifications → ### API Contracts → Conditional-mount contract` define a semântica esperada.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `main.ts` (Swagger mount) | E2E (Supertest) — boot da app com `SWAGGER_ENABLED=true` → `GET /api/docs` responde `200`/HTML; `GET /api/docs-json` responde `200`/JSON com `info.title === 'StreamTube API'`; `GET /api/docs-yaml` responde `200`/YAML | `test/swagger.e2e-spec.ts` |
| `main.ts` (gating) | E2E (Supertest) — boot da app sem `SWAGGER_ENABLED` (ou com `'false'`) → as três rotas retornam `404` | (mesmo arquivo, segundo `describe`) |

**Dependencies:** SI-1, SI-2 _(SI-1 garante a lib + metadata.ts; SI-2 garante o `swagger.enabled` injetável)_

**Acceptance criteria:**

- Com `SWAGGER_ENABLED=true`, `GET /api/docs` retorna `200` com `Content-Type: text/html` e o corpo contém o título `StreamTube API Docs`.
- Com `SWAGGER_ENABLED=true`, `GET /api/docs-json` retorna `200` com `application/json` e o corpo é um documento OpenAPI 3.x cujo `info.title === 'StreamTube API'` e `components.securitySchemes['access-token']` declara `type: 'http', scheme: 'bearer', bearerFormat: 'JWT'`.
- Com `SWAGGER_ENABLED=true`, `GET /api/docs-yaml` retorna `200` com `application/yaml`.
- Com `SWAGGER_ENABLED` ausente ou `'false'`, qualquer uma das três rotas retorna `404` (sem vazamento de cabeçalhos Swagger).

---

### SI-4 — Script `openapi:export` + artefato `openapi.json`

**Description:** Implementar a parte estática de `openapi-docs-nestjs/TD-02` (Option C) — `nestjs-project/src/openapi-export.ts` instancia o `AppModule`, serializa o documento via `JSON.stringify(document, null, 2)` em `nestjs-project/openapi.json`, e encerra sem `app.listen`. Habilita codegen offline para o frontend futuro (cross-layer contact point declarado em TD-02).

**Technical actions:**

1. Criar `nestjs-project/src/openapi-export.ts` com `bootstrap` que chama `NestFactory.create(AppModule, { logger: false })`, monta `DocumentBuilder` idêntico ao de SI-3 (mesmo `setTitle/setVersion/addBearerAuth`), chama `SwaggerModule.createDocument(app, document)`, grava `writeFileSync('openapi.json', JSON.stringify(document, null, 2))` e termina com `await app.close()` (per library-refs § 6).
2. Adicionar `"openapi:export": "ts-node -r tsconfig-paths/register src/openapi-export.ts"` em `nestjs-project/package.json` → `scripts` (per library-refs § 6).
3. Versionar `nestjs-project/openapi.json` inicial gerado pela primeira execução do script, para que o diff de PR exponha mudanças de contrato (per `openapi-docs-nestjs/TD-02` Recommendation — "fundação correta para futura integração FE").

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `openapi-export.ts` | Integration: invoca a função `exportSpec` programaticamente (sem subprocess), grava em path temporário, lê o arquivo e afirma sobre `info.title === 'StreamTube API'`, `info.version === '1.0'` e `components.securitySchemes['access-token']` presente | `src/openapi-export.integration-spec.ts` |

**Dependencies:** SI-1 _(precisa de `@nestjs/swagger` + metadata.ts emitida pelo CLI plugin; o script reusa o `AppModule` carregado, independente do estado de `SWAGGER_ENABLED`)_

**Acceptance criteria:**

- `docker compose exec nestjs-api npm run openapi:export` termina com exit code `0` e produz `nestjs-project/openapi.json`.
- `nestjs-project/openapi.json` é um documento OpenAPI 3.x válido com `info.title === 'StreamTube API'` e `info.version === '1.0'`.
- O documento exportado contém `components.securitySchemes['access-token']` com `type: 'http'`, `scheme: 'bearer'`, `bearerFormat: 'JWT'` — espelhando o runtime de SI-3.
- O documento exportado contém schemas inferidos dos DTOs existentes (e.g., DTOs de phase-02-auth) via CLI plugin — verifica que `components.schemas` é não-vazio.

---

### SI-5 — Enriquecer spec OpenAPI com decoradores explícitos nos controllers/DTOs existentes

**Description:** Materializar a Revision de 2026-05-12 em `openapi-docs-nestjs/TD-01` — a inferência via CLI plugin (`classValidatorShim: true`) cobre apenas schemas de DTOs a partir de `class-validator`, mas operações, respostas tipadas por status code, contratos de erro e exemplos exigem decoradores explícitos. Esta SI percorre os controllers já implementados em `nestjs-project/src/auth/` e `nestjs-project/src/users/` (entregues em phase-02-auth) anotando cada endpoint com `@ApiOperation` (summary + description), `@ApiBody` quando o body é tipado, `@ApiParam`/`@ApiQuery` para parâmetros, e `@ApiResponse` cobrindo o status code de sucesso + os erros relevantes alinhados ao envelope de phase-02-auth/TD-07 (`{ statusCode, error, message, code }`). Declara um modelo de erro compartilhado via `@ApiExtraModels(ApiErrorEnvelope)` registrado uma vez no `DocumentBuilder` (ou via `@ApiExtraModels` na raiz dos controllers afetados) e referenciado em `@ApiResponse({ schema: { $ref: getSchemaPath(ApiErrorEnvelope) } })`.

**Technical actions:**

1. Criar `nestjs-project/src/common/openapi/api-error-envelope.dto.ts` exportando uma classe `ApiErrorEnvelope` cujos campos (`statusCode: number`, `error: string`, `message: string | string[]`, `code?: string`) são decorados com `@ApiProperty` — espelha o envelope decidido em `phase-02-auth/TD-07` (consultar `## Inherited Decisions Detail → phase-02-auth/TD-07` no context). Esta classe é o schema reusável referenciado por todos os `@ApiResponse` de erro.
2. Registrar `ApiErrorEnvelope` em `nestjs-project/src/swagger/swagger-document.ts` (helper `buildSwaggerConfig`) via `SwaggerModule.createDocument(app, config, { extraModels: [ApiErrorEnvelope] })` — garante o schema aparece em `components.schemas` mesmo se nenhum controller individual o registrar com `@ApiExtraModels`.
3. Anotar `nestjs-project/src/auth/*.controller.ts` (signup/login/refresh/forgot-password/reset-password/confirm-email) e `nestjs-project/src/users/*.controller.ts` com `@ApiTags('auth' | 'users')` no controller-level + por endpoint: `@ApiOperation({ summary, description })`, `@ApiBody({ type: <DtoExistente> })` (CLI plugin já infere, mas tornar explícito quando há `examples`), `@ApiParam`/`@ApiQuery` quando aplicável, e múltiplos `@ApiResponse` cobrindo: (a) success status (200/201/204) com `type: <ResponseDto>` ou `description`; (b) os erros documentados que cada endpoint emite (400 validação, 401 unauthorized, 403 forbidden, 404 not found, 409 conflict, 429 throttler) usando `{ status, description, schema: { $ref: getSchemaPath(ApiErrorEnvelope) } }`.
4. Para endpoints protegidos por `JwtAuthGuard`, adicionar `@ApiBearerAuth('access-token')` (nome do security scheme já registrado em `DocumentBuilder` de SI-3). Endpoints públicos não recebem o decorator.
5. Re-executar `npm run openapi:export` e revisar o diff de `nestjs-project/openapi.json` antes de versionar — confirmar que cada path tem `summary`, `responses` por status code, e referências a `#/components/schemas/ApiErrorEnvelope` nos error responses.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `ApiErrorEnvelope` | Integration: extende a integration test de `openapi-export.ts` (SI-4) afirmando: (a) `components.schemas.ApiErrorEnvelope` existe e tem as propriedades esperadas; (b) ao menos um path tem `responses['401'].content['application/json'].schema.$ref === '#/components/schemas/ApiErrorEnvelope'`; (c) endpoints de auth/users protegidos têm `security: [{ 'access-token': [] }]`; (d) endpoints documentados têm `summary` não-vazio | `src/openapi-export.integration-spec.ts` (extensão) |

**Dependencies:** SI-1, SI-2, SI-3, SI-4 _(precisa do tooling, config, runtime UI e script de export já no lugar; só anota código existente e estende uma integration test já criada)._

**Acceptance criteria:**

- `nestjs-project/src/common/openapi/api-error-envelope.dto.ts` existe e exporta `ApiErrorEnvelope` com 4 `@ApiProperty` (statusCode, error, message, code).
- `npm run openapi:export` regera `nestjs-project/openapi.json` e o diff mostra: (a) novo schema `ApiErrorEnvelope` em `components.schemas`; (b) cada endpoint em `/auth/*` e `/users/*` ganhou `summary`, ≥1 `responses` documentando o caso de sucesso e ≥1 erro; (c) endpoints protegidos têm `security: [{ "access-token": [] }]`.
- `docker compose exec nestjs-api npm run test -- openapi-export.integration-spec` passa com as novas asserções.
- `npx tsc --noEmit` exits 0 e `npm run lint` exits 0 após as anotações.

---

## Technical Specifications

### API Contracts

The task adds three meta/documentation endpoints exposed by `SwaggerModule.setup('api/docs', app, document, …)` and conditionally mounted per `openapi-docs-nestjs/TD-03` (Option B — dev/staging only). When the `SWAGGER_ENABLED` env flag is not `'true'`, none of these endpoints are mounted and requests return `404 Not Found` from the global Nest router.

#### GET /api/docs

Swagger UI (interactive HTML documentation) for the OpenAPI spec built in-process.

**Request:** none.

**Responses:**
- `200 OK` — `text/html`; Swagger UI page (`customSiteTitle: 'StreamTube API Docs'`, `swaggerOptions: { persistAuthorization: true }`).
- `404 Not Found` — when `SWAGGER_ENABLED !== 'true'` (production posture per `openapi-docs-nestjs/TD-03`).

**Auth:** public when mounted; the UI itself supports the `access-token` Bearer scheme declared in `DocumentBuilder` so an operator can authorize and exercise protected endpoints interactively.

#### GET /api/docs-json

OpenAPI 3.x specification in JSON form, served from the runtime in-memory document.

**Request:** none.

**Responses:**
- `200 OK` — `application/json`; OpenAPI document built by `SwaggerModule.createDocument(app, config)` with `DocumentBuilder` configured (`setTitle`, `setDescription`, `setVersion`, `addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')`).
- `404 Not Found` — when `SWAGGER_ENABLED !== 'true'`.

**Note:** This is the runtime side of `openapi-docs-nestjs/TD-02` (Option C — Both). The static-file counterpart is `nestjs-project/openapi.json`, produced by the `openapi:export` npm script and not served at any HTTP route.

#### GET /api/docs-yaml

OpenAPI 3.x specification in YAML form (sibling of `/api/docs-json`).

**Request:** none.

**Responses:**
- `200 OK` — `application/yaml`; same document as `/api/docs-json`, serialized as YAML by `@nestjs/swagger`.
- `404 Not Found` — when `SWAGGER_ENABLED !== 'true'`.

#### Conditional-mount contract

The three endpoints share a single mount switch: the `if (process.env.SWAGGER_ENABLED === 'true') { SwaggerModule.setup(...) }` guard in `nestjs-project/src/main.ts`. Per `openapi-docs-nestjs/TD-03`, the flag is `true` for development and staging environments and unset (or `false`) for production, where requests to `/api/docs*` MUST return `404`. The flag is validated by the existing Joi schema in `nestjs-project/src/config/env.validation.ts` (inherited convention from phase 02) so an invalid value fails fast at boot.

---

<!-- phase-a-complete -->

## Dependency Map

```
SI-1 (root — install lib + CLI plugin)
├── SI-2 — depends on SI-1 (config namespace precisa da lib instalada para compilar `app.module.ts`)
│   └── SI-3 — depends on SI-1 + SI-2 (runtime mount precisa de @nestjs/swagger + flag injetável)
├── SI-4 — depends on SI-1 (export script reusa CLI plugin metadata; flag SWAGGER_ENABLED não se aplica)
└── SI-5 — depends on SI-1, SI-2, SI-3, SI-4 (enriquece spec via decoradores; reusa runtime + export já no lugar; estende integration test de SI-4)
```

---

## Deliverables

- [ ] SI-1 — Instalar `@nestjs/swagger` + configurar CLI plugin
- [ ] SI-2 — Configuração `swagger.config.ts` + flag `SWAGGER_ENABLED`
- [ ] SI-3 — Montar Swagger UI runtime condicional em `main.ts`
- [ ] SI-4 — Script `openapi:export` + artefato `openapi.json`
- [ ] SI-5 — Enriquecer spec OpenAPI com decoradores explícitos nos controllers/DTOs existentes

**Full test suites:**

- [ ] Backend unit + integration tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] Backend E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type-check passes (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`docker compose exec nestjs-api npm run lint`)
- [ ] Build succeeds and emits `metadata.ts` ao lado de `dist/` (`docker compose exec nestjs-api npm run build`)
