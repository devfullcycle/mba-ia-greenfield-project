---
kind: task
name: task-next-frontend-msw-foundation
test_specs_aware: true
sources_mtime:
  docs/tasks/task-next-frontend-msw-foundation/context.md: "2026-05-13T20:07:54-03:00"
  docs/decisions/technical-decisions-next-frontend-msw-foundation.md: "2026-05-13T20:06:42-03:00"
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-05-13T19:51:13-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-05-13T15:23:15-03:00"
  docs/phases/phase-02-auth/context.md: "2026-05-12T14:01:10-03:00"
  .claude/skills/testing-guide-next-frontend/SKILL.md: "2026-05-13T10:59:26-03:00"
---

# next-frontend MSW Foundation

## Objective

MSW (Mock Service Worker) foundation for next-frontend: handler module organization across domains/phases, separation between Node test handlers (msw/node) and browser dev handlers (msw/browser Service Worker), response builder/factory strategy (with or without faker-js), and how each phase exposes its handler set to that phase's tests.

---

## Step Implementations

### SI-1 — Instalar MSW + Vitest e dependências de teste

**Description:** Adicionar Vitest, MSW v2 e bibliotecas de RTL/jsdom ao `next-frontend/package.json` como `devDependencies`; ativar os npm scripts (`test`, `test:watch`) que `next-frontend/CLAUDE.md` § Commands já documenta como contrato. Pure infra — nenhum arquivo de teste ou de mock é criado neste SI.

**Technical actions:**

1. Rodar `docker compose exec next-frontend npm install --save-dev msw vitest @testing-library/react @testing-library/jest-dom jsdom @vitest/coverage-v8` — adiciona o runner (Vitest) e o interceptor Node (`msw/node`) necessários por `next-frontend-msw-foundation/TD-02` e `TD-04` (ver `### Frontend Runtime → TD-02 / TD-04`).
2. Adicionar `"test": "vitest run"` e `"test:watch": "vitest"` em `next-frontend/package.json → scripts` — torna os comandos documentados em `CLAUDE.md § Commands` executáveis.
3. Rodar `docker compose exec next-frontend npx vitest --version` como smoke do binário (não persiste artefato; apenas valida que o install foi limpo).

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- `docker compose exec next-frontend npm ls msw vitest @testing-library/react @testing-library/jest-dom jsdom` lista cada dependência sem `extraneous` / `invalid`.
- `next-frontend/package.json → scripts` contém `test` e `test:watch` exatamente como `next-frontend/CLAUDE.md § Commands` documenta.
- `docker compose exec next-frontend npx vitest --version` imprime a versão instalada e exit 0.

---

### SI-2 — Criar a árvore `mocks/handlers/` + barrel + seed + diretório `mocks/factories/`

**Description:** Materializar o esqueleto per-domain decidido em `next-frontend-msw-foundation/TD-01` (barrel + arquivo seed) e o placeholder para factories decidido em `TD-03`. Greenfield — nenhum domínio (auth/videos/...) é populado aqui; cada fase futura adiciona um arquivo `mocks/handlers/<domain>.ts` e uma linha no barrel.

**Technical actions:**

1. Criar `next-frontend/mocks/handlers/_seed.ts` com `export const handlers: import("msw").RequestHandler[] = []` — mantém o barrel typecheck-válido até a primeira fase adicionar um domínio real (per `next-frontend-msw-foundation/TD-01`, shape canônico em `### Frontend Runtime → TD-01`).
2. Criar `next-frontend/mocks/handlers/index.ts` com `import { handlers as seedHandlers } from "./_seed"; export const handlers = [...seedHandlers];` — barrel que cada fase futura estende com `import { handlers as authHandlers } from "./auth"` + spread no array (per `next-frontend-msw-foundation/TD-01`).
3. Criar `next-frontend/mocks/factories/.gitkeep` (placeholder de diretório; a primeira factory real — `buildUser` — chega com Phase 02 via `next-frontend-msw-foundation/TD-03`).

