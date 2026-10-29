# phase-02-auth-frontend — Progress

**Status:** completed
**SIs:** 24/24 completed

### Setup-Infra — playwright.config.ts + instrumentation.ts + tests/fixtures.ts
- **Status:** completed
- **Tests:** no tests (infra setup)
- **Observations:**
  - `@playwright/test` já estava em node_modules (v1.60.0) mas não declarado em package.json — adicionado a devDependencies.
  - `playwright.config.ts` criado: sem webServer (dev server é containerizado), baseURL=localhost:3001, testDir=./tests, testMatch=*.e2e-spec.ts.
  - `instrumentation.ts` criado: register() condicionado a `NEXT_RUNTIME === "nodejs"` && `MSW_ENABLED === "true"`, `onUnhandledRequest: "bypass"` per arquitetura E2E.
  - `tests/fixtures.ts` criado: auto-use `network` fixture que documenta o contrato (sem page.route(), sem server.use() por teste).
  - Script `test:e2e` adicionado ao package.json.

### SI-02.0.1 — Infra: install batch shadcn primitives
- **Status:** completed
- **Tests:** no tests (infra)
- **Observations:** none

### SI-02.0.2 — Tests shadcn batch (checkbox)
- **Status:** completed
- **Tests:** 6 passing
- **Observations:**
  - `vitest.config.ts` precisou de `resolve.alias` para o `@/` path (tsconfig não é lido automaticamente pelo Vite).
  - `vitest.setup.ts` criado com `@testing-library/jest-dom/vitest` (export específico para Vitest) e `afterEach(cleanup)` explícito — sem globals mode, a auto-cleanup do RTL não dispara sozinha.

### SI-02.0.3 — Custom-ui: icon-button.tsx
- **Status:** completed
- **Tests:** 5 passing
- **Observations:** none

### SI-02.0.4 — Custom-business simple group
- **Status:** completed
- **Tests:** 22 passing
- **Observations:** none

### SI-02.0.5 — Custom-business complex: password-visibility-toggle
- **Status:** completed
- **Tests:** 3 passing
- **Observations:**
  - Criados `components/icons/eye-icon.tsx` e `components/icons/eye-off-icon.tsx` como dependência do toggle.

### SI-02.0.6 — Custom-business complex: terms-checkbox
- **Status:** completed
- **Tests:** 6 passing
- **Observations:** none

### SI-02.1 — Auth contract aliases em lib/api/contracts.ts
- **Status:** completed
- **Tests:** no tests (type-only; compile-gated)
- **Observations:**
  - DTOs (`RegisterDto`, `LoginDto`, `ForgotPasswordDto`, `RefreshTokenDto`) estão como `Record<string, never>` no openapi.json atual — fields expandirão quando a spec upstream evoluir; tsc passa.
  - Adicionado `RefreshTokenPair` e `RefreshTokenDto` que SI-02.4 precisará.

### SI-02.2 — Módulo de sessão iron-session (lib/auth/session.ts)
- **Status:** completed
- **Tests:** 4 passing
- **Observations:**
  - `lib/env.ts` atualizado com `SESSION_PASSWORD` (Zod min 32 chars).
  - `vitest.setup.ts` recebeu `process.env.SESSION_PASSWORD` para testes.
  - `next/headers` mockado via `vi.mock` com Map em memória; iron-session roda crypto real no teste.

### SI-02.3 — Handlers MSW de auth (mocks/handlers/auth.ts)
- **Status:** completed
- **Tests:** no tests (test-infra)
- **Observations:**
  - `lucide-react` (adicionado pelo shadcn na checkbox) substituído por `@/components/icons/check-icon.tsx` per regra UI.
  - `@testing-library/user-event` adicionado ao devDependencies (estava em node_modules do container mas não declarado).
  - MSW handler resolvers usam `HttpResponse.json(data)` sem generic conflitante — tipagem dos corpos ainda passa via `type` imports dos aliases.

### SI-02.4 — Helper de refresh de token single-flight (lib/auth/refresh.ts)
- **Status:** completed
- **Tests:** 4 passing
- **Observations:**
  - Usa `fetch` raw (não `upstream` client) para o `/auth/refresh` — evita conflito de tipos com `RefreshTokenDto: Record<string, never>` no schema atual.

