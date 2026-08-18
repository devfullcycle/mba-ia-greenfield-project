---
scope_type: ad-hoc
related_phases: []
status: decided
date: 2026-05-13
scope_description: "MSW (Mock Service Worker) foundation for next-frontend: handler module organization across domains/phases, separation between Node test handlers (msw/node) and browser dev handlers (msw/browser Service Worker), response builder/factory strategy (with or without faker-js), and how each phase exposes its handler set to that phase's tests."
---

# Technical Decisions — next-frontend MSW Foundation

_Subprojects in scope:_

- `next-frontend/` — primary and only subproject. Hosts the `mocks/` tree (`mocks/handlers/`, `mocks/factories/`, `mocks/server.ts`, optional `mocks/browser.ts`), the MSW dependencies, the Vitest setupFiles wiring (`vitest.config.ts`), and the optional Service Worker artifact under `public/mockServiceWorker.js` if browser-mode is wired.
- `nestjs-project/` — **no open decision in this document.** MSW lives entirely on the FE side and only intercepts the BFF's `fetch` calls to the upstream NestJS API; the backend is the contract source (via `openapi.json`) and is otherwise unaffected. The contract anchor is settled by `next-frontend-openapi-typing/TD-05` (hand-written handlers, fixtures typed via `paths`).

> Cross-doc anchors (already decided — do not reopen):
> - **Hand-written handlers typed via `paths`:** `next-frontend-openapi-typing/TD-05`. Auto-generated MSW handlers (orval `mock: true`, hey-api MSW plugin, etc.) are explicitly rejected. Every TD below assumes the handler bodies are hand-written and typed via `paths["/route"]["method"]["responses"][status]["content"]["application/json"]`.
> - **MSW v2 (`msw` + `msw/node`) chosen as the BFF test fake:** `next-frontend/CLAUDE.md` § Testing. Vitest as runner; BFF Route Handlers tested **as functions** (imported and invoked directly); `msw/node` intercepts the `fetch` they make to NestJS.
> - **Canonical file map and `mocks/` exception:** `.claude/rules/next-frontend-msw-mocks.md` and `.claude/rules/next-frontend-bff-api.md`. The `mocks/` tree is the only place outside `lib/api/contracts.ts` allowed to import `paths` from `@/lib/api/types.gen` directly — because its job is to mirror wire shapes, not expose named aliases.
> - **URL composition:** handlers match `${env.API_URL}/...` (the upstream URL the BFF actually calls). `env.API_URL` is server-only per `next-frontend-config-base/TD-03` Option A (Strict BFF — single server-only key).
> - **Determinism principle (locked):** TD-05 rejects randomized fixture bodies for BFF integration tests. The factory TD below (TD-03) operates strictly inside that constraint — any builder must produce deterministic output by default.

This research builds the **structural foundation** on which Phase 02+ adds endpoints. It is intentionally orphan ad-hoc (`related_phases: []`) — Phase 02 (auth) and beyond will each contribute one domain module to the structure decided here, without re-researching the structure.

---

## TD-01: Handler Module Organization & Phase Expansion Model

**Scope:** Frontend

**Trigger:** Decide how `mocks/handlers.ts` (the file `next-frontend/CLAUDE.md` and `next-frontend-msw-mocks.md` currently reference as a single artifact) is organized internally as the BFF grows from ~5 endpoints in Phase 02 to ~30+ across Phases 02–07. The "phase only adds the routes it owns" requirement is the user's explicit ask — the chosen structure must make per-phase additions append-only, with minimal merge conflict surface and clear ownership.

**Context:** Today `mocks/` does not exist (bootstrap pending per CLAUDE.md). Two consumer surfaces will read whatever this structure produces:

