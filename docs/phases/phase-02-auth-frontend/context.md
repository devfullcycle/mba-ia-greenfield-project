---
kind: phase
name: phase-02-auth-frontend
sources_mtime:
  docs/project-plan.md: "2026-05-12T13:48:56-03:00"
  docs/decisions/technical-decisions-phase-02-auth-frontend.md: "2026-05-14T11:03:30-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-05-13T15:23:15-03:00"
  docs/decisions/technical-decisions-next-frontend-msw-foundation.md: "2026-05-14T09:31:19-03:00"
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-05-13T19:51:13-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-05-12T16:17:52-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-05-12T14:01:06-03:00"
  .claude/skills/testing-guide-next-frontend/SKILL.md: "2026-05-13T10:59:26-03:00"
  docs/inventories/screen-inventory-phase-02-auth-frontend.md: "2026-05-14T10:00:23-03:00"
---

# phase-02-auth-frontend — Context

## Scope

**Phase name:** Cadastro, Login e Gerenciamento de Conta

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de envio de e-mails transacionais
- Cadastro de usuário com e-mail e senha
- Criação automática do canal do usuário a partir do prefixo do e-mail
- Confirmação de conta via e-mail com link de ativação
- Login e controle de sessão do usuário
- Logout
- Recuperação de senha: solicitação via e-mail → link com token → redefinição
- Telas de cadastro, login, confirmação de conta e recuperação de senha

**Out of scope:** _Not specified._

**Deliverables:** fluxo completo de cadastro → confirmação → login → recuperação de senha funcionando. Canal criado automaticamente para cada usuário.

**Affected subprojects:**

- `nestjs-project` — no specific note (in scope: cadastro/login/sessão, e-mails transacionais, criação automática de canal, tokens de confirmação e recuperação)
- `nextjs-project` — no specific note (in scope: telas de cadastro, login, confirmação de conta e recuperação de senha)

**Deferred subprojects:** _None._

**Sequencing notes:** Depende de: Fase 01.

**Neighbors (for boundary detection only):**

- **Phase 01:** Preparação de toda a fundação do projeto: repositório, ambiente de desenvolvimento, projetos Next.js e Nest.js, banco de dados PostgreSQL e serviços auxiliares.
- **Phase 03:** Upload e Processamento de Vídeos — Depende de: Fase 01, Fase 02.

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-02-auth-frontend/TD-01 | phase | Frontend | Authentication Orchestration Approach | decided | A (Custom BFF cookie-based session) | — |
| phase-02-auth-frontend/TD-02 | phase | Frontend | Session Cookie Strategy | decided | B (iron-session encrypted container) | iron-session |
| phase-02-auth-frontend/TD-03 | phase | Frontend | Token Refresh Orchestration | decided | A (Transparent BFF refresh on 401 w/ single-flight) | — |
| phase-02-auth-frontend/TD-04 | phase | Frontend | Form Library and Client-Side Validation | decided | A (react-hook-form + zod resolver) | react-hook-form, @hookform/resolvers |
| phase-02-auth-frontend/TD-05 | phase | Frontend | Mutation Submission Pathway | decided | A (Route Handler POST + client fetch) | — |
| phase-02-auth-frontend/TD-06 | phase | Frontend | Session State Propagation to Client Components | decided | A (Server-rendered session + RSC Context Provider) | — |
| phase-02-auth-frontend/TD-07 | phase | Frontend | Email-Link Landing Pattern | decided | A (RSC processes token; Client form for reset input) | — |

_Source files:_

