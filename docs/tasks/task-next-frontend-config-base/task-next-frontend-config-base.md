---
kind: task
name: task-next-frontend-config-base
test_specs_aware: true
sources_mtime:
  docs/tasks/task-next-frontend-config-base/context.md: "2026-05-13T14:53:01-03:00"
  docs/tasks/task-next-frontend-config-base/library-refs.md: "2026-05-13T14:53:57-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-05-13T14:50:56-03:00"
  docs/decisions/technical-decisions-phase-01-configuracao-base.md: "2026-05-12T14:01:33-03:00"
---

# next-frontend Config Base — Env Validation Foundation

## Objective

Foundation for environment variable configuration and validation in the next-frontend subproject: validation library, server/client boundary enforcement strategy, and the initial canonical env-key contract for the FE↔BE bridge.

---

## Step Implementations

### SI-1 — Instalar deps e criar env loader

**Description:** Instalar `zod@^4.0.0` e `@t3-oss/env-nextjs@^0.13.0` como dependências runtime do `next-frontend`; criar `next-frontend/lib/env.ts` exportando o objeto `env` tipado via `createEnv()`; criar `next-frontend/.env.example` documentando o conjunto canônico de chaves (`API_URL` + `NODE_ENV`).

**Technical actions:**

1. Rodar `docker compose exec next-frontend npm install zod@^4.0.0 @t3-oss/env-nextjs@^0.13.0` (comandos npm sempre dentro do container per `next-frontend/CLAUDE.md` § "Commands")
2. Criar `next-frontend/lib/env.ts` exportando `env` via `createEnv({ server: { API_URL: z.url() }, client: {}, shared: { NODE_ENV: z.enum([...]) }, experimental__runtimeEnv: { NODE_ENV: process.env.NODE_ENV }, emptyStringAsUndefined: true })` (per `next-frontend-config-base/TD-02` Setup + `next-frontend-config-base/TD-01` idioms Zod 4 + `next-frontend-config-base/TD-03` chaves canônicas)
3. Criar `next-frontend/.env.example` documentando `API_URL` (server-only, formato URL, exemplo Docker comentado) e `NODE_ENV` (per `next-frontend-config-base/TD-03` Setup)
4. Rodar `docker compose exec next-frontend npx tsc --noEmit` para confirmar compilação OK

**Tests:** _(empty — Setup SI; smoke-gated by `npx tsc --noEmit` (action 4); validation behavior é built-in via `@t3-oss/env-nextjs` runtime e não tem branching lógico no projeto para asseverar.)_

**Dependencies:** none

**Acceptance criteria:**

- `next-frontend/package.json` declara `zod` e `@t3-oss/env-nextjs` em `dependencies`.
- `next-frontend/lib/env.ts` existe e exporta `env` como named export; o tipo é inferido pelo `createEnv` (sem `as` casts em consumers).
- `next-frontend/lib/env.ts` declara `server: { API_URL: z.url() }`, `client: {}`, `shared: { NODE_ENV: z.enum(["development", "production", "test"]) }`, `experimental__runtimeEnv: { NODE_ENV: process.env.NODE_ENV }`, e `emptyStringAsUndefined: true`.
- `next-frontend/.env.example` existe e documenta exatamente `API_URL` e `NODE_ENV` (nenhuma menção a `NEXT_PUBLIC_API_URL`).
- `docker compose exec next-frontend npx tsc --noEmit` termina com exit code 0.

---

### SI-2 — Atualizar next-frontend/CLAUDE.md para BFF estrito

**Description:** Reescrever a seção "Talking to the NestJS API" em `next-frontend/CLAUDE.md` para alinhar à decisão TD-03: remover a convenção planejada de `NEXT_PUBLIC_API_URL` e documentar o modelo BFF estrito — uma única chave `API_URL` server-only; browser fala com o backend apenas via Route Handlers same-origin.

**Technical actions:**

1. Editar `next-frontend/CLAUDE.md` § "Talking to the NestJS API" — substituir o parágrafo dual-key planejado pela convenção single-key strict BFF: somente `API_URL` (server-only) existe; clientes acessam o backend exclusivamente via Route Handlers (same-origin); remover a menção a `NEXT_PUBLIC_API_URL`; referenciar `next-frontend/lib/env.ts` como source-of-truth da leitura de env (per `next-frontend-config-base/TD-03` Migração)

**Tests:** _(empty — atualização documental; corretude validada por grep nos ACs.)_

**Dependencies:** SI-1 _(o env layer em `lib/env.ts` deve existir antes do CLAUDE.md referenciá-lo como source-of-truth canônico)_

**Acceptance criteria:**

- `grep -rn 'NEXT_PUBLIC_API_URL' next-frontend/` retorna zero matches após a edição.
- `next-frontend/CLAUDE.md` § "Talking to the NestJS API" cita `API_URL` como única chave de ambiente para o backend e referencia `next-frontend/lib/env.ts` como source-of-truth.
- A seção menciona explicitamente o modelo BFF estrito (Client Components → Route Handlers same-origin → NestJS) e remove qualquer referência a chamadas diretas do browser ao backend.

