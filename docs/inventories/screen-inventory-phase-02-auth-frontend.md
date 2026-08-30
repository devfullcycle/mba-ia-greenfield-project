# phase-02-auth-frontend — Screen Inventory

> **Phase:** 02 — Cadastro, Login e Gerenciamento de Conta (frontend slice)
> **Status:** Validated
> **Date:** 2026-05-14
> **Screens in scope:** 3

---

## Screen: Tela de cadastro

**Route:** `/signup`
**Figma:** https://www.figma.com/design/Doz7n3FsRhfvelYrPhTZAG/?node-id=140-333 (node `Doz7n3FsRhfvelYrPhTZAG:140:333`)
**Purpose (from project-plan.md):** "Cadastro de usuário com e-mail e senha".

### Component inventory

| Component (Figma node)              | Type              | In DS? | Reuse?                                  | Notes |
|-------------------------------------|-------------------|--------|-----------------------------------------|-------|
| SignupForm (143:2399)               | Server-connected  | ✗      | `components/auth/signup-form.tsx (new)` | Form como unidade (TD-04/TD-05); submit dispara mutation de signup |
| Card (143:2400)                     | Presentational    | ✓      | `components/ui/card.tsx`                | Container auth card |
| BackArrow (143:2407)                | Local-interactive | ✗      | `components/auth/back-link.tsx (new)`   | Navegação client-side (Next.js `<Link>`) |
| BrandLogo (2387:2263)               | Presentational    | ✓      | `components/auth/brand-logo.tsx`        | Inclui `components/icons/streamtube-icon.tsx` |
| Heading "Create account" (143:2429) | Presentational    | ✗      | new                                     | `<h1>` puro-DOM |
| Subtitle (143:2442)                 | Presentational    | ✗      | new                                     | Helper text puro-DOM |
| FullNameField (2716:2085)           | Presentational    | ✗      | new                                     | Composição Label + Input |
| FormLabel "Full Name" (2172:347)    | Presentational    | ✓      | `components/ui/label.tsx`               | — |
| Input "Full Name" (143:2433)        | Local-interactive | ✓      | `components/ui/input.tsx`               | Controlado via react-hook-form (TD-04) |
| EmailField (2716:2087)              | Presentational    | ✗      | new                                     | Composição Label + Input |
| FormLabel "Email address" (2172:350)| Presentational    | ✓      | `components/ui/label.tsx`               | — |
| Input "Email" (143:2434)            | Local-interactive | ✓      | `components/ui/input.tsx`               | Controlado via react-hook-form (TD-04) |
| PasswordField (2716:2089)           | Presentational    | ✗      | new                                     | Composição Label + Input + toggle + strength meter + helper |
| FormLabel "Password" (2172:353)     | Presentational    | ✓      | `components/ui/label.tsx`               | — |
| Input "Password" (143:2435)         | Local-interactive | ✓      | `components/ui/input.tsx`               | Controlado via react-hook-form (TD-04) |
| PasswordVisibilityToggle (I143:2435;82:6685) | Local-interactive | ✗ | `components/auth/password-visibility-toggle.tsx (new)` | Toggle de `type` password/text client-side |
| PasswordStrengthMeter (143:2446)    | Local-interactive | ✗      | `components/auth/password-strength-meter.tsx (new)` | Opera apenas sobre input client-side |
| PasswordStrengthHelper (143:2444)   | Presentational    | ✗      | new                                     | Helper text dirigido pelo strength meter |
| ConfirmPasswordField (2716:2091)    | Presentational    | ✗      | new                                     | Composição Label + Input + toggle |
| FormLabel "Confirm Password" (2172:356) | Presentational | ✓      | `components/ui/label.tsx`               | — |
| Input "Confirm Password" (143:2436) | Local-interactive | ✓      | `components/ui/input.tsx`               | Controlado via react-hook-form (TD-04) |
| ConfirmPasswordVisibilityToggle (I143:2436;82:6685) | Local-interactive | ✗ | `components/auth/password-visibility-toggle.tsx (new)` | Toggle de `type` password/text client-side |
| TermsCheckboxRow (2716:2093)        | Local-interactive | ✗      | `components/auth/terms-checkbox.tsx (new)` | Estado checkbox local; validado por Zod (TD-04) |
| Checkbox (143:2445)                 | Local-interactive | ✗      | `components/ui/checkbox.tsx (new)`      | Primitive DS ainda não autorada |
| TermsLinks (143:2439)               | Local-interactive | ✗      | new                                     | Anchors inline para /terms e /privacy (rotas fora do escopo) |
| SubmitButton "Create account" (143:2443) | Server-connected | ✓   | `components/ui/button.tsx`              | Submit do form; dispara mutation de signup (TD-05) |
| AuthFooter (2394:2284)              | Presentational    | ✓      | `components/auth/auth-footer.tsx`       | Inclui link "Sign in" → /login (nav client-side) |