- **Vitest setupFiles** → `setupServer(...allHandlers)` once at suite startup (`mocks/server.ts`).
- **Per-test `server.use(...)` overrides** inside `beforeEach` or individual `it` blocks (canonical MSW v2 override pattern — see the MSW docs' "Override handlers at runtime" recipe).

The single-file `mocks/handlers.ts` shown in `.claude/rules/next-frontend-msw-mocks.md` is the **minimum viable shape**, not a structural mandate; the rule's example is one file because no decision has been made yet about how to grow it. This TD makes that decision.

Reference: MSW's official "Structuring handlers" best-practice page recommends per-domain modules composed via a barrel `mocks/handlers/index.ts` for any non-trivial mock surface.

**Options:**

### Option A: Single flat `mocks/handlers.ts` (status-quo example)

All handlers live in one file. Phase 02 appends auth handlers below an `// === Auth ===` comment; Phase 03 appends video handlers below `// === Videos ===`; etc. `mocks/server.ts` imports `handlers` as-is.

- **Pros:** Smallest possible footprint — one file, one import path, zero indirection. Easy to grep "where is the GET /videos/:id handler" — just open the file.
- **Cons:** Merge conflict surface grows with team size and concurrent phases (Phase 02 and Phase 03 PRs both touch the bottom of the same file). No structural separation between domains — discipline relies on section comments. Authoring two endpoints for different domains in the same file blurs ownership. Scales poorly past ~10–15 endpoints (the file becomes long enough that scrolling beats searching).

### Option B: Per-domain modules + barrel (MSW's recommended pattern)

```
mocks/
  handlers/
    auth.ts            # Phase 02 owns this file
    videos.ts          # Phase 03–05 own this file
    channels.ts        # Phase 04 owns this file
    comments.ts        # Phase 06 owns this file
    likes.ts           # Phase 06 owns this file
    search.ts          # Phase 07 owns this file
    index.ts           # barrel — composes all into a single `handlers` array
  factories/           # see TD-03
  server.ts            # setupServer(...handlers) — imports from handlers/index.ts
```

Each domain file exports `export const handlers = [...]`. The barrel spreads them:

```ts
// mocks/handlers/index.ts
import { handlers as authHandlers } from "./auth";
import { handlers as videosHandlers } from "./videos";
export const handlers = [...authHandlers, ...videosHandlers];
```

Phase NN's contribution = one new file under `handlers/` + one line appended to `handlers/index.ts`.

- **Pros:** Matches MSW's official recommendation. Domain ownership is structural, not by-comment — a Phase 02 PR touches `handlers/auth.ts` and one line in `handlers/index.ts`; a Phase 03 PR touches `handlers/videos.ts` and one line in the barrel. Merge conflicts in the barrel are trivial (one-line append). Per-domain files stay short enough to read top-to-bottom. Future Storybook / Playwright workers can import a single domain's handlers (`import { handlers as authHandlers } from "@/mocks/handlers/auth"`) when scoped fixtures matter. Naturally aligns with the codebase's existing per-domain organization (`components/<feature>/`, future `app/api/<domain>/`).
- **Cons:** Two files to touch per phase instead of one (the domain file + the barrel). Minor mental tax for the first phase that has only ~5 endpoints (Phase 02). The grep "where is GET /videos/:id" answer is one level deeper (find the domain, then the handler) — but still trivial with editor tooling.

### Option C: Per-phase modules

```
mocks/handlers/
  phase-02-auth.ts
  phase-03-upload.ts
  phase-04-management.ts
  ...
  index.ts
```

Files are named by phase rather than by domain. Phase NN owns exactly one file.

- **Pros:** Strict phase ownership — a Phase NN PR touches exactly one handler file. Easy to delete "phase 02 mocks" wholesale during refactoring (rare but possible).
- **Cons:** Domain-vs-phase tension — Phase 04 ("management") and Phase 05 ("viewing") both touch video endpoints, so handlers for `/videos/:id` would either live in two phase files (duplicate / drift risk) or violate phase ownership (one phase owns endpoints used by another phase's features). Phase numbers leak into the FE codebase, which is otherwise organized by domain (not by phase). Late-arriving cross-phase endpoint changes (e.g., Phase 05 adds `view-count` to the `GET /videos/:id` response shape that Phase 03 originally created) have no natural home — either phase 05's file overrides phase 03's, or phase 03's file is edited cross-phase. Naming conventions tied to project-management artifacts age badly once the phase model retires.

**Recommendation:** **Option B (per-domain modules + barrel)**. Three reasons. (1) **MSW's own best-practice recommends it** — the project should not invent its own scheme when the official one is documented and matches the codebase's domain orientation. (2) **Domain ownership tracks the codebase**, not the project plan — `components/`, `app/api/`, and any future feature folders will be organized by domain (auth, videos, channels), so handler files mirror that vocabulary and remain stable as phases come and go. (3) **Append-only growth with minimal merge conflicts** — each phase touches a new file plus one line in the barrel, which is the smallest practical concurrent-PR footprint. Option A is acceptable through Phase 02 alone (~5–7 endpoints) but accumulates costs that B avoids from day one; bootstrapping directly into B costs one extra file and one barrel and pays off by Phase 03. Option C's phase coupling is rejected outright — domain-by-phase is a category error.

> **File naming inside each domain module.** Inside `handlers/<domain>.ts`, group handlers by **HTTP method + path** rather than by test scenario — a single handler is the happy-path default; per-test error/edge scenarios are added via `server.use(...)` in the test file, never as additional handlers in the domain file. This keeps the domain file small and stable (one handler per `paths` entry, not one handler per assertion case).

**Decision:** B (per-domain modules under `mocks/handlers/<domain>.ts` + barrel `mocks/handlers/index.ts`)

---

## TD-02: Node Test Handlers vs. Browser Dev Handlers (setupServer / setupWorker)

**Scope:** Frontend

**Trigger:** Decide whether to wire **only** `setupServer` (Node — Vitest BFF integration tests) at the foundation phase, or to also wire `setupWorker` (browser Service Worker — `msw/browser`) for FE-only dev sessions, and how the handler set is shared (or kept separate) between the two contexts. The user explicitly named this separation in the research scope: "separação entre handlers de teste (Node — Vitest/Jest) e handlers de dev browser (Service Worker)".

**Context:** Two execution contexts exist for MSW in this project — and they intercept **different traffic** under the strict-BFF model:

- **Node (`msw/node` + `setupServer`)** — used inside Vitest. Intercepts the `fetch` that BFF Route Handlers make to **the upstream NestJS API**, at URLs matching `${env.API_URL}/...`. This is the only context CLAUDE.md and the msw-mocks rule currently mandate.
- **Browser (`msw/browser` + `setupWorker`)** — would run as a Service Worker in the browser during `next dev`. Under strict BFF, the browser **only** talks to same-origin Next.js Route Handlers (`/api/...`); it **never** talks to NestJS directly. So a browser worker would intercept **same-origin requests to `/api/...`** — i.e., it would mock the **BFF responses** to the Components layer, not the upstream NestJS.

These are two different mock layers — different URLs (`${env.API_URL}/...` vs `/api/...`), different shapes (upstream Nest contract vs BFF-exposed contract, per `next-frontend-openapi-typing/TD-04`), different consumers (BFF Route Handlers vs Client Components). Sharing handlers between them is not as simple as importing the same array.

Existence of a dev browser worker is **not yet required** by any documented capability: no existing rule or CLAUDE.md section asks for "FE dev without the BFF running". But the user's research scope makes the separation question explicit, so the structural decision belongs in this foundation TD — even if the answer is "test-only for now".

**Options:**

### Option A: Test-only (`setupServer` only); no browser worker at the foundation

Only `mocks/server.ts` is created. The browser worker artifact (`public/mockServiceWorker.js`) is **not** generated. `mocks/browser.ts` does **not** exist. Phase 02+ FE dev runs against either (a) a real BFF that talks to a real NestJS (`API_URL` set in `.env.local`), or (b) a real BFF that talks to a temporarily-mocked upstream via a custom dev-time approach (e.g., a dev-only Route Handler stub) — but **not** via a browser-side MSW worker.

The directory layout from TD-01 stands; the domain handler files are imported only by `mocks/server.ts`.

- **Pros:** Smallest foundation surface — one wiring file (`mocks/server.ts`), one setupFiles entry in `vitest.config.ts`, zero browser-side artifacts. No second mock layer to keep coherent with the first. Adding a browser worker later is **non-breaking** — it adds files, never edits the existing ones (the domain handlers are reusable as a *starting point* for browser handlers if needed). Avoids committing the Service Worker file under `public/` (which generates a real HTTP route in `next dev`) until there is a real dev workflow that demands it.
- **Cons:** FE developers cannot run the app fully offline (without a working NestJS upstream) until the BFF Route Handler has a real or mocked upstream to call. Storybook / component dev playgrounds that need API responses must either run the full stack or wait for TD-02 to be revisited.

### Option B: Both contexts wired at foundation, **separate** handler sets (no sharing)

Both `mocks/server.ts` (Node) and `mocks/browser.ts` (Browser) are created. Domain handlers split into two trees under `handlers/`:

```
mocks/
  handlers/
    upstream/          # mocks NestJS (URLs ${env.API_URL}/...) — for Node tests
      auth.ts
      videos.ts
      index.ts
    bff/               # mocks Next.js BFF (URLs /api/...) — for browser dev
      auth.ts
      videos.ts
      index.ts
  server.ts            # imports handlers/upstream
  browser.ts           # imports handlers/bff
```

`public/mockServiceWorker.js` is committed (via `npx msw init public/`). A dev-time conditional registers the worker (`if (process.env.NEXT_PUBLIC_MSW === "true") { worker.start() }`).

- **Pros:** Both mock contexts available from day one. Clean separation — neither tree drifts into the other's responsibility, and the two URL spaces (`${env.API_URL}/...` vs `/api/...`) cannot be mixed up. Storybook / pure FE-dev sessions work offline immediately. The split matches the BFF↔components contract distinction in `next-frontend-openapi-typing/TD-04` (upstream contract vs BFF contract).
- **Cons:** Double the handler surface from the first commit — every new endpoint touched by tests AND by FE dev needs two handlers (one upstream, one BFF), with different URL shapes, possibly different response shapes (TD-04 reshape case). Browser worker requires a public Service Worker file in `public/mockServiceWorker.js` whose lifecycle (regeneration, versioning) is one more thing to maintain. Speculative cost — no documented capability today asks for browser-side mocks; the second mock layer is investment ahead of demand.

### Option C: Both contexts wired at foundation, **shared upstream-targeted** handler set (single source)

Both `mocks/server.ts` and `mocks/browser.ts` exist and import the **same** `mocks/handlers/index.ts` (upstream-targeted, matching `${env.API_URL}/...`). In dev, the browser worker registers and intercepts — but since the browser never fetches `${env.API_URL}/...` directly under strict BFF, the browser worker effectively **does nothing**. The Node server handles all real interception in tests.

- **Pros:** Single handler tree (matches TD-01 directly without a second branch). Symmetrical mental model — "one set of handlers, two runtimes".
- **Cons:** **The browser worker intercepts nothing the browser actually sends under strict BFF**, because the browser only hits `/api/...`. Wiring `setupWorker` with upstream-targeted handlers in this project would be ceremonial — a worker that runs but never matches. To make the browser worker do real work, its handlers must target `/api/...` (Option B's `handlers/bff/`), not the upstream — so this option is internally incoherent for the BFF model. Useful only in a non-BFF project where the browser calls the API directly.

**Recommendation:** **Option A (test-only, `setupServer` only at the foundation)**. The browser worker is a future capability with no documented current consumer; wiring it now (Option B) is speculative investment, and wiring it incoherently (Option C) actively misleads developers into thinking interception works when it doesn't under strict BFF. Option A keeps the foundation minimal, aligns 1:1 with everything CLAUDE.md and the existing rules currently document, and is non-breaking to extend.

**When Option A should be revisited** — the trigger for re-opening this TD with a Supersede toward Option B-style wiring:

- A dedicated capability appears in `docs/project-plan.md` or a phase plan that requires FE-offline dev (e.g., Storybook with mocked API responses; design-system playground that renders real-data states; FE-team-only sprints with the BE stack down).
- The number of BFF Route Handlers grows past the point where running the full stack just to dev a single FE page is the dominant pain.

Under Option A, when that day comes, the path to Option B is additive: `npx msw init public/` to generate the SW file, create `mocks/browser.ts`, create `mocks/handlers/bff/` mirroring the upstream tree, register the worker behind a `NEXT_PUBLIC_MSW` flag. The existing `handlers/<domain>.ts` files (upstream-targeted) keep working unchanged.

> **Directory naming under Option A.** Do not preemptively name handler files `upstream/auth.ts` to "leave room for Option B later" — that's premature complexity. Use the flat `handlers/auth.ts` per TD-01 today; if Option B is ever taken, the migration is "move `handlers/*.ts` into `handlers/upstream/` and add a sibling `handlers/bff/`" — a one-commit refactor with no test changes (the barrel keeps the same import surface to `mocks/server.ts`).

**Decision:** A (test-only `setupServer` at foundation; browser worker deferred until a real FE-offline-dev consumer exists)

---

## TD-03: Response Builders / Factory Pattern (with or without faker-js)

**Scope:** Frontend

**Trigger:** Decide whether handler fixture bodies are inlined as literals inside each `http.METHOD(...)` resolver, or assembled by factory functions in a separate `mocks/factories/` tree — and if factories are used, whether they incorporate `faker-js` (seeded for determinism) or hand-written defaults. The user named the factory pattern and faker-js explicitly in the research scope.

**Context:** Two constraints frame the answer:

1. **Determinism is non-negotiable.** `next-frontend-openapi-typing/TD-05` rejected `faker`-randomized auto-generated handlers because BFF integration tests assert on specific values. Anything decided here must produce deterministic output by default — runtime random sources are forbidden unless explicitly seeded.
2. **Tests need to *vary* fixtures per scenario** — happy path (`200` with full body), edge case (`200` with optional fields missing), error case (`404`, `500`). Per-test variation today happens via `server.use(http.METHOD(..., () => HttpResponse.json(literal)))` — inlining the literal works but duplicates the bulk of the body across tests, with the per-test difference buried inside an otherwise-identical object.

Without factories, every test that wants to assert "user with `confirmedAt` set vs unset" rewrites the entire user object. With factories, the test writes `buildUser({ confirmedAt: null })` and reads as intent.

The cost of factories is one extra file per domain (`mocks/factories/<domain>.ts`) and one extra concept ("build vs. inline"). The benefit grows with how many tests touch each shape.

**Options:**

### Option A: No factories — inline literal fixtures in every handler / override

Every default handler and every `server.use(...)` override constructs the response body as a literal object inline:

```ts
http.get(`${env.API_URL}/users/:id`, () => HttpResponse.json<GetUserOk>({
  id: "user-1", email: "alice@example.com", channelSlug: "alice",
  confirmedAt: "2026-05-01T00:00:00Z", createdAt: "2026-04-01T00:00:00Z",
}))

// In a test:
server.use(http.get(`${env.API_URL}/users/:id`, () => HttpResponse.json<GetUserOk>({
  id: "user-1", email: "alice@example.com", channelSlug: "alice",
  confirmedAt: null, createdAt: "2026-04-01T00:00:00Z",
})))
```

- **Pros:** Zero indirection — the fixture body is right next to the route. New tests don't need to learn a builder API. No extra files, no extra dep. Trivially deterministic (literals).
- **Cons:** Per-test override duplicates the entire body to change one field (`confirmedAt: null`) — readability decreases as the body grows. Drift risk: as the contract gains a field (say `displayName`), every literal fixture in every test must be updated, even when the test does not care about `displayName`. TypeScript catches drift via `paths`-anchored typing, but the fix is per-call. For Phase 02 (~5 endpoints, ~10 tests), this is bounded; for Phase 06 (~10 endpoints, ~30+ tests touching comments + likes + replies) the duplication becomes meaningful.

### Option B: Factory builders with hand-written defaults (no faker)

`mocks/factories/<domain>.ts` exports `buildX(overrides?: Partial<X>): X` for each shape. Defaults are hand-coded deterministic values; overrides spread on top:

```ts
// mocks/factories/users.ts
import type { User } from "@/lib/api/contracts";
const baseUser: User = {
  id: "user-1", email: "alice@example.com", channelSlug: "alice",
  confirmedAt: "2026-05-01T00:00:00Z", createdAt: "2026-04-01T00:00:00Z",
};
export const buildUser = (overrides: Partial<User> = {}): User => ({ ...baseUser, ...overrides });

// Default handler:
http.get(`${env.API_URL}/users/:id`, () => HttpResponse.json<GetUserOk>(buildUser()))

// Test override (intent-revealing):
server.use(http.get(`${env.API_URL}/users/:id`, () =>
  HttpResponse.json<GetUserOk>(buildUser({ confirmedAt: null }))))
```

- **Pros:** Deterministic by construction (no random source). Test bodies read as intent ("an unconfirmed user", "a user without channel name") because only the diff is visible. Contract drift fix is **one file per shape** instead of every test (update `baseUser` once; all callers compose against the new shape automatically — TypeScript catches mismatches at compile time via the same `paths`-anchored typing). Composes well with `buildList = (n, overrides) => Array.from({length: n}, (_, i) => buildUser({ id: `user-${i}`, ...overrides }))` for collection endpoints. No new runtime dep — factories are plain functions.
- **Cons:** One extra layer to learn ("what factories exist for this domain?"). One factory file per domain doubles the `mocks/` file count vs Option A. Naming discipline required (`buildUser` vs `aUser` vs `userFixture` — pick one convention and stick with it; recommendation is `buildX`).

### Option C: Factory builders with seeded faker-js

Same shape as Option B, but defaults are produced by `@faker-js/faker` with a fixed seed at module load:

```ts
import { faker } from "@faker-js/faker";
faker.seed(42); // deterministic across runs
const baseUser: User = {
  id: faker.string.uuid(),
  email: faker.internet.email(),
  channelSlug: faker.internet.username().toLowerCase(),
  confirmedAt: faker.date.recent().toISOString(),
  createdAt: faker.date.past().toISOString(),
};
export const buildUser = (overrides: Partial<User> = {}): User => ({ ...baseUser, ...overrides });
```

- **Pros:** Plausible-looking data for free — useful when reading test output ("alice@example.com" vs `faker`'s "kayla.ortiz@hotmail.com"). Faker covers many shapes (names, emails, URLs, dates, UUIDs, lorem text) with one API. Determinism preserved by global `faker.seed(...)`.
- **Cons:** **Seed coupling is fragile.** Adding a single field to `baseUser` (e.g., a new `phoneNumber: faker.phone.number()`) **shifts every subsequent value** because faker advances its internal cursor as it generates — every prior literal value (id, email, slug, dates) changes, breaking every snapshot test and any assertion that pinned a concrete value. Practical mitigation requires `faker.seed(N)` reset before *each* generated value (defeating the purpose of factories) or per-field local seeds (verbose). Adds one dep (`@faker-js/faker` is ~5MB unminified — dev-only, but still meaningful), and one mental model ("when faker's cursor matters"). The "plausible data" win is small in a project that uses `alice@example.com`-style values without complaint.

### Option D: Hand-written defaults today, faker as an opt-in escape hatch for large-collection scenarios

Adopt Option B as the foundation. Do **not** ban faker; allow it as an opt-in import in factories that need bulk data (e.g., `buildVideoList(n=50)` for testing pagination UI where 50 hand-written titles is tedious). When used, faker MUST be re-seeded immediately before generating the collection (`faker.seed(seedForThisFixture); ...`) and the seed value is part of the test's contract (committed alongside the fixture file).

- **Pros:** All of Option B's wins by default. Faker is available when it pays — large lists where reading "Title 1, Title 2, ..." is tedious. Faker's seed brittleness is contained to one factory at a time (`buildVideoList`'s seed scope is local, not module-wide), eliminating the global-cursor drift problem.
- **Cons:** Two paradigms instead of one — developers must know which factories use faker (and the seeding rule) and which don't. Minor doc burden in the msw-mocks rule.

**Recommendation:** **Option D (hand-written defaults as the default + opt-in seeded faker for bulk collections)**. Reasons: (1) **Option B's determinism + readability is the right baseline** — every fixture in Phase 02 (5–7 endpoints, single-record-mostly) is naturally hand-written, and the diff-revealing override pattern is the highest-value benefit. (2) **Bulk-collection cases will arrive (Phase 07 home page grid, Phase 06 comment threads) and inline hand-written lists of 20+ items are genuinely tedious** — keeping faker available as a scoped tool is pragmatic. (3) **Per-fixture local seeding eliminates the global-cursor pitfall** that makes Option C structurally fragile — using `faker.seed(N)` immediately before a collection-builder run scopes the determinism to that fixture and isolates it from upstream changes to other factories.

Concrete pattern for D:

```ts
// mocks/factories/videos.ts  (Option B style — default case)
const baseVideo: Video = { id: "video-1", title: "First video", durationSec: 120, /* ... */ };
export const buildVideo = (overrides: Partial<Video> = {}): Video => ({ ...baseVideo, ...overrides });

// Opt-in faker for a bulk-list scenario only:
import { faker } from "@faker-js/faker";
export const buildVideoList = (n: number, seed = 42): Video[] => {
  faker.seed(seed); // local — does not affect any other factory
  return Array.from({ length: n }, (_, i) =>
    buildVideo({ id: `video-${i + 1}`, title: faker.lorem.sentence(4), durationSec: faker.number.int({ min: 60, max: 3600 }) }));
};
```

If the project never reaches a real bulk-collection use case, faker is simply never installed — Option D collapses into Option B in practice, with zero retroactive cost. Add `@faker-js/faker` to `devDependencies` only when the first `buildXList` is authored.

**Decision:** D (hand-written deterministic defaults as the default + opt-in seeded faker scoped to bulk-collection builders only; `@faker-js/faker` installed only when the first bulk builder is authored — not at foundation)

---

## TD-04: How Each Phase's Tests Consume the Handler Set

**Scope:** Frontend

**Trigger:** Decide how a single phase's tests "import only the routes pertinent to that phase" — the user's last explicit requirement. Two interpretations are possible: (a) **literal subsetting** — only Phase 02's auth handlers are loaded when running Phase 02 tests, others are not; or (b) **canonical full-set load + per-test overrides** — every handler is loaded into `setupServer`, but each test cares only about the endpoints it actually `fetch`-es. This TD resolves which interpretation is right and why.

**Context:** Three facts shape the answer:

1. **MSW v2 handlers are inert until matched.** A handler for `GET ${env.API_URL}/videos/:id` does *nothing* if no test in the current run fetches that URL. Loading all handlers into `setupServer` has **zero runtime impact** on tests that don't touch them — the cost is paid only by URLs actually fetched. The "phase imports only what it needs" worry is reframed: nothing forces a phase to interact with handlers for endpoints it doesn't call.
2. **`server.use(...)` is the canonical override surface** (MSW docs' "Override handlers at runtime" recipe). Per-test deviations (errors, edge cases) layer on top of the default set without touching the default set. `server.resetHandlers()` in `afterEach` reverts to the defaults — keeping isolation per-test trivial.
3. **The unhandled-request guardrail.** `setupServer(...handlers).listen({ onUnhandledRequest: "error" })` makes any `fetch` to a URL with no handler **throw**. This is the discipline that catches missing handlers in CI — if a Phase 02 test accidentally `fetch`-es `/videos/:id` (a Phase 03+ endpoint), the test fails loudly because no handler matched, not because the wrong fixture was returned. This is already baked into the msw-mocks rule's spirit ("Endpoint coverage… `msw/node` fails with 'request unhandled' if a fetch goes unintercepted").

Given these, the user's "phase imports only what it needs" requirement is **already satisfied structurally** by the universal-default + per-test-override pattern, *provided* the per-domain split from TD-01 is in place (so a phase's *authoring* surface is bounded to its domain file). The question now is whether to enforce subsetting at the runtime/setupFiles layer too, or to accept that loading-all is the canonical pattern.

**Options:**

### Option A: Universal handler set + per-test `server.use(...)` overrides + `onUnhandledRequest: "error"`

`mocks/server.ts` calls `setupServer(...handlers)` where `handlers` is the barrel-aggregated array from TD-01. Vitest's `setupFiles` calls `server.listen({ onUnhandledRequest: "error" })` once; `afterEach(() => server.resetHandlers())` keeps isolation. Per-test variation uses `server.use(...)`.

Phase 02's tests `import { POST } from "@/app/api/auth/signup/route"` and call it — the auth handlers in the universal set are matched on `fetch` to `${env.API_URL}/auth/signup`; the video handlers in the same universal set are never matched (Phase 02 tests don't touch `/videos`) and impose zero cost.

- **Pros:** Canonical MSW v2 pattern (the docs' recipes are written for this model). Zero setupFiles complexity per phase — one global `mocks/server.ts`, one Vitest setupFile, one `afterEach` reset. New phases extend by adding a handler file (TD-01); no test-config change. `onUnhandledRequest: "error"` makes accidental cross-domain fetches fail loudly. Aligns with how MSW's docs ("Structuring handlers" + "Override handlers at runtime") describe the recommended workflow. Per-test "this phase only cares about X" is implicit in *which routes the test fetches*, which is the natural unit of coverage.
- **Cons:** A developer reading "what handlers does this test rely on?" must inspect the test body + handlers/index.ts to see what's in scope (the answer is "everything in the barrel, but only the URLs actually fetched matter"). Mildly less explicit than per-test setupServer composition.

### Option B: Per-suite handler composition — each test/suite imports a domain handler set into its own `setupServer`

No global `mocks/server.ts`. Each test file (or each `describe` block) imports the domain handlers it needs and constructs its own `setupServer`:

```ts
// app/api/auth/signup/__tests__/signup.integration.test.ts
import { setupServer } from "msw/node";
import { handlers as authHandlers } from "@/mocks/handlers/auth";
const server = setupServer(...authHandlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
```

- **Pros:** Explicit per-suite scoping — the handler set is right there in the test's imports. A reader sees exactly what's in play. "Phase 02 imports only auth handlers" is literally true at the file level.
- **Cons:** Boilerplate in every integration test file — `setupServer` + listen/close/reset is ~6 lines of ceremony per file. Centralized invariants (`onUnhandledRequest: "error"`, reset timing) drift across files unless a custom test-extend helper is built — adding that helper is another foundation TD that doesn't currently exist. Worse, each `setupServer` runs its own MSW interceptor lifecycle — running >50 such files in a Vitest worker adds real startup time per file. Loses the "single source of truth for default fixtures" property (different suites disagree about what the default Video looks like). MSW's docs explicitly recommend the universal pattern over this one.

### Option C: Phase-scoped `setupFiles` (Vitest projects / per-suite setupFiles config)

Vitest's `projects` config feature splits the test suite into named subsuites with different `setupFiles`. Hypothetically: a Phase 02 project uses `setupFiles: ["mocks/setup-auth.ts"]` that loads only auth handlers into its server; Phase 03 uses `setupFiles: ["mocks/setup-videos.ts"]`; etc.

- **Pros:** Phase boundary becomes a runner-level concept. Each project loads exactly the handlers its tests care about.
- **Cons:** **Phase as a runner-level concept is wrong** — phases are project-management artifacts, while Vitest projects/setups are runtime concerns. The two cease to align as soon as a Phase 06 feature touches a Phase 02 endpoint (auth) and a Phase 03 endpoint (videos); now Phase 06 tests need both setups, and the project boundary blurs. Multiplies Vitest configuration without addressing the actual concern (which is *authoring* surface, not runtime surface — and TD-01 already addresses authoring surface via per-domain files). Speculative complexity with no concrete payoff.

**Recommendation:** **Option A (universal handler set + `server.use(...)` overrides + `onUnhandledRequest: "error"`)**. The user's "import only what it needs" requirement is satisfied at the *authoring* layer by TD-01 (per-domain files; each phase adds one file). At the *runtime* layer, loading all handlers is the canonical MSW v2 model and imposes no cost on tests that don't fetch the extra URLs. `onUnhandledRequest: "error"` enforces that a phase's test cannot accidentally invoke a route outside its scope (the fetch fails loudly with "no handler matched"), which is the strongest version of "stays inside its phase" available. Option B's per-suite composition pays real boilerplate cost for an explicitness gain that TD-01 already provides at a different layer. Option C invents a Vitest-projects-shaped problem for a phase-shaped concern.

Concrete wiring (foundation SI under this option):

```ts
// next-frontend/vitest.config.ts (relevant excerpt)
export default defineConfig({
  test: {
    environment: "node", // BFF integration tests are Node-side
    setupFiles: ["./mocks/setup.ts"],
  },
});
```

```ts
// next-frontend/mocks/setup.ts
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

Phase 02+ tests need no additional setup — they `import { POST } from "@/app/api/auth/signup/route"`, build a `Request`, await the handler, and assert. Per-test deviations call `server.use(...)` inline.

**Decision:** A (universal handler set loaded into `setupServer` + per-test `server.use(...)` overrides + `onUnhandledRequest: "error"`)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|----------------|--------|
| TD-01 | Frontend | Handler module organization & phase expansion model | **B** (per-domain modules under `mocks/handlers/<domain>.ts` + barrel) | **B** |
| TD-02 | Frontend | Node test handlers vs. browser dev handlers (setupServer / setupWorker) | **A** (test-only `setupServer` at foundation; browser worker deferred until a real consumer exists) | **A** |
| TD-03 | Frontend | Response builders / factory pattern (with or without faker) | **D** (hand-written defaults as the default + opt-in seeded faker for bulk-collection factories only) | **D** |
| TD-04 | Frontend | How each phase's tests consume the handler set | **A** (universal handler set + `server.use(...)` overrides + `onUnhandledRequest: "error"`) | **A** |

---

## Notes for downstream pipeline

- This is an **orphan ad-hoc** (`related_phases: []`) document, sibling to `next-frontend-config-base`, `next-frontend-openapi-typing`, and `openapi-docs-nestjs`. It is foundation for Phase 02+ FE test work, not itself a phase capability.
- **Composition with `next-frontend-openapi-typing/TD-05`** is tight: TD-05 locks "hand-written handlers, typed via `paths`"; every TD above operates strictly inside that constraint. The factory pattern in TD-03 does not change that — factories produce typed fixture *literals* that handlers still emit by hand via `HttpResponse.json<paths[...]>()`.
- **Composition with `.claude/rules/next-frontend-msw-mocks.md`** is also tight: the rule currently shows `mocks/handlers.ts` as a single file (example syntax, not a structural mandate). Once these TDs are decided, the rule should be updated to reference `mocks/handlers/<domain>.ts` + the barrel (TD-01 B), to call out `mocks/factories/` (TD-03 D), and to document the `onUnhandledRequest: "error"` + `server.resetHandlers()` lifecycle (TD-04 A). The "Where MSW lives" section will need a small rewrite.
- **Implementation surface for `/plan-build`** under the recommended choices: install `msw` and `@testing-library/jest-dom` + `jsdom` (Vitest setup), create `mocks/handlers/` with one empty domain barrel + `index.ts`, create `mocks/factories/` (empty placeholder), create `mocks/server.ts`, create `mocks/setup.ts` for Vitest lifecycle, register `setupFiles` in `vitest.config.ts`, update `package.json` scripts (`test`, `test:watch`) per CLAUDE.md, update `next-frontend-msw-mocks.md` to reflect the new structure. `@faker-js/faker` and `mocks/browser.ts` are NOT installed at the foundation.
- **Forward-compatibility under recommendations:** Option A in TD-02 + Option D in TD-03 + Option B in TD-01 form a coherent "minimum but extensible" foundation. Each future capability (browser dev worker per TD-02, bulk-list factories per TD-03, etc.) is additive — no choice locks the project out of its alternative.
- **Supersede candidates if recommendations are accepted:** none from prior decisions. This TD-set does not contradict TD-05 of openapi-typing or any item in `next-frontend/CLAUDE.md`; it concretizes them.

Sources consulted during research:
- [MSW — Structuring handlers (best practice)](https://mswjs.io/docs/best-practices/structuring-handlers) — per-domain modules + barrel as the official recommendation; `server.use(...)` override recipe.
- [MSW — `server.resetHandlers()`](https://mswjs.io/docs/api/setup-server/reset-handlers) — afterEach reset pattern.
- [MSW — Vitest Browser Mode recipe](https://mswjs.io/docs/recipes/vitest-browser-mode) — context for the browser-worker option (TD-02 B); not adopted at foundation but available later.
- `next-frontend-openapi-typing/TD-05` (in-repo) — handler-typing decision that anchors every TD above.
- `.claude/rules/next-frontend-msw-mocks.md` (in-repo) — current MSW conventions for `mocks/handlers.ts` + per-test overrides.
- `next-frontend/CLAUDE.md` § Testing (in-repo) — Vitest + MSW stack and the BFF-as-functions testing pattern.
