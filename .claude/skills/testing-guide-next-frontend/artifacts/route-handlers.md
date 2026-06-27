> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Route Handlers (`app/api/**/route.ts`, exporting `GET`/`POST`/`PUT`/`PATCH`/`DELETE`)

The BFF seam. Every browser request flows through a same-origin Route Handler that proxies to the upstream NestJS API via the typed `upstream` client. This is the single most test-worthy artifact type in `next-frontend`.

## What to test

- **Status-code mapping** — the handler reads `{ data, error, response }` from `upstream.X(...)` and must map upstream success/error to the right BFF status (e.g., pass through `response.status` on error, `200`/`201` on success).
- **Request → upstream translation** — correct upstream path, method, path/query params, and body forwarded. A wrong URL or body shape is a real bug MSW catches.
- **Response reshaping** — if the handler projects a subset/composed shape (a *reshape* alias from `contracts.ts`), assert the projected body, not the raw upstream body.
- **Branching** — auth/session presence, body validation rejection (400 before any upstream call), conditional upstream calls.
- **Session/cookie effects** — if the handler sets/clears `iron-session`-style cookies (login/logout), assert `Set-Cookie` behavior.
- **Contract coverage** — every endpoint the handler hits must have a hand-written MSW handler typed via `paths`; an uncovered fetch fails with `"request unhandled"`.

## Layer assignment

| Situation | Layer | What it validates |
|---|---|---|
| Handler proxies upstream (no branching) | **Integration** (`*.integration.test.ts` + MSW) | request→upstream translation + status/body mapping |
| Handler branches (auth check, validation, conditional upstream) | **Integration** (covers each branch end-to-end via MSW fixtures + `server.use` overrides) | branch outcomes against the wire contract |
| Handler extracts a **pure** helper (e.g., a body validator, a mapper with conditionals) | **Unit** (`*.test.ts`) for the helper **+** Integration for the handler | unit: the logic in isolation; integration: the handler wiring + contract |
| Validation is just Zod passthrough wiring | **Integration** — one test per endpoint proving rejection is wired (do not enumerate every Zod rule) | validator is wired |

Never write a Vitest unit test that renders or HTTP-calls the handler — call it **as a function**.

## Setup pattern

`*.integration.test.ts`, colocated in `app/api/<route>/__tests__/`. MSW lifecycle is global (`mocks/setup.ts`); per-case deviations via `server.use(...)`.

```ts
// app/api/auth/login/__tests__/route.integration.test.ts
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { env } from "@/lib/env";
import { server } from "@/mocks/server";

// Import the handler AFTER MSW is listening. Top-level static import is fine
// because mocks/setup.ts calls server.listen() in a global beforeAll; if the
// handler module reads env/inits at import time, prefer a dynamic import()
// inside the test (see references/gotchas.md — MSW dynamic-import note).
import { POST } from "@/app/api/auth/login/route";

describe("POST /api/auth/login", () => {
  it("forwards credentials and returns the session on 200", async () => {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com", password: "pw" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ /* asserted reshape fields */ });
  });

  it("maps an upstream 401 to a 401 BFF response", async () => {
    server.use(
      http.post(`${env.API_URL}/auth/login`, () =>
        HttpResponse.json({ message: "invalid" }, { status: 401 }),
      ),
    );

    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x@y.z", password: "bad" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
```

For handlers with route params, build a `NextRequest` and pass the `{ params }` context object the handler expects (see `.claude/rules/next-frontend-bff-api.md` for the param signature).

## When to skip

- Do not duplicate Zod rule-by-rule coverage at this layer — one wired-rejection test per endpoint is enough (rule-level validation lives in the schema's own unit test if it has custom refinements).
- Do not assert the raw upstream body when the handler reshapes — assert the reshape.
- Do not add a unit test that mocks `upstream` — that mocks the boundary the integration test exists to exercise.

## Examples from project

- `app/api/auth/{login,signup,logout,forgot-password}/route.ts` — **scaffolded, empty** as of 2026-05. When implemented: each gets a `*.integration.test.ts` covering the success path + the reserved-trigger error paths (`conflict@example.com` → 409, `badrequest@example.com` → 400 per the e2e trigger table; reuse the same `mocks/handlers/auth.ts` fixtures). `logout` additionally asserts cookie-clearing; `login` asserts session establishment.
- The MSW `auth` domain handler + factory must exist before these integration tests can run (`mocks/handlers/auth.ts`, `mocks/factories/auth.ts`) — see `references/external-systems.md`.
