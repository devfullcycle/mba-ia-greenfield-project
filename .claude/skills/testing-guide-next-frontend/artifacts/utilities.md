> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Utilities & Boundary Modules (`lib/**/*.ts`)

Plain TS modules under `lib/`. Test only those with **branching logic** or that **encode an assumption about an external system's shape** — pure single-path glue is framework/library behavior and is not worth a unit test.

## What to test

- **Branching helpers** — functions with conditionals, fallbacks, error handling, or non-trivial transformation.
- **Configured-dependency contracts** — `lib/env.ts` is a Zod 4 schema: a *contract* about which env vars must exist and their shape. Test that it **rejects** a missing/invalid `API_URL` and **accepts** a valid one. A wrong schema is a runtime boot failure TypeScript cannot catch.
- **Reshape contracts** — `lib/api/contracts.ts` *reshape* aliases (`Pick`/composed). These are type-level; they are proven by `tsc --noEmit` and by the consumers' tests, not a runtime unit test. A pure pass-through alias needs no test at all.
- **`tailwind-merge` conflict resolution** — `cn()` extends `tailwind-merge` with the project's custom `font-size` group (`text-display`, `text-h1`, `text-label-md`, …). The *configuration* is the test-worthy part: that two conflicting custom typography utilities dedupe to the last one.

## Layer assignment

| Module shape | Layer |
|---|---|
| Branching / transformation logic | **Unit** `*.test.ts` |
| `lib/env.ts` Zod schema (accept/reject) | **Unit** `*.test.ts` — exercise the schema, not framework behavior |
| `cn()` custom `tailwind-merge` group | **Unit** `*.test.ts` — assert conflict resolution for the *custom* groups only |
| `lib/api/upstream.ts` (just `createClient` + `server-only`) | ❌ no unit test — covered transitively by route-handler integration tests (the client is exercised through MSW there) |
| `lib/api/contracts.ts` pass-through alias | ❌ no test — `tsc` proves it |
| Pure single-path glue (no branching) | ❌ no test |

No integration/E2E layer for utilities — they have no system boundary of their own (the boundary is `upstream`, exercised via route-handler integration tests).

## Setup pattern

`*.test.ts` (no JSX → **no jsdom docblock**, runs under default `node`), colocated in `lib/__tests__/` or `lib/<area>/__tests__/`.

```ts
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn() custom tailwind-merge groups", () => {
  it("dedupes conflicting custom typography utilities to the last", () => {
    expect(cn("text-label-md", "text-h1")).toBe("text-h1");
  });

  it("still merges standard tailwind conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
```

For `lib/env.ts`, stub `process.env` within the test, dynamically `import("@/lib/env")` after setting/clearing `API_URL`, and assert the schema throws on invalid and yields the typed object on valid (use `vi.resetModules()` between cases — the module memoizes at import).

## When to skip

- A function with no conditionals and no external-shape assumption (e.g., a one-line formatter) — skip; that's a mirror/single-path test.
- `upstream.ts` — it is `createClient<paths>({ baseUrl })` with a `server-only` guard; nothing to unit-test. The `server-only` guard's effect (build error in a Client Component) is a build-time concern, not a Vitest test.
- Pass-through `contracts.ts` aliases — `tsc` is the test.

## Examples from project

- `lib/utils.ts` (`cn`) — **worth testing**: the extended `tailwind-merge` `font-size` group is custom config; test conflict resolution for the custom utilities + a standard-conflict sanity case.
- `lib/env.ts` — **worth testing**: Zod 4 schema; assert reject-on-missing-`API_URL` and accept-on-valid.
- `lib/api/upstream.ts` — **skip**: trivial client construction; exercised via route-handler integration tests.
- `lib/api/contracts.ts` — **skip** until it gains a reshape alias; pass-through aliases are `tsc`-proven.