**Tests:** _(empty — Infra)_

**Dependencies:** SI-1

**Acceptance criteria:**

- `next-frontend/mocks/handlers/index.ts` e `next-frontend/mocks/handlers/_seed.ts` existem; o array `handlers` no barrel é tipado como `RequestHandler[]` (sem `as` / cast).
- `next-frontend/mocks/factories/.gitkeep` existe (diretório vazio no git).
- `docker compose exec next-frontend npx tsc --noEmit` exit 0 — o barrel + seed novos não quebram a typecheck.

---

### SI-3 — Wire MSW na lifecycle do Vitest (`mocks/server.ts` + `mocks/setup.ts` + `vitest.config.ts`)

**Description:** Carrega o `setupServer` Node-only do MSW no `setupFiles` do Vitest. Aplica TD-02 (test-only — sem `setupWorker` no browser) e TD-04 (universal handler set + `server.use(...)` overrides + `onUnhandledRequest: "error"` + `resetHandlers` em `afterEach`). Smoke-gated: Vitest deve subir limpo carregando o servidor e relatando "0 testes" porque ainda não há specs.

**Technical actions:**

1. Criar `next-frontend/mocks/server.ts` com `setupServer(...handlers)` importando do barrel de SI-2 (per `next-frontend-msw-foundation/TD-02`; shape canônico em `### Frontend Runtime → TD-02`).
2. Criar `next-frontend/mocks/setup.ts` com `beforeAll(() => server.listen({ onUnhandledRequest: "error" }))`, `afterEach(() => server.resetHandlers())`, `afterAll(() => server.close())` (per `next-frontend-msw-foundation/TD-04`; shape canônico em `### Frontend Runtime → TD-04`).
3. Criar `next-frontend/vitest.config.ts` com `environment: "node"` e `setupFiles: ["./mocks/setup.ts"]` (per `next-frontend-msw-foundation/TD-04`).
4. Rodar `docker compose exec next-frontend npm test` para smoke do bootstrap — esperado exit 0 com "0 test files / 0 tests" (Vitest carrega `setupFiles`, MSW inicializa, nada é interceptado porque nenhum teste fez `fetch`).

**Tests:** _(empty — Setup SI; smoke-gated by AC; behavior tests live in consumer phases starting at Phase 02)_

**Dependencies:** SI-2

**Acceptance criteria:**

- `next-frontend/mocks/server.ts`, `next-frontend/mocks/setup.ts`, `next-frontend/vitest.config.ts` existem com os shapes documentados em `### Frontend Runtime`.
- `docker compose exec next-frontend npm test` exit 0; output contém "0 test files" e NÃO contém warnings de `onUnhandledRequest` (porque nenhum `fetch` foi disparado).
- `docker compose exec next-frontend npx tsc --noEmit` exit 0 — todos os imports MSW v2 + Vitest + `paths` resolvem; `handlers: RequestHandler[]` typecheck contra a assinatura de `setupServer(...handlers)`.

---

### SI-4 — Atualizar `.claude/rules/next-frontend-msw-mocks.md` para refletir a estrutura decidida

**Description:** A regra atual (`.claude/rules/next-frontend-msw-mocks.md`) mostra `mocks/handlers.ts` como arquivo único (exemplo herdado do contrato pré-decision). Atualizar para refletir o que esta task materializou: a árvore per-domain `mocks/handlers/<domain>.ts` + barrel (TD-01), o diretório `mocks/factories/` com a convenção `buildX(overrides)` (TD-03), e a lifecycle `listen({ onUnhandledRequest: "error" }) + resetHandlers + close` (TD-04). A exceção "`mocks/` pode importar `paths` direto" permanece — ela já era travada por `next-frontend-openapi-typing/TD-05`.

**Technical actions:**

