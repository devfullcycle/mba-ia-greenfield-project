<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only the `next-frontend` container** — **never** start the Next.js dev server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting the container, always confirm it is up before proceeding:

```bash
docker compose ps   # next-frontend must show status "running"
```

The base image's command is `tail -f /dev/null`, so the container stays alive **without** booting Next. The dev server is only started on demand via `docker compose exec`.

If the dev server has been started, verify it actually serves before claiming success:

```bash
curl -I http://localhost:3001   # expect HTTP/1.1 200 OK
```

Only start `npm run dev` when the user **explicitly** asks to run the application — never as part of "start the environment".

## Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start container (from next-frontend/)
docker compose up -d

# Install dependencies (first time only)
docker compose exec next-frontend npm install

# Run the dev server (watch mode) — see "Long-running Processes" below
docker compose exec next-frontend npm run dev
```

Service:
- `next-frontend` — Next.js dev container, host port `3001` → container port `3000`. Browser accesses the app at **`http://localhost:3001`**.

Bind mount: the repo's `next-frontend/` directory is mounted at `/home/node/app` inside the container, so file edits on the host are reflected immediately.

Teardown and inspection commands run on the **host machine**:

```bash
# Verify the dev server is responding (after it has been started)
curl -I http://localhost:3001

# Check container logs
docker compose logs next-frontend

# Tear down
docker compose down
```

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and shadcn command runs **inside the container**, never on the host. Running on the host uses a different Node version, bypasses the container's working directory, and can leave artifacts owned by the wrong user on the bind mount.

### Container-only commands (always prefix with `docker compose exec next-frontend`)

```bash
npm run dev                              # Dev server with hot-reload (run in background)
npm run build                            # Production build (.next/)
npm run start                            # Serve the production build
npm run lint                             # ESLint (eslint-config-next)

npm test                                 # Vitest — unit + integration (run mode)
npm run test:watch                       # Vitest watch mode (run in background)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npx shadcn@latest add <component>        # Add a shadcn primitive — respects components.json
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs next-frontend
curl -I http://localhost:3001
```

**E2E tests run on the host (not inside any container).** Run them with `npx playwright test`:

```bash
# Run all E2E tests
npx playwright test

# Run a specific test file
npx playwright test tests/smoke.e2e-spec.ts

# Open the HTML report after a run
npx playwright show-report
```


## Long-running Processes

Commands that never exit (dev server, watch modes) must be run **in background** in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `npm run dev`, `npm run start`, `npm run test:watch`, and any other persistent process. After starting the dev server in background, validate with `curl -I http://localhost:3001`.

## Architecture

Next.js 16 App Router with React 19 Server Components by default. Routes, layouts, and pages live under `app/`.

- **Server Components** (default): can `fetch` from the NestJS API directly server-side. Prefer this for data loading — keeps payloads small and avoids client-side waterfalls.
- **Client Components** (`"use client"`): only when the component uses `useState`/`useEffect`/refs/browser APIs or interactive event handlers. Keep client boundaries as deep in the tree as possible.

### Talking to the NestJS API

This project follows a **strict BFF model**: the browser never talks to the NestJS API directly. All client traffic flows through same-origin Route Handlers under `app/api/**`, which then proxy to the upstream NestJS API server-side. This eliminates CORS, keeps the backend URL out of the client bundle, and gives a single integration surface for MSW-based BFF tests.

- **From the browser (Client Components):** fetch from same-origin Route Handlers only (e.g., `fetch("/api/videos")`). Direct calls to the NestJS API from the browser are forbidden.
- **From the server (Route Handlers, RSC, Server Actions):** read the upstream URL from `env.API_URL` (see `lib/env.ts`) and fetch from there. The Route Handler is the only layer that knows the backend address.

#### OpenAPI contract — single source of truth for wire shapes

The upstream API publishes an OpenAPI 3.x spec. **Every wire shape in `next-frontend/` — Route Handler requests/responses, MSW fixtures, BFF↔component types — is derived from that spec via generated types.** No DTO is hand-duplicated on the frontend; if a shape isn't in `paths`, it doesn't exist.

