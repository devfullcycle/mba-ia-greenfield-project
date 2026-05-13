---
scope_type: ad-hoc
related_phases: []
status: decided
date: 2026-05-13
scope_description: "How next-frontend consumes the openapi.json artifact produced by nestjs-project (openapi-docs-nestjs/TD-02, Option C): how the spec is brought into next-frontend's filesystem boundary under Docker bind-mount isolation, codegen tooling, when codegen runs and whether output is committed, how types are shared between the BFF Route Handlers (upstream → Nest) and the Components layer (browser → same-origin BFF), and how MSW handlers in the BFF integration tests reuse the same schema."
---

# Technical Decisions — next-frontend OpenAPI Typing

_Subprojects in scope:_

- `next-frontend/` — primary. Hosts the local copy of the spec, the codegen pipeline (npm script, generated output path, freshness check), and the generated types consumed by both BFF layer (`app/api/**/route.ts`) and Components layer (RSC and Client Components), plus MSW handlers (`mocks/handlers.ts`).
- `nestjs-project/` — **no open decision in this document.** The producer side is settled by `openapi-docs-nestjs/TD-02` (Option C, runtime UI + `openapi.json` exported artifact). This research only consumes that artifact. The Docker bind-mount isolation between the two subprojects (see TD-02 below) means the producer's file at `nestjs-project/openapi.json` is not directly readable from inside the `next-frontend` container — a copy under `next-frontend/` is required.

> Cross-doc anchors:
> - **Producer of the spec:** `openapi-docs-nestjs/TD-02` — the canonical artifact lives at `nestjs-project/openapi.json` and is committed in that subproject.
> - **Docker isolation constraint:** per `next-frontend/CLAUDE.md` § Development Environment, only `next-frontend/` is bind-mounted into its container (`/home/node/app`). The sibling `nestjs-project/openapi.json` is **not** visible inside the `next-frontend` container's filesystem; any codegen command run inside the container (CLAUDE.md mandates all `npm`/`npx`/`tsc` commands run inside the container) must read a path that resolves under `/home/node/app`. The two subprojects also run on **separate Docker Compose stacks** with no shared network (`next-frontend-config-base/TD-03` Context). This is the load-bearing constraint behind TD-02 (Spec Sourcing) — without it, codegen could read the producer file directly via a relative path.
> - **BFF architectural commitment:** `next-frontend-config-base/TD-03` (strict BFF — single server-only `API_URL`; browser calls only same-origin Route Handlers; backend URL never leaves the server) — this scopes WHO consumes the upstream Nest types (only the BFF) and WHO consumes the BFF-facing types (the Components layer).
> - **Testing model that uses MSW:** `next-frontend/CLAUDE.md` § Testing — BFF integration tests import Route Handlers as functions and let `msw/node` intercept the `fetch` they make to NestJS. Mocks model the NestJS upstream, not the BFF.
> - **Excluded option (deprecated):** `openapi-typescript-codegen` (ferdikoomen) was archived on 2024-05-01; all versions deprecated on npm; the upstream README explicitly redirects users to `@hey-api/openapi-ts`. Included in this document only for trace; not evaluated as a live option in TD-01.

---

## TD-01: OpenAPI Codegen Tooling

**Scope:** Frontend

**Trigger:** Select the codegen tool that converts the local copy of `openapi.json` (sourced per TD-02) into the TypeScript artifacts consumed by `next-frontend`. The choice constrains everything downstream — how much code is generated, whether a runtime client is produced, what plugins exist for MSW / TanStack Query / Zod, and how heavy the dependency footprint is.

**Context:** Today `next-frontend` has zero codegen tooling for the spec. Two consumer surfaces must end up typed:

- **BFF layer** (`app/api/**/route.ts`): calls upstream NestJS via `fetch(env.API_URL + path)`. Needs request body / response body / path-param / query-param types **for the NestJS endpoint shape**.
- **Components layer** (RSC and Client): calls same-origin Route Handlers via `fetch("/api/...")`. Needs request/response types **for the BFF shape** (which may equal the NestJS shape pass-through, or diverge if the BFF reshapes — addressed in TD-04).

Stack constraint: Next.js 16.2.6 + React 19.2.4, App Router, TypeScript strict. The project already uses **Zod 4** for env validation (`next-frontend-config-base/TD-01`) and `class-variance-authority` for component variants. There is currently **no** client-side data-fetching library (no TanStack Query, no SWR). MSW is committed but not yet wired (`mocks/handlers.ts` + `mocks/server.ts` pending bootstrap — see CLAUDE.md "Status — bootstrap pending"). The BFF model means the upstream Nest contract is touched **only inside server-side Route Handlers** — the browser never sees `paths`-typed code from the upstream spec.