### SI-02.5 — BFF Route Handler: POST /api/auth/signup
- **Status:** completed
- **Tests:** 4 passing
- **Observations:**
  - `server-only` guard resolvido via `resolve.alias` em vitest.config.ts (stub vazio em `lib/__mocks__/server-only.ts`).
  - Handler importado via dynamic import dentro de `beforeAll` — padrão obrigatório para evitar captura do fetch não-patcheado pelo MSW (per project memory).

### SI-02.6 — BFF Route Handler: POST /api/auth/login
- **Status:** completed
- **Tests:** 4 passing
- **Observations:** none

### SI-02.7 — BFF Route Handler: POST /api/auth/logout
- **Status:** completed
- **Tests:** 2 passing
- **Observations:** none

### SI-02.8 — BFF Route Handler: POST /api/auth/forgot-password
- **Status:** completed
- **Tests:** 3 passing
- **Observations:** none

### SI-02.9 — Propagação de sessão para Client Components
- **Status:** completed
- **Tests:** 4 passing (2 session-provider + 2 use-session)
- **Observations:**
  - `lib/env.ts` atualizado com `isServer: typeof window === "undefined" || process.env.VITEST !== undefined` para evitar bloqueio de vars server-only em testes jsdom.

### SI-02.10.0 — Drift audit: Tela de cadastro
- **Status:** completed
- **Tests:** no tests (audit-only)
- **Observations:**
  - Re-rodado a pedido do usuário contra os arquivos reais em disco (figma:figma-implement-design → node 140:333). Corrigiu 3 phantoms do relatório anterior: back-link (era classificado como botão-ícone `size-9→size-6`; na verdade é wrapper `<Link>` de texto → alinhado), password-visibility-toggle (assumia consumo de IconButton; é `<button>` cru → retune direto na className), terms-checkbox (anchor `text-foreground` inexistente; já está `text-muted-foreground` → alinhado).
  - Quick scan corrigido: 11 componentes (8 alinhado, 2 drift menor, 1 drift relevante, 0 ausente). Specifics aplicáveis: checkbox.tsx (5), password-visibility-toggle.tsx (2), password-strength-meter.tsx (2).
  - Auditoria não produziu edits em `next-frontend` (report vive em `docs/`); AC "git diff vazio" interpretado como "sem edits de código pelo audit" (literal impossível em resume com fase inteira uncommitted).

### SI-02.10a — Tela de cadastro (visual shell)
- **Status:** completed
- **Tests:** no tests (visual shell)
- **Observations:**
  - Aplicadas as 3 decisões auto-Edit do Drift Report corrigido: checkbox.tsx (radius hardcoded→token, border→border-2, border-input→border-border, drop 2 overrides dark), password-visibility-toggle.tsx (radius-1→radius-full, svg size-4→size-6), password-strength-meter.tsx (barras rounded-full→radius-0-5, text-helper→text-caption). 8 componentes skip.
  - Path da página: plano especifica `app/(auth)/signup/page.tsx` (route group); a página de login existente está em `app/login/page.tsx` (sem route group) — divergência de convenção de path entre slices; fora de escopo deste SI reconciliar (observação para o usuário).
  - Criado `components/icons/arrow-back-icon.tsx` a partir do asset Figma (arrow_back) — back-link.tsx é wrapper `<Link>` e recebe o ícone como children (posicionamento absolute via call-site, permitido).
  - **Fora de escopo (autorizado pelo usuário):** `hooks/__tests__/use-session.test.ts:12` tinha erro de tipo TS2769 pré-existente do SI-02.9 (SessionProvider sem `children` no createElement); aplicado fix de 1 linha (children no objeto de props) para destravar o gate `tsc --noEmit` do projeto. SI-02.9 deveria ter pego isso — follow-up para o usuário.
  - Paridade visual não verificada em browser (dev server não iniciado per regra next-frontend/CLAUDE.md — só sob pedido explícito); tsc --noEmit do projeto passa (exit 0).