- phase-02-auth-frontend — `docs/decisions/technical-decisions-phase-02-auth-frontend.md` (scope_type: phase, related_phases: [2])

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de envio de e-mails transacionais | — _(no TD yet — plan-validate will flag as MD)_ |
| Cadastro de usuário com e-mail e senha | phase-02-auth-frontend/TD-01, phase-02-auth-frontend/TD-05 |
| Criação automática do canal do usuário a partir do prefixo do e-mail | — _(no TD yet — plan-validate will flag as MD)_ |
| Confirmação de conta via e-mail com link de ativação | phase-02-auth-frontend/TD-07 |
| Login e controle de sessão do usuário | phase-02-auth-frontend/TD-01, phase-02-auth-frontend/TD-02, phase-02-auth-frontend/TD-03, phase-02-auth-frontend/TD-05, phase-02-auth-frontend/TD-06 |
| Logout | phase-02-auth-frontend/TD-01, phase-02-auth-frontend/TD-05 |
| Recuperação de senha: solicitação via e-mail → link com token → redefinição | phase-02-auth-frontend/TD-05, phase-02-auth-frontend/TD-07 |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | phase-02-auth-frontend/TD-01, phase-02-auth-frontend/TD-04 |

## Decisions Detail

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) **Architectural fit.** The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority — Auth.js's value (DB adapters, OAuth providers, magic-link, `getServerSession` helpers) is mostly unused in this configuration. (2) **Smaller blast radius.** A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern; a misconfigured Auth.js callback is a longer fault-isolation loop. (3) **Compatibility with Next.js 16 / React 19.** Built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use; Auth.js v5 versions track Next.js majors with a lag, adding compatibility risk that Option A does not have. Option C is rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive (loses RSC personalization).
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) **Defense in depth on the cookie content** — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection; the marginal cost is one ~3KB dep. (2) **Single cookie to manage** simplifies logout (one `session.destroy()` call) and avoids the orphan-cookie failure mode of Option A. (3) **Room to carry minimal user metadata** (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render the authenticated chrome (avatar, channel name) without a per-render `/auth/me` round-trip — Phase 04+ gains compound here. Option A is a viable downgrade if the team rejects `iron-session` for any reason; the migration A→B (or B→A) is a one-Route-Handler refactor with no test changes downstream because the BFF interface is unchanged. Option C is rejected: it solves a problem (server-side revocation) the project does not have at the cost of infrastructure the project does not own.
**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A (RSC still needs server-side refresh) — adopting B means doing both. Option C's pre-emptive timer is rejected because the failure modes (multiple tabs, sleep/wake) outweigh the latency saving and force a `"use client"` shell near the root.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) **Decoupled from TD-05** — works with Route Handlers OR Server Actions; the form code does not change if TD-05 is revisited later. (2) **Aligned with shadcn's canonical form primitive** — the project already commits to `radix-nova` shadcn (`components.json`); `npx shadcn@latest add form` produces react-hook-form wrappers; choosing react-hook-form means using the supported primitive instead of hand-rolling around it. (3) **Zod-first developer ergonomics match the rest of the FE foundation** — `next-frontend-config-base/TD-01` chose Zod 4 for env; the same schemas-as-source-of-truth pattern carries to forms with zero new validator paradigm. Option B is rejected for impedance with shadcn's primitive and for over-investing in progressive-enhancement that the strict-BFF model does not require. Option C is rejected for the per-field boilerplate and the loss of client-side feedback on a project that values quick, type-safe form iteration.
**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) **Strict-BFF alignment.** `next-frontend-config-base/TD-03` named Route Handlers as the BFF surface; Option A keeps every mutation visible under `app/api/**`. (2) **Test scaffold already exists** — `next-frontend/CLAUDE.md` § Testing and `next-frontend-msw-foundation` were authored for Route-Handlers-as-functions; Option A reuses them with zero invention. (3) **Single mutation surface** — Phase 02 sets the precedent for Phases 03–07; uniformity beats per-mutation idiom-picking when the cost of inconsistency compounds (Option C). Option B has real ergonomic appeal for the simplest forms but fragments the BFF surface and forces test-pattern reinvention; if the team later wants progressive enhancement for specific forms, the migration A→B is per-form and doesn't require touching unrelated routes — A is the safer default and the cheaper baseline.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) **No first-render flicker, no round-trip** — the session is delivered in the same response as the page HTML; the Client Provider hydrates with the correct initial state; users never see "Login" briefly turn into their avatar. (2) **No new BFF endpoint** — the cookie is the source of truth, RSC reads it, the Provider broadcasts it; the BFF surface stays minimal. The `router.refresh()` requirement after mid-session mutations is a small price (one line in the relevant mutation handler) for the structural benefits. Option B is rejected for the double-read-and-flicker; Option C is dominated by Option B and rejected.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) **First-paint-correct** — the user sees the right outcome on the first paint, no skeleton, no flicker. (2) **Single integration pattern across both flows** — confirmation is RSC-only; reset is RSC + Client form (TD-04, TD-05 patterns reused) — both share the "RSC owns the token, Client Component owns the input" split. (3) **Email-prefetch behavior** is solved at the backend's idempotent-confirmation level (a small note for `/plan-build` to confirm; not a separate TD). Option B's Route-Handler-as-link-target adds redirects for no clean gain. Option C is dominated.
**Libraries:** —

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.

