---
scope_type: ad-hoc
related_phases: [3]
status: pending
date: 2026-11-28
scope_description: "Baseline de Node e test runner do backend exigidos pela migração ao Nest 12 decidida em phase-03-upload-processing-backend/TD-12 (opção B)."
---

# Technical Decisions — Backend: baseline de Node e test runner sob o Nest 12

_Subprojects in scope:_

- `nestjs-project/` — cobre todos os TDs: imagem Node do container, `engines`, `@types/node`, runner e configs de teste.
- `next-frontend/` — sem TD. Nenhuma das duas decisões toca o frontend.

_Origem:_ este documento resolve o `MD-1` do `validation.md` da Fase 03. O `phase-03-upload-processing-backend/TD-12` foi decidido como **B** (correções dentro das majors atuais mais migração para o Nest 12 na própria fase). Essa decisão não é reaberta aqui. O Nest 12 traz pacotes ESM-only, e isso cria duas escolhas que nenhum TD cobria: qual Node o projeto roda e com qual runner a suíte carrega esses pacotes.

_Inherited (não reabertas):_ `phase-03-upload-processing-backend/TD-12` (migração ao Nest 12), `phase-03-upload-processing-backend/TD-11` (estratégia de testes híbrida: integration real, unit com mock. É agnóstica de runner e não muda aqui), política de Docker do `CLAUDE.md` (tudo roda em container, então o Node que importa é o da imagem, não o do host).

_Estado atual medido em `nestjs-project/`:_

- Imagem `Dockerfile.dev`: `node:25.6.0-slim`. Não há `engines` no `package.json`. `@types/node` está em `^22.10.7`. Não existe `.github/workflows`.
- Jest 30 com `ts-jest` 29, em dois configs: o bloco `jest` do `package.json` (unit e integration) e `test/jest-e2e.json`. `tsconfig.json` usa `module: nodenext`, `isolatedModules: true` e `types: ["jest","node"]`. O `package.json` não tem `"type"`, ou seja, o app é CommonJS.
- 26 arquivos de spec. Só 5 usam a API do Jest, com 70 `jest.fn`, 18 `jest.Mocked` e 6 `jest.Mock`. Não há `jest.mock`. O `test:integration` roda serial (`--runInBand`) por causa do banco compartilhado.
- 12 arquivos de documentação e regras citam Jest, entre eles `.claude/rules/nestjs-testing.md` e o skill `testing-guide-nestjs-project`.

_Fatos consultados (Context7 e fontes primárias):_

- Nest 12: os pacotes são ESM-only. Um app CommonJS os consome via `require(esm)`, que só é liberado sem flag a partir do Node 20.19 e 22.12. Para rodar o app, o piso é Node 20.19+ (ou 22.12+ na linha 22). Para `nest new`, `generate` e `upgrade` (schematics), o piso é Node 22.22.3+, 24.15+ ou 26+.
- O Jest só carrega os pacotes ESM-only do Nest 12 no Node 24.9+. Antes disso falha com `ERR_REQUIRE_ASYNC_MODULE`. A recomendação oficial é rodar a suíte no Node 24.9+ ou migrar para Vitest. O `nest upgrade` sobe o Jest para 30 e avisa disso.
- `nest new` passou a gerar projetos CommonJS com Jest e projetos ESM com Vitest. Projetos existentes podem manter o tooling atual.
- Ciclo de vida do Node (endoflife.date): 22 é LTS e vai até 2027-04-30; 24 é LTS e vai até 2028-04-30; **25 não é LTS e chegou ao fim de vida em 2026-06-01**; 26 virou LTS em 2026-10-28 e vai até 2029-04-30.

---

## TD-01: Baseline de Node do projeto (imagem, `engines` e tipos)

**Scope:** Repo-wide

**Capability:** Transversal — covers: Serviço de armazenamento de arquivos (vídeos e thumbnails); Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** O Nest 12 (TD-12 B) fixa pisos de Node, e o worker de vídeo (`phase-03-upload-processing-backend/TD-04`) vai ganhar uma imagem própria com ffmpeg, o que cria uma segunda imagem para manter. A imagem atual (`node:25.6.0-slim`) está numa linha Current que já saiu de suporte, e o `@types/node` está dois majors atrás dela. A versão é citada em ao menos quatro lugares que precisam ficar consistentes: `Dockerfile.dev`, a imagem do worker, o campo `engines` do `package.json` e o `@types/node`. A escolha também condiciona o TD-02, porque o Jest só funciona a partir do Node 24.9.

**Options:**

### Option A: Node 24 LTS (24.15 ou superior), fixado por versão
- Imagem `node:24.x-slim` (a partir de 24.15, para o `nest upgrade` e o `nest generate` rodarem dentro do container), `engines.node: ">=24.15"` e `@types/node@^24`. O worker reaproveita a mesma tag.
- **Pros:** LTS com suporte até 2028-04. Atende o piso do Jest (24.9) e o dos schematics (24.15). Menor risco para addons nativos como o `argon2`, porque a linha está madura.
- **Cons:** é um downgrade de major em relação à imagem atual (25 para 24), então a imagem precisa ser testada. O suporte se encerra antes do da linha 26.

### Option B: Node 26 LTS
- Imagem `node:26.x-slim`, `engines.node: ">=26"` e `@types/node@^26`.
- **Pros:** é a LTS mais nova, com suporte até 2029-04, e evita uma nova troca de major dentro do ciclo do projeto. Atende todos os pisos.
- **Cons:** entrou em LTS há cerca de um mês, então o ecossistema (binários pré-compilados do `argon2`, plugins do Nest, `unplugin-swc`) tem menos tempo de uso. Ainda é preciso verificar a compatibilidade na instalação.

