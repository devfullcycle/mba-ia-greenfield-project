> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Route Handlers (`app/api/**/route.ts`)

Route handlers are the BFF (Backend-for-Frontend) layer. They export `GET`/`POST`/`PUT`/`PATCH`/`DELETE` functions that receive a `Request` (or `NextRequest`) and return a `Response`. In this project, they typically:

- Validate the incoming request,
- Forward to the NestJS API via `fetch`,
- Transform the NestJS response into the shape the client wants,
- Set cookies / headers (auth tokens, redirects).

This is the artifact type with the strongest testing contract in `next-frontend/CLAUDE.md`: route handlers are tested **as functions** (imported, called directly), and `msw/node` intercepts the `fetch` calls they make to NestJS. **No** Vitest test may hit the real NestJS API.

## What to test

- **Status codes** for each branch (200, 201, 400, 401, 403, 404, 500).
- **Response body shape** — does the BFF transform the NestJS payload as the client expects? This is the *integrity* concern.
- **Request validation** — malformed bodies, missing fields, invalid query params.
- **Auth handling** — does the handler read the auth cookie / header, forward it to NestJS, redirect / 401 when absent?
- **NestJS contract** — the URL, method, headers, and body the handler sends. MSW handlers act as living fixtures of that contract; if a fixture must change, the contract changed.
- **Error mapping** — NestJS returns 422, BFF maps it to what?

## Layer assignment

| Route-handler shape | Vitest `*.test.ts` (unit, mocked collaborators) | Vitest `*.integration.test.ts` (MSW) | Playwright E2E |
|---|---|---|---|
| Pure transformation, no `fetch` | ✅ unit | — | flow only |
| Proxy to NestJS (forward request, return response) | — | ✅ MSW for happy path + each error branch | flow only |
| Validation + proxy + transformation | ✅ unit-test the validation/transformation branches; **and** | ✅ MSW for the proxy contract | flow only |
| Sets cookies / redirects | — | ✅ assert on `response.headers.get("set-cookie")` / status 302 | flow only |

> Two layers are not redundant: the unit layer proves logic is correct against fixed inputs; the integration layer proves the NestJS contract (URL, method, body, headers) — which is the bug a unit test cannot catch because it doesn't make the HTTP call.

## Setup pattern — integration with MSW

`app/api/auth/login/__tests__/route.integration.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest"
import { http, HttpResponse } from "msw"
import { server } from "@/mocks/server"
import { POST } from "@/app/api/auth/login/route"

const API_URL = process.env.API_URL ?? "http://api.test"

describe("POST /api/auth/login", () => {
  it("forwards credentials to NestJS and returns 200 + token cookie", async () => {
    server.use(
      http.post(`${API_URL}/auth/login`, async ({ request }) => {
        const body = await request.json()
        expect(body).toEqual({ email: "u@e.com", password: "hunter2" })
        return HttpResponse.json({ accessToken: "jwt-xyz" })
      })
    )

    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "u@e.com", password: "hunter2" }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(res.headers.get("set-cookie")).toMatch(/access_token=jwt-xyz/)
    expect(await res.json()).toEqual({ ok: true })
  })

  it("returns 401 when NestJS rejects the credentials", async () => {
    server.use(
      http.post(`${API_URL}/auth/login`, () =>
        HttpResponse.json({ message: "Invalid credentials" }, { status: 401 })
      )
    )
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "u@e.com", password: "bad" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("returns 400 on an empty body without calling NestJS", async () => {
    let called = false
    server.use(
      http.post(`${API_URL}/auth/login`, () => {
        called = true
        return HttpResponse.json({}, { status: 200 })
      })
    )
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(called).toBe(false)
  })
})
```

## Setup pattern — unit (transformation only)

When a handler has pure transformation logic worth covering in isolation, factor it into a helper and unit-test the helper directly. Avoid the temptation to "unit test the handler with `fetch` mocked via `vi.mock`" — that's the anti-pattern; use the MSW integration test instead.

## When to skip

- The handler is a trivial passthrough with no transformation and no validation, and the same path is already covered by a Playwright E2E that proves it works end-to-end. (Rare — most handlers earn at least one MSW test.)

## Examples from this project

- No route handlers exist yet. The first ones (auth login, signup, video upload init) must have `*.integration.test.ts` files under `app/api/<route>/__tests__/` with MSW fixtures for the NestJS contract.

## Cross-references

- `../references/external-systems.md` — how MSW intercepts NestJS calls, where `API_URL` comes from.
- `../references/file-conventions.md` — Vitest config: `setupFiles`, `environment`, MSW server lifecycle.
- `../references/gotchas.md` — common BFF testing mistakes (missing handlers throw, request body parsing, `set-cookie` assertions).