**Input path constraint:** the chosen tool's CLI must accept a path resolvable inside the `next-frontend` container (e.g., `./openapi.json` relative to `/home/node/app`). The location and lifecycle of that local file are decided in TD-02; this TD only requires that the tool reads a single local file path.

**Options:**

### Option A: `openapi-typescript` + `openapi-fetch`

`openapi-typescript` (CLI) emits a single `.d.ts` file containing a `paths` interface that maps every operation in the spec to its request/response shapes — pure types, zero runtime cost. `openapi-fetch` is an optional ~6KB typed `fetch` wrapper that consumes the `paths` type and gives `client.GET("/videos", { params })` end-to-end typing without runtime schema validation.

- **Pros:** Smallest possible runtime footprint — types are erased at build, the optional client is one tiny dep used only on the server side (BFF layer). No generated request functions, no generated DTOs, no generated query hooks — output is one `.d.ts` file and you compose against it. Type-first, idiomatic to TypeScript strict mode (no `any`, no factory classes). Native MSW typing via the same `paths` symbol — `http.get<paths["/videos"]["get"]["responses"][200]["content"]["application/json"]>(...)` types a hand-written handler off the canonical schema without orval's generated boilerplate. Trivial integration with the existing `fetch`-based BFF (no client adapter for Route Handlers to learn). Maintained by the OpenAPI TS team; canonical `paths`/`components` types format reused by many other tools.
- **Cons:** No runtime validation of responses (a malformed upstream response surfaces as a TypeScript-typed-but-actually-wrong value); pair with Zod-derived parsing at the BFF boundary if needed. No generated SDK methods — every Route Handler builds the request manually (or via the thin `openapi-fetch` client). For a project that later wants per-endpoint TanStack Query hooks, a separate codegen step (`openapi-react-query` or hand-rolled) is required.

### Option B: `@hey-api/openapi-ts` (full SDK)

Direct successor of the now-deprecated `openapi-typescript-codegen`. Generates a complete TypeScript SDK with one function per operation, fully typed request/response objects, and pluggable HTTP clients (`@hey-api/client-fetch`, `@hey-api/client-next`, or others). Ecosystem includes plugins for Zod-schema generation, TanStack Query hooks, MSW handlers, and validators. Used at scale by Vercel and PayPal.

- **Pros:** Generated SDK methods (e.g., `getVideos({ query })`) replace hand-written `fetch` calls in Route Handlers — less boilerplate per endpoint as the API grows. Plugin system covers MSW, Zod runtime validation, and React-Query hooks from the same generator, which simplifies TD-05 and future runtime-validation TDs. `@hey-api/client-next` is purpose-built for App Router (handles RSC ↔ Route Handler context correctly).
- **Cons:** Significantly more generated code on disk and in the bundle — even with tree-shaking, the per-operation function machinery is heavier than zero-runtime types. The generated SDK becomes a third client style (alongside the existing `fetch`-based code) — every developer learns its conventions. Plugin matrix introduces version-coupling between `@hey-api/openapi-ts`, the chosen client plugin, and other plugins (TanStack Query, MSW); upgrades touch multiple packages. The runtime-client value is largely wasted in a strict BFF where only Route Handlers (server-side) call the upstream — no client-side calls to upstream means no client-side benefit from the SDK.

### Option C: Orval

Full-fledged codegen with built-in MSW handler generation (`mock: true`), client adapters for `fetch` / `axios` / `swr` / `@tanstack/react-query`, and a "tags-split" output mode that splits the SDK by OpenAPI tag. The MSW generation is the most opinionated: handlers are produced as a single file per tag with `faker`-based randomized responses.

- **Pros:** MSW handler generation is the most mature in this class — solves TD-05 in one config flag (`mock: true`) without writing MSW handlers manually. Native TanStack Query / SWR generators if those libraries enter the stack later. Single tool covers SDK + mocks + types in one config.
- **Cons:** Same critique as Option B (heavy SDK output, runtime-client surface unused by a strict BFF), plus the generated MSW handlers are `faker`-randomized and require per-test override anyway (`server.use(...)`) for deterministic assertions — the auto-generated mocks are scaffolding, not test data, so part of the value evaporates. Generated SDK conflicts with the existing fetch-based BFF idiom. Heavier dependency tree than Options A and B for the same end-user value in this project.