1. Editar `.claude/rules/next-frontend-msw-mocks.md` § "Where MSW lives": substituir a referência única a `mocks/handlers.ts` por uma listagem que inclua `mocks/handlers/<domain>.ts`, `mocks/handlers/index.ts` (barrel), `mocks/factories/<domain>.ts`, `mocks/server.ts`, `mocks/setup.ts` — com one-liner explicando o papel de cada (per `next-frontend-msw-foundation/TD-01` e `TD-02`).
2. Adicionar nova subseção "Lifecycle (Vitest `setupFiles`)" documentando o ciclo `listen({ onUnhandledRequest: "error" }) → resetHandlers (afterEach) → close (afterAll)`, com snippet curto e o motivo de `onUnhandledRequest: "error"` (per `next-frontend-msw-foundation/TD-04`).
3. Adicionar nova subseção "Factories convention" descrevendo `mocks/factories/<domain>.ts` exportando `buildX(overrides?: Partial<X>): X` com defaults hand-written, e a regra de `@faker-js/faker` opt-in apenas para `buildXList` com `faker.seed(N)` local antes da geração (per `next-frontend-msw-foundation/TD-03`).
4. Atualizar o exemplo de código que mostra um handler — trocar `next-frontend/mocks/handlers.ts` por `next-frontend/mocks/handlers/auth.ts`, preservando byte-verbatim o restante (a tipagem via `paths["/videos/{id}"]["get"]["responses"][200]["content"]["application/json"]` e a composição com `${env.API_URL}/...`).

**Tests:** _(empty — rule doc only)_

**Dependencies:** SI-3

**Acceptance criteria:**

- `.claude/rules/next-frontend-msw-mocks.md` cita `mocks/handlers/<domain>.ts` e `mocks/handlers/index.ts` explicitamente; a string isolada `mocks/handlers.ts` foi removida ou trocada onde representava o arquivo único antigo.
- A regra contém as subseções "Lifecycle (Vitest setupFiles)" e "Factories convention" com referências verbatim a `next-frontend-msw-foundation/TD-04` e `TD-03` respectivamente.
- O exemplo de handler na regra usa `next-frontend/mocks/handlers/auth.ts` (não `mocks/handlers.ts`); a tipagem `paths[...]` e a URL `${env.API_URL}/...` foram preservadas verbatim.
- O bloco "Exception to the contracts-barrel rule" continua presente sem alteração (já estava correto pré-decision).

---

### SI-5 — Atualizar `next-frontend/CLAUDE.md § Testing → Status` para refletir bootstrap concluído

**Description:** A subseção `## Testing → ### Status — bootstrap pending` em `next-frontend/CLAUDE.md` enumera todos os artefatos que SI-1..SI-3 acabaram de materializar como "não instalados ainda". Substituir por uma subseção `### Status — bootstrap complete` referenciando este task como fundação, e manter o bloco "Already decided" (TD-05 de openapi-typing) atualizado para refletir que agora é convenção executada, não pendente.

**Technical actions:**

1. Editar `next-frontend/CLAUDE.md § Testing`: substituir o bloco `### Status — bootstrap pending` por `### Status — bootstrap complete` listando os artefatos agora presentes (`next-frontend/vitest.config.ts`, `next-frontend/mocks/server.ts`, `next-frontend/mocks/setup.ts`, `next-frontend/mocks/handlers/index.ts`, `next-frontend/mocks/factories/`) e citando `docs/tasks/task-next-frontend-msw-foundation/` como a fundação que materializou tudo.
2. Atualizar o bloco "Already decided" para deixar explícito que `next-frontend-openapi-typing/TD-05` (handler typing via `paths`) já é executado nos handlers per-domain criados (não mais "convenção pendente").

**Tests:** _(empty — doc only)_

**Dependencies:** SI-4

**Acceptance criteria:**

