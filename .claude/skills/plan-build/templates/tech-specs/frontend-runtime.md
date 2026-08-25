# Tech Spec subsection — Frontend Runtime

Emitted when ≥1 TD with `Renders in: frontend-runtime` (explicit OR default-by-inference per `phase-a.md` § A2) AND `ui_in_scope ∈ {true, logic-only}`. One `#### {td-slug}/TD-NN — {topic}` subsection per applicable TD.

The Frontend Runtime subsection hosts FE-runtime architectural-transversal decisions: TDs whose impact spans multiple screens / global patterns (TanStack Query global setup, React Compiler adoption, universal Suspense boundary pattern, global Next.js cache strategy). These decisions are NOT per-screen (those go in `### UI Contracts`), NOT cross-layer wire contracts (those go in `### API Contracts`), and NOT tooling/Repo-wide (which is never rendered).

## Template

> **Builder note (do NOT transcribe into artifact):** this subsection is emitted when ≥1 TD has `Renders in: frontend-runtime` (explicit OR default-by-inference per `phase-a.md` § A2) AND `ui_in_scope ∈ {true, logic-only}`. One `#### {td-slug}/TD-NN` block per applicable TD.

````markdown
### Frontend Runtime

#### {slug}/TD-NN — {topic from Decisions Index}

