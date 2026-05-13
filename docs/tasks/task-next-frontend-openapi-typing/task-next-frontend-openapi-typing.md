---
kind: task
name: task-next-frontend-openapi-typing
test_specs_aware: true
sources_mtime:
  docs/tasks/task-next-frontend-openapi-typing/context.md: "2026-05-13T15:46:56-03:00"
  docs/tasks/task-next-frontend-openapi-typing/library-refs.md: "2026-05-13T15:46:29-03:00"
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-05-13T15:43:57-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-05-12T16:17:52-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-05-13T15:23:15-03:00"
  docs/phases/phase-02-auth/context.md: "2026-05-12T14:01:10-03:00"
  .claude/skills/testing-guide-next-frontend/SKILL.md: "2026-05-13T10:59:26-03:00"
---

# Task — next-frontend OpenAPI Typing

## Objective

> How next-frontend consumes the openapi.json artifact produced by nestjs-project (openapi-docs-nestjs/TD-02, Option C): how the spec is brought into next-frontend's filesystem boundary under Docker bind-mount isolation, codegen tooling, when codegen runs and whether output is committed, how types are shared between the BFF Route Handlers (upstream → Nest) and the Components layer (browser → same-origin BFF), and how MSW handlers in the BFF integration tests reuse the same schema.

---

## Step Implementations

### SI-1 — Spec sourcing under Docker isolation (Setup)

**Frontend Runtime spec:** see `## Technical Specifications` → `### Frontend Runtime` → `#### next-frontend-openapi-typing/TD-02 — Spec Sourcing Under Docker Bind-Mount Isolation`

**Description:** Materializa o copy local de `openapi.json` dentro de `next-frontend/` para que codegen rodando no container leia `./openapi.json` (resolvido sob `/home/node/app`). O script de sync vive na raiz do repo e roda no host — não dentro de container algum, pois o monorepo inteiro só é visível do host (per `next-frontend-openapi-typing/TD-02`).

**Technical actions:**

1. Criar `scripts/sync-openapi.sh` (executável: `chmod +x`) byte-verbatim do snippet em `### Frontend Runtime → #### next-frontend-openapi-typing/TD-02 → Setup` — copia `nestjs-project/openapi.json` para `next-frontend/openapi.json`.
2. Rodar o script uma vez do repo-root no host: `bash scripts/sync-openapi.sh` para materializar `next-frontend/openapi.json` inicial.
3. Commitar `scripts/sync-openapi.sh` + `next-frontend/openapi.json` no mesmo change (a paridade entre os dois committed copies é load-bearing para TD-03 funcionar).

**Dependencies:** —

**Tests:** _(empty — Setup SI; smoke-gated by AC; behavior tests live in Migration + Verification SIs)_

**Acceptance criteria:**

- `scripts/sync-openapi.sh` existe na raiz do repo, é executável (`test -x scripts/sync-openapi.sh`), e seu conteúdo bate byte-a-byte com o snippet em `### Frontend Runtime → #### next-frontend-openapi-typing/TD-02 → Setup`.
- Rodar `bash scripts/sync-openapi.sh` no host produz `next-frontend/openapi.json` byte-idêntico a `nestjs-project/openapi.json` (verificável por `diff -q nestjs-project/openapi.json next-frontend/openapi.json` → exit 0).
- Tanto `scripts/sync-openapi.sh` quanto `next-frontend/openapi.json` estão committed no repo no mesmo PR/commit do bootstrap.

---

### SI-2 — Codegen pipeline: install openapi-typescript + npm script + first generation (Setup of TD-03 phase 1)

**Frontend Runtime spec:** see `## Technical Specifications` → `### Frontend Runtime` → `#### next-frontend-openapi-typing/TD-03 — Codegen Execution Timing & Output Commit Policy`

**Description:** Estabelece o pipeline de codegen completo: instala `openapi-typescript` como dev-dep, adiciona o npm script canônico, gera `lib/api/types.gen.ts` a partir de `next-frontend/openapi.json` (do SI-1) e commita o artefato. CI freshness check sai num SI separado (SI-5) para não estourar a action cap.

