---
scope_type: ad-hoc
related_phases: []
status: decided
date: 2026-05-12
scope_description: "Implementar documentação OpenAPI no projeto NestJS — tooling, estratégia do artefato e política de exposição em produção"
---

# Technical Decisions — OpenAPI Documentation for NestJS

_Subprojects in scope:_

- `nestjs-project/` — backend: gera e expõe a especificação OpenAPI. Todos os TDs deste documento incidem aqui.
- `next-frontend/` — frontend: **sem decisão aberta neste documento.** TD-02 define um artefato estável (`openapi.json`) cujo consumo pelo frontend (codegen de cliente TS) é trabalho futuro; uma TD dedicada será aberta quando o frontend efetivamente integrar o spec.

---

## TD-01: OpenAPI Documentation Tooling

**Scope:** Backend

**Trigger:** Necessidade de documentar a API REST do NestJS via OpenAPI 3.x, com mínimo atrito de manutenção e alinhamento com o stack já decidido (class-validator + class-transformer — phase-02-auth/TD-06).

**Context:** O projeto NestJS 11 hoje não publica documentação de API. As decisões anteriores fixaram `class-validator` + `class-transformer` para validação (phase-02-auth/TD-06) e definiram o envelope padrão de erro (phase-02-auth/TD-07). A escolha do tooling de OpenAPI precisa preservar essas decisões — substituí-las teria efeito cascata sobre todos os DTOs já implementados na fase 02. O programa de decoradores vs introspecção de tipos é o trade-off central.

**Options:**

### Option A: `@nestjs/swagger` (oficial)
- Pacote oficial do NestJS, baseado em decoradores (`@ApiProperty`, `@ApiResponse`, `@ApiTags`) e gerador de OpenAPI a partir de `DocumentBuilder`. Suporta um CLI plugin (`nest-cli.json` → `plugins`) que faz **introspecção automática** de DTOs com `classValidatorShim: true`, reduzindo decoradores explícitos para o mínimo.
- **Pros:** Integração nativa com `class-validator`/`class-transformer` (já no stack). Curva de aprendizado baixa para times com NestJS. CLI plugin elimina ~80% do boilerplate quando configurado. Ecosistema maduro: Swagger UI embarcada, JSON/YAML export prontos, suporte a auth schemes (Bearer/JWT) out-of-the-box. Versão `@nestjs/swagger ^11` é compatível com `@nestjs/core ^11.0.1` instalado.
- **Cons:** Requer alguma anotação adicional para responses complexas, polimorfismo, e variações por status. Spec depende de runtime metadata (decorators) — não há "pure type-driven" sem o CLI plugin.

### Option B: Nestia (`@nestia/core` + `@nestia/sdk`)
- Toolkit alternativo type-driven: gera o OpenAPI a partir de **tipos TypeScript puros** (preferencialmente `interface`), sem `@ApiProperty`. Inclui geração de SDK cliente e validador próprio (`typia`) ~20.000× mais rápido que `class-validator`.
- **Pros:** Zero-decorator para schema. SDK codegen embutido. Performance superior em runtime (typia). Comunidade ativa, doc própria.
- **Cons:** **Conflita com o stack já decidido em phase-02-auth/TD-06 (class-validator + class-transformer):** o ganho de Nestia exige adotar `typia` como validador, o que é um re-platform — não compatível com manter `class-validator` na phase 02 já implementada. Os DTOs precisariam ser reescritos como interfaces. Adoção menor (relativo ao oficial). Curva de aprendizado nova.

### Option C: Manual OAS authoring (openapi.yaml/json à mão)
- Manter o arquivo `openapi.yaml`/`openapi.json` versionado e editado à mão, sem geração automática a partir do código.
- **Pros:** Controle total. Spec não acoplado ao código.
- **Cons:** Manutenção manual divergente do código real — risco alto de spec stale. Sem detecção automática de drift entre DTO e contrato. Trabalho proporcional ao crescimento da API.

**Recommendation:** **Option A (`@nestjs/swagger`)** — é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo. Nestia tem mérito técnico real mas o custo de migração do stack de validação inviabiliza-a sem uma decisão upstream de supersede de TD-06. Manual authoring é descartado.

**Decision:** A (@nestjs/swagger + CLI plugin)
**Libraries:** @nestjs/swagger

**Revisions:**

- 2026-05-12 — Esclarece que o CLI plugin (`classValidatorShim: true`) cobre apenas inferência de schemas de DTOs a partir de `class-validator`; documentação de operações, respostas tipadas por status code, contratos de erro (alinhados ao envelope de phase-02-auth/TD-07) e exemplos exigem decoradores explícitos (`@ApiOperation`, `@ApiResponse`, `@ApiBody`, `@ApiParam`, `@ApiQuery`, `@ApiExtraModels`). _Rationale:_ openapi.json gerado pelo bootstrap atual está genérico — sem detalhes de parâmetros, schemas de retorno por status, nem contratos de erro — porque a base instalada se apoiou só na introspecção automática. Esta revisão fixa que enriquecimento via decoradores explícitos faz parte da Option A escolhida, não é trabalho fora do escopo do TD.

---

## TD-02: OpenAPI Spec Artifact Strategy

**Scope:** Cross-layer

**Trigger:** Definir como o spec OpenAPI é exposto para consumidores — humanos (exploração interativa) e máquinas (codegen de cliente FE futuro).

**Context:** O `@nestjs/swagger` (TD-01, Option A) permite duas modalidades de publicação do spec: **runtime** (Swagger UI + endpoint JSON servidos pela aplicação Nest) e **artefato estático** (arquivo `openapi.json` gerado em build/script e commitado ou publicado em CI). A escolha afeta como o frontend (futuro) consome o contrato: se o spec só existe em runtime, codegen exige a API no ar; se existe como arquivo, codegen roda offline em qualquer CI. Como o `next-frontend` ainda não integra o spec mas vai integrar, a decisão é cross-layer — o artefato é o ponto de contato entre os subprojetos.