### SI-02.10b — Tela de cadastro (lógica & wiring)
- **Status:** completed
- **Tests:** 4 passing (signup-form.wiring vitest) + 3 passing (auth-signup E2E)
- **Observations:**
  - Wiring completo: RHF + zodResolver (schema TD-04: fullName/email/password/confirmPassword/terms; `RegisterDto` vazio na contract source — payload `{email,password}` autorado per TD-04, pass-through pelo BFF). Submit→`fetch("/api/auth/signup")`; 409→hint inline no e-mail + CTA `/login`; 400→msg form-level (`data-slot=form-error`, não no campo e-mail); 201→estado "Conta criada!".
  - Instaladas deps `react-hook-form@^7.76.0` + `@hookform/resolvers@^5.2.2` (zod ^4.4.3 já presente; resolver auto-detecta v4). `z.email()` / `z.boolean().refine` (idioms Zod 4).
  - **Desvio de library-refs (justificado):** o padrão canônico usa o primitivo shadcn `components/ui/form.tsx`, que NÃO existe e foi deliberadamente excluído da Reused DS list da tela (usa Label+Input puros). Wirei RHF direto via `register`/`Controller` + msgs inline `text-destructive`, sem introduzir um primitivo DS não-auditado — mantém escopo do SI.
  - **Test-infra (in-scope):** `vitest.setup.ts` ganhou polyfill de `ResizeObserver` (jsdom não provê; Radix `@radix-ui/react-use-size` referencia no mount — bloqueava todo teste de componente Radix-backed).
  - **Removido (consequência direta deste SI):** `components/auth/__tests__/signup-form.test.tsx` (teste presentacional bootstrap do SI-02.0.4) — afirmava o contrato antigo (`isSubmitting` prop, botão "Sign up") que este SI substituiu deliberadamente; superseded pelo wiring test + E2E.
  - Criado `lib/auth/error-mapping.ts` (mapeia `ApiErrorEnvelope` → setError por status, per library-refs).
  - **Fora de escopo (follow-ups p/ usuário):** (a) `.env.local` foi criado pelo subagente de testes com `API_URL=http://localhost:3000` — dentro do container isso aponta pro próprio Next dev server; se o MSW server-side morrer (hot-reload), o fetch upstream cai em 404 HTML do Next em vez de falhar rápido. Convenção do projeto (CLAUDE.md / vitest.setup default) é o nome de serviço Compose (`http://nestjs-api:3000`). (b) `.env.example` não lista `SESSION_PASSWORD`. (c) Operacional: o dev server precisa de restart limpo com `MSW_ENABLED=true` antes de cada run E2E — server de sessão anterior pode ter MSW morto silenciosamente (não reproduzível a partir de estado limpo).

### SI-02.11.0 — Drift audit: Tela de login
- **Status:** completed
- **Tests:** no tests (audit-only)
- **Observations:**
  - Figma node 138:179 auditado contra disco; 8 componentes da Reused DS list. Quick scan: 7 alinhado, 1 drift menor, 0 drift relevante, 0 ausente.
  - 6 componentes (`card`, `label`, `input`, `button`, `brand-logo`, `auth-footer`) reproduzem a decisão `alinhado/skip` da auditoria de signup (SI-02.10.0) — Prior honored, sem CONFLICT (demanda Figma idêntica entre as duas telas, mesmo design file).
  - `streamtube-icon.tsx` é first-time (não estava na Reused DS de signup): SVG icon DS-compliant, sem superfície de token para driftar → alinhado.
  - Único drift: `login-form.tsx` link "Forgot password?" usa `text-label-md` (token de label peso Medium) onde o Figma 147:539 demanda Inter Regular 14/20 = `text-body-md`. auto-Edit retune típico (mesmo sistema tipográfico → menor), a aplicar em SI-02.11a.
  - Auditoria não produziu edits em `next-frontend` (report vive em `docs/`); AC "git diff vazio" satisfeito no sentido "sem edits de código pelo audit".

