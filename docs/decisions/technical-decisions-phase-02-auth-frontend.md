---
scope_type: phase
related_phases: [2]
status: decided
date: 2026-05-14
scope_description: "Frontend side of Phase 02 — auth screens (signup, login, account confirmation, forgot/reset password) plus the BFF wiring that makes them work: how the Next.js app stores the JWT/refresh tokens issued by the NestJS backend, how it refreshes them, how forms are built and submitted, how Client Components know who the user is, and how email-link landings (confirmation/reset) are structured. Backend auth is settled in `phase-02-auth/TD-01..TD-10` and is NOT reopened here."
---

# Technical Decisions — Phase 02 Frontend (Auth Screens & BFF Session)

_Subprojects in scope:_

- `next-frontend/` — primary subproject. Owns the auth screens (`app/(auth)/signup`, `app/(auth)/login`, `app/(auth)/forgot-password`, `app/(auth)/reset-password`, `app/(auth)/confirm`), the BFF Route Handlers under `app/api/auth/**`, the session-cookie management module (`lib/auth/session.ts` or equivalent), the form/validation pattern reused across the four screens, the `mocks/handlers/auth.ts` MSW domain file (per `next-frontend-msw-foundation/TD-01`), and the auth contract aliases in `lib/api/contracts.ts` (per `next-frontend-openapi-typing/TD-04`).
- `nestjs-project/` — **no open decision in this document.** Backend auth is settled in `phase-02-auth/TD-01..TD-10` (Argon2id hashing, custom `@nestjs/jwt` guards, refresh-token rotation, opaque DB tokens for confirmation/reset, `@nestjs-modules/mailer`, class-validator, custom domain exception filter, `@nestjs/throttler`, JWT refresh format, nickname allowlist). The FE consumes those endpoints unchanged; no backend contract change is implied or requested.

> Cross-doc anchors (already decided — do NOT reopen):
> - **Strict BFF — single server-only `API_URL`:** `next-frontend-config-base/TD-03`. Only Route Handlers / RSC / Server Actions read `env.API_URL`; the browser only talks to same-origin `/api/...`. This forecloses any "browser → NestJS direct" auth pattern.
> - **OpenAPI contract chain:** `next-frontend-openapi-typing/TD-01..TD-05`. Auth request/response shapes (signup body, login response with tokens, error envelope per `phase-02-auth/TD-07`) come from `paths` in `lib/api/types.gen.ts`; named aliases live in `lib/api/contracts.ts`.
> - **MSW handlers per domain:** `next-frontend-msw-foundation/TD-01..TD-04`. Phase 02's contribution is one `mocks/handlers/auth.ts` file + one barrel line; integration tests assert on Route Handlers as functions with `msw/node` intercepting upstream `fetch`.
> - **Backend token model:** access JWT (~15min) + opaque/JWT refresh with rotation (`phase-02-auth/TD-03`, `TD-09`); login response body carries both tokens. Backend custom guards expect `Authorization: Bearer <accessToken>` (`phase-02-auth/TD-02`). The FE must transport tokens to the backend on every authenticated call — the open question here is _where the tokens live on the FE side_, not the backend transport.
> - **Email-token shape:** confirmation and password-reset tokens are random opaque strings stored in DB (`phase-02-auth/TD-04`). Sent as URL parameters in the email link.
> - **Error envelope:** `{ statusCode, error, message }` with machine-readable `error` codes (`phase-02-auth/TD-07`). Forms switch on `error` for field-level mapping; the envelope is read once in a single FE error-mapping helper.
> - **Existing FE scaffolding:** `app/login/page.tsx` and `components/auth/{brand-logo,auth-footer}.tsx` already exist (Figma scaffold). This research informs how those are wired; it does not commit to keeping them at their current path (route group reshuffle is an SI-level concern for `/plan-build`).

---

## TD-01: Authentication Orchestration Approach

**Scope:** Frontend

**Capability:** Transversal — covers: "Cadastro de usuário com e-mail e senha", "Login e controle de sessão do usuário", "Logout", "Telas de cadastro, login, confirmação de conta e recuperação de senha"

**Context:** Phase 02's FE has to take the NestJS backend's JWT-based auth and turn it into a working Next.js session. The first decision is structural: do we adopt a third-party auth framework that wraps the whole flow, or do we build the BFF↔Nest auth bridge ourselves on top of the strict-BFF architecture already chosen? This single decision constrains every TD that follows: TDs 02–06 are downstream consequences of A vs. B.

The backend already owns the auth model entirely (Argon2id hashing, JWT issuance, refresh rotation, opaque email tokens, throttling). The FE side does not need an authentication _framework_ — it needs an authenticated _session_ on the browser side. The question is whether to lean on Auth.js for the cookie/session plumbing or to write that plumbing directly against `next/headers`.

**Options:**

### Option A: Custom BFF cookie-based session (vanilla `next/headers` + small helper)

Write a small `lib/auth/session.ts` module that uses Next.js's built-in `cookies()` (from `next/headers`) to read/write a session cookie containing the backend tokens. BFF Route Handlers under `app/api/auth/**` (`signup`, `login`, `logout`, `refresh`, `confirm`, `forgot-password`, `reset-password`) call the upstream Nest endpoints, take the returned tokens, and set them in the response cookie. RSC + Server Actions read the cookie via the same helper.

- **Pros:** Smallest dependency surface — no auth framework to learn, configure, version-track. Every behavior is visible in a single small file (~50 lines). Aligned 1:1 with the strict-BFF model already locked in `next-frontend-config-base/TD-03` — the BFF is the only NestJS caller, sessions are a BFF concern, no third-party shim sits between the BFF and the cookie. Free choice on every downstream parameter (cookie shape per TD-02, refresh trigger per TD-03, session shape per TD-06) without fighting an opinionated framework. No external library version to chase against Next.js 16 / React 19 (Auth.js v5 stable was on Next.js 14; v5+ explicitly recommends checking compatibility per Next major).
- **Cons:** We write the session helper, the refresh logic, and the route handlers ourselves — five small Route Handlers (~150 LOC total) plus the session helper (~50 LOC). Easy to get a CSRF/cookie attribute wrong without library-author-vetted defaults — mitigated by (a) using `cookies().set()`'s explicit options, (b) adding a `.claude/rules` file capturing the cookie attribute checklist, and (c) the BFF integration tests assert the response `Set-Cookie` header on each auth Route Handler.