Contract chain: `openapi.json` (committed local copy) → `lib/api/types.gen.ts` (generated, do not edit) → `paths` (typed surface) → consumers (BFF + components + MSW).

CI guard: `.github/workflows/openapi-freshness.yml` blocks merging stale spec/types pairs.

Source of decisions: `docs/decisions/technical-decisions-next-frontend-openapi-typing.md` (TD-01…TD-05).

**Env var convention — single key, server-only:**

- `API_URL` — the upstream NestJS base URL. **Server-only**: validated and exposed via `lib/env.ts` (`@t3-oss/env-nextjs` + Zod 4). Accessing `env.API_URL` from a Client Component throws at runtime. There is **no** client-exposed (`NEXT_PUBLIC_*`) variant for the backend URL, and there must not be one — introducing a public backend URL would defeat the BFF model.
- `lib/env.ts` is the **source of truth** for environment variable reads in `next-frontend/`.
- See `.env.example` for the canonical key set and `lib/env.ts` for the `createEnv({ server, client, shared, ... })` schema.

The concrete value of `API_URL` depends on Docker Compose topology (e.g., `http://nestjs-api:3000` on a shared Compose network vs `http://host.docker.internal:3000` from a separate stack). The stacks are currently separate — networking integration is deferred to its own infra task; in the meantime, `.env.local` carries whichever value the local environment can reach.

Media streaming will eventually come from Object Storage (S3/MinIO) — TBD.

Refer to the C4 container diagram at `docs/diagrams/software-arch.mermaid` for the full system view.

## Testing

Stack decisions for this project:

- **Vitest** for unit and integration tests of pages, components, hooks, utils, and BFF route handlers.
- **Playwright** for end-to-end tests (full browser flow).
- **MSW (`msw` + `msw/node`)** as the fake API for BFF tests: route handlers are tested **as functions** — they are imported and called directly, while `msw/node` intercepts the `fetch` calls they make to the NestJS API and returns fixtures. BFF tests **never** point to the real NestJS API.
- **MSW (`msw/node` via `instrumentation.ts`)** as the fake API for E2E tests: the dev server boots server-side MSW so the **real** `/api/**` Route Handlers run; only their upstream NestJS `fetch` is faked, reusing the `mocks/` handler set (no browser-level/BFF handler set). See "E2E architecture" below.

## Test type selection — apply mechanically

The suffix is a contract. It drives the runner (Vitest vs. Playwright), where the file lives, and what is allowed inside it.

| Suffix | When | Runner | External I/O | Location |
|---|---|---|---|---|
| `*.test.ts` / `*.test.tsx` | **Unit** — pure logic, collaborators mocked (utils, hooks, a single component in isolation). | Vitest | Forbidden. | `__tests__/` next to the artifact. |
| `*.integration.test.ts` / `*.integration.test.tsx` | **Integration** — multiple artifacts wired together; route handlers called as functions with `msw/node` intercepting `fetch` to the upstream API. | Vitest | MSW only (no real network). | `__tests__/` next to the artifact. |
| `*.e2e-spec.ts` | **End-to-end** — full browser flow; real `/api/**` run server-side, upstream faked (see "E2E architecture"). | Playwright | server-side MSW via instrumentation — no real network. | `tests/` at root. |

Routing decision tree (apply in order; first match wins):

- Renders a component or invokes a hook/util in isolation with mocks for collaborators → **`*.test.ts`** (or `.tsx` if rendering JSX).
- Imports a route handler (`import { GET } from "@/app/api/.../route"`), builds a `Request`/`NextRequest`, calls the handler, and asserts on its `Response`, with MSW intercepting fetches to the upstream API → **`*.integration.test.ts`**.
- Drives the full app in a real browser (navigation, forms, assertions on rendered DOM) → **`*.e2e-spec.ts`** under `tests/`.

### Running tests during development

Run only what is relevant to the change in progress:

```bash
# Vitest (single file or pattern) — inside the container
docker compose exec next-frontend npm test -- path/to/file.test.ts

# Playwright (single spec) — on the HOST
npx playwright test tests/foo.e2e-spec.ts
```

### E2E test prerequisites — start the environment before running Playwright