**Technical actions:**

1. Dentro do container `next-frontend`, rodar `npm install -D openapi-typescript` (per `**Libraries:**` em `next-frontend-openapi-typing/TD-01`; versão pinada per `docs/tasks/task-next-frontend-openapi-typing/library-refs.md` — `^7.x`).
2. Adicionar `"openapi:types": "openapi-typescript ./openapi.json -o ./lib/api/types.gen.ts"` aos `scripts` de `next-frontend/package.json` byte-verbatim do snippet em `### Frontend Runtime → #### next-frontend-openapi-typing/TD-03 → Setup`.
3. Rodar `docker compose exec next-frontend npm run openapi:types` para gerar `next-frontend/lib/api/types.gen.ts` a partir do `openapi.json` committed em SI-1.
4. Commitar `next-frontend/package.json`, `next-frontend/package-lock.json` e `next-frontend/lib/api/types.gen.ts`. **`.gitignore` NÃO deve excluir `lib/api/types.gen.ts`** — o arquivo gerado é committed by design (per TD-03 Option C).

**Dependencies:** SI-1 (requires `next-frontend/openapi.json` committed)

**Tests:** _(empty — Setup SI; smoke-gated by AC; behavior tests live in Migration + Verification SIs)_

**Acceptance criteria:**

- `next-frontend/package.json` lista `openapi-typescript` em `devDependencies` com a versão pinada per `library-refs.md` (`^7.x` ou major-compatible).
- `next-frontend/package.json` `scripts` contém a entrada `openapi:types` byte-verbatim do snippet em `### Frontend Runtime → #### next-frontend-openapi-typing/TD-03 → Setup`.
- `next-frontend/lib/api/types.gen.ts` existe e exporta `paths` (verificável por `grep -E '^export (interface|type) paths' next-frontend/lib/api/types.gen.ts` → match).
- Re-rodar `docker compose exec next-frontend npm run openapi:types` produz zero diff em `next-frontend/lib/api/types.gen.ts` (idempotência do codegen).
- Os três arquivos (`package.json`, `package-lock.json`, `lib/api/types.gen.ts`) estão committed.

---

### SI-3 — Typed upstream client (Setup of TD-01)

**Frontend Runtime spec:** see `## Technical Specifications` → `### Frontend Runtime` → `#### next-frontend-openapi-typing/TD-01 — OpenAPI Codegen Tooling`

**Description:** Instala `openapi-fetch` (runtime-dep) e autora o módulo server-only `lib/api/upstream.ts` que instancia o cliente HTTP tipado contra `paths` de `types.gen.ts`. Sob o BFF estrito do `next-frontend-config-base/TD-03`, este cliente só pode ser importado em código server-side; `import "server-only"` é a guarda que falha o build se um Client Component tentar consumi-lo.

**Technical actions:**

1. Dentro do container `next-frontend`, rodar `npm install openapi-fetch` (per `**Libraries:**` em `next-frontend-openapi-typing/TD-01`; versão pinada per `library-refs.md` — `^0.13.x`).
2. Autorar `next-frontend/lib/api/upstream.ts` byte-verbatim no F2-load-bearing do snippet em `### Frontend Runtime → #### next-frontend-openapi-typing/TD-01 — OpenAPI Codegen Tooling → Setup` (`import "server-only";`, `createClient<paths>({ baseUrl: env.API_URL })`, export `upstream`). Imports de `openapi-fetch`, `./types.gen` e `@/lib/env` são derivable — implementer adiciona sem cobertura F2.
3. Verificar dentro do container: `docker compose exec next-frontend npx tsc --noEmit` exit 0.
4. Commitar `next-frontend/package.json`, `next-frontend/package-lock.json` e `next-frontend/lib/api/upstream.ts`.

**Dependencies:** SI-2 (requires `next-frontend/lib/api/types.gen.ts` to typecheck the `createClient<paths>` instantiation)

**Tests:** _(empty — Setup SI; smoke-gated by AC; behavior tests live in Migration + Verification SIs)_

**Acceptance criteria:**