### Option B: Auth.js v5 (`next-auth`) with Credentials provider + custom `authorize` calling Nest

Install `next-auth@5`, configure a Credentials provider whose `authorize` callback `fetch`-es `${env.API_URL}/auth/login` against Nest. Use Auth.js's JWT session strategy. Implement `jwt()` and `session()` callbacks to thread `accessToken` / `refreshToken` / `expiresAt` through the Auth.js session JWT. Implement refresh-on-expiry inside the `jwt()` callback (the official Auth.js refresh-token-rotation recipe).

- **Pros:** Battle-tested cookie/CSRF defaults — Auth.js's session cookie has correct `httpOnly`, `secure`, `sameSite`, prefix attributes out of the box. Built-in `signIn()` / `signOut()` / `auth()` helpers reduce per-route boilerplate. The `jwt()` refresh-rotation pattern is documented and copyable. Trivial to add OAuth providers later (Google/GitHub) if the project ever grows social login.
- **Cons:** **Architectural impedance mismatch with the strict-BFF model.** Auth.js was built around the assumption that the Next.js app IS the auth authority (with adapters writing to a DB it owns). When a separate backend (Nest) is the authority, Auth.js becomes a wrapper around a `fetch` call — the Credentials `authorize` callback does what one Route Handler would do, only inside a framework whose lifecycle (`/api/auth/[...nextauth]`, `auth()`, `signIn()`, callbacks) the developer must learn before they can debug a "wrong status code" issue. **Refresh-rotation in `jwt()` is awkward** when the upstream backend rotates the refresh token on every call (`phase-02-auth/TD-03`): every concurrent BFF request that triggers `jwt()` near expiry will race for a single rotation, and Auth.js does not natively serialize `jwt()` calls per session. **Compatibility risk** with Next.js 16 + React 19 — Auth.js v5 documentation lags one Next major behind reality; bugs in this combo surface as opaque "auth() returned null" issues. **Unused surface** is large: OAuth providers, magic-link, database adapters, `getServerSession`-style helpers — none of them serve a project whose backend already owns auth. Higher long-term maintenance for a phase-02 deliverable that needs ~5 endpoints and one cookie.

### Option C: Custom client-side token management (no BFF cookie; tokens in client state + memory)

The login Route Handler returns the tokens to the browser as a JSON body. A Client Component stores the access token in a React Context (memory only, lost on page reload) and the refresh token in `localStorage` (or `sessionStorage`). Every subsequent client `fetch("/api/...")` attaches the access token in `Authorization`; the BFF reads the header and forwards it. RSC and Server Actions cannot read the session (no cookie), so authenticated server-side rendering becomes impossible.

- **Pros:** Zero cookie configuration; no CSRF concern (no auto-sent credentials). Pure stateless BFF — every request explicitly carries its credential.
- **Cons:** **Refresh tokens in `localStorage` are an OWASP anti-pattern** (any XSS on the app reads them). **Loses RSC personalization** — Server Components cannot tell who the user is, so the `app/layout.tsx` cannot render an "avatar / login button" toggle server-side; every authenticated affordance becomes client-side hydration with a flicker. **Loses progressive rendering** — pages that depend on the user must wait for client JS. **Defeats the BFF security premise**: the whole point of the strict-BFF model is to keep credentials off `window` — Option C inverts that. **Page reload loses the session** if access token is memory-only; persisting it in `localStorage` widens the XSS surface further. Disqualified for any project that takes auth seriously, listed only to rule out by name.

**Recommendation:** **Option A (Custom BFF cookie-based session)**. Three reasons. (1) **Architectural fit.** The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority — Auth.js's value (DB adapters, OAuth providers, magic-link, `getServerSession` helpers) is mostly unused in this configuration. (2) **Smaller blast radius.** A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern; a misconfigured Auth.js callback is a longer fault-isolation loop. (3) **Compatibility with Next.js 16 / React 19.** Built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use; Auth.js v5 versions track Next.js majors with a lag, adding compatibility risk that Option A does not have. Option C is rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive (loses RSC personalization).

**Decision:** A (Custom BFF cookie-based session — `next/headers` + small helper)

---

## TD-02: Session Cookie Strategy (what flows in the cookie, in what shape)

**Scope:** Frontend

**Capability:** Login e controle de sessão do usuário

**Context:** Given TD-01 Option A (custom BFF cookie-based session), the next decision is the cookie's shape. The BFF receives two tokens from Nest on `/auth/login` and `/auth/refresh`: an access JWT (~15min) and a refresh token (`phase-02-auth/TD-09` chose JWT for the refresh too). It must persist them so subsequent BFF requests can attach `Authorization: Bearer <accessToken>` to upstream calls and call `/auth/refresh` when the access expires.

The choice is the **container** for those tokens on the browser side. All viable options use httpOnly cookies (the access/refresh tokens MUST never be JS-readable). The differences are: one cookie or two, encrypted-at-rest or signed-only, JWT-shaped or opaque.

This decision **depends on TD-01 Option A**. Under TD-01 Options B/C, this TD is moot.

**Options:**

### Option A: Two plain httpOnly cookies — `st_access` (access JWT) + `st_refresh` (refresh JWT, `Path=/api/auth/refresh`)

Two separate `Set-Cookie` headers. Both `httpOnly`, `secure`, `sameSite=lax`. The access cookie has no path scope (sent on every same-origin request); the refresh cookie's `Path` is scoped to the refresh endpoint so the browser only sends it when refresh is actually invoked. No encryption layer — the cookie value is the raw JWT.

- **Pros:** Simplest possible mechanics — the BFF reads `cookies().get("st_access")?.value`, attaches it to the upstream `Authorization` header. Path-scoped refresh cookie minimizes refresh-token exposure across requests. No additional dependency. Cookie attributes are explicit and reviewable. Smallest amount of code on the FE side.
- **Cons:** **The JWT payload is base64-readable** — anyone who exfiltrates the cookie (via a cross-origin attack chain or a server-log breach) sees `userId`, `tokenFamily`, `iat`, `exp` immediately. (Mitigated structurally: `httpOnly` + `secure` + `sameSite=lax` + correct CORS config block ordinary exfiltration.) **No room for additional session metadata** without adding more cookies. **Two cookies to set/clear in tandem** — a logout that clears one and forgets the other leaves an orphan refresh cookie until expiry.

### Option B: Encrypted session container (`iron-session`) wrapping both tokens + minimal user fingerprint