Playwright runs on the **host** and targets the **containerized** dev server. Before running any `*.e2e-spec.ts`, the dev server must be running inside the container with `MSW_ENABLED=true`. Follow these steps in order:

```bash
# 1. Ensure the container is up (idempotent)
docker compose up -d

# 2. Start the dev server with MSW enabled — runs in background (never exits)
docker compose exec -d next-frontend sh -c "MSW_ENABLED=true npm run dev"

# 3. Wait until the server is ready (retries up to ~30 s)
curl --retry 15 --retry-delay 2 --retry-connrefused -I http://localhost:3001

# 4. Run the E2E suite on the host
npx playwright test

# Or a single spec
npx playwright test tests/xxxx.e2e-spec.ts
```

**Important rules:**
- Step 2 must use `MSW_ENABLED=true` — without it `instrumentation.ts` skips MSW and upstream calls will fail or hit the real NestJS API.
- Never add `webServer` to `playwright.config.ts` — Playwright must not manage the dev server process (it runs inside Docker, not on the host).
- If the dev server is already running from a previous session, skip steps 2–3 and go straight to step 4.

### MSW + Vitest — wired

Vitest roda em `environment: "node"` (default) e carrega `mocks/setup.ts` via `setupFiles`; MSW sobe com `onUnhandledRequest: "error"` — qualquer `fetch` não interceptado falha o teste com `"request unhandled"`. Layout de `mocks/` (handlers por domínio + barrel, factories, server).

### E2E architecture

Real browser → real Next.js (RSC, layouts, real `/api/**` Route Handlers server-side) → upstream NestJS **faked at the server**. Only the NestJS API is fake; real `iron-session` cookies are set, so auth/session flows are genuinely testable.

**Mechanism.**

1. `instrumentation.ts` `register()` — when `NEXT_RUNTIME === "nodejs"` **and** `MSW_ENABLED=true`, dynamically imports `mocks/server.ts` and calls `server.listen({ onUnhandledRequest: "bypass" })`.
2. Reuses the `mocks/` upstream handlers (same set as Vitest); no browser-level handler set, no `tests/handlers/`.
3. Per-scenario outcomes via **reserved trigger fixtures** in the shared handlers (e.g. `email: "conflict@example.com"` → 409, `"badrequest@example.com"` → 400; else success). No per-test `server.use()`. Keep the trigger table small.
4. Playwright runs on the **host** (`npx playwright test`, `http://localhost:3001`); the containerized `next dev` must run with `MSW_ENABLED=true`. No `webServer` in `playwright.config.ts` (dev server is containerized).

**Hard rules.**

- E2E specs **MUST NOT** browser-intercept `/api/**` (`page.route()` or any browser-level mock) — it short-circuits the Route Handlers.
- E2E specs **MUST NOT** reach a real NestJS API — upstream is always the server-side `mocks/` MSW.
- Upstream handlers are **shared** with Vitest — no E2E-only fork; per-scenario deviation is a reserved trigger fixture branch, not a runtime override. Trigger values must not collide with Vitest fixture values.
- `onUnhandledRequest`: `"error"` in Vitest, **`"bypass"`** in instrumentation — never copy `"error"` into `instrumentation.ts`.

## Stack Summary

Next.js App Router with React Server Components, TypeScript strict, React 19, Tailwind CSS v4 (CSS-first config via `@theme inline` in `app/globals.css` — there is NO `tailwind.config.js`), shadcn/ui (style `radix-nova`, baseColor `neutral`, `cssVariables: true`) on top of `radix-ui` primitives, `class-variance-authority` (`cva`) with extended `tailwind-merge`, custom SVG icon components in `components/icons/` (no external icon library), `Inter` + `Geist_Mono` fonts loaded via `next/font/google` in `app/layout.tsx`. Exact versions in `package.json`.

## Project Structure & Path Aliases