### SI-02.11a — Tela de login (visual shell)
- **Status:** completed
- **Tests:** no tests (visual shell)
- **Observations:**
  - Drift Report aplicado: 1 auto-Edit em `components/auth/login-form.tsx` (link "Forgot password?" `text-label-md` → `text-body-md`, per Figma 147:539 Inter Regular 14/20). Demais 7 componentes `skip`. Post-edit variant-conflict guard: nenhum sibling tipográfico sob prefixo de variante no link → sem ação extra.
  - Criado `app/(auth)/login/page.tsx` (route group, espelha a convenção de `app/(auth)/signup/page.tsx`): main > Card > BrandLogo + h1 "Sign in" + LoginForm + AuthFooter. Sem BackLink/subtítulo (ausentes no Figma node 138:179).
  - **Removido (consequência direta deste SI):** `app/login/page.tsx` (scaffold pré-fase). O plano fixa o path em `app/(auth)/login/page.tsx`; manter ambos resolveria `/login` em paralelo (route group não afeta a URL) → erro de rota paralela do Next. O scaffold antigo era a versão pré-fase desta mesma tela, substituída por esta (compõe LoginForm) — superseded.
  - Paridade visual não verificada em browser (dev server não iniciado per regra next-frontend/CLAUDE.md); compilação validada na final verification.

### SI-02.11b — Tela de login (lógica & wiring)
- **Status:** completed
- **Tests:** 5 passing (login-form.wiring vitest) + 3 passing (auth-login E2E)
- **Observations:**
  - 4 ações completas: (1) RSC shell + client form já satisfeito por SI-02.11a (rota anônima, sem guard); (2) RHF + zodResolver, schema mínimo `email`+`password` (LoginDto sem props na contract source, autorado per TD-04); (3) submit → `fetch("/api/auth/login")`, `router.refresh()` em 200 (TD-06; tokens nunca no client per TD-02); (4) error-mapping: 401→alert form-level, 403→alert distinto + CTA reenvio, 400→inline no campo email.
  - `login-form.tsx` reescrito de presentational (prop `isSubmitting`) para wired RHF — supersede o scaffold do SI-02.0.4. **Removido (consequência direta):** `components/auth/__tests__/login-form.test.tsx` (teste presentational bootstrap afirmava o contrato antigo, substituído pelo wiring test + E2E).
  - Adicionado `mapLoginErrorToForm` a `lib/auth/error-mapping.ts` (espelha o do signup; chaveia por statusCode).
  - **Test-infra (in-scope):** `mocks/handlers/auth.ts` ganhou 2 reserved triggers no handler `/auth/login` — `invalid@example.com`→401, `unconfirmed@example.com`→403 (o handler só tinha `badrequest@`→400). Mecanismo sancionado pelo contrato E2E do projeto (per-scenario via reserved trigger, sem `server.use()` em E2E); requerido pelos cenários 401/403 do spec desta SI. Valores não colidem com triggers existentes.
  - Diagnóstico do fix-loop (1 tentativa): falha Vitest era isolamento de teste (`refreshMock` module-level retinha contagem do teste 200 anterior — source correto, retorna antes de `router.refresh()` em `!res.ok`); resolvido com `beforeEach(refreshMock.mockClear())`. Falha E2E 401 era MSW server-side stale: `instrumentation.ts` carrega MSW uma vez no boot e NÃO faz hot-reload; servidor pré-edição caía no branch 200. Resolvido com restart limpo do dev server (mesma gotcha já registrada em SI-02.10b).
  - **Fora de escopo (follow-up p/ usuário):** o CTA de reenvio de confirmação aponta para `/resend-confirmation`, rota inexistente nesta fase (design gap/TBD já registrado no UI Contract — `403` Error Catalog "TBD — design gap"). Sem endpoint de reenvio no escopo deste slice.
  - **Operacional:** o container `next-frontend` não tem `pkill`; matar o dev server stale antes de E2E exige kill via `/proc` (PIDs de `next-server`). Relevante para SI-02.12b (mesmo fluxo E2E).
  - Paridade visual não verificada em browser (regra next-frontend/CLAUDE.md — só sob pedido explícito).