- `next-frontend/package.json` lista `openapi-fetch` em `dependencies` com a versão pinada per `library-refs.md`.
- `next-frontend/lib/api/upstream.ts` começa com a linha `import "server-only";` e exporta um símbolo `upstream` cuja inferência de tipo TypeScript resolve para `Client<paths>` (verificável por `tsc --noEmit` e por inspeção do hover-info no IDE).
- Os tokens F2-load-bearing do snippet (`createClient<paths>`, `baseUrl: env.API_URL`, `import "server-only"`) aparecem byte-verbatim em `lib/api/upstream.ts`.
- `docker compose exec next-frontend npx tsc --noEmit` exit 0 com o módulo no codebase.

---

### SI-4 — Contracts barrel (Setup of TD-04)

**Frontend Runtime spec:** see `## Technical Specifications` → `### Frontend Runtime` → `#### next-frontend-openapi-typing/TD-04 — Type Sharing Between BFF Layer and Components Layer`

**Description:** Cria `next-frontend/lib/api/contracts.ts` como o **único** ponto autorizado a importar `paths` de `types.gen.ts`. O arquivo nasce sem aliases — feature SIs futuros (em fases que tocam o BFF) anexam aliases conforme os endpoints aparecem. A convenção pass-through-by-default (`type Video = paths["/videos/{id}"]...`) e a forma reshape (`type VideoCard = Pick<Video, ...>`) ficam documentadas in-file via comentário.

**Technical actions:**

1. Autorar `next-frontend/lib/api/contracts.ts` com: (a) `import type { paths } from "./types.gen";` no topo; (b) bloco de comentário multi-linha descrevendo a convenção (pass-through alias indexa `paths["/route"]["method"]["responses"][status]["content"]["application/json"]`; reshape alias usa `Pick`/`Omit`/composição); (c) zero `export type` ainda — barril vazio pronto pra crescer. Estrutura segue o F2-load-bearing do snippet em `### Frontend Runtime → #### next-frontend-openapi-typing/TD-04 — Type Sharing Between BFF Layer and Components Layer → Setup`.
2. Verificar dentro do container: `docker compose exec next-frontend npx tsc --noEmit` exit 0.
3. Commitar `next-frontend/lib/api/contracts.ts`.

**Dependencies:** SI-2 (requires `next-frontend/lib/api/types.gen.ts` existence so `import type { paths } from "./types.gen"` resolves)

**Tests:** _(empty — Setup SI; smoke-gated by AC; behavior tests live in Migration + Verification SIs)_

**Acceptance criteria:**

- `next-frontend/lib/api/contracts.ts` existe e começa (após o comentário de cabeçalho opcional) com `import type { paths } from "./types.gen";`.
- O arquivo NÃO exporta nenhum alias ainda — `grep -c '^export type' next-frontend/lib/api/contracts.ts` retorna `0` (a primeira feature SI futura é quem adiciona o primeiro alias).
- O bloco de comentário descreve a convenção dual (pass-through alias keyed em `paths[...]` vs reshape alias via `Pick`/`Omit`).
- `docker compose exec next-frontend npx tsc --noEmit` exit 0.

---

### SI-5 — CI freshness check workflow (Setup of TD-03 phase 2)

**Frontend Runtime spec:** see `## Technical Specifications` → `### Frontend Runtime` → `#### next-frontend-openapi-typing/TD-03 — Codegen Execution Timing & Output Commit Policy`

**Description:** Materializa o gate de drift: um workflow de CI que roda `bash scripts/sync-openapi.sh` + `npm run openapi:types` + `git diff --exit-code next-frontend/openapi.json next-frontend/lib/api/types.gen.ts`. Falha quando qualquer dos dois committed artifacts está stale. A mensagem de erro do step de diff aponta o developer pro one-liner remediation. Plataforma de CI segue convenção do repo (GitHub Actions / GitLab CI / etc. — implementer resolve no momento da execução).

**Technical actions:**