- `next-frontend/CLAUDE.md § Testing` não contém mais a string literal "bootstrap pending" nem "do not exist yet" referenciando os arquivos criados em SI-3.
- A subseção `### Status` referencia este task pelo path `docs/tasks/task-next-frontend-msw-foundation/` como origem das decisões.
- O bloco "Already decided" cita `next-frontend-openapi-typing/TD-05` como convenção em vigor (não pendente).

---

## Technical Specifications

### Frontend Runtime

#### next-frontend-msw-foundation/TD-01 — Handler Module Organization & Phase Expansion Model

**Pattern:** Per-domain handler modules under `mocks/handlers/<domain>.ts` (`auth.ts`, `videos.ts`, `channels.ts`, …) composed via a barrel `mocks/handlers/index.ts`. Each phase contributes one new domain file plus one line in the barrel — append-only, minimal merge-conflict surface, matches MSW's official "Structuring handlers" recommendation. Inside a domain file, group handlers by **HTTP method + path** (one handler per `paths` entry), never by test scenario — per-test deviations layer via `server.use(...)`.

**Setup:** Canonical shape of the `mocks/handlers/` tree + barrel re-export.

```ts
// next-frontend/mocks/handlers/index.ts
import { handlers as authHandlers } from "./auth";
// import { handlers as videosHandlers } from "./videos";  // appended by Phase 03
export const handlers = [...authHandlers /* , ...videosHandlers */];
```

```ts
// next-frontend/mocks/handlers/auth.ts  (example shape; populated by Phase 02)
import { http, HttpResponse } from "msw";
import type { paths } from "@/lib/api/types.gen";
import { env } from "@/lib/env";

export const handlers = [
  // one handler per (method, path) — happy-path default; per-test edge cases via server.use(...)
];
```

**Aplicação:** logic-only — applies to every domain handler file the project will author. Foundation creates `mocks/handlers/index.ts` plus a seed `mocks/handlers/_seed.ts` exporting `export const handlers = []` (keeps the barrel valid + TypeScript clean before the first real domain module lands). Future phases each contribute one `mocks/handlers/<domain>.ts` file plus one barrel line — Phase 02 (`auth.ts`), Phase 03 (`videos.ts`), Phase 04 (`channels.ts`), Phase 06 (`comments.ts`, `likes.ts`), Phase 07 (`search.ts`).

**Migração:**

_No existing files require refactor — Setup SI is the only application of this pattern in the current task._

**Verificação:**