**Pattern:** {one-paragraph verbatim or near-verbatim quote of the TD's `**Recommendation:**` prose — describes the chosen architectural pattern. Source: `## Decisions Detail` for current-scope TDs OR `## Inherited Decisions Detail` for inherited TDs.}

_(For inherited TDs from a sibling slice via `depends_on_slices`, replace the entire subsection body with the one-line reference per `phase-a.md` § A2 "Inherited Frontend Runtime TDs" — do NOT duplicate Pattern/Setup/Aplicação/Migração/Verificação. Example:)_

```
_Inherited from slice {sibling-slug}: see {sibling-slug}/TD-NN (renders in Frontend Runtime in {sibling-slug}'s plan)._
```

**Setup:** the **canonical shape** of the pattern at the application root — F2-load-bearing only. The implementer pastes this verbatim and **extends with derivable boilerplate** (imports, framework-standard wiring, helper functions whose shape is implied) without violating F2. See `## Snippet Scope` below for INCLUDE / EXCLUDE rules.

```{lang from TD's Libraries — e.g., tsx for React/Next.js}
// {target-file resolved from the frontend subproject's framework convention — e.g., `app/providers.tsx` for Next.js App Router, `src/main.tsx` for Vite/React, `src/main.ts` for Vue. Prepend the frontend subproject directory.}

{snippet — canonical wiring shape per `## Snippet Scope` INCLUDE list:
configuration values that affect runtime behavior, F2-protected names, and
canonical instantiation/wiring expressions. Target 5-15 lines; exclude
derivable boilerplate (imports, type juggling, framework-standard wrappers).
Sourced from the TD's Recommendation prose + the cached Context7 docs in
library-refs.md when the TD's **Libraries:** field is non-empty.}
```

**Aplicação:** scope of the pattern's adoption — declared via component references (when a UI surface exists) OR via capability/file-pattern references (when the phase is logic-only). Branch by the phase's `ui_in_scope` (per Gate 9):

- **`ui_in_scope: true` (UI surface present):** reference Server-connected components from `## UI Inventory → ### Server-connected Components`. **Reference, do not relist:** the full list is already in `## UI Inventory`; this subsection only declares which subset adopts the pattern and which is explicitly excluded.
  - **Adopts the pattern:** {short scope statement — e.g., "all Server-connected components in `## UI Inventory → ### Server-connected Components`" OR "all components reading from `/api/users/*` endpoints" OR explicit list of component names if scope is narrow}.
  - **Excludes / boundaries:** {explicit list of components or routes that do NOT adopt this pattern + one-line rationale per exclusion}.
    - `{ComponentName}` — {rationale, e.g., "uses Server Action mutations directly; pattern only applies to read-side queries"}
- **`ui_in_scope: logic-only` (no UI surface in this phase):** `## UI Inventory` contains only the logic-only placeholder body — the `### Server-connected Components` sub-block does NOT exist, so the component-reference form above is not applicable. Instead, name the future surfaces by capability (e.g., "applies to all future read-side components served from `/api/users/*`") or by file-pattern target (e.g., "applies to every Server Component under `<frontend-subproject>/<auth-routes-pattern>`"). The phase that later adds the UI surface inherits this constraint via `## Inherited Decisions Detail` and renders it in its own `### UI Contracts` per-screen rendering strategy.

**Migração:** files in the existing codebase that must be refactored to adopt the pattern. One row per file.

| File | Current behavior | Required change | Owning SI |
|------|-----------------|-----------------|-----------|
| `<frontend-subproject>/{path-to-file}` | Direct `fetch()` in Server Component | Wrap in `<HydrationBoundary>` + use `prefetchQuery` | SI-NN.M (Migration) |
| `<frontend-subproject>/{path-to-file}` | `useEffect` + `useState` data fetch | Replace with `useQuery({ queryKey, queryFn })` | SI-NN.M' (Migration) |

_(Empty table when no existing files need refactor — Setup-only adoption. Render `_No existing files require refactor — Setup SI is the only application of this pattern in the current phase._` instead of an empty header.)_

**Verificação:** test surface that proves the pattern is correctly adopted across the components/files listed above.

- **Unit:** {what to assert at unit level — e.g., "every component using `useQuery` is wrapped in QueryClientProvider via the test harness"}.
- **Integration:** {what to assert at integration level — e.g., "rendering the feed page makes ≤1 fetch per query key (no waterfall)"}.
- **E2E:** {what to assert at E2E level when applicable — e.g., "navigating between cached routes does not refire the network call within `staleTime` window"}.
- **Regression guards:** {one-line description of any pre-existing test that, after migration, MUST still pass — proof of no behavioral change for end users}.
````

## Snippet Scope (F2-load-bearing only)

The Setup snippet captures the **decision**, not the file. Aim for 5-15 lines per snippet; if you exceed 20 lines, you are likely implementing instead of materializing — review and trim.

**INCLUDE in the snippet** (these are F2-protected and must be byte-verbatim):

- **Library/framework names + version-relevant API calls** (`new QueryClient(...)`, `cookies().set(...)`, `<HydrationBoundary>`, `createMiddleware()`).
- **Configuration values that affect runtime behavior** that the TD's Recommendation locked: `staleTime: 60_000`, `httpOnly: true`, `secure: true`, `sameSite: "lax"`, `path: "/"`, retry counts, cache TTLs, route matchers, public-route lists.
- **Field / cookie / header / endpoint names** referenced verbatim from the TD's Recommendation prose or `**Libraries:**` line (`access_token`, `refresh_token`, `Authorization`, `/api/auth/refresh`).
- **Canonical wiring shape** — the minimal expression that locks the pattern at the app root: `<QueryClientProvider client={qc}>{children}</QueryClientProvider>`, `<AuthProvider session={session}>{children}</AuthProvider>`, `export async function proxy(req: NextRequest) { ... }` skeleton with the redirect/return rules.
- **Subtle decision primitives** — algorithmic content the TD relied on (e.g., the `inflightRefresh` deduplication primitive in a 401 retry wrapper; the `cache()` React 19 dedup in a DAL).

**EXCLUDE from the snippet** (these are derivable; implementer writes them without F2 cover):

- **Imports** of the libraries listed above (the implementer reads `**Libraries:**` and imports as needed).
- **TS type juggling** that does not change runtime behavior: `Pick<Parameters<...>, ...>` extractions, generic over methods, `as const` annotations on otherwise-obvious literals.
- **Framework-idiomatic boilerplate**: the standard wrapping patterns each frontend framework uses to compose providers / inject runtime singletons (e.g., for React/Next.js: `createContext` + `useContext` + custom hook boilerplate around a single value, `useState(() => ...)` for stable instances, named `export function Providers({ children })` wrapper shape; for Vue: `provide`/`inject` composables; for SvelteKit: stores + root layout). These are derivable from each framework's conventions — see the BAD example below where the `Providers` wrapper function is derivable, while only the inner canonical wiring expression (e.g., `<QueryClientProvider client={qc}>{children}</QueryClientProvider>`) is F2-load-bearing.
- **Derivable helpers**: if you locked `setAuthCookies(access, refresh)` in the snippet, you do NOT also write `clearAuthCookies` / `getAccessToken` / `getRefreshToken` — name them in prose and let the implementer derive their shape from `cookies().delete(...)` / `cookies().get(...)`.
- **Error handling** that follows the global Error Catalog convention: returning `{ statusCode, error, message }` envelopes. Show the shape ONCE in the snippet that introduces the convention; subsequent handlers reference it by prose.
- **Replicated implementations** of the same shape for sibling endpoints: show ONE Route Handler in full; mention "all four `/api/auth/{register,login,forgot-password,refresh}` follow this shape" in prose.

**Heuristic for the builder:** when drafting the Setup snippet, ask "is this byte different from what a competent implementer would write reading the Pattern prose + `**Libraries:**` + `library-refs.md`?". If no → drop it. **Exception:** items on the INCLUDE list above (especially "subtle decision primitives" — algorithmic content the TD relied on) are always retained, even when the heuristic would suggest dropping. The INCLUDE list overrides the heuristic by construction; the heuristic only governs items NOT explicitly listed in INCLUDE.

### GOOD vs BAD example (TanStack Query on Next.js App Router)

> **Concrete illustrative pair** — Next.js App Router + TanStack Query is shown here because it makes the F2-load-bearing vs derivable-boilerplate distinction obvious. The same scope rule applies to any framework + runtime-library combo: keep the configuration values + canonical wiring expression; let the implementer derive imports, framework-standard wrappers, and helper boilerplate from the framework's conventions (e.g., Vite/React `src/main.tsx`, Vue `src/main.ts` + `app.use(...)`, SvelteKit `src/routes/+layout.svelte`).

**GOOD** (5-7 lines, F2-load-bearing only):

```tsx
// <frontend-subproject>/<entry-file>   — e.g., app/providers.tsx for Next.js App Router
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000 } },
});
<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
```

`staleTime: 60_000` is the runtime decision; `<QueryClientProvider client={qc}>` is the canonical shape.

**BAD** (15+ lines, includes derivable boilerplate):

```tsx
// <frontend-subproject>/<entry-file>
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
  }));
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools />}
    </QueryClientProvider>
  );
}
```

The `"use client"` directive, the imports, the `useState(() => ...)` for stable instance, the `Providers` function wrapper, the dev-only Devtools — all derivable. Only `staleTime: 60_000` and `<QueryClientProvider client={qc}>{children}</QueryClientProvider>` are decision-load-bearing.

## Build rules

- **One subsection per applicable TD.** Each TD with `Renders in: frontend-runtime` (explicit or default-by-inference) AND in scope per A2 filter gets its own `#### {td-slug}/TD-NN — {topic}` block.
- **TD ordering** — same order as `## Decisions Detail` in context.md (phase-scope TDs first, then ad-hoc).
- **Inherited TDs** — render as the one-line reference per `phase-a.md` § A2; do NOT materialize the 5 fields. Materialization lives only in the slice that decided the TD.
- **`Aplicação` adoption-target form depends on `ui_in_scope`:** when `true`, references `## UI Inventory → ### Server-connected Components` by composition (not by relisting); excludes/boundaries are the only per-pattern content. When `logic-only`, the component reference form is not applicable (no `### Server-connected Components` sub-block exists in the placeholder body) — use the capability or file-pattern reference form documented in the `Aplicação` field above.
- **Field-name verbatim invariant (F2 protection)** applies to:
  - **the snippet code** — scoped to the `## Snippet Scope` INCLUDE list only (F2-load-bearing content);
  - **library names** cited in `**Libraries:**`;
  - **any Recommendation prose** quoted in the Pattern field of this subsection.

  Copy byte-verbatim from the TD or `library-refs.md`. The EXCLUDE list (imports, type juggling, framework-idiomatic patterns, derivable helpers, replicated sibling implementations) is OUT-of-scope for F2 — the implementer writes those without verbatim cover. See `phase-a.md` § A4 for the full invariant.
- **Empty subsection states.** When a TD has no Migração rows (greenfield Setup-only) or no specific Verificação requirements beyond the implicit framework defaults, render the placeholder text shown in the template — never emit empty headers or empty tables.