Single httpOnly cookie (`st_session`) containing an `iron-session`-encrypted+signed object `{ accessToken, refreshToken, accessExpiresAt, userId }`. `getIronSession(cookies(), opts)` is called from every Route Handler / RSC / Server Action that needs session state. `session.save()` writes the cookie with all required attributes.

- **Pros:** **Encryption-at-rest in the cookie** — the JWT and userId are not visible to anyone with `document.cookie` access via XSS (`httpOnly` already blocks that) NOR to anyone reading server access logs that leak `Cookie:` headers. **Single cookie to manage** — one read, one write, one clear. **Tamper-evident** by signature — any modification of the cookie value invalidates the session at the next read. **Room for session metadata** (e.g., `userId`, `email`, `channelSlug` on the session object) lets RSC components read user identity without an extra `/auth/me` round-trip on every render. **First-class App Router support** — `iron-session` documents the `getIronSession(cookies(), …)` pattern explicitly for Next.js Route Handlers, RSC, and Server Actions. **Mature, focused dependency** (single concern, ~5 years stable, no transitive footprint). The session-secret env key (`SESSION_SECRET`) is one new key in `lib/env.ts` — fits cleanly into the existing `@t3-oss/env-nextjs` schema.
- **Cons:** Adds one dependency (`iron-session`) and one required env key (`SESSION_SECRET`, ≥32 chars). Cookie size grows ~30% from encryption overhead — still well under any browser/server limit (4KB typical), but worth noting. The single cookie is sent on every same-origin request including non-auth `/api/*` and even static asset requests under the app domain (the latter mitigated by `Path=/`); slightly larger request headers on every page load.

### Option C: Opaque session ID + server-side store (Redis / Postgres) keyed by ID

The cookie carries only a random session ID; the actual tokens live in a server-side store (Redis or a Postgres `sessions` table) keyed by that ID. Every request looks up the store to get the current access/refresh tokens.