---

## Technical Specifications

### Frontend Runtime

#### next-frontend-config-base/TD-01 — Validation Library for Env Schema

**Pattern:** Three converging reasons: (1) **Type-inference matches the FE's strict-TS culture** — `lib/env.ts` exports a typed `env` object with no `as` casts, satisfying the project's "Type Safety" working principle. (2) **Ecosystem gravity in Next.js / React 19** — Zod is the de-facto schema language for App Router (Server Actions inputs, form resolvers, future contract validation), so introducing it once at the env layer compounds value for forms in Phase 02+. (3) **Direct enablement of TD-02 Option A (`@t3-oss/env-nextjs`)** — t3-env's first-citizen validator. Backend parity with Joi is not load-bearing: env schemas are not shared FE↔BE (different runtimes, different key sets); two validators across two subprojects is a bounded cost.

**Setup:** Zod 4 schemas are consumed by `createEnv()` (see TD-02). The Zod 4 idioms locked by this TD — used for every env value validation in this phase:

```ts
// idiom set — applied inside createEnv() schemas (TD-02)
z.url()                                        // top-level URL validator (NOT z.string().url() — deprecated in v4)
z.coerce.number().default(3000)                // string→number with fallback for empty .env entries
z.stringbool()                                 // env-style boolean parsing: "true"|"1"|"yes"|"on" → true
z.enum(["development", "production", "test"])  // fixed-value sets (e.g., NODE_ENV)
z.string().min(1)                              // non-empty server-side secret
```

Zod 4 moved string-format methods to top-level functions; `z.string().url()` from older blog posts is deprecated and MUST NOT be used.

**Aplicação:** logic-only — applies to the single `next-frontend/lib/env.ts` module (TD-02 instantiates `createEnv` with these schemas). Future phases reuse Zod 4 for `react-hook-form` resolvers, Server Action input validation, and any contract typing that lands later. No other module in this phase imports Zod directly.

**Migração:** _No existing files require refactor — Setup SI is the only application of this pattern in the current phase._

**Verificação:**

- **Unit:** `npx tsc --noEmit` exits 0 on `lib/env.ts` and any consumer files; consumers reference `env.X` without `as` casts (assertion via grep on consumer files: `as\s+[A-Z]` adjacent to `env\.` returns zero matches).
- **Integration:** N/A in this phase — Zod is exercised through TD-02's `createEnv` runtime; no isolated Zod test surface.
- **E2E:** N/A.
- **Regression guards:** none (greenfield — Zod has zero prior consumers in `next-frontend/`).

#### next-frontend-config-base/TD-02 — Server/Client Boundary Enforcement Strategy

**Pattern:** The only option that combines (i) **type-level NEXT_PUBLIC_ prefix enforcement**, (ii) **runtime Proxy-based leak detection**, and (iii) **single-file, single-import-path consumer ergonomics**. Option B reaches roughly the same _structural_ outcome at higher implementation and maintenance cost, with a weaker guarantee (no prefix enforcement, no proxy). Option C is unsafe at any non-trivial team size. The marginal cost over B is one ~3KB dep — well-spent for the strongest boundary among the three.

**Setup:** `next-frontend/lib/env.ts` exports a single typed `env` object via `createEnv({ server, client, shared, experimental__runtimeEnv, emptyStringAsUndefined })`. Next.js 16.2.6 is `>= 13.4.4`, so the `experimental__runtimeEnv` path applies (server vars auto-pulled from `process.env`; only client + shared listed in runtime).

```ts
// next-frontend/lib/env.ts
export const env = createEnv({
  server: { API_URL: z.url() },
  client: {},
  shared: { NODE_ENV: z.enum(["development", "production", "test"]) },
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
  },
  emptyStringAsUndefined: true,
});
```

Boundary guarantees locked by this snippet:

- Keys added to `client` MUST be prefixed with `NEXT_PUBLIC_` (TS compile error otherwise; currently empty per TD-03 strict BFF).
- Any client-bundle access to `server.API_URL` throws `"Attempted to access a server-side environment variable on the client"` (runtime Proxy).
- `emptyStringAsUndefined: true` normalizes empty `.env` entries to `undefined` so Zod `.default()` fires.

**Aplicação:** logic-only — `lib/env.ts` is the sole module that calls `createEnv`. Every consumer across the app imports the validated object via `import { env } from "@/lib/env"` regardless of context (RSC, Route Handler, Server Action, Client Component). Direct `process.env.X` reads in feature code are forbidden post-adoption — allowed only inside `lib/env.ts` itself and inside non-Next contexts that explicitly load env via `loadEnvConfig(process.cwd())` from `@next/env` (e.g., future Vitest setup files, codegen scripts).

**Migração:**

| File | Current behavior | Required change | Owning SI |
|------|-----------------|-----------------|-----------|
| _(none — `next-frontend/` has no current env consumers)_ | — | — | — |

_No existing files require refactor — Setup SI is the only application of this pattern in the current phase._

**Verificação:**

