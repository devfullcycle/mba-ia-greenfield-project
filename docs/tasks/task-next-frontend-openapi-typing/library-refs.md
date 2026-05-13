---
libs:
  openapi-typescript:
    version: "^7.x"
    context7_id: "/websites/openapi-ts_dev"
    fetched_at: "2026-05-13T15:45:00-03:00"
  openapi-fetch:
    version: "^0.13.x"
    context7_id: "/websites/openapi-ts_dev"
    fetched_at: "2026-05-13T15:45:00-03:00"
sources_mtime:
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-05-13T15:43:57-03:00"
---

# Library References — task-next-frontend-openapi-typing

### openapi-typescript

**Purpose in this task:** convert `next-frontend/openapi.json` (the local copy of the NestJS spec, per TD-02) into a single typed `paths` interface emitted at `next-frontend/lib/api/types.gen.ts`. Pure types — no runtime emit, no client code, no SDK methods.

**Installation (dev-dep only — it's a CLI):**

```bash
npm install -D openapi-typescript typescript
```

**Canonical CLI invocation (used by TD-01 / TD-03):**

```bash
npx openapi-typescript ./openapi.json -o ./lib/api/types.gen.ts
```

Source: https://openapi-ts.dev/cli — `Transform Single Schema to TypeScript`.

The CLI accepts JSON or YAML input. The path is resolved relative to the CWD; inside the `next-frontend` container the CWD is `/home/node/app`, so `./openapi.json` resolves to the local copy materialized by the sync script (`scripts/sync-openapi.sh`, per TD-02 Option B).

**Output shape (what the SDK gets — useful when typing aliases in `lib/api/contracts.ts`, per TD-04):**

The emitted `.d.ts` exports two top-level types:

- `paths` — keyed by route template (e.g., `"/videos/{id}"`), each value is an object keyed by HTTP method (`get`, `post`, `put`, `delete`, `patch`). Each method maps to `parameters` (`path`, `query`, `header`, `cookie`), `requestBody`, and `responses` (keyed by status code → `content` → media type → schema).
- `components` — keyed by `schemas`, `parameters`, `requestBodies`, `responses`, etc., reflecting `#/components/*` of the OpenAPI document.

Typical indexing pattern for TD-04 aliases:

```ts
import type { paths } from "./types.gen";

// pass-through aliases
export type Video = paths["/videos/{id}"]["get"]["responses"][200]["content"]["application/json"];
export type VideoList = paths["/videos"]["get"]["responses"][200]["content"]["application/json"];

// reshape aliases
export type VideoCard = Pick<Video, "id" | "title" | "thumbnailUrl">;
```

**Notes for the npm script (TD-03 freshness check):**

- Add to `next-frontend/package.json`:
  ```json
  "scripts": {
    "openapi:types": "openapi-typescript ./openapi.json -o ./lib/api/types.gen.ts"
  }
  ```
- The CI freshness check runs (1) the host-side sync script and (2) `npm run openapi:types`, then `git diff --exit-code openapi.json lib/api/types.gen.ts`.
- `types.gen.ts` is committed (per TD-03 Option C) — `.gitignore` does NOT exclude it.

**Output sample (illustrative — actual content depends on the spec):**

```ts
export interface paths {
  "/videos/{id}": {
    get: {
      parameters: {
        path: { id: string };
      };
      responses: {
        200: {
          content: { "application/json": components["schemas"]["Video"] };
        };
        404: { /* ... */ };
      };
    };
  };
}
```

---

### openapi-fetch

**Purpose in this task:** thin (~6KB) typed `fetch` wrapper consumed inside `next-frontend`'s Route Handlers (BFF layer) when calling the upstream NestJS API. It is **server-side only** under the strict-BFF model — the browser never instantiates this client.

**Installation (runtime dep):**

```bash
npm install openapi-fetch
```

**Canonical client setup — server-only module (e.g., `lib/api/upstream.ts`):**

```ts
import "server-only";
import createClient from "openapi-fetch";
import type { paths } from "./types.gen";
import { env } from "@/lib/env";

export const upstream = createClient<paths>({
  baseUrl: env.API_URL,
});
```

Notes:
- `import "server-only"` (Next.js primitive) makes the module a build error if any Client Component imports it — defense-in-depth on top of the BFF model.
- `env.API_URL` is the server-only key validated by `@t3-oss/env-nextjs` (per `next-frontend-config-base/TD-03`).

**Usage in Route Handlers (the only consumer per BFF model):**

```ts
// app/api/videos/[id]/route.ts
import { NextResponse } from "next/server";
import { upstream } from "@/lib/api/upstream";
import type { Video } from "@/lib/api/contracts";

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { data, error, response } = await upstream.GET("/videos/{id}", {
    params: { path: { id: params.id } },
  });

  if (error) {
    return NextResponse.json(error, { status: response.status });
  }
  return NextResponse.json<Video>(data);
}
```

**Return shape — every method (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) returns:**

- `data` — typed to the 2XX response body when the request succeeded; `undefined` otherwise.
- `error` — typed to the union of 4XX/5XX/default response bodies when the request failed; `undefined` otherwise.
- `response` — the raw `Response` (carries `status`, `headers`, `url`).

The narrowing pattern is `if (error) { ... }` — TypeScript narrows `data` to `non-undefined` in the else branch.

**Query / path parameters and request body:**

- Path params live under `params.path`.
- Query params live under `params.query` — built off the spec's `parameters` entries with `in: query`.
- Request body lives under `body` (typed off the spec's `requestBody`).
- Headers per-call live under `headers`; merged with `client.use(...)` middleware (see below).

**URL-encoded bodies (for OAuth-style endpoints):**

```ts
await upstream.POST("/auth/token", {
  body: { clientId: "...", clientSecret: "..." },
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
});
```

`openapi-fetch` detects the `Content-Type` header and serializes the body accordingly.

**Middleware (`client.use(...)`) — useful for upstream auth headers, logging, error envelope unwrapping:**

```ts
import type { Middleware } from "openapi-fetch";

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    request.headers.set("Authorization", `Bearer ${getServerSession()}`);
    return request;
  },
  async onResponse({ response }) {
    // ... inspect status / headers
    return response;
  },
  async onError({ error }) {
    // wrap or log
    return error;
  },
};

upstream.use(authMiddleware);
```

Run middleware registration ONCE at module load — `client.use` is additive; calling it on every request multiplies handlers.

**MSW typing pattern (per TD-05):**

The `paths` type re-exported from `types.gen.ts` types both `openapi-fetch` AND the hand-written MSW handlers — one source of truth:

```ts
// mocks/handlers.ts
import { http, HttpResponse } from "msw";
import type { paths } from "@/lib/api/types.gen";

type GetVideoOk = paths["/videos/{id}"]["get"]["responses"][200]["content"]["application/json"];

export const handlers = [
  http.get(`${process.env.API_URL}/videos/:id`, () =>
    HttpResponse.json<GetVideoOk>({
      id: "abc",
      title: "Sample",
      // ... fields validated against the paths-derived type
    }),
  ),
];
```

When the upstream spec changes (regenerated `types.gen.ts`), `tsc` fails on stale fixture objects — the contract chain is end-to-end typed.

**Bundle impact note:** `openapi-fetch` lives only in server-side modules (`lib/api/upstream.ts` imports `server-only`); Next does not include it in the client bundle. The ~6KB cost is paid only on the Node side.

Sources:
- https://openapi-ts.dev/openapi-fetch — installation, `createClient`, methods, middleware.
- https://openapi-ts.dev/openapi-fetch/api — middleware API, content-type handling.
