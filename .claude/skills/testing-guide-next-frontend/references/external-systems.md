> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# External System Strategy

`next-frontend` depends on these external systems. Each row is fixed by the project's CLAUDE.md and must not be overridden per-test without a written reason.

| External system | Vitest strategy | Playwright strategy | Why |
|---|---|---|---|
| **NestJS API** (`nestjs-api` / `API_URL`) | **MSW (`msw/node`) intercepting `fetch`.** No real network calls. | Drives the running app; the app talks to whatever NestJS instance is wired (typically a real container in the same Compose stack). | The Vitest suite must be deterministic, isolated from the NestJS test suite, and runnable without the backend up. The HTTP contract is captured in `mocks/handlers.ts` and overridden per-test with `server.use(...)`. Playwright proves the real wire still works. |
| **Object Storage (S3/MinIO)** | Fake — when a route handler or hook calls a storage SDK directly, MSW intercepts the HTTP request to the storage endpoint or `vi.mock` the SDK module. | Use a real MinIO container in the Compose stack when E2E covers an upload/playback flow; otherwise fake via a fixture URL. | Real S3 has cost and network flakiness. MinIO in Docker is fine. |
| **Future external HTTP APIs** | Fake via MSW. | Fake via Playwright's `page.route(...)` mocking when the API is not safe to hit. | Rate limits, cost, flakiness. |
| **Email (SMTP)** | This concern lives in the NestJS API, not `next-frontend`. No setup here. | — | — |
| **Browser cookies / `localStorage`** | jsdom/happy-dom provides them; no extra setup. | Use Playwright's `storageState` for authenticated runs (`auth.setup.ts`). | Built-in tooling is enough. |

## MSW: where it lives, how it loads

Per `next-frontend/CLAUDE.md`:

```
mocks/
├── handlers.ts   # Default request handlers — one per NestJS endpoint touched by the BFF
└── server.ts     # setupServer(...handlers) — imported by Vitest setupFiles
```

`mocks/server.ts` (template — write when bootstrap lands):

```ts
import { setupServer } from "msw/node"
import { handlers } from "./handlers"

export const server = setupServer(...handlers)
```

`mocks/handlers.ts` (template):

```ts
import { http, HttpResponse } from "msw"

const API_URL = process.env.API_URL ?? "http://api.test"

export const handlers = [
  http.post(`${API_URL}/auth/login`, () =>
    HttpResponse.json({ accessToken: "test-token" })
  ),
  // Add one entry per NestJS endpoint touched by the BFF
]
```

`vitest.config.ts` (template — relevant parts only):

```ts
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import path from "node:path"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
    css: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
})
```

`vitest.setup.ts` (template):

```ts
import "@testing-library/jest-dom/vitest"
import { afterAll, afterEach, beforeAll } from "vitest"
import { server } from "./mocks/server"

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

> `onUnhandledRequest: "error"` is the safety rail: any `fetch` the BFF makes to an URL not declared in `handlers.ts` (or overridden via `server.use(...)`) throws, surfacing missing fixtures immediately. Without it, MSW would silently let the request through to the network — exactly the failure mode CLAUDE.md forbids.

## API_URL — single source of truth

Tests must read the NestJS base URL from the same env var the BFF uses (`API_URL` for server-side reads, per `next-frontend/CLAUDE.md`). Hardcoding `http://localhost:3000` inside fixtures or tests creates drift:

```ts
// ✅
const API_URL = process.env.API_URL ?? "http://api.test"
http.post(`${API_URL}/auth/login`, …)

// ❌ hardcoded — diverges from production wiring
http.post("http://localhost:3000/auth/login", …)
```

Set `API_URL` in `vitest.config.ts`'s `test.env` or in a `.env.test` file once.

## Playwright: where the real NestJS sits

Playwright runs against `npm run build && npm run start`. The Next.js app's server-side `fetch` calls reach whatever `API_URL` resolves to at runtime — typically the `nestjs-api` container. When the NestJS stack is unavailable, Playwright tests for flows that depend on it must be skipped (`test.skip`), not faked at the Playwright layer. Faking belongs in Vitest+MSW.

If you need to assert UI behavior independent of NestJS state (e.g., error toast on 500), use Playwright's `page.route` to mock the BFF response for that single test — but prefer to cover that branch in Vitest+MSW first, since it's faster and more isolated.
