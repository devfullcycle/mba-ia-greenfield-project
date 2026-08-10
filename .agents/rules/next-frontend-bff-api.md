---
paths:
  - 'next-frontend/app/api/**/route.ts'
  - 'next-frontend/lib/api/**/*.ts'
description: 'BFF Route Handlers and the typed upstream client — OpenAPI-anchored wire-shape pipeline'
---

# next-frontend — BFF API Rules

These rules govern the BFF (Backend-for-Frontend) layer: same-origin Route Handlers under `app/api/**` and the typed client at `lib/api/**`.

## File map

| File | Role | Edit by hand? |
|---|---|---|
| `next-frontend/openapi.json` | Committed local copy of the upstream OpenAPI spec. Lives here because the next-frontend container only sees its own subproject. | No — refreshed by `scripts/sync-openapi.sh` (repo-root, host-only). |
| `next-frontend/lib/api/types.gen.ts` | Generated `paths` interface; emitted by `openapi-typescript` from the local spec copy. | **Never.** Regenerate via `npm run openapi:types`. |
| `next-frontend/lib/api/upstream.ts` | Server-only typed HTTP client (`openapi-fetch` over `paths`). The **only** module that calls the upstream host. | Yes — sparingly (middleware, base config). |
| `next-frontend/lib/api/contracts.ts` | BFF↔components barrel. **The only file in the project authorized to import `paths` from `types.gen.ts`** (with the documented `mocks/` exception — see the MSW rule). Feature code consumes named aliases from here. | Yes — feature SIs append aliases as endpoints are wired. |

## Developer flow when the upstream contract changes

1. From repo root: `bash scripts/sync-openapi.sh` (host-only — refreshes `next-frontend/openapi.json` from the upstream source).
2. Inside the next-frontend container: `docker compose exec next-frontend npm run openapi:types` (regenerates `lib/api/types.gen.ts`).
3. `docker compose exec next-frontend npx tsc --noEmit` — surfaces every consumer that broke against the new contract.
4. Commit `next-frontend/openapi.json` AND `next-frontend/lib/api/types.gen.ts` **in the same PR**. Both are committed-by-design.

CI guard: `.github/workflows/openapi-freshness.yml` re-runs steps 1–2 and fails the PR if `git diff --exit-code` shows drift in either file. Merging a stale pair is structurally impossible.

## Consumption patterns

### Route Handler

```ts
// next-frontend/app/api/videos/[id]/route.ts
import { NextResponse } from "next/server";
import { upstream } from "@/lib/api/upstream";
import type { Video } from "@/lib/api/contracts";

export async function GET(
  _request: Request,
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

- Import `upstream` from `@/lib/api/upstream`. Never re-instantiate the client per-route; that would multiply middleware registrations.
- Return shapes typed via aliases from `@/lib/api/contracts` (NOT directly off `paths`).
- The destructured triple `{ data, error, response }` narrows by `if (error)`; in the else branch `data` is non-undefined.

### Adding a new alias to `lib/api/contracts.ts`

When a new endpoint is wired through the BFF, append an alias to `contracts.ts`:

```ts
// Pass-through alias — BFF returns the upstream shape as-is.
export type Video = paths["/videos/{id}"]["get"]["responses"][200]["content"]["application/json"];

// Reshape alias — BFF projects a subset; the name does NOT index `paths`.
export type VideoCard = Pick<Video, "id" | "title" | "thumbnailUrl">;
```

`contracts.ts` is the **only** file (outside `mocks/`) allowed to write `import type { paths } from "./types.gen"`. Feature code consumes the named aliases.

### `upstream.ts` — server-only invariant

The module starts with `import "server-only";` — a Next.js primitive that makes any Client Component import a build error. Do not remove it. Do not add `"use client"` to any file that imports `upstream`.

When adding middleware (e.g., upstream auth headers), register it **once** at module load:

```ts
import type { Middleware } from "openapi-fetch";

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    request.headers.set("Authorization", `Bearer ${getServerSession()}`);
    return request;
  },
};

upstream.use(authMiddleware);
```

`client.use(...)` is additive — calling it on every request multiplies handlers.

## What does NOT belong in this layer

- **No hand-written DTOs.** Every wire shape is derived from `paths`. If you find yourself defining `interface VideoResponse { ... }` by hand, you're bypassing the contract.
- **No raw `fetch(env.API_URL + ...)`** in Route Handlers. Use `upstream`.
- **No `paths` imports from feature components or hooks.** Components import named aliases from `@/lib/api/contracts`; hooks fetch from same-origin `/api/...` Route Handlers.
- **No upstream calls from the browser.** This is the BFF model — direct browser → upstream is forbidden (it would leak the backend URL and re-introduce CORS).

For the MSW handler typing convention (the documented exception to the "only `contracts.ts` imports `paths`" rule), see `next-frontend-msw-mocks.md`.