- **Unit:** N/A (barrel has no logic to unit-test).
- **Integration:** N/A at foundation — first real handler/test pair arrives with Phase 02 (auth signup integration test).
- **Regression guards:** `docker compose exec next-frontend npx tsc --noEmit` exits clean after the barrel + seed are created (the empty `handlers` array typechecks against MSW v2's `RequestHandler[]`).

#### next-frontend-msw-foundation/TD-02 — Node Test Handlers vs. Browser Dev Handlers

**Pattern:** Foundation wires test-only `setupServer` (from `msw/node`) at `mocks/server.ts`. The browser worker (`setupWorker` from `msw/browser`) is **deferred** — `public/mockServiceWorker.js` is NOT generated; `mocks/browser.ts` does NOT exist. Adding browser interception later is additive (non-breaking) once a real FE-offline-dev consumer appears (Storybook, design-system playground, FE-team sprint without backend).

**Setup:** Canonical `mocks/server.ts` shape — single source for the Vitest setupFile.

```ts
// next-frontend/mocks/server.ts
import { setupServer } from "msw/node";
import { handlers } from "./handlers";
export const server = setupServer(...handlers);
```

**Aplicação:** logic-only — applies to every Vitest integration test under `next-frontend/app/api/**/__tests__/*.integration.test.ts` (BFF Route Handler test pattern from `next-frontend/CLAUDE.md` § Testing). The browser worker is intentionally absent — Client Components developed in foundation/Phase 02 do not have FE-offline mocking. A future phase that needs browser-side mocks supersedes this TD with the `mocks/browser.ts` + `public/mockServiceWorker.js` additive set.

**Migração:**

_No existing files require refactor — Setup SI is the only application of this pattern in the current task._

**Verificação:**

- **Unit:** N/A.
- **Integration:** the first integration test authored by Phase 02 exercises the wiring end-to-end — Vitest loads `mocks/setup.ts`, which calls `server.listen()`, which intercepts the `fetch` issued by the imported Route Handler when it calls `${env.API_URL}/auth/signup`.
- **Regression guards:** `next-frontend/public/` does NOT contain `mockServiceWorker.js` after this task completes — that file is the signal that browser mocking has been wired; its absence is the signal that Option A holds. Add a CI grep or pre-commit assertion if drift is a concern.

#### next-frontend-msw-foundation/TD-03 — Response Builders / Factory Pattern (with or without faker-js)

**Pattern:** Hand-written deterministic factories under `mocks/factories/<domain>.ts` are the default — every shape gets a `buildX(overrides?: Partial<X>): X` function that composes a hand-coded `baseX: X` literal with the caller's overrides. `@faker-js/faker` is **opt-in** and **scoped to bulk-collection builders only** (e.g., `buildVideoList(n, seed)`); when used, `faker.seed(N)` is called **immediately before** generating the collection so determinism is local to that builder and does not interact with the global cursor. Faker is NOT installed at foundation — first bulk builder triggers the install.

**Setup:** Canonical factory shape — hand-written deterministic default + scoped seeded faker pattern (commented; not active at foundation).

```ts
// next-frontend/mocks/factories/<domain>.ts  (example shape; first real factory authored by Phase 02)
import type { User } from "@/lib/api/contracts";

const baseUser: User = {
  id: "user-1",
  email: "alice@example.com",
  channelSlug: "alice",
  confirmedAt: "2026-05-01T00:00:00Z",
  createdAt: "2026-04-01T00:00:00Z",
  // mirror User from `@/lib/api/contracts` verbatim
};
export const buildUser = (overrides: Partial<User> = {}): User => ({
  ...baseUser,
  ...overrides,
});

// Opt-in seeded faker — only when bulk lists matter (NOT installed at foundation):
// import { faker } from "@faker-js/faker";
// export const buildUserList = (n: number, seed = 42): User[] => {
//   faker.seed(seed);  // local seed — does NOT affect any other factory's cursor
//   return Array.from({ length: n }, (_, i) =>
//     buildUser({ id: `user-${i + 1}`, email: faker.internet.email() }));
// };
```

**Aplicação:** logic-only — applies to every shape that future-phase tests author overrides for. Foundation creates `mocks/factories/` as a directory with a `.gitkeep` placeholder (no `_seed.ts` here — factories are typed against `@/lib/api/contracts`, which itself is empty at foundation, so no fake-content file is needed). `@faker-js/faker` is NOT added to `next-frontend/package.json` `devDependencies` at this task — it is installed by the first phase whose tests author a `buildXList` bulk builder.

**Migração:**

_No existing files require refactor — Setup SI is the only application of this pattern in the current task._

**Verificação:**

- **Unit:** N/A at foundation (no factory exists yet).
- **Integration:** Phase 02's first auth test exercises the first factory (e.g., `buildUser({ confirmedAt: null })` for the unconfirmed-user case) and proves the shape — the override pattern works, the default has the right contract shape (typechecks against `@/lib/api/contracts → User`), and the test reads as intent.
- **Regression guards:** `next-frontend/package.json` `devDependencies` does NOT include `@faker-js/faker` after this task completes — confirms the opt-in deferral.

#### next-frontend-msw-foundation/TD-04 — How Each Phase's Tests Consume the Handler Set

**Pattern:** Universal handler set loaded into a single `setupServer(...handlers)` at suite startup via Vitest's `setupFiles`. Per-test deviation uses `server.use(...)` (MSW's canonical override recipe). `afterEach(() => server.resetHandlers())` keeps tests isolated. `server.listen({ onUnhandledRequest: "error" })` makes any unintercepted `fetch` throw — phase-only scoping is enforced by the **URLs each test actually fetches**, not by the loaded handler set. The phase boundary lives at the **authoring** layer (TD-01's per-domain files), not at the runtime layer.

**Setup:** Canonical Vitest setupFile + `vitest.config.ts` registration.

```ts
// next-frontend/mocks/setup.ts
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

```ts
// next-frontend/vitest.config.ts (relevant excerpt — node environment for BFF integration tests; component tests opt into jsdom per file)
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./mocks/setup.ts"],
  },
});
```

**Aplicação:** logic-only — applies to every `*.integration.test.ts` under `next-frontend/app/api/**/__tests__/` (BFF Route Handler test pattern). Per-test overrides via `server.use(http.METHOD(...))` are the documented mechanism for happy-path/error-path scenario switching; `afterEach`'s `server.resetHandlers()` guarantees overrides do not leak. Unit `*.test.ts` files (component / hook / util tests) inherit the same global `setupFiles` registration; whether they exercise MSW depends on whether they `fetch` — unintercepted fetches fail loudly because of `onUnhandledRequest: "error"`.

**Migração:**

_No existing files require refactor — Setup SI is the only application of this pattern in the current task._

**Verificação:**

- **Unit:** N/A at foundation.
- **Integration:** the first integration test authored by Phase 02 must (a) call the imported Route Handler, (b) observe that `server.listen({ onUnhandledRequest: "error" })` was applied — any accidentally-unhandled `fetch` fails the test loudly with `"request unhandled"`, (c) reset between tests — a `server.use(...)` override in test 1 does not leak into test 2 (provable by writing two tests where test 1 overrides and test 2 expects the default fixture).
- **E2E:** N/A — MSW does not run under Playwright in this project (per `next-frontend/CLAUDE.md` § Testing — Playwright drives the running app against whichever upstream the running environment is wired to).
- **Regression guards:** `docker compose exec next-frontend npm test` (once Phase 02 adds tests) exits clean with no `onUnhandledRequest` warnings logged by MSW.

---

<!-- phase-a-complete -->

## Dependency Map

```
SI-1 (root — install deps)
└── SI-2 — depends on SI-1 (msw types needed to type the handlers array)
    └── SI-3 — depends on SI-2 (server.ts imports `handlers` from the barrel created in SI-2)
        └── SI-4 — depends on SI-3 (rule documents the structure that now exists on disk — not a speculative spec)
            └── SI-5 — depends on SI-4 (CLAUDE.md points to the rule; rule must reflect post-bootstrap reality before CLAUDE.md cites it)