1. Autorar arquivo de workflow CI no caminho canônico do repo (e.g., `.github/workflows/openapi-freshness.yml` quando GitHub Actions é a plataforma; ajustar conforme infra existente). Conteúdo segue byte-verbatim no F2-load-bearing o snippet em `### Frontend Runtime → #### next-frontend-openapi-typing/TD-03 — Codegen Execution Timing & Output Commit Policy → Setup` (3 steps: sync → gen → diff).
2. Adicionar mensagem clara de remediation no step final (e.g., `Run: bash scripts/sync-openapi.sh && (cd next-frontend && npm run openapi:types) then commit`).
3. Commitar o workflow file.

**Dependencies:** SI-1 (workflow chama `scripts/sync-openapi.sh`), SI-2 (workflow chama `npm run openapi:types` e diff espera `lib/api/types.gen.ts` committed como baseline)

**Tests:** _(empty — Setup SI; smoke-gated by AC; behavior tests live in Migration + Verification SIs)_

**Acceptance criteria:**

- Existe um workflow file no caminho canônico de CI do repo contendo, em ordem, os três steps: `bash scripts/sync-openapi.sh`, `cd next-frontend && npm run openapi:types`, `git diff --exit-code next-frontend/openapi.json next-frontend/lib/api/types.gen.ts`.
- Em PR cujo `nestjs-project/openapi.json` permanece inalterado, o workflow exit 0 (no-drift baseline).
- Em PR que muta `nestjs-project/openapi.json` sem rodar sync + regen localmente, o workflow exit non-zero no step de diff e a mensagem aponta para o one-liner de remediation `bash scripts/sync-openapi.sh && (cd next-frontend && npm run openapi:types)`.

---

### SI-6 — MSW handler typing pattern documentation (Setup of TD-05)

**Frontend Runtime spec:** see `## Technical Specifications` → `### Frontend Runtime` → `#### next-frontend-openapi-typing/TD-05 — MSW Handler Typing Against the Generated Schema`

**Description:** TD-05 decide o padrão de tipagem mas NÃO bootstrap MSW em si (Vitest + `mocks/handlers.ts` + `mocks/server.ts` vivem na task separada `next-frontend-msw-foundation`). Este SI documenta o padrão em `next-frontend/CLAUDE.md § Testing` para que a task de bootstrap, quando aterrissar, adote a convenção `paths`-anchored byte-verbatim sem ter que rederivar a decisão.

**Technical actions:**

1. Editar `next-frontend/CLAUDE.md § Testing` para incluir uma sub-seção "MSW Handler Typing Convention" referenciando explicitamente `next-frontend-openapi-typing/TD-05` como a fonte da decisão.
2. Adicionar code-block exemplo na nova sub-seção do CLAUDE.md, byte-verbatim no F2-load-bearing do snippet em `### Frontend Runtime → #### next-frontend-openapi-typing/TD-05 — MSW Handler Typing Against the Generated Schema → Setup` (`import type { paths } from "@/lib/api/types.gen"`, `HttpResponse.json<paths[...]["responses"][200]["content"]["application/json"]>(...)`, URL composta a partir de `env.API_URL`).
3. Atualizar a sub-seção "Status — bootstrap pending" em `next-frontend/CLAUDE.md` para registrar que o padrão de tipagem está decidido (link cruzado para esta task) e que a task `next-frontend-msw-foundation` herda essa convenção quando rodar.

**Dependencies:** SI-3 (referencia `next-frontend/lib/api/upstream.ts` indiretamente — o snippet documentado importa `paths` de `lib/api/types.gen` que o SI-2 produziu), SI-4 (referencia `lib/api/contracts.ts` na convenção)

**Tests:** _(empty — Setup SI; smoke-gated by AC; behavior tests live in Migration + Verification SIs)_

**Acceptance criteria:**

- `next-frontend/CLAUDE.md § Testing` contém uma sub-seção (heading nível H3 ou bullet de seção) com título referenciando "MSW Handler Typing Convention" e cita explicitamente `next-frontend-openapi-typing/TD-05` como source-of-truth.
- O code-block na sub-seção contém os tokens F2-load-bearing do snippet (`import type { paths }`, `HttpResponse.json<paths[...]>`, URL via `env.API_URL`) byte-verbatim do `### Frontend Runtime → #### next-frontend-openapi-typing/TD-05 → Setup`.
- A sub-seção "Status — bootstrap pending" do CLAUDE.md menciona que a convenção de tipagem está decidida e referencia a task `next-frontend-msw-foundation` como owner da bootstrap.