- **Unit:** `npx tsc --noEmit` exits 0 across `next-frontend/`. Type surface assertion: importing `env` from a `"use client"` module narrows the type — `env.API_URL` is NOT in the autocomplete suggestions on client modules (t3-env's type-level narrowing).
- **Integration:** N/A in this phase (no Route Handler / RSC exists yet to consume `env`). The first downstream phase that introduces a Route Handler consuming `env.API_URL` validates the runtime Proxy boundary via an `*.integration.test.ts` that imports the route handler and asserts the fetched URL contains the env value.
- **E2E:** N/A.
- **Regression guards:** none (greenfield — no prior env reading in `next-frontend/`).

#### next-frontend-config-base/TD-03 — API URL Key Strategy for the FE↔BE Bridge

**Pattern:** Aligned with the BFF testing strategy and architectural commitment already documented in `next-frontend/CLAUDE.md` (Route Handlers as the only NestJS caller; BFF tests stub `fetch` via MSW). Eliminates CORS, eliminates public exposure of the backend URL, and produces the smallest correct foundation. Option B's `NEXT_PUBLIC_API_URL` is a future-proofing concession with no current consumer — and adding a public key later is a non-breaking change, while removing one is breaking. Option C ties a foundational decision to infra work explicitly deferred elsewhere.

**Setup:** Exactly one server-only env key — `API_URL` — is the canonical backend address from the FE side. Client Components / browser bundles MUST NOT reference it (enforced structurally by TD-02's t3-env boundary). Server contexts (Route Handlers, Server Actions, RSC) consume it via `env.API_URL`.

```ts
// canonical key set locked by this TD (extends the server slot of TD-02's createEnv)
server: {
  API_URL: z.url(),    // e.g., http://nestjs-api:3000 (shared Compose net) or http://host.docker.internal:3000 (dev)
},
client: {},            // intentionally empty — NO public API URL key in this phase
shared: {
  NODE_ENV: z.enum(["development", "production", "test"]),
},
```

`.env.example` documents `API_URL` + `NODE_ENV` (no `NEXT_PUBLIC_API_URL` entry; absence is intentional and load-bearing for the strict BFF model).

The concrete _value_ of `API_URL` in dev (shared Compose network with `http://nestjs-api:3000` vs `http://host.docker.internal:3000`) is **out-of-scope for this TD** — that is a Docker-Compose-topology decision deferred to a future infra ad-hoc TD or Phase 02 pre-work.

**Aplicação:** logic-only — `API_URL` is consumed only inside `next-frontend/app/api/**/route.ts` files (BFF Route Handlers) and Server Actions / RSC that hit the backend directly. Client Components reaching the backend MUST go through a Route Handler at the same origin (the BFF model). No future phase may introduce a `NEXT_PUBLIC_API_URL` without revisiting this TD (Revision via `/decide` or Supersede via `/research`).

**Migração:**

| File | Current behavior | Required change | Owning SI |
|------|-----------------|-----------------|-----------|
| `next-frontend/CLAUDE.md` | The "Talking to the NestJS API" section names a planned `NEXT_PUBLIC_API_URL` (for client-side reads) alongside `API_URL` (server-side reads) | Rewrite the dual-key paragraph to the single-key strict-BFF model: only `API_URL` exists (server-only); browser hits the backend only via same-origin Route Handlers; remove the `NEXT_PUBLIC_API_URL` mention | SI-NN.M (Doc Update) |

**Verificação:**

- **Unit:** after the doc-update SI completes, `grep -rn 'NEXT_PUBLIC_API_URL' next-frontend/` returns zero matches (currently only `next-frontend/CLAUDE.md` mentions it; updating it is sufficient).
- **Integration:** the first downstream Route Handler that consumes `env.API_URL` has an `*.integration.test.ts` whose MSW handler intercepts `fetch` against the `${env.API_URL}/...` URL pattern — proves the key flows correctly from `.env` through t3-env through the handler.
- **E2E:** N/A in this phase (no Route Handler yet).
- **Regression guards:** none (greenfield).

---

<!-- phase-a-complete -->

## Dependency Map

SI-1 (root) — Instalar deps e criar env loader
└── SI-2 — depends on SI-1 (env layer em `lib/env.ts` existe antes do CLAUDE.md referenciá-lo como source-of-truth)

---

## Deliverables

- [ ] SI-1 — Instalar deps e criar env loader
- [ ] SI-2 — Atualizar `next-frontend/CLAUDE.md` para BFF estrito

**Full test suites:**

- [ ] Type/compilation check passes (`cd next-frontend && docker compose exec next-frontend npx tsc --noEmit`)
- [ ] Lint passes (`cd next-frontend && docker compose exec next-frontend npm run lint`)

_(Vitest / Playwright commands intentionally omitted — `next-frontend/CLAUDE.md` § "Status — bootstrap pending" documents that the test infra is not yet wired. Whether to wire it in this task or defer to a separate bootstrap task is a future scoping decision; this task introduces no testable artifacts that require Vitest, so the omission is non-load-bearing.)_