### Option D: Kubb

Plugin-based meta-framework: every output kind (TS types, Zod schemas, TanStack Query hooks, MSW handlers, SWR hooks) is a separate plugin you compose. Most flexible of the four; node 22+, TypeScript 6 ready.

- **Pros:** Most modular — you opt into exactly the plugins you need, so the output is smaller than orval's full SDK. Strong story for "later we will add Zod + TanStack Query + MSW" via incremental plugin adoption without re-platforming. Plugin architecture makes Kubb future-proof if new output formats matter (e.g., MCP servers).
- **Cons:** Plugin-API stability and learning curve — each plugin has its own config; the meta-framework abstraction is more to maintain than `openapi-typescript`'s one-flag CLI. Smaller ecosystem and team behind it than openapi-typescript or hey-api. For the foundation phase where only types are needed, this is a heavier choice for the same outcome Option A delivers in one CLI invocation and one `.d.ts` file.

**Recommendation:** **Option A (`openapi-typescript` + `openapi-fetch`)**. Three reinforcing reasons. (1) **Strict BFF makes the SDK surface valueless on the client.** Only Route Handlers ever call the upstream Nest; they already use `fetch` (Next 16's caching extensions sit on top of native `fetch`); a generated SDK adds a third client style to learn for zero functional gain. (2) **Types-first matches the rest of the FE foundation.** Env validation is Zod-derived types; component variants are `cva` types; both are TS-first with zero generated runtime. `paths` is the natural extension — one `.d.ts` file imported wherever the contract is touched. (3) **MSW typing is solved by the same `paths` symbol.** Hand-written handlers in `mocks/handlers.ts` type their resolver returns off `paths["/videos"]["get"]["responses"][200]`, giving the contract guarantee without orval/kubb's verbose generated handlers (which would be overridden per-test anyway). The marginal cost of adding `openapi-fetch` (~6KB, server-side only) is small enough that we recommend the **types + thin-client** pair, not types alone — `openapi-fetch` removes the `fetch(API_URL + path, { method, headers, body })` boilerplate in each Route Handler while staying within the BFF model. Options B/C/D may be revisited if (a) client-side data-fetching enters the stack with TanStack Query and per-endpoint hooks are wanted, or (b) the API grows beyond ~20 operations and per-call boilerplate becomes painful.

**Decision:** A (`openapi-typescript` + `openapi-fetch`)
**Libraries:** openapi-typescript, openapi-fetch

---

## TD-02: Spec Sourcing Under Docker Bind-Mount Isolation

**Scope:** Frontend

**Trigger:** Decide how `openapi.json` produced by `nestjs-project` becomes readable by the codegen command running inside the `next-frontend` Docker container — which only sees its own subproject directory at `/home/node/app`. The canonical artifact lives at `nestjs-project/openapi.json` (sibling on the host filesystem) but is **invisible inside the next-frontend container** under the current bind-mount setup.

**Context:** The constraint is concrete and load-bearing:

- `next-frontend/CLAUDE.md` § Development Environment: only `next-frontend/` is bind-mounted into the container (`/home/node/app`). The repo root and sibling subprojects are **not** mounted.
- The same CLAUDE.md mandates that every `npm`, `npx`, `node`, and `tsc` command runs **inside the container** (host execution is forbidden — wrong Node version, wrong working dir, wrong file ownership).
- The two subprojects also live on **separate Docker Compose stacks** with no shared network (`next-frontend-config-base/TD-03`). A future "shared compose network" infra task is mentioned in CLAUDE.md but explicitly deferred.

Combined: the codegen CLI (running inside `next-frontend`'s container) cannot read `../nestjs-project/openapi.json` because that path is outside the bind mount. It must read a file path that resolves under `/home/node/app`. This decision establishes how the spec reaches that path and how it stays current with the canonical producer copy.

This TD is **upstream of TD-03** (execution timing / freshness): whichever sourcing strategy is chosen here defines what TD-03's CI freshness check must verify (the sourced file matches the canonical producer, in addition to types matching the sourced file).

**Options:**

### Option A: Committed local copy at `next-frontend/openapi.json`, copied by hand

The developer who edits the backend spec also runs `cp nestjs-project/openapi.json next-frontend/openapi.json` from the repo root on the host, and commits both files in the same change. The next-frontend codegen reads from `./openapi.json` (relative to `/home/node/app`, i.e., the container's CWD).

- **Pros:** Zero infra changes. Both files are committed; the diff in PR shows the spec change in both places, doubling the visibility of contract changes. Works identically in CI, on fresh clones, and on any developer machine. No coupling between the two compose stacks. Reversible: if a shared bind mount lands later, this option is trivially superseded by deleting the copy.
- **Cons:** Two files to keep in sync, with no automation. Easy to forget — a backend PR that updates `nestjs-project/openapi.json` but not `next-frontend/openapi.json` ships drift unless CI catches it (TD-03's freshness check is what catches it; without that check, this option is fragile).

### Option B: Committed local copy + repo-root sync script

Same end-state as Option A (a committed `next-frontend/openapi.json`), but the copy is automated by a small sync script (`scripts/sync-openapi.sh` or a root-level npm script if the repo grows a root `package.json`). The script runs **on the host** (since it must read from outside any single container's bind mount) and writes into `next-frontend/openapi.json`. Developers run the script after every backend spec change; CI also runs it before TD-03's freshness check.

- **Pros:** Single command instead of remembering the `cp` invocation. Documentation can point to one canonical step (`bash scripts/sync-openapi.sh`). Combined with TD-03's freshness check, eliminates drift: if the script wasn't run, the freshness check fails the build. Foundation for richer sync logic later (e.g., post-processing, filtering paths, computing a checksum).
- **Cons:** Adds a script that lives at the repo root — slight friction for a monorepo that currently has no root-level tooling. Script runs on the host, not in any container, which adds a "host-only command" category alongside CLAUDE.md's existing host-only commands (compose / probes). Still requires the file copy to be committed.

### Option C: Docker Compose bind-mount of the canonical file into the container

Modify `next-frontend/docker-compose.yaml` to add a read-only bind mount of the producer file:

```yaml
volumes:
  - ./:/home/node/app
  - ../nestjs-project/openapi.json:/home/node/app/openapi.json:ro
```

The file is **not committed in `next-frontend/`** — it appears inside the container only at runtime, sourced live from the sibling subproject's actual file on the host disk. Codegen reads `./openapi.json` as in the other options, but the path resolves to the canonical producer file with no copy step.

- **Pros:** Zero drift possible — the codegen always reads the canonical file. No sync step, no double-commit. Smallest mental model: "the spec is one file, in `nestjs-project`."
- **Cons:** Couples `next-frontend`'s `docker-compose.yaml` to a relative path (`../nestjs-project/openapi.json`) that **only exists when both subprojects are co-located in the same parent directory** — which is true today but is a strong assumption for the FE compose file to bake in. Forces fresh-clone contributors to have the sibling subproject's `openapi.json` already generated before `next-frontend`'s container can even mount cleanly (or the mount target must be created as an empty file as a precondition). Breaks the conceptual independence between the two compose stacks (`next-frontend-config-base/TD-03` Context explicitly treats them as independent). Cross-platform fragility: Docker Desktop on Windows/macOS handles relative bind mounts via WSL2 / virtualization differently than Linux, increasing the chance of environment-specific bugs.

**Recommendation:** **Option B (committed local copy + repo-root sync script)**. Three reasons. (1) **Preserves the compose-stack independence** that `next-frontend-config-base/TD-03` Context calls out as the current architecture — neither subproject's compose file references the other. (2) **Drift is eliminated structurally when paired with TD-03's CI freshness check** — the check runs the sync script and asserts no diff on either `openapi.json` or `types.gen.ts`, so a backend PR that forgets to re-sync fails CI with a clear message. (3) **The committed local file is a real artifact in PR review** — reviewers see the contract change in `next-frontend/openapi.json`'s diff at the same time as the backend change, doubling the visibility (an `openapi.json`-only diff in a feature PR is a red flag for accidental drift). Option A is acceptable as a pre-CI fallback; Option C is rejected because the cross-stack file dependency in `docker-compose.yaml` introduces coupling that the current architecture explicitly avoids, and the "no drift" gain over B is small once TD-03 lands.

**Decision:** B (committed local copy at `next-frontend/openapi.json` + repo-root sync script)

---

## TD-03: Codegen Execution Timing & Output Commit Policy

**Scope:** Frontend

**Trigger:** Decide when codegen runs (manual npm script, `prebuild` hook, `postinstall`, CI step) and whether the generated TypeScript output is committed to the repo or treated as an ephemeral build artifact. The choice determines whether contract drift between the sourced `openapi.json` (TD-02) and `next-frontend`'s typed consumers is visible as a PR diff or only as a build failure.

**Context:** This TD applies after TD-02 places a sourced `openapi.json` inside `next-frontend/`. The codegen step reads that file and writes typed output (`lib/api/types.gen.ts` under Option A of TD-01). The two concerns are: (i) **visibility of contract changes** — should a spec-driven type change appear as a diff in the PR that introduces it, or stay invisible until someone runs codegen? (ii) **reproducibility / hermeticity of FE builds** — should `npm run build` always regenerate from `openapi.json` on disk, or trust a committed snapshot?

The choice depends on TD-01 only insofar as it determines what is generated (Option A: one `.d.ts` file; Options B/C/D: many files). The timing trade-off is orthogonal to the tool choice. The choice also **composes with TD-02**: under TD-02 Option B, the CI freshness check runs `bash scripts/sync-openapi.sh && npm run openapi:types && git diff --exit-code openapi.json lib/api/types.gen.ts` — both files are verified together.

**Options:**

### Option A: Generated output committed, regen on demand only

Add an npm script `openapi:types` that runs `openapi-typescript ./openapi.json -o ./lib/api/types.gen.ts` (path relative to `/home/node/app`). The developer (or the dev who edits a Nest controller) runs it manually after re-syncing per TD-02; the resulting `types.gen.ts` is committed. No CI verification.

- **Pros:** Contract changes appear as explicit PR diffs in `types.gen.ts` — code review catches breaking changes. Fresh clones get typed code immediately. `npm run build` does not depend on a fresh codegen pass. Simplest possible mental model.
- **Cons:** Easy to forget to run after editing the backend — the FE types drift silently until someone notices a `tsc` error in unrelated code. Two-step workflow for every backend contract change (sync + types).

### Option B: Generated on `prebuild`, not committed (ephemeral)

`types.gen.ts` is in `.gitignore`. `package.json` adds `"prebuild": "openapi-typescript ./openapi.json -o ./lib/api/types.gen.ts"` (and a parallel `predev`). Every build regenerates from the current `openapi.json` on disk.

- **Pros:** Cannot drift relative to the sourced spec — the spec on disk is always the source of truth for the build. Smaller repo. No PR noise from regenerated files.
- **Cons:** Contract changes are invisible in PR review — a breaking change in the spec appears only as a downstream `tsc` error in feature code, not as a clear diff on the contract itself. Fresh clones need to run `npm run prebuild` (or `npm run dev`) before the IDE shows correct types — friction for new contributors. Pairs poorly with TD-02 Option B: the value of seeing a committed `openapi.json` diff in PR is partially wasted if the typed consequence (`types.gen.ts`) is hidden.

### Option C: Committed + CI freshness check (hybrid)

Same as Option A (script + committed `types.gen.ts`), plus a CI job that runs the full sync+gen pipeline and `git diff --exit-code openapi.json lib/api/types.gen.ts` — fails the pipeline if either file is stale. Optionally a husky `pre-commit` hook does the same locally.

- **Pros:** Contract changes are PR-visible (Option A's strength) **and** drift is impossible to merge (Option B's strength). The CI check is ~5 lines of pipeline. Composes naturally with TD-02 Option B's sync script — the CI step runs the sync first, then codegen, then asserts both files are clean. Developer experience matches Option A for the happy path; mistakes are caught automatically.
- **Cons:** One extra CI step. The `git diff --exit-code` failure mode needs a clear "run `bash scripts/sync-openapi.sh && npm run openapi:types`" message in the job output so developers know how to fix it. Marginal complexity over A.

**Recommendation:** **Option C (committed + CI freshness check)**. It is the only option that makes contract drift _both_ visible (in PR diffs) _and_ impossible to merge accidentally (CI fail). The complexity premium over Option A is one CI step. Option B's "no committed artifacts" purity is poorly paid for in a monorepo where the cross-subproject build coupling becomes a real ergonomic cost, and it wastes the PR visibility that TD-02 Option B's committed `openapi.json` is specifically designed to deliver. Option A is acceptable as a temporary state until the CI pipeline lands; downgrading from C to A is reversible (just remove the CI step) but upgrading to C later requires explaining `types.gen.ts` history in a separate commit. Start at C. Apply the same script-and-check pattern to any future generated artifact (e.g., if `openapi-fetch` is wrapped, the wrapper file is hand-written; the only generated artifact remains `types.gen.ts`).

**Decision:** C (committed + CI freshness check covering `openapi.json` and `types.gen.ts`)

---

## TD-04: Type Sharing Between BFF Layer and Components Layer

**Scope:** Frontend

**Trigger:** Decide the contract relationship between the **upstream types** (what NestJS endpoints return) and the **BFF-facing types** (what Route Handlers return to Components). These are conceptually two contracts: the user explicitly asks how to ensure "Route Handlers share the same contract on both sides."

**Context:** Under the strict-BFF model (`next-frontend-config-base/TD-03`), every NestJS call goes through a Route Handler that the browser sees as a same-origin endpoint. The Route Handler can:

- **Pass through** — return exactly what NestJS returned (same shape, same status codes). The BFF is a thin proxy that exists for CORS/cookie/URL-hiding reasons, not for shape transformation. Most common case.
- **Reshape** — pick fields, rename keys, denormalize collections, drop server-only fields (e.g., strip an `internalId`). The BFF returns a contract that intentionally differs from the upstream.

Both styles occur in real BFFs, often in the same project. The decision is **how the FE codebase declares each style and how Components consume the result** — not whether one or the other is forbidden. The choice determines: where the type used by `<VideoCard video={...} />` comes from; whether components import a path-keyed type from the upstream spec or a feature-named alias; how a developer changing one Route Handler ensures Components consuming it stay typed.

**Options:**

### Option A: Pass-through-by-default with explicit aliases at one re-export point

A single barrel file `lib/api/contracts.ts` re-exports type aliases for every BFF-exposed shape:

```ts
import type { paths } from "./types.gen";
export type Video = paths["/videos/{id}"]["get"]["responses"][200]["content"]["application/json"];
export type VideoList = paths["/videos"]["get"]["responses"][200]["content"]["application/json"];
```

Route Handlers that pass through use these aliases as their `NextResponse.json<Video>(...)` return type, **and** Components import the same alias. When a Route Handler reshapes, it declares its own type explicitly and adds it to `lib/api/contracts.ts` (e.g., `export type VideoCard = Pick<Video, "id" | "title" | "thumbnailUrl">`), tagged inline with a JSDoc comment naming the route. Both layers always reference `contracts.ts`, never the raw `paths` type.

- **Pros:** One file is the source-of-truth for "what a Component sees". Components never index into `paths[...]` directly — they import named types. Reshapes are visible (a non-`paths[...]` alias signals "the BFF transforms this"). Refactoring a route's response (e.g., adding a field on the Nest side) updates the alias in one place and propagates everywhere. Works whether the BFF is pass-through or reshaping, without forcing one style.
- **Cons:** One file accumulates aliases as the API grows — could become a long file (mitigated by sectioning per feature). Developers must remember to add the alias when introducing a new route; nothing structurally forces it (lintable via a custom ESLint rule later if drift becomes a problem).

### Option B: Inferred return types from Route Handlers

Components derive their types from the Route Handler itself via `Awaited<ReturnType<typeof GET>>` patterns. The Route Handler is the source of truth; Components type-pull from it.

- **Pros:** Zero duplication. The Route Handler's return shape IS the type. Refactoring a route updates downstream callers automatically.
- **Cons:** A Route Handler returns `NextResponse` whose JSON body is not in the static return type — `NextResponse.json(x)` returns `NextResponse<typeof x>` only on the experimental typed routes path, which is brittle in App Router (the JSON body is not consistently inferred across Server / Client component boundaries). Pulling types across files via `typeof import("@/app/api/...")` couples Component build graphs to API route files — a non-trivial import shape that breaks easily under Next's RSC/Client boundary rules. Forces a specific style (pass-through becomes the default and reshapes become hostile). Not a stable foundation today.

### Option C: Two-tier — upstream `paths` type used internally + per-feature contracts file owned by each feature

Each feature folder owns its own contract file (e.g., `app/(videos)/_contracts.ts`) that re-exports / reshapes from `paths`. No global `lib/api/contracts.ts`.

- **Pros:** Co-location — feature owns its contract file, which lives with the feature code. Smaller files. No central god-file.
- **Cons:** Multiple sources of truth for "what does the BFF expose for X" — Components in different feature folders may pull the same upstream type via slightly different aliases, drifting over time. Discoverability is worse (no single place to grep for "what types does the BFF expose?"). Common DTOs duplicated across folders unless contributors deliberately import from another feature's `_contracts.ts`, which inverts the co-location principle.

**Recommendation:** **Option A (single `lib/api/contracts.ts` with explicit aliases)**. It is the only option that (i) handles pass-through and reshape with the same mechanism, (ii) gives a single grep target for "what shape does the BFF expose", and (iii) decouples Component imports from App Router file paths (Components import `from "@/lib/api/contracts"`, not `from "@/app/api/videos/route"`). Option B is theoretically minimal but fragile against Next's actual RSC/Client/Route-Handler typing; Option C scatters the contract surface and creates drift opportunities. The "long file" concern is bounded — for the scope of StreamTube, the BFF will likely have <30 contract aliases at peak; sectioning by feature header comments is sufficient. Make `lib/api/contracts.ts` the only file that imports `paths` from `types.gen.ts` (lintable later); every other consumer imports from `contracts.ts`.

**Decision:** A (single `lib/api/contracts.ts` with explicit aliases)

---

## TD-05: MSW Handler Typing Against the Generated Schema

**Scope:** Frontend

**Trigger:** Decide how `mocks/handlers.ts` (MSW handlers that intercept the BFF's `fetch` calls to NestJS in integration tests, per `next-frontend/CLAUDE.md`) reuses the same OpenAPI contract — so the mocks cannot drift from the real upstream response shape.

**Context:** MSW handlers in this project model the **NestJS upstream**, not the BFF (per the testing model in CLAUDE.md: "BFF integration tests import Route Handlers as functions; `msw/node` intercepts the `fetch` they make to the NestJS API"). The handler signature is roughly:

```ts
http.get("http://nestjs-api:3000/videos/:id", () => HttpResponse.json({ /* fixture */ }))
```

The question is how the `/* fixture */` is typed. Three approaches exist depending on whether codegen produces mocks for us. This decision depends on TD-01 (the available plugins differ per tool).

**Options:**

### Option A: Hand-written MSW handlers typed via `paths`

Handlers stay hand-written. The fixture body is typed via the `paths` symbol from `types.gen.ts`:

```ts
type GetVideoOk = paths["/videos/{id}"]["get"]["responses"][200]["content"]["application/json"];
http.get(`${UPSTREAM}/videos/:id`, () => HttpResponse.json<GetVideoOk>(fixture))
```

When the upstream contract changes, `tsc` fails on the fixture object — the test author updates the fixture. Per-test overrides via `server.use(...)` use the same typing.

- **Pros:** No additional codegen plugin or tool. Handlers are short and explicit — what each fixture returns is visible in the test file. Per-test overrides are trivial (just call `http.get(...)` with a different body). Zero faker / random data — fixtures are deterministic by construction (best for assertions). Reuses the canonical `paths` type already chosen in TD-01.
- **Cons:** Authoring overhead grows linearly with the number of intercepted endpoints — each new endpoint that BFF tests touch needs a handler written by hand. Style discipline is required (which UPSTREAM URL to use, which alias to import) — lintable, but not enforced by codegen.

### Option B: Auto-generated MSW handlers from the spec

If TD-01 picked a tool with MSW generation (orval `mock: true`, `@hey-api/openapi-ts` MSW plugin, kubb MSW plugin), the handler set for every operation is generated automatically with `faker`-randomized response bodies. Tests import the generated handlers as the baseline and override per-test.

- **Pros:** Zero per-endpoint authoring — generation covers every operation as soon as the spec adds it. New BFF tests can spin up against a fully-mocked upstream without writing any handler.
- **Cons:** Generated fixtures are `faker`-randomized, so they are useless for assertions on specific values — every meaningful test still overrides via `server.use(...)`, which is what hand-written handlers do directly. The generator's URL composition must match `env.API_URL`'s value at test time, which adds coupling between codegen config and runtime env. Forecloses Option A in TD-01 (requires a heavier codegen tool whose primary value is the SDK, not the mocks). For a foundation phase where the API surface is small (Phase 02 = auth + email = ~5-7 endpoints), the value-to-cost ratio is poor.

### Option C: Hybrid — generated scaffold, hand-tuned per feature

Generate once at bootstrap, copy the generated handlers into `mocks/handlers.ts` as a starting point, then maintain them by hand (commit the copy, do not regenerate). Future endpoints are added by hand.

- **Pros:** Saves the initial typing pass on day one of bootstrap.
- **Cons:** One-shot benefit only. After the first generation, this collapses into Option A but with an extra dependency that is no longer used. Generated faker fixtures are still randomized and need to be hand-edited to be useful in assertions. The "saved typing" is mostly an illusion — the boilerplate is small.

**Recommendation:** **Option A (hand-written, typed via `paths`)**. Reasons: (1) **Determinism over auto-generation** — BFF integration tests assert on specific values; randomized fixtures are anti-helpful. (2) **Coherence with TD-01 recommendation** — `openapi-typescript`'s `paths` type is the single contract anchor; reusing it in MSW handlers means "spec ↔ handler ↔ assertion" is one type chain. (3) **Scale fit** — Phase 02 introduces few endpoints; the manual cost is negligible at this stage. If the API grows to dozens of endpoints and authoring overhead becomes real, this TD can be superseded with a Kubb-or-hey-api MSW plugin without touching TD-01's `paths` import sites (the generator just produces additional handler files; the existing manual handlers stay valid). Option B locks the project into a heavier TD-01 choice for marginal mock-authoring savings; Option C is Option A with an unnecessary detour.

**Decision:** A (hand-written handlers, typed via `paths`)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|----------------|--------|
| TD-01 | Frontend | OpenAPI codegen tooling | **A** (`openapi-typescript` + `openapi-fetch`) | **A** |
| TD-02 | Frontend | Spec sourcing under Docker bind-mount isolation | **B** (committed local copy at `next-frontend/openapi.json` + repo-root sync script) | **B** |
| TD-03 | Frontend | Codegen execution timing & commit policy | **C** (committed + CI freshness check that covers both `openapi.json` and `types.gen.ts`) | **C** |
| TD-04 | Frontend | Type sharing between BFF and Components layers | **A** (single `lib/api/contracts.ts` with explicit aliases) | **A** |
| TD-05 | Frontend | MSW handler typing against the generated schema | **A** (hand-written handlers, typed via `paths`) | **A** |

---

## Notes for downstream pipeline

- This is an **orphan ad-hoc** (`related_phases: []`) decision document, in the same family as `openapi-docs-nestjs` (producer side) and `next-frontend-config-base` (FE foundation). It enables Phase 02+ FE work that touches the BFF without itself being a phase capability.
- **Docker bind-mount constraint is the load-bearing driver of TD-02.** If a future infra task introduces a shared Compose network (mentioned as "to be defined" in `next-frontend/CLAUDE.md` and in `next-frontend-config-base/TD-03` Notes), TD-02 may be revisited — but the committed-local-copy strategy stays valid regardless of the runtime network topology, because the issue is filesystem visibility from inside the container, not network reachability.
- TDs 03, 04, 05 are partially **coupled to TD-01**: choosing a heavier tool (Options B/C/D) reshapes the natural answers to TD-04 and TD-05 (e.g., a generated SDK in TD-01 favors importing SDK return types directly in TD-04; an MSW-plugin-bearing tool favors Option B in TD-05). The recommendations above form a **coherent set** assuming TD-01 is decided as A — if TD-01 swings to B/C/D, TDs 04 and 05 must be revisited.
- TD-02 and TD-03 **compose**: under TD-02 Option B and TD-03 Option C, the CI freshness check is one pipeline step that runs the sync script, runs the codegen script, and asserts no diff on `openapi.json` or `types.gen.ts`. Drift on either side fails CI with a clear remediation message.
- After decisions are made, the implementation surface for `/plan-build` will include: a host-runnable sync script (e.g., `scripts/sync-openapi.sh`) producing `next-frontend/openapi.json`, an npm script (`openapi:types`) inside `next-frontend`, a committed generated artifact (`next-frontend/lib/api/types.gen.ts`), the contracts barrel (`next-frontend/lib/api/contracts.ts`), a CI freshness check, and the MSW handler typing pattern documented in the test bootstrap task (separate task — `next-frontend-msw-foundation`, identified during `/decide` triage 2026-05-13).
- `next-frontend/CLAUDE.md` does not yet mention the codegen pipeline; once decisions are made, the "Talking to the NestJS API" section should reference `@/lib/api/contracts` as the canonical import target, the sync script as a host-only step in the Development Environment section, and the new npm scripts.

Sources consulted during research:
- [openapi-typescript & openapi-fetch documentation](https://openapi-ts.dev/) — types-first OpenAPI consumption.
- [Hey API (`@hey-api/openapi-ts`)](https://heyapi.dev/) — full-SDK codegen with Next.js client plugin.
- [Orval](https://orval.dev/) — SDK + MSW + TanStack Query codegen.
- [Kubb](https://kubb.dev/) — plugin-based meta-framework for OpenAPI codegen.
- [openapi-typescript-codegen archived notice](https://github.com/ferdikoomen/openapi-typescript-codegen/issues/2064) — confirms successor is `@hey-api/openapi-ts`.
