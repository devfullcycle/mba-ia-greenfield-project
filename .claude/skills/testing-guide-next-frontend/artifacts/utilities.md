> Part of the `testing-guide-next-frontend` skill (see `../SKILL.md`).

# Utilities (`lib/*.ts`)

Plain TypeScript helpers — pure functions, classifiers, formatters, validators. The decision rule is the universal Layer Assignment Table: branching → unit test; no branching → skip (configured-library passthrough).

## What to test

- **Branching logic**: conditionals, switches, calculations with multiple outcomes, error classifiers.
- **Boundary/edge cases**: null, empty, max, off-by-one — when the function takes user-supplied or external data.
- **Security-critical transformations**: HTML escaping, URL/path sanitization, token parsing.
- **Data integrity**: serialization round-trips, currency math, date arithmetic.

## What NOT to test

- **Single-path passthroughs** that forward to a library. The `cn()` helper in `lib/utils.ts` falls in this bucket — it composes `clsx` and `tailwind-merge`. Trust the libraries.
- **Mirror tests**: `expect(format("hello")).toBe("HELLO")` where `format` is literally `s.toUpperCase()`. The assertion restates the implementation.

The narrow exception for `cn()`: if the `extendTailwindMerge` config grows non-trivial groups whose correctness encodes a project rule (e.g., a new typography group that must dedupe correctly so `cn("text-h1", "text-h2")` yields `"text-h2"`), one targeted test covering that rule is justified. Add it only when the rule actually exists.

## Layer assignment

| Utility shape | Vitest `*.test.ts` |
|---|---|
| Pure passthrough to library (`cn`) | ❌ skip |
| Pure function with branching | ✅ one test per branch + edge cases |
| Function with side effects (logging, storage) | Wrong category — move to a hook or service |

## Setup pattern

`lib/__tests__/<name>.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { formatVideoDuration } from "@/lib/format-video-duration" // hypothetical

describe("formatVideoDuration", () => {
  it("formats seconds under a minute as 0:SS", () => {
    expect(formatVideoDuration(42)).toBe("0:42")
  })

  it("formats hours as H:MM:SS", () => {
    expect(formatVideoDuration(3661)).toBe("1:01:01")
  })

  it("returns '0:00' for zero", () => {
    expect(formatVideoDuration(0)).toBe("0:00")
  })

  it("clamps negatives to '0:00'", () => {
    expect(formatVideoDuration(-5)).toBe("0:00")
  })
})
```

## When to skip

- The utility is a one-liner that forwards arguments to a library.
- The utility has a single code path and no edge cases.

## Examples from this project

- `lib/utils.ts` `cn()` — single-line passthrough to `clsx` + `extendTailwindMerge`. **Skip** until the `extendTailwindMerge` config encodes a non-trivial dedup rule worth pinning.