**Options:**

### Option A: Runtime-only (Swagger UI + endpoint JSON, sem arquivo)
- `SwaggerModule.setup('api/docs', app, document)` monta UI em `/api/docs` e o JSON em `/api/docs-json`. Nenhum arquivo é gerado/commitado.
- **Pros:** Setup mínimo (um bloco em `main.ts`). Spec sempre reflete o código rodando — zero risco de drift entre arquivo e runtime. Sem etapa de build adicional.
- **Cons:** Codegen do FE exige a API rodando no momento (CI precisa subir o backend ou apontar para uma instância estável). Sem histórico do contrato em diff de PR — mudanças de schema são invisíveis até alguém comparar specs em runtime.

### Option B: Artefato estático apenas (gerar `openapi.json`, sem UI runtime)
- Script `npm run openapi:gen` que instancia o app NestJS em modo "build-only", chama `SwaggerModule.createDocument`, serializa `JSON.stringify(document)` em `openapi.json` (ou em `<backend-subproject>/openapi.json`) e encerra. UI runtime desativada. Arquivo commitado ou publicado em CI.
- **Pros:** Contrato versionado — mudanças aparecem como diff em PR. Codegen do FE roda offline. Auditoria de breaking changes facilitada.
- **Cons:** Sem UI interativa para desenvolvedores e QA. Spec pode ficar stale se o desenvolvedor esquecer de rodar o script antes do commit — exige hook ou step de CI para garantir frescor.

### Option C: Ambos — UI runtime + artefato estático
- Mantém `SwaggerModule.setup('api/docs', ...)` em runtime **e** roda script de export para `openapi.json` em build/CI. UI para humanos, arquivo para codegen.
- **Pros:** Cobre os dois casos de uso sem comprometer nenhum. FE tem artefato estável; devs/QA têm UI interativa. Drift entre arquivo e runtime detectável via diff em PR (`openapi.json` desatualizado é um diff visível).
- **Cons:** Duas superfícies para manter (uma linha de configuração runtime + um npm script). Marginalmente mais complexo que A ou B isoladamente.

**Recommendation:** **Option C (Ambos)** — o custo marginal sobre Option A é apenas um npm script (~15 linhas) e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam. Option B sozinho pune a experiência de desenvolvimento em dev/local; Option A sozinho compromete o pipeline de codegen futuro. Combinar é dominante.

**Decision:** C (Runtime UI + openapi.json exportado)

---

## TD-03: Production Exposure Policy for Swagger UI

**Scope:** Backend

**Trigger:** Decidir se a UI interativa do Swagger fica exposta em produção (e em que condições).

**Context:** A UI Swagger em produção é útil (documentação viva para integradores) mas aumenta superfície de ataque: enumera todos os endpoints, parâmetros aceitos, formato de respostas — útil para reconhecimento. Hoje o projeto não tem requisito de API pública para terceiros; é uma plataforma orientada a frontend próprio (`next-frontend`). A decisão é policy, não técnica — qual lado do trade-off priorizar.

**Options:**

### Option A: Sempre exposta (todos os ambientes, sem auth)
- `SwaggerModule.setup` chamado incondicionalmente em `main.ts`. `/api/docs` acessível por qualquer origem em prod.
- **Pros:** Sem condicionais. Documentação sempre disponível para integradores eventuais.
- **Cons:** Reconhecimento facilitado para atacantes. Spec pública pode expor endpoints internos não destinados a consumidores externos (admin, debug). Não combina com a postura defensiva da fase 02 (rate limiting, refresh rotation).

### Option B: Apenas em dev/staging (desabilitada em prod via env)
- `if (process.env.NODE_ENV !== 'production') { SwaggerModule.setup(...) }` ou flag dedicada `SWAGGER_ENABLED`. Em prod, `/api/docs` retorna 404. `openapi.json` (TD-02) continua disponível como artefato no repo/CI para quem precisar.
- **Pros:** Minimiza superfície em prod. Não impede consumo externo legítimo — o arquivo committed cobre isso. Alinhado com o stance defensivo já estabelecido (TD-08 phase-02-auth — throttler).
- **Cons:** Devs precisam consultar staging ou o arquivo commitado para inspecionar contrato de prod. Em troubleshooting de prod, não há UI clicável (precisa replicar localmente).

### Option C: Sempre exposta com auth básica em prod
- `SwaggerModule.setup` chamado sempre; em prod, middleware extra protege `/api/docs` com Basic Auth (credenciais via env). Dev/staging sem proteção.
- **Pros:** Documentação disponível para parceiros autorizados em prod. Atacantes anônimos não enumeram a API.
- **Cons:** Outra credencial pra gerenciar/rotacionar (mais coisa em `.env`). Basic auth não é robusto sozinho. Adiciona código de middleware específico. Para um projeto sem caso de uso público claro, é over-engineering.

**Recommendation:** **Option B (Apenas em dev/staging)** — alinha com a postura defensiva já estabelecida em phase 02 e não compromete consumidores legítimos (o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI"). Re-abrir como Option A ou C é trivial no futuro se um caso de uso de API pública aparecer.

**Decision:** B (Apenas em dev/staging via env flag)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | OpenAPI Documentation Tooling | A (`@nestjs/swagger` + CLI plugin) | A |
| TD-02 | Cross-layer | OpenAPI Spec Artifact Strategy | C (Runtime UI + `openapi.json` exportado) | C |
| TD-03 | Backend | Production Exposure Policy for Swagger UI | B (Apenas em dev/staging via env flag) | B |