### SI-02.12.0 — Drift audit: Tela de recuperação de senha
- **Status:** completed
- **Tests:** no tests (audit-only)
- **Observations:**
  - Figma node 140:289 auditado contra disco; 8 componentes. Quick scan: 8 alinhado, 0 drift (menor/relevante/ausente). Sem auto-Edit — SI-02.12a aplicará apenas skips.
  - 6 componentes (`card`, `label`, `input`, `button`, `brand-logo`, `auth-footer`) reproduzem `alinhado/skip` das auditorias signup/login — Prior honored, sem CONFLICT.
  - `forgot-password-form.tsx` (first-time): compõe só primitivos DS alinhados, sem token hardcoded → alinhado. `icon-button.tsx` (first-time): Figma arrow_back é M3 standard icon button (container invisível até interação) → mapeia para a variante `ghost`; tamanho/posição da seta são composição de call-site da SI-02.12a (precedente do back-link de signup) → sem drift de DS-file.
  - Observado (fora do escopo do audit): Figma footer mostra "Sign up" onde o usual seria "Sign in" — valor de conteúdo/prop + design-gap já registrado como open question no UI Contract; não é drift de token.
  - Auditoria não produziu edits em `next-frontend` (report em `docs/`); AC "git diff vazio" satisfeito.

### SI-02.12a — Tela de recuperação de senha (visual shell)
- **Status:** completed
- **Tests:** no tests (visual shell)
- **Observations:**
  - Drift Report: 8 decisões `skip` — nenhum edit de DS aplicado.
  - Criado `app/(auth)/forgot-password/page.tsx` (route group, espelha convenção signup/login): main > Card relative > IconButton(arrow_back, absolute top-left) + BrandLogo + h1 "Reset password" + subtítulo + ForgotPasswordForm + AuthFooter. Sem scaffold antigo conflitante (não havia `app/forgot-password/`).
  - Back affordance: `IconButton` (DS primitive, per UI Contract) com `ArrowBackIcon` (reusa `components/icons/arrow-back-icon.tsx`, criado em SI-02.10a a partir do asset Figma arrow_back — mesmo asset/posição que o back-link de signup). A navegação client-side de volta para `/login` (onClick) é interação → wiring da SI-02.12b; o shell renderiza o controle.
  - **Fidelidade Figma vs UX (follow-up p/ usuário):** AuthFooter renderizado per Figma literal — question "Remember your password?" + link "Sign up" → `/signup`. O UI Contract registra como open question que o usual seria "Sign in" → `/login` (inconsistência de design a confirmar com designer). Mantido fiel ao Figma per AC; não resolvido unilateralmente.
  - Paridade visual não verificada em browser (regra next-frontend/CLAUDE.md); compilação na final verification.

### SI-02.12b — Tela de recuperação de senha (lógica & wiring)
- **Status:** completed
- **Tests:** 4 passing (forgot-password-form.wiring vitest) + 3 passing (auth-forgot-password E2E)
- **Observations:**
  - 5 ações completas: (1) RSC shell + client form já satisfeito por SI-02.12a (rota anônima, sem guard); (2) RHF + zodResolver, schema só `email` (ForgotPasswordDto sem props, autorado per TD-04); (3) submit → `fetch("/api/auth/forgot-password")` payload `{email}`; (4) sucesso `204` → caixa de confirmação inline (`role=status`, "Verifique seu e-mail") substitui o form no mesmo Card, mensagem anti-enumeration neutra (idêntica registrado/não); (5) `400` → inline abaixo do campo e-mail (form não substituído).
  - `forgot-password-form.tsx` reescrito de presentational para wired RHF (padrão do signup-form, sem router — sucesso é estado inline, não navegação). **Removido (consequência direta):** `components/auth/__tests__/forgot-password-form.test.tsx` (teste presentational bootstrap superseded pelo wiring test + E2E).
  - Adicionado `mapForgotPasswordErrorToForm` a `lib/auth/error-mapping.ts` (400→campo email; else→root.serverError).
  - Sem novos reserved triggers MSW — handler `/auth/forgot-password` já tinha `badrequest@`→400 / qualquer outro→204 (anti-enumeration). Nenhum edit em `mocks/`.
  - Fix-loop não necessário (0 tentativas); o subagente precisou de restart limpo do dev server porque o servidor pré-existente rodava SEM `MSW_ENABLED=true` (HTTP 200 mas MSW server-side off). Confirmação confiável de readiness E2E = `POST /api/auth/forgot-password` retornar 204, não só `curl -I` 200.
  - Paridade visual não verificada em browser (regra next-frontend/CLAUDE.md).