### Verbs of intent

| Verb                                          | Component                            | Capability (project-plan.md)             |
|-----------------------------------------------|--------------------------------------|------------------------------------------|
| Cadastrar novo usuário com e-mail e senha     | SignupForm + SubmitButton (143:2443) | "Cadastro de usuário com e-mail e senha" |

### Observations

- Form classificado como Server-connected como unidade (skill rule: forms com validação local + submit ao servidor são sempre Server-connected); SubmitButton também marcado Server-connected porque a ação de submit é despachada por ele (TD-05).
- Capabilities "Criação automática do canal do usuário a partir do prefixo do e-mail" e "Confirmação de conta via e-mail com link de ativação" são side-effects server-side da mutation de signup; não têm affordance dedicada nesta tela.
- O link "Sign in" no AuthFooter e o back-arrow no topo dependem de navegação client-side framework-provided (Next.js `<Link>`) — Local-interactive por skill rules.
- Visibility-toggles e strength meter operam apenas sobre input client-side.
- Links "Terms of Service" e "Privacy Policy" apontam para rotas fora do escopo da Fase 02 — flag para Open questions.
- Nenhum componente visível no screenshot ausente de `get_design_context`.

---

## Screen: Tela de login

**Route:** `/login`
**Figma:** https://www.figma.com/design/Doz7n3FsRhfvelYrPhTZAG/?node-id=138-179 (node `Doz7n3FsRhfvelYrPhTZAG:138:179`)
**Purpose (from project-plan.md):** "Login e controle de sessão do usuário".

### Component inventory

| Component (Figma node)                       | Type              | In DS? | Reuse?                                  | Notes |
|----------------------------------------------|-------------------|--------|-----------------------------------------|-------|
| LoginForm (143:2265)                         | Server-connected  | ✗      | `components/auth/login-form.tsx (new)`  | react-hook-form + Zod (TD-04); submit → `/api/auth/login` (TD-05) |
| Card (143:1250)                              | Presentational    | ✓      | `components/ui/card.tsx`                | see screen: Tela de cadastro |
| BrandLogo (2387:2244)                        | Presentational    | ✓      | `components/auth/brand-logo.tsx`        | see screen: Tela de cadastro; composta de StreamtubeIcon + wordmark |
| StreamtubeIcon (I2387:2244;2417:133)         | Presentational    | ✓      | `components/icons/streamtube-icon.tsx`  | Sub-componente do BrandLogo |
| Heading "Sign in" (143:2273)                 | Presentational    | ✗      | new                                     | `<h1>` puro-DOM |
| FormLabel "Email address" (2172:253)         | Presentational    | ✓      | `components/ui/label.tsx`               | — |
| Input email (147:536)                        | Local-interactive | ✓      | `components/ui/input.tsx`               | Controlado via react-hook-form (TD-04) |
| FormLabel "Password" (2172:263)              | Presentational    | ✓      | `components/ui/label.tsx`               | — |
| Link "Forgot password?" (147:539)            | Local-interactive | ✗      | new                                     | Nav client-side → `/forgot-password` (Next.js `<Link>`) |
| Input password (147:540)                     | Local-interactive | ✓      | `components/ui/input.tsx`               | Controlado via react-hook-form (TD-04); sem visibility-toggle no Figma |
| SubmitButton "Sign in" (147:541)             | Server-connected  | ✓      | `components/ui/button.tsx`              | Trigger do submit; mutation pathway TD-05 |
| AuthFooter (2394:2271)                       | Presentational    | ✓      | `components/auth/auth-footer.tsx`       | see screen: Tela de cadastro; link interno "Sign up" → /signup (nav client-side) |

### Verbs of intent

| Verb                                                     | Component                              | Capability (project-plan.md)            |
|----------------------------------------------------------|----------------------------------------|-----------------------------------------|
| Autenticar usuário com e-mail e senha e iniciar sessão   | LoginForm + SubmitButton (147:541)     | "Login e controle de sessão do usuário" |

### Observations