---

## Technical Specifications

### Frontend Runtime

#### next-frontend-openapi-typing/TD-01 — OpenAPI Codegen Tooling

**Pattern:** Types-first OpenAPI consumption. `openapi-typescript` (CLI) emits a single `.d.ts` exporting a `paths` interface — pure types, zero runtime. `openapi-fetch` (~6KB typed wrapper) sits on top of `paths` and is consumed **only server-side** inside Route Handlers (the strict-BFF model from `next-frontend-config-base/TD-03` means the SDK surface is valueless in the browser). MSW handler fixtures, Route Handler request/response typing, and the consumer barrel (`lib/api/contracts.ts`, TD-04) all read from the same `paths` symbol — one source of truth for the wire shape.

**Setup:**

```ts
// next-frontend/lib/api/upstream.ts
import "server-only";
import createClient from "openapi-fetch";
import type { paths } from "./types.gen";
import { env } from "@/lib/env";

export const upstream = createClient<paths>({ baseUrl: env.API_URL });
```

`import "server-only"` (Next.js primitive) turns any Client Component import of this module into a build error — defense-in-depth on top of the BFF model. `env.API_URL` is the server-only key validated by `@t3-oss/env-nextjs` (inherited from `next-frontend-config-base/TD-03`).

**Aplicação:**

Logic-only phase — `## UI Inventory` is the `_Frontend-runtime only —` placeholder; no `### Server-connected Components` sub-block exists yet. The pattern applies to:

- Every Route Handler under `next-frontend/app/api/**/route.ts` that calls the upstream NestJS API — imports `upstream` from `@/lib/api/upstream` and calls `upstream.GET(...)` / `upstream.POST(...)` instead of raw `fetch(env.API_URL + ...)`.
- Every consumer of the generated `paths` type (the barrel `lib/api/contracts.ts`, the MSW handlers `mocks/handlers.ts`) — imports `type { paths } from "@/lib/api/types.gen"`.

Future UI surfaces inherit this constraint via `## Inherited Decisions Detail`; Components themselves do NOT import `openapi-fetch` (browser never calls the upstream).

**Migração:**

_No existing files require refactor — Setup SI is the only application of this pattern in the current phase._

**Verificação:**

- **Unit:** `npx tsc --noEmit` succeeds on `lib/api/upstream.ts` and every consumer of `paths`. Type errors here surface contract drift before runtime.
- **Integration:** `*.integration.test.ts` under `next-frontend/app/api/**/__tests__/` instantiates Route Handlers as functions and asserts on the typed `Response`; `msw/node` intercepts the `upstream.GET/POST` calls. Tests fail if a handler's request shape diverges from the `paths`-derived type.
- **E2E:** out-of-scope at this task (no UI surface).
- **Regression guards:** none (greenfield — no prior fetch sites exist).

#### next-frontend-openapi-typing/TD-02 — Spec Sourcing Under Docker Bind-Mount Isolation