- **Pros:** Server-side revocation is trivial (delete the row). Cookie payload is minimal (just an opaque ID). Tokens never leave the server filesystem.
- **Cons:** **Adds a server-side state store** that the architecture does NOT have today (no Redis in the stack; Postgres is on the backend, not on the FE Compose stack — adding a FE-side DB is a major infrastructure decision deferred elsewhere). **Every BFF request adds a store lookup** on top of the existing upstream Nest fetch — extra latency for no security gain over Option B (Option B's encrypted cookie is already tamper-evident and unreadable to the client). **Session-store choice is its own infrastructure TD** that this research is not equipped to make. Disqualified at the foundation phase by infrastructure cost; reconsider only if an explicit "instant server-side revocation across all sessions" requirement appears.

**Recommendation:** **Option B (`iron-session` encrypted container)**. Three reasons. (1) **Defense in depth on the cookie content** — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection; the marginal cost is one ~3KB dep. (2) **Single cookie to manage** simplifies logout (one `session.destroy()` call) and avoids the orphan-cookie failure mode of Option A. (3) **Room to carry minimal user metadata** (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render the authenticated chrome (avatar, channel name) without a per-render `/auth/me` round-trip — Phase 04+ gains compound here. Option A is a viable downgrade if the team rejects `iron-session` for any reason; the migration A→B (or B→A) is a one-Route-Handler refactor with no test changes downstream because the BFF interface is unchanged. Option C is rejected: it solves a problem (server-side revocation) the project does not have at the cost of infrastructure the project does not own.

**Decision:** B (`iron-session` encrypted container — single cookie carrying access + refresh + minimal user fingerprint)
**Libraries:** iron-session

---

## TD-03: Token Refresh Orchestration

**Scope:** Frontend

**Capability:** Login e controle de sessão do usuário

**Context:** Backend access tokens expire in ~15min (`phase-02-auth/TD-03`). The FE must replace expired access tokens using the refresh token without forcing the user to log in again. The choice is _where_ refresh is detected and orchestrated. Three placements are realistic: the BFF transparently refreshes on upstream 401, the client retries explicitly via `/api/auth/refresh`, or a background timer near expiry pre-empts the 401.

Under TD-01 Option A and TD-02 Option B, the session container holds both tokens and an `accessExpiresAt`. The BFF can therefore know proactively whether the access token is about to expire OR react retroactively to a 401 from upstream.

This TD composes with TD-02 (the cookie shape determines what "session" means in the BFF code) and feeds into TD-05 (mutation pathway — Server Actions vs Route Handlers — but refresh orchestration is the same regardless of pathway).

**Options:**

### Option A: Transparent BFF refresh on upstream 401 (lazy, server-driven)

Every Route Handler under `app/api/**` calls a small BFF helper `callUpstream(path, init)` that: (1) reads the session, (2) attaches `Authorization: Bearer <accessToken>`, (3) `fetch`-es Nest. If Nest returns 401, the helper calls `${env.API_URL}/auth/refresh` with the refresh token, updates the session cookie with the new tokens, retries the original request once, returns the result. Client-side fetch is oblivious — it never sees a 401-then-200; it only sees the final response.

- **Pros:** **Refresh is invisible to client code** — Components and forms call `/api/...` and receive the right data; refresh orchestration lives in one helper. Composes naturally with the rotation model in `phase-02-auth/TD-03` (which already mandates a single refresh per family — the BFF's serial in-process flow naturally serializes). **Single retry semantics** — the helper retries once on 401 and surfaces the second response (success or final auth failure) as-is. **No client-side timer to maintain across tabs**, no polling for refresh status. Plays well with the BFF integration tests already wired in `next-frontend-msw-foundation` — MSW can simulate a 401-then-200 sequence and assert the helper's retry behavior.
- **Cons:** **Concurrent BFF calls within the same client-page render can each see 401** before the first one finishes refreshing — leading to N parallel `/auth/refresh` requests. The backend's rotation model treats only one as valid; the rest see "refresh token reused → revoke family", killing the session. Mitigation: (a) a per-request-context single-flight (Promise dedup) on the BFF side; (b) accept the rare failure mode and let the user re-login (refresh races are uncommon in practice with 15min access tokens). The single-flight is ~10 LOC inside the helper, tested by MSW intercepting two parallel fetches. **The first call after a long idle period pays a ~50ms penalty** for the refresh round-trip — bounded and acceptable.

### Option B: Client-driven refresh — explicit `/api/auth/refresh` call from the browser on response 401

Client components / hooks wrap `fetch("/api/...")` with a "if 401, call `fetch('/api/auth/refresh', { method: 'POST' })`, then retry original" pattern. A `useAuthFetch()` hook centralizes this. The BFF Route Handler `/api/auth/refresh` reads the session, calls upstream `/auth/refresh`, updates the session cookie, returns 200/401.

- **Pros:** Refresh logic is visible at the call site. Browser controls retry timing.
- **Cons:** **Refresh is now a client-side concern**, which contradicts the BFF-centralization premise — every client fetcher must opt into the wrapper, otherwise plain `fetch` calls miss the refresh path. **RSC and Server Actions still need server-side refresh anyway** (they cannot run client-side hooks), so this option doesn't replace Option A — it duplicates it. **Race conditions on parallel client fetches** are even worse than Option A (no shared in-process state to single-flight against; multiple tabs can each trigger refresh independently). Higher overall complexity, no clean win.

### Option C: Background refresh timer (pre-emptive, client-driven)

A Client Component at the layout level sets a `setTimeout` for `accessExpiresAt - 60s` and pings `/api/auth/refresh` to refresh proactively. Avoids ever hitting an upstream 401.

- **Pros:** Eliminates the 401-and-retry latency entirely. Simple to reason about ("refresh fires once before expiry").
- **Cons:** **Requires a client-side Provider component that owns a timer** — adds a `"use client"` boundary near the root of `app/layout.tsx` for a concern that is otherwise server-driven. **Multiple tabs each run their own timer** → multiple refresh races (worse than Option A, which only refreshes when needed). **Tab/laptop-sleep edge cases** are notorious — `setTimeout` fires inconsistently across browser background-throttling, locked screens, system sleep — leading to either unnecessary refreshes or missed refreshes followed by a 401 anyway. **Wastes refresh tokens** when a session is idle (still rotates the refresh chain even when no real request is made), bloating the backend's `refresh_tokens` table. Strictly worse than Option A on every axis except the marginal latency win on the first post-idle request.

**Recommendation:** **Option A (Transparent BFF refresh on upstream 401, with per-request single-flight)**. The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A (RSC still needs server-side refresh) — adopting B means doing both. Option C's pre-emptive timer is rejected because the failure modes (multiple tabs, sleep/wake) outweigh the latency saving and force a `"use client"` shell near the root.

**Decision:** A (Transparent BFF refresh on upstream 401 with per-request single-flight)

---

## TD-04: Form Library and Client-Side Validation

**Scope:** Frontend

**Capability:** Telas de cadastro, login, confirmação de conta e recuperação de senha

**Context:** Phase 02 introduces the first user-input forms in the project: signup, login, forgot-password, reset-password (password + confirmation). All four have similar shapes (1-2 fields, async submit, error mapping from the backend's `{ error, message }` envelope). The choice of form-handling library shapes ergonomics for these four screens AND every form in Phases 03–07 (video upload metadata, comment composer, channel edit, search bar, filter chips). It also interacts with TD-05 (mutation pathway): some libraries are progressive-enhancement-first (tied to Server Actions), others are JS-first (tied to client `fetch`).

The project already uses Zod 4 (`next-frontend-config-base/TD-01`) for env validation. Reusing Zod for form validation is the obvious zero-friction path — the open question is which form library wraps Zod.

**Options:**

### Option A: `react-hook-form` + `@hookform/resolvers/zod`

The de facto React forms standard (~10M weekly DLs). `useForm({ resolver: zodResolver(schema) })`; `register("email")` wires inputs; `handleSubmit(onSubmit)` runs the schema and calls the submit handler. Schema is a Zod object; types are inferred (`z.infer<typeof signupSchema>`). Works identically with `fetch` to a Route Handler OR with a Server Action (`<form action={action}>` is supported via `useForm`'s `formMethods.handleSubmit`).

- **Pros:** **Mature, widely-known API** — most React developers can read a `useForm` block on first sight. **Excellent shadcn integration** — shadcn's `Form` primitive (`components/ui/form.tsx`) is built around `react-hook-form` and is the canonical consumer in `radix-nova` style; installing it via `npx shadcn@latest add form` produces components that ARE react-hook-form wrappers. **First-class Zod resolver** with full type inference end-to-end — the schema is the source of truth for both validation and TS types, matching the project's convention from `next-frontend-config-base/TD-01`. **Performance** — uncontrolled inputs by default, minimal re-renders even with many fields. **No coupling to a mutation pathway** — works with Route Handler `fetch` (TD-05 Option A) or Server Actions (TD-05 Option B) with the same code shape. **Active 2026 development** (v7.66+; React 19 supported). **Battle-tested error rendering** — `formState.errors` + `<FormMessage>` is the documented pattern.
- **Cons:** Adds two deps (`react-hook-form`, `@hookform/resolvers`). Slight learning curve for developers used to controlled `useState`-per-field forms — but trivial compared to learning a higher-level alternative.

### Option B: Conform (`@conform-to/react` + `@conform-to/zod`)

Designed for Server Actions and progressive enhancement. Forms work with JS disabled. The schema is shared between client validation and server-side validation in the action. `useForm` from Conform yields field metadata to wire `<input>` elements.

- **Pros:** **Progressive enhancement** — forms submit even without JS. **Server-side validation reuse** — the same Zod schema validates on the server (in the Action) and on the client. Newer-school API, Vercel-blessed in some Next.js docs.
- **Cons:** **Couples the form library to TD-05's choice** — Conform's value is in Server Actions; combined with TD-05 Option A (Route Handlers), most of Conform's advantage evaporates and it becomes "react-hook-form with a steeper API and smaller community". **Smaller ecosystem** — far fewer integration examples, no shadcn-canonical wrapper. **shadcn's `Form` primitive is react-hook-form-shaped** — adopting Conform means hand-writing form primitives or accepting a fork from the canonical shadcn `radix-nova` style. **Progressive enhancement is not a project goal** — the strict-BFF model already requires JS for everything beyond static reads (auth screens are interactive); the no-JS fallback is theoretical. **Higher onboarding cost** in a project with no prior Conform usage.

### Option C: Native HTML forms + Server Actions + manual `useFormState`/`useActionState`

No library. Each form is a `<form action={signupAction}>` with `useActionState` for pending/error state. Validation runs server-side in the Action via Zod; field errors come back in the action's return value and are rendered manually.

- **Pros:** Zero dependencies. Most idiomatic to Next.js 16's React 19 surface. Works without JS.
- **Cons:** **Manual error wiring per-field** — no `formState.errors` indirection; the Action must return a structured error object and the JSX must map it to fields by hand. Across 4 phase-02 screens × ~3 fields each, this is duplicate boilerplate that Options A/B abstract. **No client-side validation feedback** — Action runs server-side only, so "password too short" requires a server round-trip per attempt unless the developer hand-writes a parallel client-side validator (drift risk between client and server schemas, exactly what Zod-on-client solved). **Disqualifies the existing shadcn `Form` primitive** — `components/ui/form.tsx` (canonical in `radix-nova` style) IS a react-hook-form wrapper. Going Option C means either skipping shadcn's form primitive (a step backwards from the project's shadcn convention) or installing it but not using it. **Coupling to TD-05 Option B** — Option C is a Server-Action-only pattern; if TD-05 picks Route Handlers, Option C becomes "no library, no Server Action either", which means hand-rolled `useState` + `fetch` + `useState` for errors — explicitly the boilerplate Options A and B exist to eliminate.

**Recommendation:** **Option A (`react-hook-form` + `@hookform/resolvers/zod`)**. Three reasons. (1) **Decoupled from TD-05** — works with Route Handlers OR Server Actions; the form code does not change if TD-05 is revisited later. (2) **Aligned with shadcn's canonical form primitive** — the project already commits to `radix-nova` shadcn (`components.json`); `npx shadcn@latest add form` produces react-hook-form wrappers; choosing react-hook-form means using the supported primitive instead of hand-rolling around it. (3) **Zod-first developer ergonomics match the rest of the FE foundation** — `next-frontend-config-base/TD-01` chose Zod 4 for env; the same schemas-as-source-of-truth pattern carries to forms with zero new validator paradigm. Option B is rejected for impedance with shadcn's primitive and for over-investing in progressive-enhancement that the strict-BFF model does not require. Option C is rejected for the per-field boilerplate and the loss of client-side feedback on a project that values quick, type-safe form iteration.

**Decision:** A (`react-hook-form` + `@hookform/resolvers/zod`)
**Libraries:** react-hook-form, @hookform/resolvers

---

## TD-05: Mutation Submission Pathway (Server Actions vs. Route Handler `fetch`)

**Scope:** Frontend

**Capability:** Transversal — covers: "Cadastro de usuário com e-mail e senha", "Login e controle de sessão do usuário", "Logout", "Recuperação de senha: solicitação via e-mail → link com token → redefinição"

**Context:** Phase 02 is the first phase with user-initiated _writes_ (signup, login, logout, request-reset, reset-password, resend-confirmation). Every write call eventually reaches NestJS, but the FE has two viable paths to get there:

- **Route Handler POST + client `fetch`:** the form submits via `fetch("/api/auth/login", { method: "POST", body: JSON.stringify(values) })`; the Route Handler reads the body, calls upstream Nest, returns the response. Today's BFF integration tests already exercise this exact path.
- **Server Action:** the form binds `<form action={loginAction}>`; the Action runs server-side, calls upstream Nest directly, and returns either `redirect()` or a result the form renders. No client `fetch`; Next.js posts the FormData to a hidden Action endpoint.

Both paths are valid in Next.js 16. The choice affects: (a) the BFF integration test pattern (Route Handlers tested as functions vs. Actions tested as functions — both work but the existing test scaffold is Route-Handler-shaped per `next-frontend/CLAUDE.md` § Testing); (b) MSW interception URL (Route Handler path is constant; Server Action endpoint is auto-generated and version-coupled to the build); (c) consistency with the strict-BFF model (Route Handlers are explicitly the BFF surface; Server Actions are server-side too but bypass the explicit `app/api/**` BFF surface).

This TD is **independent of TD-04** (Option A `react-hook-form` works with both pathways).

**Options:**

### Option A: Route Handler POST + client `fetch` (form submits via XHR)

`<form>` is intercepted via `react-hook-form`'s `handleSubmit` (TD-04 A); the submit handler runs `fetch("/api/auth/login", { method: "POST", body: JSON.stringify(values) })`; the response shapes the next step (redirect on 200, field errors on 400 mapped from `phase-02-auth/TD-07`'s `error` codes). Cookies (per TD-02) are auto-attached as same-origin credentials.

- **Pros:** **1:1 with the strict BFF model already locked in `next-frontend-config-base/TD-03`** — the Route Handler is the explicit, named, reviewable BFF surface. **Test scaffold already in place** — `next-frontend/CLAUDE.md` § Testing and `next-frontend-msw-foundation` are written for "import the Route Handler as a function, build a `Request`, await the handler, MSW intercepts the upstream `fetch`". No test-pattern invention needed. **MSW URL stability** — the interception target is `${env.API_URL}/auth/login` (a Nest URL) and the Route Handler path is a stable file path; no auto-generated identifiers to track. **Compatible with both browser-side optimistic UI and progressive disclosure** — the JSON response gives the client full visibility into what happened. **OpenAPI-typed end-to-end** — the Route Handler request/response is typed via `paths` (`next-frontend-openapi-typing/TD-04`); the client `fetch` is typed via the BFF contract aliases in `lib/api/contracts.ts`.
- **Cons:** **No JS, no submit** — the form requires JavaScript to call `fetch`. Acceptable here: the strict-BFF model already requires JS for client interactivity, so this is not a regression. **Slightly more code** than Server Actions for the simplest forms (~5 extra LOC per submit handler vs. `<form action={action}>`).

### Option B: Server Action (form posts directly to a server function)

`<form action={loginAction}>`; `loginAction` is a Server Action that calls `${env.API_URL}/auth/login` directly. Returns a redirect or a structured error via `useActionState`. The Route Handler `app/api/auth/login/route.ts` does not exist for this flow.

- **Pros:** **Less per-screen code** — no client submit handler, no `fetch` boilerplate. **Progressive enhancement** — form works without JS. **Native React 19 + Next 16 idiom** — Server Actions are first-class. **Type inference end-to-end** — the Action's argument type is the form input shape.
- **Cons:** **Bypasses the explicit BFF surface defined in `next-frontend-config-base/TD-03`.** Server Actions ARE server-side, so they don't violate the "no browser→Nest" rule, but they don't appear in the explicit `app/api/**` BFF tree either — the integration surface fragments into "endpoints under `app/api/**`" + "Actions colocated near pages". **Test-pattern divergence** — Actions are tested as functions too, but the test file lives near the page (not under `app/api/**/__tests__/`); no test scaffold is written for this yet. **MSW interception still works** for the Action's outgoing `fetch` to Nest, but the existing `next-frontend-msw-foundation/TD-04` (universal-handler-set + per-test override) was reasoned about with Route Handler tests in mind. **Auth-cookie writes inside Server Actions** require explicit opt-in (`'use server'` boundary, `cookies().set()` in an Action mutates the response cookie) — works, but the failure mode of forgetting `await session.save()` inside an Action is harder to debug than the symmetric mistake in a Route Handler. **Mixing Server Actions for some flows and Route Handlers for others** (e.g., logout via Action, login via Route Handler) is the worst of both worlds; choosing Option B mid-project would force a wholesale move of every endpoint.

### Option C: Mixed — Server Actions for forms, Route Handlers for non-form mutations (e.g., logout button)

Each mutation picks the more idiomatic pathway. Form submits use Server Actions; non-form actions (logout button click, "resend confirmation" button) use Route Handler `fetch`.

- **Pros:** Each interaction uses the most ergonomic primitive for its shape. Logout-button-via-fetch matches "I'm clicking a button, not submitting a form".
- **Cons:** **Two integration surfaces to test, mock, and document.** Two BFF mental models. The decision of "is this a form or a button click" is fuzzier than it sounds (e.g., "submit comment" is a form, but "delete comment" is a button click — both are mutations on the same domain). The cost of the dual surface compounds across phases. Strictly worse than committing to one pathway.

**Recommendation:** **Option A (Route Handler POST + client `fetch`)**. Three reasons. (1) **Strict-BFF alignment.** `next-frontend-config-base/TD-03` named Route Handlers as the BFF surface; Option A keeps every mutation visible under `app/api/**`. (2) **Test scaffold already exists** — `next-frontend/CLAUDE.md` § Testing and `next-frontend-msw-foundation` were authored for Route-Handlers-as-functions; Option A reuses them with zero invention. (3) **Single mutation surface** — Phase 02 sets the precedent for Phases 03–07; uniformity beats per-mutation idiom-picking when the cost of inconsistency compounds (Option C). Option B has real ergonomic appeal for the simplest forms but fragments the BFF surface and forces test-pattern reinvention; if the team later wants progressive enhancement for specific forms, the migration A→B is per-form and doesn't require touching unrelated routes — A is the safer default and the cheaper baseline.

**Decision:** A (Route Handler POST + client `fetch`)

---

## TD-06: Session State Propagation to Client Components

**Scope:** Frontend

**Capability:** Login e controle de sessão do usuário

**Context:** Once the user is logged in (cookie set per TD-02), Client Components need to know "who am I, am I logged in?" — to render an avatar instead of a "Login" button, to show the current channel name, to disable form fields while a login mutation is in flight, etc. Phase 02 itself introduces minimal authenticated UI (just the post-login redirect target — possibly a stub home), but the propagation pattern set here is reused across every phase that has authenticated affordances.

Three placements are realistic. Each composes differently with TD-01 Option A + TD-02 Option B (the session is in an iron-session cookie, readable from any RSC / Server Action / Route Handler).

This TD is also a small instance of "API contract for the BFF": whether or not `/api/auth/me` exists shapes the BFF's surface area.

**Options:**

### Option A: Server-rendered session + React Context Provider rendered in RSC layout

`app/layout.tsx` (RSC) reads the session via `getIronSession(cookies(), opts)` and passes the user (or `null`) into a `<SessionProvider initialUser={...}>` Client Component that lives at the layout level. Client Components consume `useSession()` reading from the Context.

- **Pros:** **Zero client-side fetch on first render** — the session is already available when JS hydrates, no flicker between "guest" and "logged-in" UI. **Single render path** — the RSC reads the cookie once per request; everything below it sees a consistent user state for that request. **Works with React 19's RSC + Client Components seamlessly** — Context hydration is a documented pattern. **No new BFF endpoint** required. **Logout is automatic** at next navigation — the next RSC render reads no session and renders the Provider with `initialUser={null}`.
- **Cons:** **Client Components that need fresh session data after a mutation must trigger a router refresh** (`router.refresh()`) to re-render the RSC and update the Provider — works fine for login/logout (full page reload via redirect anyway) but requires an explicit `refresh()` after, e.g., a "change channel name" mutation in Phase 04. (Mitigation: a thin `useUpdateSession()` hook that calls `router.refresh()` is one line.) Slight conceptual model: the Provider is "read by Client Components, written by RSC" — needs a brief comment in the file but is otherwise standard.

### Option B: Dedicated `/api/auth/me` endpoint + Client `fetch` in a top-level Provider

A `GET /api/auth/me` Route Handler returns the user (or 401). A Client `<SessionProvider>` calls `fetch("/api/auth/me")` on mount, stores the result in state, and exposes `useSession()`. Mutations that change the session call `mutate("/api/auth/me")` (or equivalent) to refresh.

- **Pros:** **Client-driven cache invalidation** — any mutation can re-fetch `/api/auth/me` to update the global state without a router refresh. **Familiar SWR/React-Query-shaped pattern** if those libs ever enter the stack.
- **Cons:** **Double round-trip on every page load** — first the page render (server side), then the client fetches `/api/auth/me` to populate the Provider, causing a guest→authenticated flicker between hydration and the fetch resolving. **New BFF surface** (`/api/auth/me`) that exists only to bridge a gap Option A closes structurally. **Loss of authenticated RSC** — Server Components cannot read the Provider's state, so any RSC that needs the user (e.g., RSC layout rendering an avatar) must read the cookie directly anyway — meaning the cookie is read TWICE per request (once in RSC, once via the Client Provider's fetch). Worst-of-both-worlds.

### Option C: Cookie read directly per Client Component via a `useSession()` hook that does the round-trip

Each Client Component that needs the session calls `useSession()`, which `fetch`-es `/api/auth/me` on mount. No top-level Provider; each consumer manages its own loading state.

- **Pros:** Local — no shared state, no Provider tree.
- **Cons:** **N round-trips per page** for N session-aware Client Components. **N flickers**. **N spinners**. Strictly worse than Option B on every dimension; rejected.

**Recommendation:** **Option A (Server-rendered session + Provider rendered in RSC layout)**. Two reinforcing reasons. (1) **No first-render flicker, no round-trip** — the session is delivered in the same response as the page HTML; the Client Provider hydrates with the correct initial state; users never see "Login" briefly turn into their avatar. (2) **No new BFF endpoint** — the cookie is the source of truth, RSC reads it, the Provider broadcasts it; the BFF surface stays minimal. The `router.refresh()` requirement after mid-session mutations is a small price (one line in the relevant mutation handler) for the structural benefits. Option B is rejected for the double-read-and-flicker; Option C is dominated by Option B and rejected.

**Decision:** A (Server-rendered session + React Context Provider in RSC layout)

---

## TD-07: Email-Link Landing Pattern (Confirmation & Password-Reset URLs)

**Scope:** Frontend

**Capability:** Transversal — covers: "Confirmação de conta via e-mail com link de ativação", "Recuperação de senha: solicitação via e-mail → link com token → redefinição"

**Context:** Two backend flows send an email containing a URL with a one-time opaque token (`phase-02-auth/TD-04`):

- **Confirmation:** `https://app/.../confirm?token=<opaque>` — backend exposes a `POST /auth/confirm` endpoint that consumes the token, marks the account confirmed, returns success. The user just needs to land somewhere that triggers the call and shows a result.
- **Password reset:** `https://app/.../reset-password?token=<opaque>` — backend exposes `POST /auth/reset-password` that takes `{ token, newPassword }`. The user lands on a page, enters a new password, submits.

The two flows have different shapes. Confirmation is a one-shot side-effect (no user input needed beyond clicking the link). Reset is a two-step landing (display form, accept submission). The pattern chosen here applies to both, with the reset flow needing the form portion.

**Options:**

### Option A: RSC page processes the token server-side; Client form below for input-required flows

- **Confirmation route** `app/(auth)/confirm/page.tsx`: an async RSC reads `searchParams.token`, calls the BFF Route Handler `/api/auth/confirm` (or, equivalently, calls the upstream `POST /auth/confirm` directly via the same helper RSCs use elsewhere), branches on the result, and renders a "Account confirmed" or "Invalid/expired token" UI inline. No client interactivity required for the simple case.
- **Reset route** `app/(auth)/reset-password/page.tsx`: the RSC validates `searchParams.token` is non-empty, then renders a `<ResetPasswordForm token={token} />` Client Component (TD-04 form pattern) that POSTs `{ token, newPassword }` to `/api/auth/reset-password`. The token is passed to the Client Component as a prop, NOT re-read client-side from the URL — keeps the token off the client-side router state in the React tree.

- **Pros:** **Consistent with TD-05 Option A** for the form portion of reset. **Confirmation flow is purely server-side** — single network round-trip from the user's click to the rendered "confirmed" message; no JS required to display the result. **Bot-prefetch-safe** — gmail/outlook prefetchers fetch the URL silently; the RSC's call is to the backend's confirmation endpoint, which is single-use by design (`phase-02-auth/TD-04` opaque tokens are marked as used). The first prefetch consumes the token, but the user clicking the same link sees a "already confirmed / link expired" UI from the same RSC — a known behavior to handle, not a bug. **No client-side token leakage** — the reset token is bound to the form submission as a hidden field passed via prop; never lands in `window.history` state visible to React DevTools.
- **Cons:** **Email prefetching can pre-consume the confirmation token** — the user clicks the link and immediately sees "already confirmed" with no first-attempt success UI. Mitigation: the confirmation endpoint is idempotent on success and returns the same `confirmed: true` body the second time (a small backend behavior to verify, not a research-side TD); the FE renders "confirmed" cleanly either way. **RSC + searchParams** is a Next.js 16 idiom — small but real learning surface for developers used to client-side query parsing.

### Option B: Route Handler processes the token + redirects to a confirmation page (no RSC token reading)

The email link points to `/api/auth/confirm?token=...` — a GET Route Handler that calls the upstream confirm endpoint, then `redirect()`-s to `/auth/confirmed` (a static page) or `/auth/confirm-failed`. Reset flow analogous: link points to `/api/auth/reset-password-redirect?token=...`, the Route Handler validates the token shape, sets a short-lived signed cookie carrying the token, redirects to `/reset-password` (a static page), and the form on that page reads the token from the cookie.

- **Pros:** Token never appears in the post-redirect URL — slightly cleaner. The Route Handler can do the upstream call before the user sees any UI.
- **Cons:** **Email-link-to-Route-Handler is unconventional** in Next.js — most patterns route email links to pages, not API endpoints. **The reset case requires a token-bearing cookie hop** (Route Handler sets cookie → page reads cookie → form posts `{ tokenFromCookie, newPassword }`) — extra moving piece, extra failure mode (cookie not set due to SameSite mismatch breaks the flow). **Two redirects per confirmation click** (email-link → Route Handler → result page) — slower and noisier in network logs. **No clear gain over Option A's RSC pattern** for the simple case; introduces complexity for the reset case.

### Option C: Client-only landing — page renders, Client Component reads URL, calls BFF, branches

A static page renders skeleton; a `"use client"` component reads `useSearchParams()` for the token, calls `fetch("/api/auth/confirm", { method: "POST", body: { token } })` on mount, branches.

- **Pros:** Simplest mental model for a developer used to SPAs.
- **Cons:** **Loading flicker on every email-click** — the user sees a skeleton, then a result. **Email prefetchers don't run JS**, so the prefetch problem is dodged accidentally — but at the cost of ALL real users seeing the loading skeleton first. **No SSR result page** — the rendered HTML on the server is "loading...", not "Account confirmed", so screenshot/preview tools see useless content. **Token in the URL is read into client-side React state** — a slight increase in attack surface (the token is now in a hook, in DevTools, in component snapshots) compared to Option A's "RSC reads it once and doesn't pass it down" pattern. Strictly worse than Option A.

**Recommendation:** **Option A (RSC processes the token server-side; Client form below for reset's input step)**. Three reasons. (1) **First-paint-correct** — the user sees the right outcome on the first paint, no skeleton, no flicker. (2) **Single integration pattern across both flows** — confirmation is RSC-only; reset is RSC + Client form (TD-04, TD-05 patterns reused) — both share the "RSC owns the token, Client Component owns the input" split. (3) **Email-prefetch behavior** is solved at the backend's idempotent-confirmation level (a small note for `/plan-build` to confirm; not a separate TD). Option B's Route-Handler-as-link-target adds redirects for no clean gain. Option C is dominated.

**Decision:** A (RSC processes token server-side; Client form below for reset's input step)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|----------------|--------|
| TD-01 | Frontend | Authentication orchestration approach | **A** (Custom BFF cookie-based session) | **A** |
| TD-02 | Frontend | Session cookie strategy | **B** (`iron-session` encrypted container) | **B** |
| TD-03 | Frontend | Token refresh orchestration | **A** (Transparent BFF refresh on upstream 401, with single-flight) | **A** |
| TD-04 | Frontend | Form library and client-side validation | **A** (`react-hook-form` + `@hookform/resolvers/zod`) | **A** |
| TD-05 | Frontend | Mutation submission pathway | **A** (Route Handler POST + client `fetch`) | **A** |
| TD-06 | Frontend | Session state propagation to client components | **A** (Server-rendered session + Provider in RSC layout) | **A** |
| TD-07 | Frontend | Email-link landing pattern | **A** (RSC processes the token; Client form below for reset's input step) | **A** |

---

## Notes for downstream pipeline

- **This document is `scope_type: ad-hoc` with `related_phases: [2]`** (complementary frontend research to the existing backend slice `technical-decisions-phase-02-auth.md`). It is NOT a phase slice — to avoid the `AskUserQuestion` slug-collision branch the user explicitly opted out of, and because the backend doc was not authored with `covers_capabilities` declared. Aggregate capability coverage for Phase 02 is computed downstream by `plan-context` from BOTH this doc and the backend doc.
- **TD-01 → TD-02 dependency.** TD-02 only exists if TD-01 chooses Option A (custom BFF). If TD-01 swings to Option B (Auth.js), TD-02's question is answered by Auth.js's defaults and the TD becomes moot — `plan-resolve` should drop TD-02 in that case.
- **TD-03 composes with TD-02.** The single-flight refresh helper assumes the cookie shape from TD-02. The helper is one ~30-LOC module under `lib/auth/with-refresh.ts`.
- **TD-04 and TD-05 are independent** — both Recommendation choices (react-hook-form + Route Handler `fetch`) compose seamlessly, but the document is also internally coherent if TD-05 swings to Server Actions (TD-04 Option A still works; only the submit-handler shape changes).
- **TD-06 + TD-02 + TD-01 together imply** a `lib/auth/session.ts` module that wraps `getIronSession(cookies(), …)` and is the single read/write point for the session container. RSC layouts call it; Route Handlers call it; Server Actions (if TD-05 swings to B in the future) call it. One file; one set of session attributes (`userId`, `email`, `channelSlug`, `accessToken`, `refreshToken`, `accessExpiresAt`).
- **TD-07 has a small backend assumption:** the confirmation endpoint must be idempotent on the success case (re-confirming an already-confirmed account returns success rather than 400). This is a small `/plan-build` task to verify against the existing `phase-02-auth` backend implementation; it is NOT a backend decision change, just a behavior to confirm.
- **Implementation surface for `/plan-build` if recommendations are accepted:**
  - `next-frontend/lib/auth/session.ts` — iron-session wrapper, single read/write surface (TD-01 A + TD-02 B).
  - `next-frontend/lib/auth/with-refresh.ts` — single-flight upstream-call helper (TD-03 A).
  - `next-frontend/app/api/auth/{signup,login,logout,refresh,confirm,forgot-password,reset-password}/route.ts` — BFF Route Handlers (TD-05 A).
  - `next-frontend/app/(auth)/{signup,login,forgot-password,reset-password,confirm}/page.tsx` — auth screens; signup/login/forgot-password/reset-password use react-hook-form (TD-04 A); confirm + reset-password landing follow TD-07 A.
  - `next-frontend/components/auth/session-provider.tsx` — Client Provider (TD-06 A); rendered in `app/layout.tsx` with `initialUser` from RSC.
  - `next-frontend/mocks/handlers/auth.ts` — Phase 02's domain handler file (per `next-frontend-msw-foundation/TD-01`); barrel updated.
  - `next-frontend/lib/api/contracts.ts` — auth aliases (`User`, `LoginResponse`, `SignupResponse`, etc.) re-exporting `paths[...]` (per `next-frontend-openapi-typing/TD-04`).
  - `next-frontend/lib/env.ts` — adds `SESSION_SECRET` server-only key (per TD-02 B); `.env.example` updated.
  - `npx shadcn@latest add form input label button` — install the shadcn primitives the auth screens need.
  - Two new dependencies: `react-hook-form`, `@hookform/resolvers`, `iron-session` (three packages). No new dev-deps.
- **Existing FE scaffolding** (`app/login/page.tsx`, `components/auth/{brand-logo,auth-footer}.tsx`) is consumed and possibly re-routed by `/plan-build` (the `app/login/` path likely moves under an `app/(auth)/` route group for layout consistency across the four auth screens). Not a research-side decision.
- **`next-frontend/CLAUDE.md` updates** that `/plan-build` should land alongside the implementation: a brief "Auth & Sessions" section describing TD-01 A's BFF cookie model, the `lib/auth/session.ts` import contract, and the `react-hook-form`-based form pattern. The OpenAPI/MSW sections do not need changes (their conventions already cover auth endpoints generically).

Sources consulted during research:

- [iron-session — Next.js App Router Route Handlers / RSC / Server Actions usage](https://github.com/vvo/iron-session) — confirms `getIronSession(cookies(), opts)` is the canonical pattern for Next 13+ App Router (applies to Next 16); session-secret ≥32 chars; single-cookie encrypted+signed model.
- [Auth.js — Credentials provider with Next.js + JWT refresh-token rotation](https://authjs.dev/getting-started/authentication/credentials) and [refresh-token-rotation guide](https://authjs.dev/guides/basics/refresh-token-rotation) — confirms the awkwardness of rotating refresh tokens through the `jwt()` callback when the upstream backend single-uses each refresh, motivating TD-01's recommendation against Option B.
- [React Hook Form v7.66](https://react-hook-form.com) and [Resolvers (`@hookform/resolvers/zod`)](https://github.com/react-hook-form/resolvers) — confirms first-class Zod 4 support, React 19 compatibility, and the shadcn-canonical `Form` primitive contract.
- `next-frontend/CLAUDE.md` § Architecture / Talking to the NestJS API / Testing — strict-BFF model, MSW + Vitest + Route Handlers-as-functions test pattern.
- `docs/decisions/technical-decisions-phase-02-auth.md` (backend slice — already decided) — backend token model, error envelope, opaque email tokens; consumed as constraints.
- `docs/decisions/technical-decisions-next-frontend-config-base.md`, `…openapi-typing.md`, `…msw-foundation.md` — FE foundation locked-ins consumed throughout.
