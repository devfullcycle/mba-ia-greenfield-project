---
kind: phase
name: phase-02-auth-frontend
test_specs_aware: true
sources_mtime:
  docs/phases/phase-02-auth-frontend/context.md: "2026-05-14T11:17:59-03:00"
  docs/phases/phase-02-auth-frontend/library-refs.md: "2026-05-14T11:07:24-03:00"
  docs/project-plan.md: "2026-05-12T13:48:56-03:00"
  docs/decisions/technical-decisions-phase-02-auth-frontend.md: "2026-05-14T11:03:30-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-05-13T15:23:15-03:00"
  docs/decisions/technical-decisions-next-frontend-msw-foundation.md: "2026-05-14T09:31:19-03:00"
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-05-13T19:51:13-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-05-12T16:17:52-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-05-12T14:01:06-03:00"
  docs/inventories/screen-inventory-phase-02-auth-frontend.md: "2026-05-14T10:00:23-03:00"
---

# Phase 02 — Cadastro, Login e Gerenciamento de Conta (Frontend Slice)

## Objective

Entregar o slice de frontend da Fase 02 — telas de cadastro, login e solicitação de recuperação de senha (`/signup`, `/login`, `/forgot-password`) com a camada BFF que as faz funcionar (Route Handlers sob `app/api/auth/**` que proxiam o NestJS, sessão por cookie iron-session encriptado, refresh transparente no 401, forms react-hook-form + Zod, propagação de sessão para Client Components via RSC) — de modo que o fluxo cadastro → login → solicitação de recuperação de senha funcione contra o backend de auth já consolidado em `phase-02-auth`.

---

## Step Implementations

### SI-02.0.1 — Infra: install batch shadcn primitives

**Description:** Instalar o shadcn primitive `checkbox` via CLI registry e commitar o arquivo gerado em `components/ui/`.

**Technical actions:**

1. Rodar `docker compose exec next-frontend npx shadcn@latest add checkbox` — gera `components/ui/checkbox.tsx`.
2. Commitar `components/ui/checkbox.tsx`.

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- `components/ui/checkbox.tsx` existe.
- Arquivo gerado compila per `docker compose exec next-frontend npx tsc --noEmit`.

---

### SI-02.0.2 — Tests shadcn batch (checkbox)

**Description:** Unit test para o shadcn primitive `checkbox` instalado em SI-02.0.1 — variants, a11y, data-slot, event handlers.

**Technical actions:**

1. Author `components/ui/__tests__/checkbox.test.tsx`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `checkbox.tsx` | Unit per testing-guide-next-frontend § "UI Primitives" — variants, a11y (`role`, `aria-checked`), `data-slot`, `onCheckedChange` | `components/ui/__tests__/checkbox.test.tsx` |

**Dependencies:** SI-02.0.1

**Acceptance criteria:**

- O teste cobre estados checked/unchecked/indeterminate, atributos ARIA e o handler `onCheckedChange`.
- Suite passa per `docker compose exec next-frontend npm test -- components/ui/__tests__/checkbox.test.tsx`.

---

### SI-02.0.3 — Custom-ui: icon-button.tsx

**Description:** Author `components/ui/icon-button.tsx` per UI Contract — primitive sob `components/ui/` não disponível no shadcn registry (usado como `arrow_back` na tela de forgot-password).

**Technical actions:**

