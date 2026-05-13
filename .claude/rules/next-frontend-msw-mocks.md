---
paths:
  - 'next-frontend/mocks/**'
  - 'next-frontend/**/*.integration.test.ts'
  - 'next-frontend/**/*.integration.test.tsx'
description: 'MSW handler typing convention + Route Handler integration test pattern (paths-anchored fixtures)'
---

# next-frontend — MSW Mocks Rules

These rules govern MSW handler authoring (per-domain modules under `mocks/handlers/<domain>.ts`, the barrel, the `msw/node` server, and per-test `server.use(...)` overrides) and the BFF integration-test pattern that drives them.

## Where MSW lives

By convention, MSW lives under `next-frontend/mocks/`. The tree is per-domain — each phase contributes one new domain file plus one line in the barrel:

- `mocks/handlers/<domain>.ts` — handlers for a single API domain (e.g., `auth.ts`, `videos.ts`, `channels.ts`). One handler per `(method, path)` entry from the OpenAPI `paths`; per-test deviations layer via `server.use(...)`.
- `mocks/handlers/index.ts` — barrel re-export. Each phase appends one `import { handlers as <domain>Handlers } from "./<domain>"` line plus one spread into the exported `handlers` array.
- `mocks/factories/<domain>.ts` — response-body factories for the domain. Each shape exports a `buildX(overrides?: Partial<X>): X` function.
- `mocks/server.ts` — `setupServer(...handlers)` from `msw/node`, imported by Vitest's `setupFiles`.
- `mocks/setup.ts` — Vitest setup file that registers the MSW lifecycle (`listen` / `resetHandlers` / `close`).

Tests override fixtures per-case via `server.use(http.get(...))` inside `beforeEach` or individual `it` blocks.

## Lifecycle (Vitest `setupFiles`)

The MSW server is started once per Vitest run, reset between tests, and torn down at the end:

```ts
// next-frontend/mocks/setup.ts
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

`onUnhandledRequest: "error"` is load-bearing: any `fetch` that escapes the handler set fails the test loudly with `"request unhandled"`. That is the discipline that keeps the coverage matrix in sync with the contract — there is no silent passthrough to the real network.

`resetHandlers` runs after every test so a `server.use(...)` override in one test does not leak into the next.

## Factories convention

Hand-written deterministic factories under `mocks/factories/<domain>.ts` are the default. Every shape gets a `buildX(overrides?: Partial<X>): X` function that composes a hand-coded `baseX: X` literal with the caller's overrides:

```ts
// next-frontend/mocks/factories/<domain>.ts
import type { User } from "@/lib/api/contracts";

const baseUser: User = {
  id: "user-1",
  email: "alice@example.com",
  // mirror User from @/lib/api/contracts verbatim
};
export const buildUser = (overrides: Partial<User> = {}): User => ({
  ...baseUser,
  ...overrides,
});
```

`@faker-js/faker` is **opt-in** and scoped to bulk-collection builders only (e.g., `buildVideoList(n, seed)`). When used, call `faker.seed(N)` **immediately before** generating the collection so determinism is local to that builder and does not interact with the global cursor. Faker is not installed at foundation — the first phase that authors a `buildXList` triggers the install.

## Route Handler + MSW integration test pattern

For every test under `app/api/**/__tests__/*.integration.test.ts`:

1. **Import the handler directly from the route module** — `import { GET, POST } from "@/app/api/.../route"`.
2. **Construct a `Request`** (or `NextRequest`) with the URL, method, headers, and body the handler expects, then `await` the handler.
3. **`msw/node` intercepts** the `fetch` calls the handler makes to the upstream API — configured **once** in Vitest's `setupFiles` (see `mocks/setup.ts` and `mocks/server.ts`) — and returns fixtures defined in `mocks/handlers/<domain>.ts` (override per-test with `server.use(...)`).
4. **Assert on the `Response`** returned by the handler: status, headers, JSON body.

Why this pattern: it isolates the BFF from the upstream suite (no cross-project test coupling), is fully deterministic, and runs at unit-test speed. Any change to the upstream contract is reflected in the fixtures, not by hitting a live service.

## Typing convention — paths-anchored, hand-written

Handlers in `mocks/handlers/<domain>.ts` (and per-test `server.use(...)` overrides) **MUST** type their fixture bodies via the same `paths` symbol that types the BFF's `openapi-fetch` client. The contract chain — `openapi.json` → `lib/api/types.gen.ts` → `paths` → handler fixture — is end-to-end typed, so a stale fixture fails `tsc --noEmit` after `types.gen.ts` regenerates.

**Hand-written handlers only.** No `faker`-randomized auto-generated handlers — BFF integration tests need deterministic fixture bodies to assert on specific values.

```ts
// next-frontend/mocks/handlers/auth.ts
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

### Exception to the contracts-barrel rule

The BFF rule (`next-frontend-bff-api.md`) says **only** `lib/api/contracts.ts` may import `paths` directly from `@/lib/api/types.gen`. **Modules under `mocks/` are the documented exception** — they import `paths` directly because their job is to mirror the wire shape, not to expose named aliases. Feature code (Route Handlers, Components) still imports named aliases from `@/lib/api/contracts`.

### Per-test overrides reuse the same indexing pattern

```ts
server.use(
  http.get(`${env.API_URL}/videos/:id`, () =>
    HttpResponse.json<paths["/videos/{id}"]["get"]["responses"][404]["content"]["application/json"]>(
      { /* error fixture body */ },
      { status: 404 },
    ),
  ),
);
```

### URL composition

Use `${env.API_URL}/...` so the handler matches the value the BFF actually calls — the test runtime sets `API_URL` to whatever the test environment routes through.

### Endpoint coverage

Every endpoint added to the BFF's `paths` index **MUST** have a corresponding hand-written handler (or per-test override) before its integration test can run. `msw/node` fails with `"request unhandled"` if a fetch goes unintercepted — that is the discipline that keeps the coverage matrix in sync with the contract.