### Option C: Node 22 LTS (22.22.3 ou superior)
- Imagem `node:22.x-slim`, `engines.node: ">=22.22.3"` e `@types/node@^22` (já é a major atual do `package.json`).
- **Pros:** não muda o `@types/node` e satisfaz o piso do Nest 12 para rodar o app e para os schematics.
- **Cons:** o suporte termina em 2027-04, cerca de cinco meses após a fase. Fica abaixo do piso do Jest (24.9), o que obriga a migrar para Vitest (TD-02 B).

_Nota:_ manter `node:25.6.0-slim` não é uma opção, porque a linha 25 já está fora de suporte desde 2026-06-01.

**Recommendation:** **Option A (Node 24 LTS, a partir de 24.15)** — é o menor passo seguro: satisfaz os pisos do Nest 12 e do Jest, tem suporte até 2028 e não depende de o ecossistema ter alcançado a linha 26. A Option B é a candidata natural se, na instalação, o `argon2` e as demais dependências nativas já tiverem suporte confirmado.

**Decision:** A (Node 24 LTS, a partir de 24.15)
**Libraries:** `@types/node@^24`

---

## TD-02: Test runner do backend sob o Nest 12 (Jest ou Vitest)

**Scope:** Backend

**Capability:** Transversal — covers: Serviço de armazenamento de arquivos (vídeos e thumbnails); Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** A suíte inteira precisa carregar pacotes ESM-only do Nest 12 (e, no TD-08, o `nanoid` 6, também ESM-only). O runner é citado em vários arquivos que precisam ficar coerentes: os dois configs de teste (`package.json` e `test/jest-e2e.json`), os scripts `test`, `test:cov`, `test:integration` e `test:e2e`, o `tsconfig.json` (`types: ["jest","node"]`), o ESLint, os specs que usam `jest.*` e a documentação de testes do projeto (o skill `testing-guide-nestjs-project` e `.claude/rules/nestjs-testing.md`). Depende do TD-01: o Jest só é viável em Node 24.9 ou superior. A estratégia de testes em si (`phase-03-upload-processing-backend/TD-11`, integration real e unit com mock) não muda com a escolha.

**Options:**

### Option A: Manter o Jest 30 (com `ts-jest` atualizado) sobre Node 24.9 ou superior
- O projeto é CommonJS e continua assim. O Jest carrega os pacotes ESM via `require(esm)`. O `nest upgrade` já sobe `jest`, `@types/jest` e `ts-jest` para versões compatíveis. Nada muda nos specs, nos scripts nem na documentação.
- **Pros:** custo de migração praticamente zero e nenhuma mudança de documentação. É o runner que o Nest 12 mantém para projetos CommonJS. Mantém o type-check do `ts-jest` nos testes.
- **Cons:** depende de um caminho relativamente novo do Node (`require(esm)` dentro do registro de módulos do Jest). Um pacote ESM com top-level await falha com `ERR_REQUIRE_ASYNC_MODULE`. Exige o piso de Node do TD-01 (A ou B).

### Option B: Migrar para Vitest com `unplugin-swc`
- Troca por `vitest`, `unplugin-swc`, `@swc/core` e `@vitest/coverage-v8`. São criados `vitest.config.ts` e `vitest.config.e2e.ts` (com `include` por `*.e2e-spec.ts` e `globals: true`), com alias de `src`. O SWC é necessário para preservar `emitDecoratorMetadata`. Os 5 specs que usam `jest.*` passam para `vi.*` e `Mocked`/`Mock` do Vitest. O `test:integration` precisa rodar sem paralelismo de arquivos.
- **Pros:** carrega ESM nativamente e funciona em qualquer Node 22.12 ou superior (inclusive a Option C do TD-01). É o runner padrão dos projetos ESM do Nest 12. Mais rápido em execução e em watch.
- **Cons:** migração concreta: 26 specs, 94 usos de API do Jest, dois configs, `tsconfig`, ESLint, scripts e 12 arquivos de documentação e regras (o skill de testes e `nestjs-testing.md`). O SWC não faz type-check, então erros de tipo em testes só aparecem no `tsc --noEmit`, que já é parte da Definition of Done.

**Recommendation:** **Option A (manter o Jest 30)** — o app continua CommonJS, que é o caso em que o Nest 12 mantém o Jest, e o custo de migração (26 specs mais a documentação) só se justifica se o Jest realmente falhar. Se aparecer `ERR_REQUIRE_ASYNC_MODULE` ou se o TD-01 optar pelo Node 22 (Option C), a Option B passa a ser obrigatória. Essa decisão pode ser revertida depois com custo conhecido.

**Decision:** A (manter o Jest 30 com ts-jest atualizado, sobre Node 24.9 ou superior)
**Libraries:** `jest@^30`, `ts-jest`, `@types/jest`

---

## Dependências entre TDs

TD-02 depende de TD-01: o Jest só é viável em Node 24.9 ou superior (TD-01 A ou B). Se o TD-01 for decidido como C (Node 22), o TD-02 só admite a Option B. Os dois TDs condicionam a execução de `phase-03-upload-processing-backend/TD-12` (migração ao Nest 12): a imagem Node e o runner precisam estar definidos antes do `nest upgrade`.

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Repo-wide | Baseline de Node do projeto (imagem, `engines` e tipos) | A — Node 24 LTS (24.15 ou superior) | _[pending]_ |
| TD-02 | Backend | Test runner do backend sob o Nest 12 | A — Manter o Jest 30 sobre Node 24.9 ou superior | _[pending]_ |