**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.

**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.

**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### next-frontend-config-base/TD-01

**Recommendation:** **Option A (Zod 4)**. Three converging reasons: (1) **Type-inference matches the FE's strict-TS culture** — `lib/env.ts` exports a typed `env` object with no `as` casts, satisfying the project's "Type Safety" working principle. (2) **Ecosystem gravity in Next.js / React 19** — Zod is the de-facto schema language for App Router (Server Actions inputs, form resolvers, future contract validation), so introducing it once at the env layer compounds value for forms in Phase 02+. (3) **Direct enablement of TD-02 Option A (`@t3-oss/env-nextjs`)** — t3-env's first-citizen validator. Backend parity with Joi is not load-bearing: env schemas are not shared FE↔BE (different runtimes, different key sets); two validators across two subprojects is a bounded cost.

**Libraries:** zod

### next-frontend-config-base/TD-02

**Recommendation:** **Option A (`@t3-oss/env-nextjs`)**. The only option that combines (i) **type-level NEXT_PUBLIC_ prefix enforcement**, (ii) **runtime Proxy-based leak detection**, and (iii) **single-file, single-import-path consumer ergonomics**. Option B reaches roughly the same _structural_ outcome at higher implementation and maintenance cost, with a weaker guarantee (no prefix enforcement, no proxy). Option C is unsafe at any non-trivial team size. The marginal cost over B is one ~3KB dep — well-spent for the strongest boundary among the three.

**Libraries:** @t3-oss/env-nextjs

### next-frontend-config-base/TD-03

**Recommendation:** **Option A (Strict BFF — single server-only `API_URL`)**. Aligned with the BFF testing strategy and architectural commitment already documented in `next-frontend/CLAUDE.md` (Route Handlers as the only NestJS caller; BFF tests stub `fetch` via MSW). Eliminates CORS, eliminates public exposure of the backend URL, and produces the smallest correct foundation. Option B's `NEXT_PUBLIC_API_URL` is a future-proofing concession with no current consumer — and adding a public key later is a non-breaking change, while removing one is breaking. Option C ties a foundational decision to infra work explicitly deferred elsewhere. The Docker networking gap (how server-in-container resolves the backend) is a separate orthogonal decision, surfaced below.

**Libraries:** —

### next-frontend-msw-foundation/TD-01

**Recommendation:** **Option B (per-domain modules + barrel)**. Three reasons. (1) **MSW's own best-practice recommends it** — the project should not invent its own scheme when the official one is documented and matches the codebase's domain orientation. (2) **Domain ownership tracks the codebase**, not the project plan — `components/`, `app/api/`, and any future feature folders will be organized by domain (auth, videos, channels), so handler files mirror that vocabulary and remain stable as phases come and go. (3) **Append-only growth with minimal merge conflicts** — each phase touches a new file plus one line in the barrel, which is the smallest practical concurrent-PR footprint. Option A is acceptable through Phase 02 alone (~5–7 endpoints) but accumulates costs that B avoids from day one; bootstrapping directly into B costs one extra file and one barrel and pays off by Phase 03. Option C's phase coupling is rejected outright — domain-by-phase is a category error.