1. Author `components/ui/icon-button.tsx` per UI Contract specs (botão icon-only acessível, baseado em `components/ui/button.tsx` + slot de ícone de `components/icons/`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `icon-button.tsx` | Unit per testing-guide-next-frontend § "UI Primitives" + custom-logic — variants, a11y (`aria-label` obrigatório), data-slot, `onClick` | `components/ui/__tests__/icon-button.test.tsx` |

**Dependencies:** none

**Acceptance criteria:**

- `components/ui/icon-button.tsx` existe e corresponde ao UI Contract (botão icon-only com `aria-label`).
- Unit test exercita variants + branch de a11y (falha/aviso quando `aria-label` ausente) + `onClick`.

---

### SI-02.0.4 — Custom-business simple group: back-link + forgot-password-form + login-form + password-strength-meter + signup-form

**Description:** Author os business components base sem lógica de scoring/estado complexa sinalizada nas Notes do inventory — esqueletos presentational/estruturais consumidos pelas telas; a lógica & wiring fina é aplicada nos respectivos SI-Xb.

**Technical actions:**

1. Author `components/auth/back-link.tsx` per UI Contract (link de navegação client-side via Next.js `<Link>`).
2. Author `components/auth/forgot-password-form.tsx` per UI Contract (Email field group + Button; shell do form, wiring em SI-02.12b).
3. Author `components/auth/login-form.tsx` per UI Contract (campos email/password + Button; shell do form, wiring em SI-02.11b).
4. Author `components/auth/password-strength-meter.tsx` per UI Contract (indicador derivado do input de senha client-side).
5. Author `components/auth/signup-form.tsx` per UI Contract (campos do cadastro + Button; shell do form, wiring em SI-02.10b).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `back-link.tsx` | Unit per testing-guide-next-frontend § "Client Components" — render + href | `components/auth/__tests__/back-link.test.tsx` |
| `forgot-password-form.tsx` | Unit per testing-guide-next-frontend § "Client Components" — render + props | `components/auth/__tests__/forgot-password-form.test.tsx` |
| `login-form.tsx` | Unit per testing-guide-next-frontend § "Client Components" — render + props | `components/auth/__tests__/login-form.test.tsx` |
| `password-strength-meter.tsx` | Unit per testing-guide-next-frontend § "Client Components" — render + reflexo do valor | `components/auth/__tests__/password-strength-meter.test.tsx` |
| `signup-form.tsx` | Unit per testing-guide-next-frontend § "Client Components" — render + props | `components/auth/__tests__/signup-form.test.tsx` |

**Dependencies:** none

**Acceptance criteria:**

- Cada componente existe no path declarado e corresponde ao seu UI Contract.
- Unit tests exercitam rendering + props de cada componente.
- Suite passa per `docker compose exec next-frontend npm test -- components/auth/__tests__`.

---

### SI-02.0.5 — Custom-business complex: password-visibility-toggle

**Description:** Author `components/auth/password-visibility-toggle.tsx` — business component com toggle state per Notes "Toggle de `type` password/text client-side".

**Technical actions:**

1. Author `components/auth/password-visibility-toggle.tsx` per UI Contract (botão que alterna o `type` do input password/text, controlado client-side).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `password-visibility-toggle.tsx` | Unit per testing-guide-next-frontend § "Client Components" baseline | `components/auth/__tests__/password-visibility-toggle.test.tsx` |
| `password-visibility-toggle.tsx` | Unit: toggle assertions per Notes signal ("Toggle de `type` password/text") | (same file) |

**Dependencies:** none

**Acceptance criteria:**

- `components/auth/password-visibility-toggle.tsx` existe e corresponde ao UI Contract.
- Unit tests cobrem rendering baseline + a transição de estado (clicar alterna `type` de `password` para `text` e de volta, com `aria-pressed`/`aria-label` coerentes).

---

### SI-02.0.6 — Custom-business complex: terms-checkbox

**Description:** Author `components/auth/terms-checkbox.tsx` — business component com estado local per Notes "Estado checkbox local; validado por Zod (TD-04)".

**Technical actions:**

1. Author `components/auth/terms-checkbox.tsx` per UI Contract (linha de checkbox de aceite dos termos + links inline; estado local, integrável ao react-hook-form do signup).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `terms-checkbox.tsx` | Unit per testing-guide-next-frontend § "Client Components" baseline | `components/auth/__tests__/terms-checkbox.test.tsx` |
| `terms-checkbox.tsx` | Unit: local-state assertions per Notes signal ("Estado checkbox local") | (same file) |

**Dependencies:** SI-02.0.1

**Acceptance criteria:**

- `components/auth/terms-checkbox.tsx` existe e corresponde ao UI Contract (consome `components/ui/checkbox.tsx`).
- Unit tests cobrem rendering baseline + transições do estado local de aceite (marcado/desmarcado) e exposição do valor para validação.

---

### SI-02.1 — Auth contract aliases em `lib/api/contracts.ts`

**Description:** Definir os aliases tipados do contrato auth que o BFF e os componentes consomem, derivados de `paths` (single grep target para "o que o BFF expõe").

**Technical actions:**

1. Criar/estender `lib/api/contracts.ts` — único arquivo que importa `paths` de `lib/api/types.gen.ts`; exportar aliases explícitos para `RegisterDto`, `LoginDto`, `ForgotPasswordDto`, as respostas `POST /auth/register` (`{ id, email }`), `POST /auth/login` (`{ access_token, refresh_token }`), e `ApiErrorEnvelope` (`{ statusCode, error, message, code }`) (per `next-frontend-openapi-typing/TD-04`; shapes per `### API Contracts` → BFF tier).
2. Garantir que nenhum outro consumidor importe `paths` diretamente — todos importam de `@/lib/api/contracts` (per `next-frontend-openapi-typing/TD-04`).

**Tests:** _(empty — type-only aliases; compile-gated por `npx tsc --noEmit`)_

**Dependencies:** none

**Acceptance criteria:**

- `lib/api/contracts.ts` exporta aliases para `RegisterDto`, `LoginDto`, `ForgotPasswordDto`, as respostas de register/login, e `ApiErrorEnvelope`.
- `docker compose exec next-frontend npx tsc --noEmit` sai com código 0 com os aliases em uso.

---

### SI-02.2 — Módulo de sessão iron-session (`lib/auth/session.ts`)

**Description:** Criar o helper de sessão por cookie encriptado — container único que carrega tokens + fingerprint mínimo do usuário, base do modelo strict-BFF cookie-based.

**Technical actions:**

1. Instalar `iron-session` (per `phase-02-auth-frontend/TD-02`; library-refs.md → seção iron-session).
2. Criar `lib/auth/session.ts` — `getSession()`/`setSession()`/`destroySession()` sobre `next/headers` `cookies()`, cookie `httpOnly` encriptado carregando `access_token` + `refresh_token` + `userId` + `email` + `channelSlug` (per `phase-02-auth-frontend/TD-02`); senha de sessão lida de `lib/env.ts` (per `next-frontend-config-base/TD-02`).
3. Expor a interface BFF do helper de modo que login/logout/refresh sejam um único `setSession`/`destroySession` (per `phase-02-auth-frontend/TD-01` — custom BFF cookie-based session; ~50-LOC, grep-friendly).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `lib/auth/session.ts` | Unit per testing-guide-next-frontend § "`lib/` utility" — set/get/destroy round-trip, ausência de cookie → sessão vazia | `lib/auth/__tests__/session.test.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `setSession` seguido de `getSession` devolve `userId`, `email`, `channelSlug` e os tokens; `destroySession` zera a sessão.
- `getSession` sem cookie presente retorna sessão vazia sem lançar.
- O cookie emitido é `httpOnly` e encriptado (conteúdo não legível em claro).

---

### SI-02.3 — Handlers MSW de auth (`mocks/handlers/auth.ts`)

**Description:** Adicionar o domain file MSW de auth com handlers tipados off `paths`, consumidos pelos testes de integração das Route Handlers BFF (Vitest) e pelo E2E server-side (instrumentation).

**Technical actions:**

1. Criar `mocks/handlers/auth.ts` — handlers para upstream `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/forgot-password`, `POST /auth/refresh`, tipados via os aliases de `@/lib/api/contracts` (per `next-frontend-openapi-typing/TD-05` — hand-written, typed via `paths`).
2. Registrar o módulo no barrel de handlers (um arquivo novo + uma linha no barrel) (per `next-frontend-msw-foundation/TD-01` — per-domain modules + barrel).
3. Embutir reserved trigger fixtures no handler set compartilhado: `email: "conflict@example.com"` → 409, `"badrequest@example.com"` → 400, senão sucesso (per `next-frontend/CLAUDE.md` § E2E architecture; fixtures determinísticas hand-written per `next-frontend-msw-foundation/TD-03`).

**Tests:** _(empty — MSW handler set é test-infra; exercitado pelos testes de integração de SI-02.5..SI-02.8 e pelo E2E)_

**Dependencies:** SI-02.1

**Acceptance criteria:**

- `mocks/handlers/auth.ts` exporta handlers para os 5 endpoints upstream de auth e está registrado no barrel.
- Os trigger fixtures (`conflict@example.com` → 409, `badrequest@example.com` → 400) produzem o status esperado; demais entradas retornam sucesso.
- Os tipos de retorno dos resolvers derivam de `@/lib/api/contracts` (sem DTO duplicado à mão).

---

### SI-02.4 — Helper de refresh de token single-flight (`lib/auth/refresh.ts`)

**Description:** Implementar o refresh transparente no BFF quando o upstream responde 401, com single-flight para deduplicar chamadas concorrentes.

**Technical actions:**

1. Criar `lib/auth/refresh.ts` — em upstream 401, chamar `POST /auth/refresh` com o `refresh_token` da sessão, re-selar a sessão com o novo par e reexecutar a chamada original (per `phase-02-auth-frontend/TD-03`).
2. Implementar single-flight: duas chamadas upstream interceptadas concorrentes disparam exatamente **um** refresh; ambas aguardam a mesma promise (per `phase-02-auth-frontend/TD-03` — desenhado no helper desde o dia 1).
3. Em falha do refresh (401/expirado/reusado em `POST /auth/refresh`), destruir a sessão e propagar 401 para o chamador (per `phase-02-auth-frontend/TD-03`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `lib/auth/refresh.ts` | Integration (MSW) per testing-guide-next-frontend § "Route handler/helper" — refresh em 401, single-flight (duas chamadas → um refresh), falha de refresh destrói sessão | `lib/auth/__tests__/refresh.integration.test.ts` |

**Dependencies:** SI-02.2, SI-02.3

**Acceptance criteria:**

- Uma chamada upstream que responde 401 dispara um refresh e a chamada original é reexecutada com o novo `access_token`.
- Duas chamadas upstream concorrentes que recebem 401 resultam em exatamente uma chamada a `POST /auth/refresh`.
- Refresh inválido/expirado destrói a sessão e o helper propaga 401 sem reexecutar.

---

### SI-02.5 — BFF Route Handler: POST /api/auth/signup

**Route:** POST /api/auth/signup
**API Contract:** see `## Technical Specifications` → `### API Contracts` → BFF tier → `#### POST /api/auth/signup`

**Description:** Route Handler same-origin que proxia o cadastro para o upstream NestJS, mantendo o modelo strict-BFF.

**Technical actions:**

1. Criar `app/api/auth/signup/route.ts` — `POST` que encaminha para `POST /auth/register` via `openapi-fetch` server-side lendo `env.API_URL` (per `phase-02-auth-frontend/TD-05` — Route Handler POST + client fetch; per `next-frontend-openapi-typing/TD-01`).
2. Tipar request/response pelos aliases de `@/lib/api/contracts` (`RegisterDto` → `{ id, email }`); 201 pass-through, **sem** cookie de sessão (per `### API Contracts` → BFF tier `#### POST /api/auth/signup`; per `phase-02-auth-frontend/TD-01`).
3. Repassar erros upstream verbatim no envelope `ApiErrorEnvelope`: 409 (e-mail já registrado) e 400 (validação) pass-through (per `### API Contracts` → BFF tier).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `app/api/auth/signup/route.ts` | Integration (MSW) per testing-guide-next-frontend § "Route handler (simple proxy)" — 201 pass-through; 409/400 pass-through; nenhum cookie setado | `app/api/auth/signup/__tests__/route.integration.test.ts` |

**Dependencies:** SI-02.1, SI-02.3

**Acceptance criteria:**

- `POST /api/auth/signup` com payload válido retorna `201` com `{ id, email }` e **não** seta cookie de sessão.
- `POST /api/auth/signup` com e-mail já registrado retorna `409` com o envelope `{ statusCode, error, message }` repassado do upstream.
- `POST /api/auth/signup` com corpo inválido retorna `400` com o envelope de validação repassado.

---

### SI-02.6 — BFF Route Handler: POST /api/auth/login

**Route:** POST /api/auth/login
**API Contract:** see `## Technical Specifications` → `### API Contracts` → BFF tier → `#### POST /api/auth/login`

**Description:** Route Handler de login que proxia o upstream, retira os tokens do corpo FE-facing e os sela no cookie iron-session.

**Technical actions:**

1. Criar `app/api/auth/login/route.ts` — `POST` que encaminha para `POST /auth/login` server-side via `openapi-fetch` (per `phase-02-auth-frontend/TD-05`; per `next-frontend-openapi-typing/TD-01`).
2. Em 200 upstream, **omitir** `access_token`/`refresh_token` do corpo FE-facing e selar a sessão via `setSession()` carregando tokens + `userId`/`email`/`channelSlug` (per `### API Contracts` → BFF tier `#### POST /api/auth/login`; per `phase-02-auth-frontend/TD-02`).
3. Repassar erros upstream verbatim: 401 (credenciais inválidas), 403 (e-mail não confirmado), 400 (validação) no envelope `ApiErrorEnvelope` (per `### API Contracts` → BFF tier).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `app/api/auth/login/route.ts` | Integration (MSW) per testing-guide-next-frontend § "Route handler" — corpo FE-facing sem tokens; `Set-Cookie` iron-session presente; 401/403/400 pass-through | `app/api/auth/login/__tests__/route.integration.test.ts` |

**Dependencies:** SI-02.1, SI-02.2, SI-02.3

**Acceptance criteria:**

- `POST /api/auth/login` com credenciais válidas retorna `200` cujo corpo **não** contém `access_token` nem `refresh_token` e responde com um cookie `iron-session` `httpOnly` setado.
- `POST /api/auth/login` com credenciais inválidas retorna `401` com o envelope upstream repassado e **sem** setar cookie.
- `POST /api/auth/login` com e-mail não confirmado retorna `403` com o envelope upstream repassado.

---

### SI-02.7 — BFF Route Handler: POST /api/auth/logout

**Route:** POST /api/auth/logout

**Description:** Route Handler de logout — revoga os refresh tokens no upstream e destrói o cookie de sessão. A capability "Logout" não tem UI nesta fase (botão vive no chrome autenticado, Fase posterior); o contrato BFF é entregue agora para estar pronto quando o chrome chegar (per `## Non-UI / Deferred Capabilities`).

**Technical actions:**

1. Criar `app/api/auth/logout/route.ts` — `POST` que lê o `access_token` da sessão e chama upstream `POST /auth/logout` com `Authorization: Bearer` server-side (per `phase-02-auth-frontend/TD-05`; per `next-frontend-openapi-typing/TD-01`).
2. Após a chamada upstream (sucesso ou 401), invocar `destroySession()` — single `session.destroy()` (per `phase-02-auth-frontend/TD-02` — cookie único; per `phase-02-auth-frontend/TD-01`).
3. Responder `204` ao cliente independentemente do resultado upstream (idempotência do logout local).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `app/api/auth/logout/route.ts` | Integration (MSW) per testing-guide-next-frontend § "Route handler" — sessão destruída; `204`; upstream 401 ainda destrói sessão | `app/api/auth/logout/__tests__/route.integration.test.ts` |

**Dependencies:** SI-02.2, SI-02.3

**Acceptance criteria:**

- `POST /api/auth/logout` com sessão ativa retorna `204` e o cookie de sessão é invalidado na resposta.
- `POST /api/auth/logout` quando o upstream responde `401` ainda destrói a sessão local e retorna `204`.
- Uma requisição autenticada subsequente após o logout não enxerga a sessão anterior.

---

### SI-02.8 — BFF Route Handler: POST /api/auth/forgot-password

**Route:** POST /api/auth/forgot-password
**API Contract:** see `## Technical Specifications` → `### API Contracts` → BFF tier → `#### POST /api/auth/forgot-password`

**Description:** Route Handler que proxia a solicitação de recuperação de senha; resposta 204 pass-through, preservando o no-op anti-enumeration do upstream.

**Technical actions:**

1. Criar `app/api/auth/forgot-password/route.ts` — `POST` que encaminha para `POST /auth/forgot-password` server-side via `openapi-fetch` (per `phase-02-auth-frontend/TD-05`; per `next-frontend-openapi-typing/TD-01`).
2. Tipar request por `ForgotPasswordDto` de `@/lib/api/contracts`; `204` pass-through esteja o e-mail registrado ou não (anti-enumeration upstream); sem cookie de sessão (per `### API Contracts` → BFF tier `#### POST /api/auth/forgot-password`).
3. Repassar `400` (validação) verbatim no envelope `ApiErrorEnvelope` (per `### API Contracts` → BFF tier).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `app/api/auth/forgot-password/route.ts` | Integration (MSW) per testing-guide-next-frontend § "Route handler (simple proxy)" — 204 pass-through (e-mail conhecido e desconhecido); 400 pass-through; nenhum cookie | `app/api/auth/forgot-password/__tests__/route.integration.test.ts` |

**Dependencies:** SI-02.1, SI-02.3

**Acceptance criteria:**

- `POST /api/auth/forgot-password` com e-mail válido retorna `204` sem corpo e sem cookie.
- `POST /api/auth/forgot-password` com e-mail não registrado retorna o mesmo `204` (resposta indistinguível — anti-enumeration).
- `POST /api/auth/forgot-password` com corpo inválido retorna `400` com o envelope de validação repassado.

---

### SI-02.9 — Propagação de sessão para Client Components (RSC + Context Provider)

**Description:** Entregar a sessão server-rendered na mesma resposta do HTML e hidratar um Context Provider client — sem flicker, sem round-trip extra.

**Technical actions:**

1. No RSC raiz (`app/layout.tsx` ou layout de área), ler `getSession()` e passar o estado inicial para um Client Provider (per `phase-02-auth-frontend/TD-06` — server-rendered session + RSC Context Provider).
2. Criar `components/auth/session-provider.tsx` (`"use client"`) que recebe a sessão inicial via props e a expõe por contexto (per `phase-02-auth-frontend/TD-06`).
3. Criar `hooks/use-session.ts` — hook de leitura do contexto de sessão para Client Components (per `phase-02-auth-frontend/TD-06`).
4. Documentar a convenção `router.refresh()` após mutations mid-session (uma linha no handler relevante) para re-render do chrome com a sessão atualizada (per `phase-02-auth-frontend/TD-06`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `components/auth/session-provider.tsx` | Unit per testing-guide-next-frontend § "Client Components" — hidrata com sessão inicial; expõe valor por contexto | `components/auth/__tests__/session-provider.test.tsx` |
| `hooks/use-session.ts` | Unit per testing-guide-next-frontend § "Custom hook" (`renderHook`) — retorna a sessão do provider; estado não-autenticado quando vazio | `hooks/__tests__/use-session.test.ts` |

**Dependencies:** SI-02.2

**Acceptance criteria:**

- Um Client Component dentro do provider lê, no primeiro paint, a sessão correta (autenticado vs não-autenticado) sem round-trip adicional.
- `use-session` retorna `userId`/`email`/`channelSlug` quando há sessão e estado não-autenticado quando o cookie está ausente.

---

### SI-02.10.0 — Drift audit: Tela de cadastro

**Figma:** https://www.figma.com/design/Doz7n3FsRhfvelYrPhTZAG/?node-id=140-333
**UI Contract:** see `## Technical Specifications` → `### UI Contracts` → `#### Screen: Tela de cadastro`

**Technical actions:**

1. **Drift audit** — invoke `figma:figma-implement-design` (narrow handoff) with:
   - Figma URL: https://www.figma.com/design/Doz7n3FsRhfvelYrPhTZAG/?node-id=140-333
   - Reused DS components: [`components/auth/signup-form.tsx`, `components/ui/card.tsx`, `components/auth/back-link.tsx`, `components/auth/brand-logo.tsx`, `components/ui/label.tsx`, `components/ui/input.tsx`, `components/auth/password-visibility-toggle.tsx`, `components/auth/password-strength-meter.tsx`, `components/auth/terms-checkbox.tsx`, `components/ui/checkbox.tsx`, `components/auth/auth-footer.tsx`]
   - Server-connected component names: [`SignupForm`, `SubmitButton`]
   - Target paths (read-only context; no writes here): `app/(auth)/signup/page.tsx` + `components/auth/signup-form.tsx`

   Para cada componente da Reused DS list, fazer value-level diff contra o arquivo em disco e classificar per o enum de 4 valores (`alinhado` / `drift menor` / `drift relevante` / `componente ausente`); compor Decision per default policy; escrever a seção `## Screen: signup — audited at SI-02.10.0 ({YYYY-MM-DD})` em `frontend-drift-report.md`. **Sem edits de código.**

**Dependencies:** SI-02.0.1, SI-02.0.4, SI-02.0.5, SI-02.0.6

**Tests:** _(empty — audit-only; the report is the deliverable)_

**Acceptance criteria:**

- `frontend-drift-report.md` contém a seção `## Screen: signup` com a data do run no heading.
- Todo componente da Reused DS list tem exatamente uma linha com a coluna Decision preenchida per o enum de status.
- Todo `exception` carrega justificativa de uma linha.
- `git diff --name-only HEAD -- next-frontend` após o SI está vazio.

---

### SI-02.10a — Tela de cadastro (visual shell)

**Route:** /signup
**Figma:** https://www.figma.com/design/Doz7n3FsRhfvelYrPhTZAG/?node-id=140-333
**UI Contract:** see `## Technical Specifications` → `### UI Contracts` → `#### Screen: Tela de cadastro`
**Drift Report:** see `frontend-drift-report.md` → `## Screen: signup`

**Technical actions:**

1. **Apply drift decisions** — ler a seção do Drift Report desta tela; para cada linha aplicar o verbo (`auto-Edit "<specifics>"` → Edit no arquivo DS; `create` → criar arquivo; `exception`/`skip` → no-op; `CONFLICT:` → tirar o prefixo e aplicar o verbo). Sem detecção/julgamento de drift aqui.
2. **Visual shell generation** — invoke `figma:figma-implement-design` (narrow handoff) with:
   - Figma URL: https://www.figma.com/design/Doz7n3FsRhfvelYrPhTZAG/?node-id=140-333
   - Reused DS components: lista do UI Contract _(refletindo edits da ação 1)_
   - Server-connected component names: [`SignupForm`, `SubmitButton`]
   - Target paths: `app/(auth)/signup/page.tsx` + `components/auth/signup-form.tsx`

**Dependencies:** SI-02.10.0 + SI-02.0.1, SI-02.0.4, SI-02.0.5, SI-02.0.6

**Tests:** _(empty — shell smoke-gated by build AC; Unit tests live in SI-02.10b; E2E in /plan-test-specs spec)_

**Acceptance criteria:**

- `app/(auth)/signup/page.tsx` e `components/auth/signup-form.tsx` existem, exportam os componentes esperados e compilam per `docker compose exec next-frontend npx tsc --noEmit`.
- Renderização corresponde à fidelidade do node Figma dentro da tolerância do DS set.
- Sem imports de runtime além da Reused DS list (escopo visual preservado).

---

### SI-02.10b — Tela de cadastro (lógica & wiring)

**Test Specs:** see `next-frontend/specs/signup.plan.md`
**UI Contract:** see `## Technical Specifications` → `### UI Contracts` → `#### Screen: Tela de cadastro`

**Technical actions:**

1. **Rendering strategy** — `app/(auth)/signup/page.tsx` como RSC shell compondo `components/auth/signup-form.tsx` marcado `"use client"` (per UI Contract `**Rendering strategy:**`; per `phase-02-auth-frontend/TD-05`). Rota `Anonymous` — sem guard de auth (per UI Contract `**Auth requirement:**`).
2. **Form + validação** — montar `signup-form.tsx` com `react-hook-form` + `zodResolver` (per `phase-02-auth-frontend/TD-04`; library-refs.md → react-hook-form/@hookform/resolvers), schema Zod espelhando o contrato (autorado agora, alinhável quando `RegisterDto` expandir per UI Contract `**Client-side validation mirror:**`).
3. **Endpoint wiring** — submit via `fetch("/api/auth/signup")` com tipos de `@/lib/api/contracts` (per `phase-02-auth-frontend/TD-05`; endpoint per `### API Contracts` → BFF tier `#### POST /api/auth/signup`).
4. **Error mapping** — mapear o envelope `ApiErrorEnvelope`: `409` → hint inline no campo e-mail + CTA "fazer login"; `400` → `FormMessage` inline no campo ofensor (per UI Contract `**Error Catalog → UX mapping:**`; padrão shadcn `FormMessage`/`Alert` inferido — design gap registrado nas Open questions).
5. **Sucesso** — em `201`, exibir confirmação (conta criada; e-mail de confirmação enviado pelo backend); sem sessão nesta etapa (per `### API Contracts` → BFF tier note).

**Dependencies:** SI-02.10a, SI-02.5, SI-02.1

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `components/auth/signup-form.tsx` | Unit per testing-guide-next-frontend § "Client Components" — submit happy path, mapeamento de erro 409/400 por linha, validação client-side pré-submit | `components/auth/__tests__/signup-form.wiring.test.tsx` |

E2E da página (routing, fluxo completo de cadastro) é autorado externamente por `/plan-test-specs` no spec referenciado em `**Test Specs:**` e consumido JIT por `/implement`. /plan-build não emite linha E2E aqui.

**Acceptance criteria:**

- Submeter o form com dados válidos chama `POST /api/auth/signup` com payload tipado e, em `201`, exibe o estado de sucesso de conta criada.
- Resposta `409` renderiza o hint inline no campo de e-mail com CTA "fazer login"; resposta `400` renderiza erro inline no campo ofensor.
- A validação client-side bloqueia o submit e espelha as regras do backend 1:1 (sem divergência).

---

### SI-02.11.0 — Drift audit: Tela de login

**Figma:** https://www.figma.com/design/Doz7n3FsRhfvelYrPhTZAG/?node-id=138-179
**UI Contract:** see `## Technical Specifications` → `### UI Contracts` → `#### Screen: Tela de login`

**Technical actions:**

1. **Drift audit** — invoke `figma:figma-implement-design` (narrow handoff) with:
   - Figma URL: https://www.figma.com/design/Doz7n3FsRhfvelYrPhTZAG/?node-id=138-179
   - Reused DS components: [`components/auth/login-form.tsx`, `components/ui/card.tsx`, `components/auth/brand-logo.tsx`, `components/icons/streamtube-icon.tsx`, `components/ui/label.tsx`, `components/ui/input.tsx`, `components/ui/button.tsx`, `components/auth/auth-footer.tsx`]
   - Server-connected component names: [`LoginForm`, `SubmitButton`]
   - Target paths (read-only context; no writes here): `app/(auth)/login/page.tsx` + `components/auth/login-form.tsx`

   Value-level diff por componente contra o disco, classificação per o enum de 4 valores, Decision per default policy; escrever `## Screen: login — audited at SI-02.11.0 ({YYYY-MM-DD})` em `frontend-drift-report.md`. **Sem edits de código.**

**Dependencies:** SI-02.0.4

**Tests:** _(empty — audit-only; the report is the deliverable)_

**Acceptance criteria:**

- `frontend-drift-report.md` contém a seção `## Screen: login` com a data do run no heading.
- Todo componente da Reused DS list tem exatamente uma linha com Decision preenchida per o enum.
- Todo `exception` carrega justificativa de uma linha.
- `git diff --name-only HEAD -- next-frontend` após o SI está vazio.

---

### SI-02.11a — Tela de login (visual shell)

**Route:** /login
**Figma:** https://www.figma.com/design/Doz7n3FsRhfvelYrPhTZAG/?node-id=138-179
**UI Contract:** see `## Technical Specifications` → `### UI Contracts` → `#### Screen: Tela de login`
**Drift Report:** see `frontend-drift-report.md` → `## Screen: login`

**Technical actions:**

1. **Apply drift decisions** — ler a seção do Drift Report desta tela; aplicar o verbo de cada linha (`auto-Edit`/`create`/`exception`/`skip`/`CONFLICT:` strip+apply). Sem detecção/julgamento aqui.
2. **Visual shell generation** — invoke `figma:figma-implement-design` (narrow handoff) with:
   - Figma URL: https://www.figma.com/design/Doz7n3FsRhfvelYrPhTZAG/?node-id=138-179
   - Reused DS components: lista do UI Contract _(refletindo edits da ação 1)_
   - Server-connected component names: [`LoginForm`, `SubmitButton`]
   - Target paths: `app/(auth)/login/page.tsx` + `components/auth/login-form.tsx`

**Dependencies:** SI-02.11.0 + SI-02.0.4

**Tests:** _(empty — shell smoke-gated by build AC; Unit tests live in SI-02.11b; E2E in /plan-test-specs spec)_

**Acceptance criteria:**

- `app/(auth)/login/page.tsx` e `components/auth/login-form.tsx` existem, exportam os componentes esperados e compilam per `docker compose exec next-frontend npx tsc --noEmit`.
- Renderização corresponde à fidelidade do node Figma dentro da tolerância do DS set.
- Sem imports de runtime além da Reused DS list.

---

### SI-02.11b — Tela de login (lógica & wiring)

**Test Specs:** see `next-frontend/specs/login.plan.md`
**UI Contract:** see `## Technical Specifications` → `### UI Contracts` → `#### Screen: Tela de login`

**Technical actions:**

1. **Rendering strategy** — `app/(auth)/login/page.tsx` como RSC shell compondo `components/auth/login-form.tsx` `"use client"` (per UI Contract `**Rendering strategy:**`; per `phase-02-auth-frontend/TD-05`). Rota `Anonymous` — sem guard (per UI Contract `**Auth requirement:**`).
2. **Form + validação** — `react-hook-form` + `zodResolver` (per `phase-02-auth-frontend/TD-04`), schema Zod espelhando o contrato `LoginDto` (alinhável quando expandir, per UI Contract `**Client-side validation mirror:**`).
3. **Endpoint wiring** — submit via `fetch("/api/auth/login")` tipado por `@/lib/api/contracts` (per `phase-02-auth-frontend/TD-05`; endpoint per `### API Contracts` → BFF tier `#### POST /api/auth/login`). Em `200`, a sessão já foi selada no cookie pelo BFF; disparar `router.refresh()` para o chrome refletir a sessão (per `phase-02-auth-frontend/TD-06`).
4. **Error mapping** — `401` → `Alert` form-level "credenciais inválidas"; `403` → `Alert` com CTA de reenvio de confirmação; `400` → `FormMessage` inline (per UI Contract `**Error Catalog → UX mapping:**`; padrão shadcn inferido — design gap registrado).

**Dependencies:** SI-02.11a, SI-02.6, SI-02.9, SI-02.1

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `components/auth/login-form.tsx` | Unit per testing-guide-next-frontend § "Client Components" — submit happy path, mapeamento 401/403/400, validação client-side pré-submit | `components/auth/__tests__/login-form.wiring.test.tsx` |

E2E da página (login → sessão → redirect, guards) é autorado externamente por `/plan-test-specs` no spec referenciado em `**Test Specs:**` e consumido JIT por `/implement`. /plan-build não emite linha E2E aqui.

**Acceptance criteria:**

- Submeter o form com credenciais válidas chama `POST /api/auth/login`, e após `200` a UI reflete o estado autenticado (chrome via `router.refresh()`), sem tokens visíveis no client.
- Resposta `401` renderiza alerta form-level de credenciais inválidas; `403` renderiza alerta de e-mail não confirmado; `400` renderiza erro inline.
- A validação client-side bloqueia o submit e espelha as regras do backend 1:1.

---

### SI-02.12.0 — Drift audit: Tela de solicitação de recuperação de senha

**Figma:** https://www.figma.com/design/Doz7n3FsRhfvelYrPhTZAG/?node-id=140-289
**UI Contract:** see `## Technical Specifications` → `### UI Contracts` → `#### Screen: Tela de solicitação de recuperação de senha`

**Technical actions:**

1. **Drift audit** — invoke `figma:figma-implement-design` (narrow handoff) with:
   - Figma URL: https://www.figma.com/design/Doz7n3FsRhfvelYrPhTZAG/?node-id=140-289
   - Reused DS components: [`components/auth/forgot-password-form.tsx`, `components/ui/card.tsx`, `components/ui/icon-button.tsx`, `components/auth/brand-logo.tsx`, `components/ui/label.tsx`, `components/ui/input.tsx`, `components/ui/button.tsx`, `components/auth/auth-footer.tsx`]
   - Server-connected component names: [`ForgotPasswordForm`, `SubmitButton`]
   - Target paths (read-only context; no writes here): `app/(auth)/forgot-password/page.tsx` + `components/auth/forgot-password-form.tsx`

   Value-level diff por componente contra o disco, classificação per o enum de 4 valores, Decision per default policy; escrever `## Screen: forgot-password — audited at SI-02.12.0 ({YYYY-MM-DD})` em `frontend-drift-report.md`. **Sem edits de código.**

**Dependencies:** SI-02.0.3, SI-02.0.4

**Tests:** _(empty — audit-only; the report is the deliverable)_

**Acceptance criteria:**

- `frontend-drift-report.md` contém a seção `## Screen: forgot-password` com a data do run no heading.
- Todo componente da Reused DS list tem exatamente uma linha com Decision preenchida per o enum.
- Todo `exception` carrega justificativa de uma linha.
- `git diff --name-only HEAD -- next-frontend` após o SI está vazio.

---

### SI-02.12a — Tela de solicitação de recuperação de senha (visual shell)

**Route:** /forgot-password
**Figma:** https://www.figma.com/design/Doz7n3FsRhfvelYrPhTZAG/?node-id=140-289
**UI Contract:** see `## Technical Specifications` → `### UI Contracts` → `#### Screen: Tela de solicitação de recuperação de senha`
**Drift Report:** see `frontend-drift-report.md` → `## Screen: forgot-password`

**Technical actions:**

1. **Apply drift decisions** — ler a seção do Drift Report desta tela; aplicar o verbo de cada linha (`auto-Edit`/`create`/`exception`/`skip`/`CONFLICT:` strip+apply). Sem detecção/julgamento aqui.
2. **Visual shell generation** — invoke `figma:figma-implement-design` (narrow handoff) with:
   - Figma URL: https://www.figma.com/design/Doz7n3FsRhfvelYrPhTZAG/?node-id=140-289
   - Reused DS components: lista do UI Contract _(refletindo edits da ação 1)_
   - Server-connected component names: [`ForgotPasswordForm`, `SubmitButton`]
   - Target paths: `app/(auth)/forgot-password/page.tsx` + `components/auth/forgot-password-form.tsx`

**Dependencies:** SI-02.12.0 + SI-02.0.3, SI-02.0.4

**Tests:** _(empty — shell smoke-gated by build AC; Unit tests live in SI-02.12b; E2E in /plan-test-specs spec)_

**Acceptance criteria:**

- `app/(auth)/forgot-password/page.tsx` e `components/auth/forgot-password-form.tsx` existem, exportam os componentes esperados e compilam per `docker compose exec next-frontend npx tsc --noEmit`.
- Renderização corresponde à fidelidade do node Figma dentro da tolerância do DS set.
- Sem imports de runtime além da Reused DS list.

---

### SI-02.12b — Tela de solicitação de recuperação de senha (lógica & wiring)

**Test Specs:** see `next-frontend/specs/forgot-password.plan.md`
**UI Contract:** see `## Technical Specifications` → `### UI Contracts` → `#### Screen: Tela de solicitação de recuperação de senha`

**Technical actions:**

1. **Rendering strategy** — `app/(auth)/forgot-password/page.tsx` como RSC shell compondo `components/auth/forgot-password-form.tsx` `"use client"` (per UI Contract `**Rendering strategy:**`; per `phase-02-auth-frontend/TD-05`/`TD-07`). Rota `Anonymous` — sem guard (per UI Contract `**Auth requirement:**`).
2. **Form + validação** — `react-hook-form` + `zodResolver` (per `phase-02-auth-frontend/TD-04`), schema Zod do campo e-mail espelhando `ForgotPasswordDto` (alinhável quando expandir, per UI Contract `**Client-side validation mirror:**`).
3. **Endpoint wiring** — submit via `fetch("/api/auth/forgot-password")` tipado por `@/lib/api/contracts` (per `phase-02-auth-frontend/TD-05`; endpoint per `### API Contracts` → BFF tier `#### POST /api/auth/forgot-password`).
4. **Sucesso inline** — em `204`, substituir o form por uma caixa de confirmação inline dentro do mesmo `Card`, resposta idêntica esteja o e-mail registrado ou não (per UI Contract; per `phase-02-auth-frontend/TD-07` — landing inline, sem rota dedicada).
5. **Error mapping** — `400` → `FormMessage` inline abaixo do campo de e-mail (per UI Contract `**Error Catalog → UX mapping:**`; padrão shadcn inferido — design gap registrado).

**Dependencies:** SI-02.12a, SI-02.8, SI-02.1

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `components/auth/forgot-password-form.tsx` | Unit per testing-guide-next-frontend § "Client Components" — submit happy path → success inline, mapeamento de erro 400, validação client-side pré-submit | `components/auth/__tests__/forgot-password-form.wiring.test.tsx` |

E2E da página (solicitação → success inline) é autorado externamente por `/plan-test-specs` no spec referenciado em `**Test Specs:**` e consumido JIT por `/implement`. /plan-build não emite linha E2E aqui.

**Acceptance criteria:**

- Submeter o form com e-mail válido chama `POST /api/auth/forgot-password` e, em `204`, renderiza a caixa de confirmação inline no mesmo `Card` (form substituído).
- Um e-mail não registrado produz exatamente a mesma confirmação inline (sem revelar existência da conta).
- Resposta `400` renderiza o erro inline abaixo do campo de e-mail; a validação client-side bloqueia o submit espelhando o backend 1:1.

---

## Technical Specifications

### API Contracts

> _BFF tier — frontend-exposed contract. The browser calls the FE-facing route under `app/api/auth/**`; the route proxies the upstream NestJS API server-side per the strict-BFF architecture documented in `next-frontend/CLAUDE.md` (Route Handlers as the only NestJS caller). The slice has no `Scope: Backend | Cross-layer` TD — backend auth is settled in `phase-02-auth` — so only the BFF tier is emitted. Contract source-of-truth: `next-frontend/openapi.json` → `lib/api/types.gen.ts` → `paths` (per `next-frontend-openapi-typing/TD-01..TD-04`)._

#### POST /api/auth/signup (SI-NN.X)

**forwards-to:** `POST /auth/register` *(derived: project contract source)*

**Request headers:**
- Content-Type: application/json *(derived: project contract source)*

**Request body:** `RegisterDto` *(derived: project contract source — fields per source; not re-spelled here to avoid duplication)*

**Response 201 (FE-facing):** `{ id, email }` — pass-through *(derived: project contract source; reshape: none)*

**Error responses (FE-facing):**
- 409 (Email already registered): pass-through *(derived: project contract source)*
- 400 (Validation failed): pass-through *(derived: project contract source)*

_Note: signup sets no session cookie — the backend issues an email-confirmation link and the account is unconfirmed until the user follows it; the iron-session cookie is established only on login (per phase-02-auth-frontend/TD-02). Error bodies follow the upstream `ApiErrorEnvelope` `{ statusCode, error, message, code }` *(derived: project contract source)*._

---

#### POST /api/auth/login (SI-NN.X)

**forwards-to:** `POST /auth/login` *(derived: project contract source)*

**Request headers:**
- Content-Type: application/json *(derived: project contract source)*

**Request body:** `LoginDto` *(derived: project contract source — fields per source; not re-spelled here to avoid duplication)*

**Response 200 (FE-facing):** body OMITS `access_token` / `refresh_token` *(reshape per phase-02-auth-frontend/TD-02)*

**Set-Cookie / session side-effect:** sets the encrypted `iron-session` cookie carrying `access_token` + `refresh_token` + a minimal user fingerprint (`userId`, `email`, `channelSlug`) *(per phase-02-auth-frontend/TD-02)*

**Error responses (FE-facing):**
- 401 (Invalid email or password): pass-through *(derived: project contract source)*
- 403 (Email not confirmed): pass-through *(derived: project contract source)*
- 400 (Validation failed): pass-through *(derived: project contract source)*

_Note: upstream login returns `{ access_token, refresh_token }` per the contract source; the BFF strips both from the FE-facing body and seals them into the `iron-session` cookie instead (custody never crosses to the browser). Transparent re-auth on a later upstream 401 is handled by the single-flight refresh helper against `POST /auth/refresh` *(per phase-02-auth-frontend/TD-03)* — not a server-connected UI endpoint, so it has no block here. Error bodies follow the upstream `ApiErrorEnvelope` *(derived: project contract source)*._

---

#### POST /api/auth/forgot-password (SI-NN.X)

**forwards-to:** `POST /auth/forgot-password` *(derived: project contract source)*

**Request headers:**
- Content-Type: application/json *(derived: project contract source)*

**Request body:** `ForgotPasswordDto` *(derived: project contract source — fields per source; not re-spelled here to avoid duplication)*

**Response 204 (FE-facing):** No content — pass-through *(derived: project contract source; reshape: none)*

**Error responses (FE-facing):**
- 400 (Validation failed): pass-through *(derived: project contract source)*

_Note: the upstream returns 204 whether or not the email is registered (anti-enumeration no-op) *(derived: project contract source)*; the FE renders an inline success state on 204 regardless (per phase-02-auth-frontend/TD-07 — RSC/Client landing split; success shown in the same `/forgot-password` Card). No session cookie is set._

### UI Contracts

#### Screen: Tela de cadastro

**Route:** `/signup`
**Figma:** https://www.figma.com/design/Doz7n3FsRhfvelYrPhTZAG/?node-id=140-333 (node `Doz7n3FsRhfvelYrPhTZAG:140:333`)
**Purpose:** "Cadastro de usuário com e-mail e senha".

**Auth requirement:** Anonymous _(no §Authorization Matrix emitted — pre-session public auth screen; the upstream `/auth/register` carries no security requirement in the contract source)_

**Rendering strategy:** RSC page shell composing a `"use client"` form child (react-hook-form + Zod resolver), submitting through the BFF Route Handler _(source: phase-02-auth-frontend/TD-05 — Mutation Submission Pathway: Route Handler POST + client fetch; form pattern per phase-02-auth-frontend/TD-04)_

**Reused DS components:**
- `components/auth/signup-form.tsx (new)` — Form como unidade (TD-04/TD-05); submit dispara mutation de signup
- `components/ui/card.tsx` — Container auth card
- `components/auth/back-link.tsx (new)` — Navegação client-side (Next.js `<Link>`)
- `components/auth/brand-logo.tsx` — Inclui `components/icons/streamtube-icon.tsx`
- `components/ui/label.tsx` — form field labels
- `components/ui/input.tsx` — Controlado via react-hook-form (TD-04)
- `components/auth/password-visibility-toggle.tsx (new)` — Toggle de `type` password/text client-side
- `components/auth/password-strength-meter.tsx (new)` — Opera apenas sobre input client-side
- `components/auth/terms-checkbox.tsx (new)` — Estado checkbox local; validado por Zod (TD-04)
- `components/ui/checkbox.tsx (new)` — Primitive DS ainda não autorada
- `components/auth/auth-footer.tsx` — Inclui link "Sign in" → /login (nav client-side)

**Server-connected components:**
- `SignupForm` — verbs: Cadastrar novo usuário com e-mail e senha | endpoint: `POST /api/auth/signup` (§API Contracts → BFF tier — see for `forwards-to` + request/response/projection) | reuse: `components/auth/signup-form.tsx (new)`
- `SubmitButton` — verbs: Cadastrar novo usuário com e-mail e senha | endpoint: `POST /api/auth/signup` (§API Contracts → BFF tier) | reuse: `components/ui/button.tsx`

**Behaviors:**

*Rendered states:*
- Loading: submit pendente — `SubmitButton` desabilitado / spinner enquanto a mutation está em voo.
- Empty: não aplicável (form sempre renderizado).
- Success: 201 — conta criada; backend dispara e-mail de confirmação (a conta permanece não confirmada até o link ser seguido). Não há sessão nesta etapa.
- Error: 409 e-mail já registrado / 400 validação — exibidos inline + alerta de form-level (ver mapping abaixo).

*Interactions:*
- `<PasswordVisibilityToggle>` click → alterna `type` password/text dos campos Password e Confirm Password (client-side).
- `<PasswordStrengthMeter>` ← reflete o input de senha ao vivo (client-side).
- `<TermsCheckboxRow>` toggle → estado local; bloqueia submit até marcado (validado por Zod, TD-04).
- back-arrow + link "Sign in" do `AuthFooter` → navegação client-side (Next.js `<Link>`).

**Error Catalog → UX mapping:**

| errorCode (upstream `ApiErrorEnvelope`) | UX treatment |
|-----------------------------------------|--------------|
| 409 (Email already registered) | Hint inline no campo de e-mail com CTA "fazer login"; _TBD — design gap, sem variant de erro no Figma_ |
| 400 (Validation failed) | `FormMessage` inline abaixo do campo ofensor; _TBD — design gap_ |

_Nenhum §Error Catalog emitido (slice sem TD Backend/Cross-layer); o envelope upstream `{ statusCode, error, message, code }` é a fonte (derived: project contract source)._

**Client-side validation mirror:** _Sem regras de validação field-level na contract source (`RegisterDto` com `properties: {}` não expandido em `openapi.json`); o schema Zod client-side é autorado no implement per phase-02-auth-frontend/TD-04, espelhando o upstream quando a spec expandir._

**Accessibility notes:**
- Follow DS defaults (nenhuma observação de a11y específica no inventory).

_Open questions (passivas — já registradas no inventory `## Open questions`, ingeridas como OQ por plan-validate): links "Terms of Service"/"Privacy Policy" apontam para `/terms`/`/privacy` fora do escopo da Fase 02; nenhuma surface de erro/loading presente no Figma (design gap — inferir padrão shadcn `FormMessage` + `Alert` no implement)._

---

#### Screen: Tela de login

**Route:** `/login`
**Figma:** https://www.figma.com/design/Doz7n3FsRhfvelYrPhTZAG/?node-id=138-179 (node `Doz7n3FsRhfvelYrPhTZAG:138:179`)
**Purpose:** "Login e controle de sessão do usuário".

**Auth requirement:** Anonymous _(no §Authorization Matrix emitted — pre-session public auth screen; the upstream `/auth/login` carries no security requirement in the contract source)_

**Rendering strategy:** RSC page shell composing a `"use client"` form child (react-hook-form + Zod resolver), submitting through the BFF Route Handler _(source: phase-02-auth-frontend/TD-05; form pattern per phase-02-auth-frontend/TD-04)_. Em sucesso, o cookie `iron-session` é selado pelo BFF e a sessão propaga para Client Components via RSC + Context Provider _(per phase-02-auth-frontend/TD-06)_.

**Reused DS components:**
- `components/auth/login-form.tsx (new)` — react-hook-form + Zod (TD-04); submit → `/api/auth/login` (TD-05)
- `components/ui/card.tsx` — see screen: Tela de cadastro
- `components/auth/brand-logo.tsx` — composta de StreamtubeIcon + wordmark
- `components/icons/streamtube-icon.tsx` — Sub-componente do BrandLogo (reusar o componente DS, não o asset remoto)
- `components/ui/label.tsx` — form field labels
- `components/ui/input.tsx` — Controlado via react-hook-form (TD-04)
- `components/ui/button.tsx` — SubmitButton "Sign in"; trigger do submit (TD-05)
- `components/auth/auth-footer.tsx` — link interno "Sign up" → /signup (nav client-side)

**Server-connected components:**
- `LoginForm` — verbs: Autenticar usuário com e-mail e senha e iniciar sessão | endpoint: `POST /api/auth/login` (§API Contracts → BFF tier — see for `forwards-to` + Set-Cookie projection) | reuse: `components/auth/login-form.tsx (new)`
- `SubmitButton` — verbs: Autenticar usuário com e-mail e senha e iniciar sessão | endpoint: `POST /api/auth/login` (§API Contracts → BFF tier) | reuse: `components/ui/button.tsx`

**Behaviors:**

*Rendered states:*
- Loading: submit pendente — `SubmitButton` desabilitado / spinner.
- Empty: não aplicável.
- Success: 200 — cookie `iron-session` setado pelo BFF (tokens nunca chegam ao browser, per TD-02); redireciona para a área autenticada.
- Error: 401 credenciais inválidas / 403 e-mail não confirmado / 400 validação (ver mapping abaixo).

*Interactions:*
- Link "Forgot password?" → navegação client-side para `/forgot-password` (Next.js `<Link>`).
- Link "Sign up" do `AuthFooter` → navegação client-side para `/signup`.

**Error Catalog → UX mapping:**

| errorCode (upstream `ApiErrorEnvelope`) | UX treatment |
|-----------------------------------------|--------------|
| 401 (Invalid email or password) | `Alert` form-level "credenciais inválidas"; _TBD — design gap, sem variant de erro no Figma_ |
| 403 (Email not confirmed) | `Alert` form-level com CTA de reenvio de confirmação; _TBD — design gap_ |
| 400 (Validation failed) | `FormMessage` inline abaixo do campo ofensor; _TBD — design gap_ |

_Nenhum §Error Catalog emitido; envelope upstream `{ statusCode, error, message, code }` é a fonte (derived: project contract source)._

**Client-side validation mirror:** _Sem regras field-level na contract source (`LoginDto` com `properties: {}` não expandido); schema Zod client-side autorado no implement per phase-02-auth-frontend/TD-04._

**Accessibility notes:**
- Follow DS defaults (nenhuma observação de a11y específica no inventory).

_Open questions (passivas — já no inventory `## Open questions`): Input password sem visibility-toggle no Figma (possível design gap); nenhuma surface de erro/feedback presente no Figma node (design gap — runtime states inferidos no implement); StreamtubeIcon renderizado como `<img>` remoto no Figma, mas reusar o componente DS `components/icons/streamtube-icon.tsx`._

---

#### Screen: Tela de solicitação de recuperação de senha

**Route:** `/forgot-password`
**Figma:** https://www.figma.com/design/Doz7n3FsRhfvelYrPhTZAG/?node-id=140-289 (node `Doz7n3FsRhfvelYrPhTZAG:140:289`)
**Purpose:** "Recuperação de senha: solicitação via e-mail → link com token → redefinição" — esta tela cobre a etapa de solicitação (envio do link por e-mail).

**Auth requirement:** Anonymous _(no §Authorization Matrix emitted — pre-session public auth screen; the upstream `/auth/forgot-password` carries no security requirement in the contract source)_

**Rendering strategy:** RSC page shell composing a `"use client"` form child (react-hook-form + Zod resolver), submitting through the BFF Route Handler _(source: phase-02-auth-frontend/TD-05; form pattern per phase-02-auth-frontend/TD-04)_. Estado de sucesso renderizado inline no mesmo `Card` em 204 _(per phase-02-auth-frontend/TD-07 — RSC owns token, Client owns input; aqui o sucesso é exibido na mesma tela sem rota dedicada)_.

**Reused DS components:**
- `components/auth/forgot-password-form.tsx (new)` — Email field group + Button; submit → `POST /api/auth/forgot-password` (TD-05)
- `components/ui/card.tsx` — see screen: Tela de cadastro
- `components/ui/icon-button.tsx (new)` — `arrow_back`; nav client-side de volta para `/login` (DS primitive ainda não autorada)
- `components/auth/brand-logo.tsx` — see screen: Tela de cadastro
- `components/ui/label.tsx` — form field label
- `components/ui/input.tsx` — Controlado via react-hook-form (TD-04)
- `components/ui/button.tsx` — SubmitButton "Send reset link" (TD-05)
- `components/auth/auth-footer.tsx` — texto exibido no Figma é "Sign up" (provável inconsistência — esperado "Sign in")

**Server-connected components:**
- `ForgotPasswordForm` — verbs: Solicitar envio de e-mail com link de redefinição de senha | endpoint: `POST /api/auth/forgot-password` (§API Contracts → BFF tier — see for `forwards-to` + anti-enumeration note) | reuse: `components/auth/forgot-password-form.tsx (new)`
- `SubmitButton` — verbs: Solicitar envio de e-mail com link de redefinição de senha | endpoint: `POST /api/auth/forgot-password` (§API Contracts → BFF tier) | reuse: `components/ui/button.tsx`

**Behaviors:**

*Rendered states:*
- Loading: submit pendente — `SubmitButton` desabilitado / spinner.
- Empty: não aplicável.
- Success: 204 — caixa de confirmação inline dentro do mesmo `Card` (resposta idêntica esteja o e-mail registrado ou não — anti-enumeration upstream).
- Error: 400 validação (ver mapping abaixo).

*Interactions:*
- `<IconButton>` (`arrow_back`) → navegação client-side de volta para `/login`.
- submit bem-sucedido → estado de sucesso inline substitui o form no mesmo `Card`.

**Error Catalog → UX mapping:**

| errorCode (upstream `ApiErrorEnvelope`) | UX treatment |
|-----------------------------------------|--------------|
| 400 (Validation failed) | `FormMessage` inline abaixo do campo de e-mail; _TBD — design gap_ |

_Nenhum §Error Catalog emitido; envelope upstream `{ statusCode, error, message, code }` é a fonte (derived: project contract source)._

**Client-side validation mirror:** _Sem regras field-level na contract source (`ForgotPasswordDto` com `properties: {}` não expandido); schema Zod client-side autorado no implement per phase-02-auth-frontend/TD-04._

**Accessibility notes:**
- Follow DS defaults (nenhuma observação de a11y específica no inventory).

_Open questions (passivas — já no inventory `## Open questions`): `AuthFooter` exibe "Sign up" onde a UX usual seria "Sign in" (inconsistência de design — confirmar com designer); estado de sucesso inline não extraído como variant separada no Figma (design gap — inferir no implement); a tela "set new password" (destino do link) não existe no Figma — capability coberta apenas parcialmente, a etapa de redefinição está em `## Non-UI / Deferred Capabilities` (deferred para uma fase posterior)._

### UI ↔ API Traceability Matrix

| Verb | Component | Screen | Endpoint (from API Contracts) | TD ref |
|------|-----------|--------|-------------------------------|--------|
| Cadastrar novo usuário com e-mail e senha | SignupForm + SubmitButton | /signup | POST /api/auth/signup → forwards-to POST /auth/register | phase-02-auth-frontend/TD-05 |
| Autenticar usuário com e-mail e senha e iniciar sessão | LoginForm + SubmitButton | /login | POST /api/auth/login → forwards-to POST /auth/login | phase-02-auth-frontend/TD-05 |
| Solicitar envio de e-mail com link de redefinição de senha | ForgotPasswordForm + SubmitButton | /forgot-password | POST /api/auth/forgot-password → forwards-to POST /auth/forgot-password | phase-02-auth-frontend/TD-05 |

_Capabilities marcadas em `## Non-UI / Deferred Capabilities` (Confirmação de conta, Logout, set-new-password destination, umbrella "Telas …") são excluídas desta matriz._

---

## Dependency Map

```
Bootstrap (B2.6)
SI-02.0.1 (root) — install shadcn checkbox
├── SI-02.0.2 — depends on SI-02.0.1 (test the installed primitive)
└── SI-02.0.6 — depends on SI-02.0.1 (terms-checkbox consumes ui/checkbox)
SI-02.0.3 (root, independent) — custom-ui icon-button
SI-02.0.4 (root, independent) — custom-business simple group (5 components)
SI-02.0.5 (root, independent) — custom-business complex password-visibility-toggle

Foundation
SI-02.1 (root) — auth contract aliases
└── SI-02.3 — depends on SI-02.1 (typed MSW handlers off contracts)
SI-02.2 (root) — iron-session module
├── SI-02.4 — depends on SI-02.2 + SI-02.3 (refresh helper; single-flight; MSW test)
├── SI-02.9 — depends on SI-02.2 (session propagation RSC + provider)
SI-02.5 — depends on SI-02.1 + SI-02.3 (BFF signup route)
SI-02.6 — depends on SI-02.1 + SI-02.2 + SI-02.3 (BFF login route; seals session)
SI-02.7 — depends on SI-02.2 + SI-02.3 (BFF logout route)
SI-02.8 — depends on SI-02.1 + SI-02.3 (BFF forgot-password route)

Screen: /signup
SI-02.10.0 — depends on SI-02.0.1, SI-02.0.4, SI-02.0.5, SI-02.0.6 (drift audit)
└── SI-02.10a — depends on SI-02.10.0 + SI-02.0.1, SI-02.0.4, SI-02.0.5, SI-02.0.6 (visual shell)
    └── SI-02.10b — depends on SI-02.10a + SI-02.5 + SI-02.1 (lógica & wiring)

Screen: /login
SI-02.11.0 — depends on SI-02.0.4 (drift audit)
└── SI-02.11a — depends on SI-02.11.0 + SI-02.0.4 (visual shell)
    └── SI-02.11b — depends on SI-02.11a + SI-02.6 + SI-02.9 + SI-02.1 (lógica & wiring)

Screen: /forgot-password
SI-02.12.0 — depends on SI-02.0.3, SI-02.0.4 (drift audit)
└── SI-02.12a — depends on SI-02.12.0 + SI-02.0.3, SI-02.0.4 (visual shell)
    └── SI-02.12b — depends on SI-02.12a + SI-02.8 + SI-02.1 (lógica & wiring)
```

---

## Deliverables

- [ ] SI-02.0.1 — Infra: install batch shadcn primitives (checkbox)
- [ ] SI-02.0.2 — Tests shadcn batch (checkbox)
- [ ] SI-02.0.3 — Custom-ui: icon-button.tsx
- [ ] SI-02.0.4 — Custom-business simple group: back-link + forgot-password-form + login-form + password-strength-meter + signup-form
- [ ] SI-02.0.5 — Custom-business complex: password-visibility-toggle
- [ ] SI-02.0.6 — Custom-business complex: terms-checkbox
- [ ] SI-02.1 — Auth contract aliases em `lib/api/contracts.ts`
- [ ] SI-02.2 — Módulo de sessão iron-session (`lib/auth/session.ts`)
- [ ] SI-02.3 — Handlers MSW de auth (`mocks/handlers/auth.ts`)
- [ ] SI-02.4 — Helper de refresh de token single-flight (`lib/auth/refresh.ts`)
- [ ] SI-02.5 — BFF Route Handler: POST /api/auth/signup
- [ ] SI-02.6 — BFF Route Handler: POST /api/auth/login
- [ ] SI-02.7 — BFF Route Handler: POST /api/auth/logout
- [ ] SI-02.8 — BFF Route Handler: POST /api/auth/forgot-password
- [ ] SI-02.9 — Propagação de sessão para Client Components (RSC + Context Provider)
- [ ] SI-02.10.0 — Drift audit: Tela de cadastro
- [ ] SI-02.10a — Tela de cadastro (visual shell)
- [ ] SI-02.10b — Tela de cadastro (lógica & wiring)
- [ ] SI-02.11.0 — Drift audit: Tela de login
- [ ] SI-02.11a — Tela de login (visual shell)
- [ ] SI-02.11b — Tela de login (lógica & wiring)
- [ ] SI-02.12.0 — Drift audit: Tela de solicitação de recuperação de senha
- [ ] SI-02.12a — Tela de solicitação de recuperação de senha (visual shell)
- [ ] SI-02.12b — Tela de solicitação de recuperação de senha (lógica & wiring)

**Per-screen deliverables:**

- [ ] Screen Tela de cadastro (`/signup`) is routable
- [ ] Screen Tela de cadastro (`/signup`) renders loading, success, and error states
- [ ] Screen Tela de cadastro (`/signup`) passes component tests (per testing-guide-next-frontend layers)
- [ ] Screen Tela de login (`/login`) is routable
- [ ] Screen Tela de login (`/login`) renders loading, success, and error states
- [ ] Screen Tela de login (`/login`) passes component tests (per testing-guide-next-frontend layers)
- [ ] Screen Tela de solicitação de recuperação de senha (`/forgot-password`) is routable
- [ ] Screen Tela de solicitação de recuperação de senha (`/forgot-password`) renders submit, inline success, and error states
- [ ] Screen Tela de solicitação de recuperação de senha (`/forgot-password`) passes component tests (per testing-guide-next-frontend layers)

**Full test suites:**

- [ ] Frontend unit + integration tests pass (`docker compose exec next-frontend npm test`)
- [ ] E2E tests pass (`npx playwright test` on the host, with the containerized dev server up and `MSW_ENABLED=true` per `next-frontend/CLAUDE.md`)
- [ ] Type/compilation check passes (`docker compose exec next-frontend npx tsc --noEmit`)
- [ ] Lint passes (`docker compose exec next-frontend npm run lint`)

_Scope note: `nestjs-project` is out of this slice's scope — backend auth is settled in `phase-02-auth`; no backend command is listed here by design._