```

Strict linear chain — each SI builds on the previous. No parallel roots.

---

## Deliverables

- [ ] SI-1 — Instalar MSW + Vitest e dependências de teste
- [ ] SI-2 — Criar a árvore `mocks/handlers/` + barrel + seed + diretório `mocks/factories/`
- [ ] SI-3 — Wire MSW na lifecycle do Vitest (`mocks/server.ts` + `mocks/setup.ts` + `vitest.config.ts`)
- [ ] SI-4 — Atualizar `.claude/rules/next-frontend-msw-mocks.md` para refletir a estrutura decidida
- [ ] SI-5 — Atualizar `next-frontend/CLAUDE.md § Testing → Status` para refletir bootstrap concluído

**Full test suites:**

- [ ] Frontend tests pass (`docker compose exec next-frontend npm test`) — exit 0 com "0 test files / 0 tests" ao final desta task (primeiros testes reais chegam em Phase 02).
- [ ] Type/compilation checks pass (`docker compose exec next-frontend npx tsc --noEmit`) — exit 0 com a árvore `mocks/` + `vitest.config.ts` em disco.
- [ ] Lint passes (`docker compose exec next-frontend npm run lint`) — exit 0 (a árvore `mocks/` segue a configuração ESLint já wired do `next-frontend`).