```
next-frontend/
├── app/                              # Next.js App Router (routes, layouts, pages)
│   ├── globals.css                   # Tokens + @theme inline + base layer
│   ├── layout.tsx                    # Root layout (fonts wired here)
│   ├── <route>/page.tsx
│   └── api/<route>/__tests__/        # Route handler integration tests (*.integration.test.ts)
├── components/
│   ├── ui/                           # shadcn primitives — ONLY add via shadcn CLI
│   ├── icons/                        # Custom SVG icon components
│   └── <feature>/__tests__/          # Component unit/integration tests (*.test.ts | *.integration.test.ts)
├── lib/
│   ├── utils.ts                      # `cn(...)` helper (clsx + extended tailwind-merge)
│   └── __tests__/                    # Utils tests (*.test.ts)
├── mocks/                            # MSW handlers + server (msw/node) — loaded by Vitest setupFiles AND instrumentation.ts
├── tests/                            # Playwright e2e (*.e2e-spec.ts) — real /api/** run; upstream NestJS faked server-side
└── components.json                   # shadcn config (do not edit by hand)
```

Path aliases live in `tsconfig.json` and `components.json` — `@/components`, `@/components/ui`, `@/components/icons`, `@/lib`, `@/lib/utils`, `@/hooks` (create when first hook is added).

## Design Tokens — Source of Truth

All design tokens live in **`app/globals.css`**, organized in three regions: `:root { … }` (light mode semantic + theme values), `@theme inline { … }` (Tailwind v4 token mapping exposing them as utility classes), and `@media (prefers-color-scheme: dark) :root { … }` (dark mode overrides).

## Static Assets & Images

- Static assets that ship with the app go in `public/` and are referenced as `/file.svg` (or via `<Image src="/file.svg" … />` from `next/image` when raster).

## Build Gates

Before declaring any task done in this subproject:

- `docker compose exec next-frontend npm run lint` exit 0.
- `docker compose exec next-frontend npx tsc --noEmit` exit 0.

## When in Doubt

- Compare against `components/ui/button.tsx` (canonical primitive) and `app/globals.css` (canonical token registry).
- If a Figma value has no matching token, ADD the token to `app/globals.css` first, then consume it — do not inline a hex/px value.
- If the design implies a missing shadcn primitive, install it via `npx shadcn@latest add <name>` rather than hand-rolling it.

# Figma MCP Integration Rules — next-frontend

These rules tell AI coding agents how to translate Figma designs into code for this project. They MUST be followed for every Figma-driven change.

## Figma Assets

- The Figma MCP server serves images and SVGs from a localhost endpoint embedded in the design payload.
- IMPORTANT: If the Figma MCP server returns a `localhost` source for an image or SVG, use that source directly.
- IMPORTANT: DO NOT install new icon packages — icons are custom SVG components under `@/components/icons/` (see the Icons section). Convert Figma SVG payloads into components there.
- IMPORTANT: DO NOT invent or insert placeholder images when a `localhost` source is provided.

## Required Figma-to-Code Flow

Follow this order for EVERY Figma-driven change. Do not skip steps.

1. **`get_design_context`** for the exact node(s). Primary input — returns React + Tailwind code, screenshots, and context hints.
2. If the response is too large or truncated, call **`get_metadata`** for a high-level node map, then re-fetch only the required node(s) with `get_design_context`.
3. **`get_screenshot`** for the node variant you are implementing. You MUST have both `get_design_context` and `get_screenshot` before writing code.
4. Download / inline any assets referenced in the payload (use the localhost sources).
5. **Translate**, do not transcribe. The MCP output is a REFERENCE — convert it to this project's conventions:
   - Replace raw hex colors with semantic tokens (`bg-primary`, `text-foreground`, …) or palette tokens.
   - Replace arbitrary spacing (`p-[17px]`) with the project's spacing scale.
   - Replace ad-hoc text classes (`text-base font-medium`) with the project's typography utilities (`text-label-md`, etc.).
   - Replace inline radii with `rounded-[var(--radius-*)]` tokens.
   - Swap absolute-positioned layouts for flex/grid where the design intent is a flow layout.
   - Reuse `@/components/ui/*` primitives (Button, etc.) instead of re-implementing them.
   - Server Components by default; add `"use client"` ONLY when the component uses state, effects, refs, or browser APIs.
6. **Validate** the rendered output against the Figma screenshot — pixel-level visual parity AND interactive states (hover, focus-visible, disabled, dark mode).