**Libraries:** —

### next-frontend-msw-foundation/TD-02

**Recommendation:** **Option A (test-only, `setupServer` only at the foundation)**. The browser worker is a future capability with no documented current consumer; wiring it now (Option B) is speculative investment, and wiring it incoherently (Option C) actively misleads developers into thinking interception works when it doesn't under strict BFF. Option A keeps the foundation minimal, aligns 1:1 with everything CLAUDE.md and the existing rules currently document, and is non-breaking to extend.

**Libraries:** —

### next-frontend-msw-foundation/TD-03

**Recommendation:** **Option D (hand-written defaults as the default + opt-in seeded faker for bulk collections)**. Reasons: (1) **Option B's determinism + readability is the right baseline** — every fixture in Phase 02 (5–7 endpoints, single-record-mostly) is naturally hand-written, and the diff-revealing override pattern is the highest-value benefit. (2) **Bulk-collection cases will arrive (Phase 07 home page grid, Phase 06 comment threads) and inline hand-written lists of 20+ items are genuinely tedious** — keeping faker available as a scoped tool is pragmatic. (3) **Per-fixture local seeding eliminates the global-cursor pitfall** that makes Option C structurally fragile — using `faker.seed(N)` immediately before a collection-builder run scopes the determinism to that fixture and isolates it from upstream changes to other factories.

**Libraries:** —

### next-frontend-msw-foundation/TD-04

**Recommendation:** **Option A (universal handler set + `server.use(...)` overrides + `onUnhandledRequest: "error"`)**. The user's "import only what it needs" requirement is satisfied at the *authoring* layer by TD-01 (per-domain files; each phase adds one file). At the *runtime* layer, loading all handlers is the canonical MSW v2 model and imposes no cost on tests that don't fetch the extra URLs. `onUnhandledRequest: "error"` enforces that a phase's test cannot accidentally invoke a route outside its scope (the fetch fails loudly with "no handler matched"), which is the strongest version of "stays inside its phase" available. Option B's per-suite composition pays real boilerplate cost for an explicitness gain that TD-01 already provides at a different layer. Option C invents a Vitest-projects-shaped problem for a phase-shaped concern.

**Libraries:** —

### next-frontend-openapi-typing/TD-01