**Pattern:** Committed local copy of the spec at `next-frontend/openapi.json`, kept in sync with the canonical producer at `nestjs-project/openapi.json` via a host-only sync script (`scripts/sync-openapi.sh`). The next-frontend Docker container only bind-mounts its own subproject (per `next-frontend/CLAUDE.md` § Development Environment), so codegen inside the container reads `./openapi.json` — which resolves under `/home/node/app` and points at the local copy. Compose-stack independence is preserved (neither subproject's compose file references the other); drift is prevented structurally by TD-03's CI freshness check.

**Setup:**

```bash
#!/usr/bin/env bash
# scripts/sync-openapi.sh — repo-root, runs on HOST (not in any container)
set -euo pipefail
cp nestjs-project/openapi.json next-frontend/openapi.json
echo "synced: nestjs-project/openapi.json → next-frontend/openapi.json"
```

Both `next-frontend/openapi.json` and `nestjs-project/openapi.json` are committed; the sync script keeps them byte-identical. The script runs on the host — codegen INSIDE the container reads `./openapi.json` (i.e., `/home/node/app/openapi.json`, the mounted local copy).

**Aplicação:**

Logic-only phase. The pattern applies to:

- Repo-root `scripts/sync-openapi.sh` (new file).
- `next-frontend/openapi.json` (new committed file — initially an exact copy of `nestjs-project/openapi.json`).
- Every developer workflow that touches the backend OpenAPI surface: edit a controller in `nestjs-project/` → regenerate `nestjs-project/openapi.json` via that subproject's existing script (`openapi-docs-nestjs/TD-02`) → run `bash scripts/sync-openapi.sh` from repo root → commit both files in the same PR.
- CI workflow (per TD-03) — runs the sync script as the first step of the freshness check.

**Migração:**

_No existing files require refactor — Setup SI is the only application of this pattern in the current phase._

**Verificação:**

- **Unit:** running `bash scripts/sync-openapi.sh` produces a `next-frontend/openapi.json` byte-identical to `nestjs-project/openapi.json` (verifiable via `diff -q`).
- **Integration:** TD-03's CI freshness check (see below) is the structural verifier — it asserts that any drift between the two files is caught.
- **E2E:** out-of-scope.
- **Regression guards:** none (greenfield).

#### next-frontend-openapi-typing/TD-03 — Codegen Execution Timing & Output Commit Policy

**Pattern:** Generated types (`next-frontend/lib/api/types.gen.ts`) are committed; an npm script `openapi:types` regenerates them on demand; a CI step runs the full sync+gen pipeline and `git diff --exit-code` over both `openapi.json` and `types.gen.ts`. Drift is impossible to merge: contract changes appear as PR diffs **and** are structurally prevented from going stale. Composes with TD-02 (the sync script is step 1 of the CI check).

**Setup:**

```json
// next-frontend/package.json (excerpt)
{
  "scripts": {
    "openapi:types": "openapi-typescript ./openapi.json -o ./lib/api/types.gen.ts"
  }
}
```

```yaml
# .github/workflows/ci.yml (excerpt — shape of the freshness check)
- name: Sync OpenAPI spec into next-frontend
  run: bash scripts/sync-openapi.sh
- name: Regenerate types from openapi.json
  working-directory: next-frontend
  run: npm run openapi:types
- name: Fail on drift
  run: git diff --exit-code next-frontend/openapi.json next-frontend/lib/api/types.gen.ts
```

The third step is the gate: any non-empty diff means the PR forgot to either sync (`openapi.json` stale) or regenerate (`types.gen.ts` stale). The error message MUST direct developers to `bash scripts/sync-openapi.sh && (cd next-frontend && npm run openapi:types)`.

**Aplicação:**

Logic-only phase. The pattern applies to:

- `next-frontend/package.json` — adds the `openapi:types` script.
- `next-frontend/lib/api/types.gen.ts` — committed generated file. NOT in `.gitignore`.
- CI workflow file (project's CI config — exact path / platform per repo conventions; the workflow does not exist yet so the SI that introduces it must be authored fresh).
- (Optional) `.husky/pre-commit` — same three-step check locally; deferred unless husky/lefthook is already in use elsewhere in the repo.

**Migração:**

_No existing files require refactor — Setup SI is the only application of this pattern in the current phase._

**Verificação:**

- **Unit:** running `npm run openapi:types` from inside the `next-frontend` container regenerates `lib/api/types.gen.ts` deterministically (same input ⇒ identical output).
- **Integration:** the CI freshness check itself IS the integration verifier — it fails on any drift; passing means the committed pair is current.
- **E2E:** out-of-scope.
- **Regression guards:** any future PR that edits `nestjs-project/openapi.json` without re-running the sync + codegen will fail the freshness check, preventing the merge.

#### next-frontend-openapi-typing/TD-04 — Type Sharing Between BFF Layer and Components Layer

**Pattern:** A single barrel file `next-frontend/lib/api/contracts.ts` re-exports type aliases for every shape the BFF exposes to its consumers. Pass-through routes export aliases directly from `paths[...]`; reshape routes export named projections (`Pick<...>`, `Omit<...>`, hand-written interfaces). **Both layers — Route Handlers AND Components — import from `@/lib/api/contracts`, never directly from `@/lib/api/types.gen` or from each other's files.** This is the single grep target for "what shape does the BFF expose"; reshapes are visible because their alias name does NOT index `paths`.

**Setup:**

```ts
// next-frontend/lib/api/contracts.ts
import type { paths } from "./types.gen";

// pass-through aliases — BFF returns NestJS shape as-is
export type Video = paths["/videos/{id}"]["get"]["responses"][200]["content"]["application/json"];
export type VideoList = paths["/videos"]["get"]["responses"][200]["content"]["application/json"];

// reshape aliases — BFF projects a subset (named ≠ paths[...])
export type VideoCard = Pick<Video, "id" | "title" | "thumbnailUrl">;
```

`lib/api/contracts.ts` is the **only** file in the project allowed to import `paths` from `lib/api/types.gen.ts`. Components and Route Handlers both import named aliases from `@/lib/api/contracts`.

**Aplicação:**

Logic-only phase. The pattern applies to:

- `next-frontend/lib/api/contracts.ts` — the barrel, initially empty (no aliases until the first feature SI introduces an endpoint).
- Every future Route Handler (`next-frontend/app/api/**/route.ts`) that returns typed JSON: types its `NextResponse.json<AliasName>(...)` return off an alias from `@/lib/api/contracts`.
- Every future Server / Client Component that consumes a BFF endpoint: imports the alias from `@/lib/api/contracts`, never from Route Handler modules.
- Future ESLint custom rule (deferred — not part of this task's SI): restrict `from "./types.gen"` / `from "@/lib/api/types.gen"` imports to `lib/api/contracts.ts` only.

**Migração:**

_No existing files require refactor — Setup SI is the only application of this pattern in the current phase._

**Verificação:**

- **Unit:** `npx tsc --noEmit` succeeds on `lib/api/contracts.ts` (and every consumer). Adding an alias for a non-existent `paths` key fails compile.
- **Integration:** Route Handler integration tests assert on response shapes derived from the alias; spec changes that break a contract surface as compile failures in `contracts.ts` (load-bearing path) before runtime.
- **E2E:** out-of-scope.
- **Regression guards:** none (greenfield).

#### next-frontend-openapi-typing/TD-05 — MSW Handler Typing Against the Generated Schema

**Pattern:** Hand-written MSW handlers in `mocks/handlers.ts` (and per-test `server.use(...)` overrides) type their fixture bodies via the same `paths` symbol that types the BFF's `openapi-fetch` client. The contract chain spec → `types.gen.ts` → `paths` → handler fixture is end-to-end typed; a stale fixture fails compile after `types.gen.ts` regenerates. Fixtures stay deterministic (no `faker`-randomized auto-generated handlers) so BFF integration tests can assert on specific values.

**Setup:**

```ts
// next-frontend/mocks/handlers.ts
import { http, HttpResponse } from "msw";
import type { paths } from "@/lib/api/types.gen";
import { env } from "@/lib/env";

type GetVideoOk = paths["/videos/{id}"]["get"]["responses"][200]["content"]["application/json"];

export const handlers = [
  http.get(`${env.API_URL}/videos/:id`, () =>
    HttpResponse.json<GetVideoOk>({ /* deterministic fixture body */ }),
  ),
];
```

```ts
// next-frontend/mocks/server.ts
import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);
```

The MSW `setupServer` instance is wired into Vitest `setupFiles` (`server.listen()` / `server.resetHandlers()` / `server.close()` per the bootstrap task, which is out-of-scope here — see `next-frontend/CLAUDE.md` § "Status — bootstrap pending").

**Aplicação:**

Logic-only phase. The pattern applies to:

- `next-frontend/mocks/handlers.ts` — bootstrap baseline (one handler per NestJS endpoint touched by the BFF; empty on day 1, grows feature-by-feature).
- `next-frontend/mocks/server.ts` — `setupServer` wiring (per MSW conventions).
- Every BFF integration test under `next-frontend/app/api/**/__tests__/*.integration.test.ts`: imports Route Handlers as functions, calls them with constructed `Request` objects, and asserts on the returned `Response`. Per-test overrides use `server.use(http.get(...))` typed off `paths[...]` (same anchor).
- URL composition in handlers: uses `${env.API_URL}/...` to match the value the BFF actually calls — the test runtime sets `API_URL` to whatever the test environment routes through.

**Migração:**

| File | Current behavior | Required change | Owning SI |
|------|-----------------|-----------------|-----------|
| (none) | MSW not yet wired; `mocks/handlers.ts` and `mocks/server.ts` do not exist | Author baseline `handlers.ts` (typed off `paths`) + `server.ts` (calls `setupServer(...handlers)`) | Owned by a separate bootstrap task — `next-frontend-msw-foundation` (identified during `/decide` triage 2026-05-13). |

The bootstrap of Vitest + MSW + the wiring of `setupFiles` is **out-of-scope** for this task; this task only locks the **typing pattern** (`paths`-anchored fixtures, no auto-generated handlers, no `faker`). The bootstrap task adopts the pattern when it lands.

**Verificação:**

- **Unit:** `npx tsc --noEmit` succeeds on `mocks/handlers.ts`. A stale fixture (e.g., upstream renamed a field) fails compile.
- **Integration:** BFF integration tests assert on specific values returned by the handlers / per-test overrides — deterministic by construction.
- **E2E:** out-of-scope (E2E tests don't use MSW per `next-frontend/CLAUDE.md` § Testing).
- **Regression guards:** every endpoint added to the BFF's `paths` index must have a corresponding hand-written handler (or per-test override) before the integration test for that route can run; the discipline is enforced by the test failing on missing handler ("request unhandled" from `msw/node`).

---

## Dependency Map

```
SI-1 (root: repo-root sync script + next-frontend/openapi.json)
└── SI-2 — depends on SI-1 (codegen reads ./openapi.json — must be committed)
    ├── SI-3 — depends on SI-2 (upstream.ts needs lib/api/types.gen.ts to typecheck)
    ├── SI-4 — depends on SI-2 (contracts.ts imports paths from lib/api/types.gen.ts)
    └── SI-5 — depends on SI-1 + SI-2 (CI workflow chains sync + gen + diff)
SI-6 — depends on SI-3 + SI-4 (MSW typing docs reference both lib/api/upstream.ts and lib/api/contracts.ts as canonical anchors)
```

---

## Deliverables

- [ ] SI-1 — Spec sourcing under Docker isolation (Setup)
- [ ] SI-2 — Codegen pipeline: install openapi-typescript + npm script + first generation
- [ ] SI-3 — Typed upstream client (`lib/api/upstream.ts`)
- [ ] SI-4 — Contracts barrel (`lib/api/contracts.ts`)
- [ ] SI-5 — CI freshness check workflow
- [ ] SI-6 — MSW handler typing pattern documentation in CLAUDE.md

**Full test suites:**

- [ ] Type-check passes (`docker compose exec next-frontend npx tsc --noEmit`) — primary gate; verifies `lib/api/upstream.ts` + `lib/api/contracts.ts` resolve against generated `paths`.
- [ ] Lint passes (`docker compose exec next-frontend npm run lint`).
- [ ] Production build passes (`docker compose exec next-frontend npm run build`) — verifies the `import "server-only"` boundary doesn't leak into client bundles.
- [ ] CI freshness check baseline (SI-5 workflow) passes on the merge commit — i.e., `git diff --exit-code next-frontend/openapi.json next-frontend/lib/api/types.gen.ts` returns 0 against the committed pair.
- Frontend Vitest + MSW test suite: **out-of-scope** for this task. The test runner / MSW server / setup-files bootstrap is owned by the separate `next-frontend-msw-foundation` task (per `next-frontend/CLAUDE.md` § "Status — bootstrap pending"); once that task lands, the suite gates the typing pattern this task established.