- Form e SubmitButton juntos realizam o único verb server-connected; verbs table tem 1 linha porque ambos contribuem para a mesma intent de submit.
- Input password (147:540) não tem visibility-toggle no Figma — classificado como Local-interactive apenas pelo state ownership via react-hook-form. Possível design gap.
- O link "Forgot password?" navega para `/forgot-password` (tela inventariada como #3 nesta fase).
- O link "Sign up" no AuthFooter navega para `/signup` (tela inventariada como #1 nesta fase).
- Nenhuma superfície de erro/feedback (inline field error, form-level alert, loading state) presente no Figma node — flag como design gap; runtime states precisarão ser inferidos no implement ou sourced de uma variant Figma separada.
- StreamtubeIcon é renderizado em Figma como `<img>` apontando para asset remoto, mas o filesystem snapshot tem `components/icons/streamtube-icon.tsx` como o componente DS canônico — reusar o componente DS, não o asset.

---

## Screen: Tela de solicitação de recuperação de senha

**Route:** `/forgot-password`
**Figma:** https://www.figma.com/design/Doz7n3FsRhfvelYrPhTZAG/?node-id=140-289 (node `Doz7n3FsRhfvelYrPhTZAG:140:289`)
**Purpose (from project-plan.md):** "Recuperação de senha: solicitação via e-mail → link com token → redefinição" — esta tela cobre a etapa de solicitação (envio do link por e-mail).

### Component inventory

| Component (Figma node)                | Type              | In DS? | Reuse?                                      | Notes |
|---------------------------------------|-------------------|--------|---------------------------------------------|-------|
| ForgotPasswordForm (140:289 wrapper)  | Server-connected  | ✗      | `components/auth/forgot-password-form.tsx (new)` | Email field group + Button; submit → `POST /api/auth/forgot-password` (TD-05) |
| Card (143:2308)                       | Presentational    | ✓      | `components/ui/card.tsx`                    | see screen: Tela de cadastro |
| arrow_back (143:2343)                 | Local-interactive | ✗      | `components/ui/icon-button.tsx (new)`       | Nav client-side de volta para `/login` |
| BrandLogo (2387:2252)                 | Presentational    | ✓      | `components/auth/brand-logo.tsx`            | see screen: Tela de cadastro |
| Heading "Reset password" (143:2347)   | Presentational    | ✗      | new                                         | `<h1>` puro-DOM |
| Helper text (143:2353)                | Presentational    | ✗      | new                                         | `<p>` puro-DOM ("Enter your email and we'll send you a reset link") |
| EmailField group (2713:2086)          | Presentational    | ✗      | new                                         | Composição FormLabel + Input |
| FormLabel "Email address" (2172:282)  | Presentational    | ✓      | `components/ui/label.tsx`                   | — |
| Input email (143:2351)                | Local-interactive | ✓      | `components/ui/input.tsx`                   | Controlado via react-hook-form (TD-04) |
| SubmitButton "Send reset link" (143:2354) | Server-connected | ✓     | `components/ui/button.tsx`                  | Dispara submit → `POST /api/auth/forgot-password` (TD-05) |
| AuthFooter (2394:2276)                | Presentational    | ✓      | `components/auth/auth-footer.tsx`           | see screen: Tela de cadastro; texto exibido no Figma é "Sign up" (provável inconsistência — esperado "Sign in") |

### Verbs of intent

| Verb                                                              | Component                                          | Capability (project-plan.md)                                                                  |
|-------------------------------------------------------------------|----------------------------------------------------|-----------------------------------------------------------------------------------------------|
| Solicitar envio de e-mail com link de redefinição de senha        | ForgotPasswordForm + SubmitButton (143:2354)       | "Recuperação de senha: solicitação via e-mail → link com token → redefinição"                 |

### Observations

- Form normalizado como ForgotPasswordForm (Server-connected como unidade) para consistência com signup/login; estado de submit unifica EmailField + SubmitButton.
- O AuthFooter da tela exibe link rotulado "Sign up" no Figma onde a UX usual seria "Sign in" (voltar para login). Tratado como inconsistência de design — flag para Open questions.
- Estado de sucesso é exibido inline nesta mesma tela (sem rota dedicada "verifique seu e-mail"), conforme decisão registrada no progress file. A renderização do success state não está presente como variant separada no Figma — apenas o estado default do form foi extraído.
- **Figma gap:** a tela "set new password" (destino do link enviado por e-mail, onde o usuário define a nova senha) não existe no arquivo Figma atual. A capability "Recuperação de senha…" só está parcialmente coberta pelo design — a etapa de redefinição precisa ser desenhada antes de ser inventariada.
- O ícone `arrow_back` (143:2343) corresponde ao componente Figma "Icon button" do design system, mas não há wrapper React equivalente em `components/ui/`; emitido como `components/ui/icon-button.tsx (new)` para `phase-b.md` § B2.6 gerar o SI de bootstrap.

---

## Reconciliation summary

| Capability (project-plan.md)                                                       | Covered by                                  | Screens                                              |
|------------------------------------------------------------------------------------|---------------------------------------------|------------------------------------------------------|
| "Serviço de envio de e-mails transacionais"                                        | (backend; side-effect de signup + forgot-password) | — (capability backend; sem UI direta)         |
| "Cadastro de usuário com e-mail e senha"                                           | SignupForm + SubmitButton                   | /signup                                              |
| "Criação automática do canal do usuário a partir do prefixo do e-mail"             | (backend; side-effect de signup)            | — (capability backend; sem UI direta)                |
| "Confirmação de conta via e-mail com link de ativação"                             | — (de-scoped pelo usuário)                  | — (sem tela; ver Open questions)                     |
| "Login e controle de sessão do usuário"                                            | LoginForm + SubmitButton                    | /login                                               |
| "Logout"                                                                           | — (sem UI nesta fase)                       | — (sem tela; ver Open questions)                     |
| "Recuperação de senha: solicitação via e-mail → link com token → redefinição"      | ForgotPasswordForm + SubmitButton (parcial — apenas solicitação) | /forgot-password (set-new-password ausente do Figma) |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha"            | Telas signup + login + forgot-password      | /signup, /login, /forgot-password (confirmação de-scoped) |

## Open questions

- Capability "Confirmação de conta via e-mail com link de ativação" não tem tela inventariada — de-scoped pelo usuário em 2026-05-14 ("o restante não iremos implementar agora"). O fluxo end-to-end de cadastro depende desta tela para fechar (após signup → e-mail com link → tela de confirmação); precisará ser retomada em uma fase posterior. TD-07 (Email-Link Landing Pattern) prevê RSC processando o token server-side; recomenda-se gerar o inventory da tela antes de implementar.
- Capability "Logout" não tem UI inventariada nesta fase. A "tela" de logout é, na prática, um botão dentro do chrome autenticado (avatar/menu); seu local depende de fases posteriores que introduzam o chrome (provavelmente Fase 04 — "Painel de gerenciamento" / chrome autenticado). Confirmar com `plan-validate` se logout fica fora desta fase intencionalmente.
- Tela de redefinição de senha (set new password — destino do link enviado por e-mail) NÃO existe no Figma atual. A capability "Recuperação de senha…" só está parcialmente coberta; a etapa de redefinição precisa ser desenhada (novo node Figma) e inventariada antes do implement do fluxo completo. Até lá, `/forgot-password` envia o e-mail mas o destino do link é uma rota inexistente.
- Tela de signup: links "Terms of Service" e "Privacy Policy" (node 143:2439) apontam para rotas (`/terms`, `/privacy`) fora do escopo da Fase 02. Decidir se: (a) renderizar como links inertes/placeholders até as rotas existirem; (b) abrir issue para criar páginas estáticas mínimas; (c) outra estratégia.
- Tela de signup + Tela de login: nenhuma surface de erro/feedback de form-level (alert pós-submit, loading state, inline field errors) está presente no Figma. TD-04 + envelope `{ statusCode, error, message }` (phase-02-auth/TD-07) implicam que estados precisam ser exibidos. Decidir se: (a) inferir o design no implement seguindo padrão shadcn `FormMessage` + `Alert`; (b) solicitar variants de erro/loading ao designer antes do implement.
- Tela de forgot-password: AuthFooter exibe link "Sign up" no Figma, mas a UX usual numa tela de recuperação seria "Sign in" (voltar ao login). Confirmar com o designer qual link/texto é correto; alternativa: implementar como "Sign in" baseado em UX comum.
- Tela de forgot-password: estado de sucesso inline (após submit) não foi extraído como variant separada do Figma. O design precisa de uma variant de success-state OU o implement infere o estilo (caixa de confirmação dentro do mesmo Card).
- Componentes planejados-mas-não-existentes detectados (`Reuse?` com sufixo ` (new)`) e que servirão de gatilho para `phase-b.md` § B2.6 (bootstrap SI synthesis): `components/auth/signup-form.tsx`, `components/auth/login-form.tsx`, `components/auth/forgot-password-form.tsx`, `components/auth/back-link.tsx`, `components/auth/password-visibility-toggle.tsx`, `components/auth/password-strength-meter.tsx`, `components/auth/terms-checkbox.tsx`, `components/ui/checkbox.tsx`, `components/ui/icon-button.tsx`. Confirmar com `plan-build` que todos serão materializados nesta fase OU diferidos para fases posteriores conforme decisão.