**Recommendation:** **Option A (`openapi-typescript` + `openapi-fetch`)**. Three reinforcing reasons. (1) **Strict BFF makes the SDK surface valueless on the client.** Only Route Handlers ever call the upstream Nest; they already use `fetch` (Next 16's caching extensions sit on top of native `fetch`); a generated SDK adds a third client style to learn for zero functional gain. (2) **Types-first matches the rest of the FE foundation.** Env validation is Zod-derived types; component variants are `cva` types; both are TS-first with zero generated runtime. `paths` is the natural extension — one `.d.ts` file imported wherever the contract is touched. (3) **MSW typing is solved by the same `paths` symbol.** Hand-written handlers in `mocks/handlers.ts` type their resolver returns off `paths["/videos"]["get"]["responses"][200]`, giving the contract guarantee without orval/kubb's verbose generated handlers (which would be overridden per-test anyway). The marginal cost of adding `openapi-fetch` (~6KB, server-side only) is small enough that we recommend the **types + thin-client** pair, not types alone — `openapi-fetch` removes the `fetch(API_URL + path, { method, headers, body })` boilerplate in each Route Handler while staying within the BFF model. Options B/C/D may be revisited if (a) client-side data-fetching enters the stack with TanStack Query and per-endpoint hooks are wanted, or (b) the API grows beyond ~20 operations and per-call boilerplate becomes painful.

**Libraries:** openapi-typescript, openapi-fetch

### next-frontend-openapi-typing/TD-02

**Recommendation:** **Option B (committed local copy + repo-root sync script)**. Three reasons. (1) **Preserves the compose-stack independence** that `next-frontend-config-base/TD-03` Context calls out as the current architecture — neither subproject's compose file references the other. (2) **Drift is eliminated structurally when paired with TD-03's CI freshness check** — the check runs the sync script and asserts no diff on either `openapi.json` or `types.gen.ts`, so a backend PR that forgets to re-sync fails CI with a clear message. (3) **The committed local file is a real artifact in PR review** — reviewers see the contract change in `next-frontend/openapi.json`'s diff at the same time as the backend change, doubling the visibility (an `openapi.json`-only diff in a feature PR is a red flag for accidental drift). Option A is acceptable as a pre-CI fallback; Option C is rejected because the cross-stack file dependency in `docker-compose.yaml` introduces coupling that the current architecture explicitly avoids, and the "no drift" gain over B is small once TD-03 lands.

**Libraries:** —

### next-frontend-openapi-typing/TD-03

**Recommendation:** **Option C (committed + CI freshness check)**. It is the only option that makes contract drift _both_ visible (in PR diffs) _and_ impossible to merge accidentally (CI fail). The complexity premium over Option A is one CI step. Option B's "no committed artifacts" purity is poorly paid for in a monorepo where the cross-subproject build coupling becomes a real ergonomic cost, and it wastes the PR visibility that TD-02 Option B's committed `openapi.json` is specifically designed to deliver. Option A is acceptable as a temporary state until the CI pipeline lands; downgrading from C to A is reversible (just remove the CI step) but upgrading to C later requires explaining `types.gen.ts` history in a separate commit. Start at C. Apply the same script-and-check pattern to any future generated artifact (e.g., if `openapi-fetch` is wrapped, the wrapper file is hand-written; the only generated artifact remains `types.gen.ts`).

**Libraries:** —

### next-frontend-openapi-typing/TD-04

**Recommendation:** **Option A (single `lib/api/contracts.ts` with explicit aliases)**. It is the only option that (i) handles pass-through and reshape with the same mechanism, (ii) gives a single grep target for "what shape does the BFF expose", and (iii) decouples Component imports from App Router file paths (Components import `from "@/lib/api/contracts"`, not `from "@/app/api/videos/route"`). Option B is theoretically minimal but fragile against Next's actual RSC/Client/Route-Handler typing; Option C scatters the contract surface and creates drift opportunities. The "long file" concern is bounded — for the scope of StreamTube, the BFF will likely have <30 contract aliases at peak; sectioning by feature header comments is sufficient. Make `lib/api/contracts.ts` the only file that imports `paths` from `types.gen.ts` (lintable later); every other consumer imports from `contracts.ts`.

**Libraries:** —

### next-frontend-openapi-typing/TD-05

**Recommendation:** **Option A (hand-written, typed via `paths`)**. Reasons: (1) **Determinism over auto-generation** — BFF integration tests assert on specific values; randomized fixtures are anti-helpful. (2) **Coherence with TD-01 recommendation** — `openapi-typescript`'s `paths` type is the single contract anchor; reusing it in MSW handlers means "spec ↔ handler ↔ assertion" is one type chain. (3) **Scale fit** — Phase 02 introduces few endpoints; the manual cost is negligible at this stage. If the API grows to dozens of endpoints and authoring overhead becomes real, this TD can be superseded with a Kubb-or-hey-api MSW plugin without touching TD-01's `paths` import sites (the generator just produces additional handler files; the existing manual handlers stay valid). Option B locks the project into a heavier TD-01 choice for marginal mock-authoring savings; Option C is Option A with an unnecessary detour.

**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** **Option A (`@nestjs/swagger`)** — é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo. Nestia tem mérito técnico real mas o custo de migração do stack de validação inviabiliza-a sem uma decisão upstream de supersede de TD-06. Manual authoring é descartado.

**Libraries:** @nestjs/swagger

### openapi-docs-nestjs/TD-02

**Recommendation:** **Option C (Ambos)** — o custo marginal sobre Option A é apenas um npm script (~15 linhas) e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam. Option B sozinho pune a experiência de desenvolvimento em dev/local; Option A sozinho compromete o pipeline de codegen futuro. Combinar é dominante.

**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** **Option B (Apenas em dev/staging)** — alinha com a postura defensiva já estabelecida em phase 02 e não compromete consumidores legítimos (o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI"). Re-abrir como Option A ou C é trivial no futuro se um caso de uso de API pública aparecer.

**Libraries:** —

## Inherited Conventions

_No inherited conventions from prior phases._

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |

## UI Inventory

**Source:** `docs/inventories/screen-inventory-phase-02-auth-frontend.md`
**Screens in scope:** 3

### UI ↔ Capability Join

| Screen | Route | Verb | Capability | Covering Component |
|--------|-------|------|------------|-------------------|
| Tela de cadastro | /signup | Cadastrar novo usuário com e-mail e senha | "Cadastro de usuário com e-mail e senha" | SignupForm + SubmitButton |
| Tela de login | /login | Autenticar usuário com e-mail e senha e iniciar sessão | "Login e controle de sessão do usuário" | LoginForm + SubmitButton |
| Tela de solicitação de recuperação de senha | /forgot-password | Solicitar envio de e-mail com link de redefinição de senha | "Recuperação de senha: solicitação via e-mail → link com token → redefinição" | ForgotPasswordForm + SubmitButton |

### Server-connected Components

- `SignupForm` (Tela de cadastro) — `Reuse?: new`
- `SubmitButton` (Tela de cadastro) — `Reuse?: components/ui/button.tsx`
- `LoginForm` (Tela de login) — `Reuse?: new`
- `SubmitButton` (Tela de login) — `Reuse?: components/ui/button.tsx`
- `ForgotPasswordForm` (Tela de solicitação de recuperação de senha) — `Reuse?: new`
- `SubmitButton` (Tela de solicitação de recuperação de senha) — `Reuse?: components/ui/button.tsx`

### Open Questions from Inventory

- Capability "Confirmação de conta via e-mail com link de ativação" não tem tela inventariada — de-scoped pelo usuário em 2026-05-14 ("o restante não iremos implementar agora"). O fluxo end-to-end de cadastro depende desta tela para fechar (após signup → e-mail com link → tela de confirmação); precisará ser retomada em uma fase posterior. TD-07 (Email-Link Landing Pattern) prevê RSC processando o token server-side; recomenda-se gerar o inventory da tela antes de implementar.
- Capability "Logout" não tem UI inventariada nesta fase. A "tela" de logout é, na prática, um botão dentro do chrome autenticado (avatar/menu); seu local depende de fases posteriores que introduzam o chrome (provavelmente Fase 04 — "Painel de gerenciamento" / chrome autenticado). Confirmar com `plan-validate` se logout fica fora desta fase intencionalmente.
- Tela de redefinição de senha (set new password — destino do link enviado por e-mail) NÃO existe no Figma atual. A capability "Recuperação de senha…" só está parcialmente coberta; a etapa de redefinição precisa ser desenhada (novo node Figma) e inventariada antes do implement do fluxo completo. Até lá, `/forgot-password` envia o e-mail mas o destino do link é uma rota inexistente.
- Tela de signup: links "Terms of Service" e "Privacy Policy" (node 143:2439) apontam para rotas (`/terms`, `/privacy`) fora do escopo da Fase 02. Decidir se: (a) renderizar como links inertes/placeholders até as rotas existirem; (b) abrir issue para criar páginas estáticas mínimas; (c) outra estratégia.
- Tela de signup + Tela de login: nenhuma surface de erro/feedback de form-level (alert pós-submit, loading state, inline field errors) está presente no Figma. TD-04 + envelope `{ statusCode, error, message }` (phase-02-auth/TD-07) implicam que estados precisam ser exibidos. Decidir se: (a) inferir o design no implement seguindo padrão shadcn `FormMessage` + `Alert`; (b) solicitar variants de erro/loading ao designer antes do implement.
- Tela de forgot-password: AuthFooter exibe link "Sign up" no Figma, mas a UX usual numa tela de recuperação seria "Sign in" (voltar ao login). Confirmar com o designer qual link/texto é correto; alternativa: implementar como "Sign in" baseado em UX comum.
- Tela de forgot-password: estado de sucesso inline (após submit) não foi extraído como variant separada do Figma. O design precisa de uma variant de success-state OU o implement infere o estilo (caixa de confirmação dentro do mesmo Card).
- Componentes planejados-mas-não-existentes detectados (`Reuse?` com sufixo ` (new)`) e que servirão de gatilho para `phase-b.md` § B2.6 (bootstrap SI synthesis): `components/auth/signup-form.tsx`, `components/auth/login-form.tsx`, `components/auth/forgot-password-form.tsx`, `components/auth/back-link.tsx`, `components/auth/password-visibility-toggle.tsx`, `components/auth/password-strength-meter.tsx`, `components/auth/terms-checkbox.tsx`, `components/ui/checkbox.tsx`, `components/ui/icon-button.tsx`. Confirmar com `plan-build` que todos serão materializados nesta fase OU diferidos para fases posteriores conforme decisão.

## Non-UI / Deferred Capabilities

| Capability | Status | Rationale | TD refs |
|-----------|--------|-----------|---------|
| "Confirmação de conta via e-mail com link de ativação" | deferred | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. | phase-02-auth-frontend/TD-07 |
| "Logout" | deferred | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` (BFF route handler + `session.destroy()`) so the contract is ready when the chrome lands. | phase-02-auth-frontend/TD-01, phase-02-auth-frontend/TD-05 |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen via `/screen-inventory` extension run. Documented as a known gap. | phase-02-auth-frontend/TD-07 |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | a tela de confirmação da conta não será implementada nesta fase corrente, será adiada — the umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both are deferred per Non-UI rows above. The 3 ship-this-phase telas (signup, login, forgot-password) are inventoried and covered by their own verbs; the umbrella bullet itself is deferred to the phase that lands the missing screens. | phase-02-auth-frontend/TD-01, phase-02-auth-frontend/TD-04 |

## Testing Requirements

### next-frontend

| Artifact type | Required layers |
|---------------|-----------------|
| **Page** — sync RSC, no interaction | None at component level; cover only if part of a critical flow → `*.e2e-spec.ts` |
| **Page** — sync RSC composing client children | Test the client children directly; cover the rendered page via `*.e2e-spec.ts` |
| **Page** — async RSC (`async function Page()` with `await fetch`) | `*.e2e-spec.ts` only — Vitest cannot render it |
| **Layout** (`layout.tsx`) | None unless it adds logic (auth gate, conditional rendering); else covered via E2E |
| **Client component** (`"use client"`) with state/handlers | `*.test.ts` — render with RTL, mock `next/navigation` and `fetch` |
| **Feature component** (server, composes primitives, presentational) | Skip unit; cover via the page's E2E |
| **shadcn UI primitive** (`components/ui/*`) | None — trust the library; cover via consumers |
| **Icon** (`components/icons/*`) | None |
| **`lib/` utility** with branching | `*.test.ts` |
| **Custom hook** (`hooks/*`) | `*.test.ts` with `renderHook` from `@testing-library/react` |
| **Route handler** (`app/api/**/route.ts`) with branching | `*.test.ts` (pure logic) and/or `*.integration.test.ts` with MSW |
| **Route handler** (simple proxy to NestJS) | `*.integration.test.ts` with MSW only |
| **Server action** | `*.integration.test.ts` with MSW; E2E for the submit flow |
| **Middleware / error / loading / not-found / metadata** | See guide — depends on type |

### nestjs-project

_Out of slice scope: backend auth is settled in `phase-02-auth/TD-01..TD-10`; no backend change is implied by this slice. Testing requirements are inherited from that phase and do not need to be re-declared here._
