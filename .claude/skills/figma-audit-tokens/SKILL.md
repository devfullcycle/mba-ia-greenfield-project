---
name: figma-audit-tokens
description: Audit drift between a Figma variable collection and a project's CSS variables. Captures Figma variables (all modes) plus text/effect styles, parses the project's CSS variables wherever they live (`@theme inline`, `:root`, `.dark`, custom selectors), and emits a structured JSON report at `docs/figma-audit.json` with drift items, missing-in-CSS items, and raw style observations. Framework-agnostic for variable drift; styles are emitted raw for downstream apply skills to analyze. Invoke ONLY when the user explicitly asks to audit, compare, or check drift between Figma and CSS — phrases like "audit figma tokens", "figma vs CSS drift", "compare figma to CSS variables", "puxa o estado do figma", "compara tokens do figma com o css". Never trigger on ambient Figma mentions or design-to-code work — those belong to figma-implement-design.
disable-model-invocation: true
---

# Audit Figma Tokens → JSON Drift Report

Capture the truth from a Figma variable collection, parse the project's existing CSS variables, compute the diff per token per mode, and emit a structured JSON report. The skill produces no edits — its only output is `docs/figma-audit.json`. Downstream apply skills consume the JSON and apply edits with framework-specific conventions.

## Core contract

Unless the user overrides them, follow these rules strictly:

1. **No edits to the CSS file.** This skill writes only `docs/figma-audit.json`. The CSS file is read-only.
2. **Framework-agnostic for variable drift.** Compare CSS variables wherever they appear — any selector or at-rule block. Do not assume `@theme inline`, do not assume Tailwind, do not assume `:root` is the "default" theme.
3. **Hex is a hard pre-requisite for color comparison.** If the project's CSS has any non-hex color (e.g. `oklch(...)`, `hsl(...)`, `rgb(...)`, `color(display-p3 ...)`), abort early and tell the user to migrate to hex first. Do not produce a partial JSON.
4. **Do NOT emit "delete" intents.** Variables present in CSS but missing in Figma are no-ops — installed components may reference them. Removal is always a separate, explicit task.
5. **Styles are observed, not analyzed.** Text styles and effect styles are decomposed into raw normalized data and emitted in `figma_styles[]`. Do not compute scale gaps here — that's the apply skill's job (it requires framework knowledge of the type/shadow scale conventions).

## Scope

Projects that use **CSS custom properties** (`--*` variables) for design tokens — anywhere they live in the CSS. Tailwind v4 is one consumer; vanilla CSS, CSS Modules, and other systems are equally supported, since this skill never writes and never assumes a structure beyond "CSS variables in some block(s)".

Out of scope:
- Projects with no CSS-variables-based token system (abort: "no `--*` variables found in any selector").
- Projects with non-hex color values (abort with migration instruction).
- Tailwind v3 with `tailwind.config.js` (abort: "tokens live in JS, not CSS — this skill audits CSS only").

## Prerequisites to load before running

1. **`figma:figma-use`** — load **once** at the start of the audit run, before the first `use_figma` call (Step 3). The loaded context applies to all subsequent `use_figma` calls in the same session, including Step 4's style capture; do not re-load before each call. Skipping the initial load causes silent failures around modes, fonts, and async ordering.

## Step 1 — Discover the Figma source

You need a `fileKey` and optionally a `nodeId`. Look in this order:

1. **Skill args.** If the user pasted a Figma URL, fileKey, or nodeId when invoking, parse it first. URL parsing: `figma.com/design/:fileKey/:name?node-id=1-2` → `fileKey` is `:fileKey`, `nodeId` is `1:2` (convert `-` to `:`). **Branch URLs:** `figma.com/design/:fileKey/branch/:branchKey/:name` → preserve BOTH: emit `fileKey` (the main file) AND `branchKey` (the branch) as distinct fields in the JSON. Use `branchKey` as the operative key for `use_figma` API calls (it routes to the branch), but record `fileKey` for provenance so a future re-audit can reproduce the same context.
2. **Project rules and docs.** Grep `.claude/rules/*.md`, any per-app `CLAUDE.md`, and the project README for a `figma.com/design/...` URL or an explicit `fileKey:` entry.
3. **Ask the user.** Only if the previous two turn up nothing.

The `nodeId` matters less than the `fileKey` — variable collections live at the file level, so any node can anchor a first-pass scan. If nothing specific is known, the page root (`0:1`) works.

## Step 2 — Discover the target CSS file and parse its current structure

Read the target before pulling anything from Figma. The audit needs to know what the CSS already looks like.

### Locate the file

Check common conventions in order:

- `app/globals.css` — Next.js App Router (most common)
- `src/index.css` or `src/globals.css` — Vite / CRA
- `src/app.css` or `src/styles/global.css` — SvelteKit / generic
- `app/tailwind.css` or `styles/globals.css` — Remix / older Next.js

**Monorepo subprojects.** If root-level paths fail, also search inside common subproject dirs (`next-frontend/`, `apps/<name>/`, `packages/<name>/`, `web/`, `frontend/`) using the same conventions (e.g., `next-frontend/app/globals.css`). As a fallback, grep for any `*.css` containing `@theme inline` or `:root {` with `--*` declarations across the workspace.

If none exist or multiple exist, ask the user which file is the token source of truth. Always emit the resolved path **relative to the workspace root** in `css_file` (so apply skills can locate it deterministically across machines).

### Parse what's there

Scan the file for **every block that declares CSS custom properties**, regardless of selector type. For each block, extract:

- The block's identifier (CSS selector like `:root`, `.dark`, `[data-theme="dark"]`, or at-rule string like `@theme inline`).
- The list of `--*` variable names and their current values.

The output of this step is a flat map: `{ "<block-id>": { "<var-name>": "<value>", ... }, ... }`.

**Combined selectors** (`:root, html { ... }`): treat as separate blocks with replicated contents. Emit each `(selector, condition)` pair as its own entry in `css_blocks[]` and replicate the variable declarations under each. Downstream diff treats them independently (the diff might map only one to a Figma mode and ignore the other).

**Multiple same-block declarations.** CSS allows the same `(selector, condition)` block to appear multiple times, including via `@layer ... { :root { ... } }` wrapping. Merge their variable declarations using **last-occurrence-wins** semantics (matches CSS cascade for unlayered rules). Audit treats all declarations equally for diff purposes (the comparison target is "the value the project declares for this token", not "the value that wins at runtime under cascade"). If the merged result reveals different values for the same `(selector, condition, var)` across multiple blocks, emit a `cross_block_warnings[]` entry with `kind: "multiple-declarations"` so the user sees the inconsistency:

```json
{ "kind": "multiple-declarations", "token": "--foo", "selector": ":root", "condition": null, "values_seen": ["#abc", "#def"], "reason": "same (selector, condition, var) declared with different values across multiple blocks" }
```

Note: a variable declared once in `:root` and once in `:root` inside `@media (prefers-color-scheme: dark)` is NOT a multiple-declaration — those are two distinct blocks (different `condition`).

**Conditional rules — `@media`, `@supports`, `@container`.** Variable declarations wrapped in conditional at-rules behave in one of two ways depending on the at-rule:

- **Promoted (allowlisted).** `@media (prefers-color-scheme: dark)` and `@media (prefers-color-scheme: light)` are recognized as theme-mode at-rules. The inner block is canonicalized (see "Canonical form for promoted at-rules" below) and added to `css_blocks[]` as a `{ selector, condition }` entry, fully participating in the diff. Do **not** emit `cross_block_warnings` entries for promoted blocks.

- **Excluded (everything else).** Other `@media` (responsive breakpoints, `prefers-reduced-motion`, `prefers-color-scheme: no-preference`, etc.), all `@supports`, and all `@container` blocks are **NOT** included in the diff — they create runtime variation that exceeds this skill's static drift model. Skip them during parsing but flag each occurrence in `cross_block_warnings[]` with `kind: "conditional-block"`:

```json
{ "kind": "conditional-block", "token": "--ring", "selector": ":root", "condition": "@media (prefers-reduced-motion: reduce)", "reason": "variable declared inside conditional at-rule; excluded from drift comparison" }
```

`@layer` is NOT a conditional rule (it controls cascade order, not application) and IS handled per "Multiple same-block declarations" above. The conditional set is exactly `@media`, `@supports`, and `@container`.

### Canonical form for promoted at-rules

When parsing a promoted block, normalize the at-rule string to a canonical form before recording it in `css_blocks[]` or in any `condition` field on items. This guarantees byte-identical comparison between audit and apply, even when the source CSS uses non-standard whitespace, mixed case, or the optional `screen and` / `all and` media-type prefix.

| Source CSS                                                  | Canonical                              |
|-------------------------------------------------------------|----------------------------------------|
| `@media (prefers-color-scheme: dark)`                       | `@media (prefers-color-scheme: dark)`  |
| `@media(prefers-color-scheme:dark)`                         | `@media (prefers-color-scheme: dark)`  |
| `@media   (prefers-color-scheme:   dark)`                   | `@media (prefers-color-scheme: dark)`  |
| `@media screen and (prefers-color-scheme: dark)`            | `@media (prefers-color-scheme: dark)`  |
| `@media all and (prefers-color-scheme: DARK)`               | `@media (prefers-color-scheme: dark)`  |
| `@media (prefers-color-scheme: light)`                      | `@media (prefers-color-scheme: light)` |
| `@media (prefers-color-scheme: no-preference)`              | (not in allowlist — `conditional-block` warning) |

Canonical rules:

1. Lowercase `@media` and the inner value (`dark` / `light`).
2. Exactly one space between `@media` and the opening `(`.
3. Exactly one space after `:` inside the parens; no space before.
4. Strip a leading optional media-type prefix (`screen and`, `all and`).
5. The audit JSON carries the canonical string only — the source CSS is never rewritten on disk.

The two and only canonical outputs are `@media (prefers-color-scheme: dark)` and `@media (prefers-color-scheme: light)`. Any other `@media`, `@supports`, or `@container` source is **not** canonicalized; it stays excluded per the rule above.

While parsing, also **detect the base font-size**: look for `font-size: <value>` in `:root`, `html`, or `:where(html)`. Default to `16px` if not found. Cache this value as the rem base for Step 5e numeric normalization (`8px Figma ↔ 0.5rem CSS` only holds when base is 16px).

### Hex pre-requisite check

After parsing, scan all values. If any color value is non-hex (matches `oklch(...)`, `hsl(...)`, `rgb(...)`, `color(...)`, named colors like `red`, etc.), **abort immediately** with:

```
This skill requires the project's CSS to use hex (#RRGGBB or #RRGGBBAA).
Found N non-hex value(s):
  --<token> in <block-id>: <value>
  ...
Migrate to hex (manually or via a separate format-migration task) and re-run.
```

Detect the existing hex case convention (`#ff0000` lowercase vs `#FF0000` uppercase) and shorthand usage (`#f00` vs `#ff0000`) from the parsed values; record this in the parsed structure for later normalization comparisons.

### Compute file SHA

Compute SHA-256 of the file contents. Store as `css_file_sha` in the JSON output. Apply skills validate this hash before writing — if the file changed since audit, apply aborts.

**Format.** Lowercase hex digest, NO prefix (no `sha256-`, no `0x`). 64 hex characters total. Example: `"css_file_sha": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"`. Apply skills compute SHA-256 the same way and string-compare for equality.

## Step 3 — Pull the full variable collection with every mode

`get_variable_defs` returns one mode only. For full reconciliation, go through `use_figma` and `figma.variables.getLocalVariableCollectionsAsync()`.

Use this template. It handles alias resolution recursively, hex-ifies colors, and returns a structured dump:

```js
const collections = await figma.variables.getLocalVariableCollectionsAsync();
const toHex = (c) => {
  const b = v => Math.round(v * 255).toString(16).padStart(2, '0');
  const hex = '#' + b(c.r) + b(c.g) + b(c.b);
  return (c.a !== undefined && c.a < 1)
    ? hex + Math.round(c.a * 255).toString(16).padStart(2, '0')
    : hex;
};
const resolve = async (val, modeId, depth = 0) => {
  if (depth > 6 || val == null) return null;
  if (typeof val !== 'object') return val;
  if (val.type === 'VARIABLE_ALIAS') {
    const target = await figma.variables.getVariableByIdAsync(val.id);
    if (!target) return 'MISSING_TARGET';
    const col = collections.find(c => c.id === target.variableCollectionId);
    const mid = col.modes.some(m => m.modeId === modeId) ? modeId : col.defaultModeId;
    return { via: target.name, value: await resolve(target.valuesByMode[mid], mid, depth + 1) };
  }
  return 'r' in val ? toHex(val) : val;
};
const out = [];
for (const col of collections) {
  const cEntry = {
    collection: col.name,
    modes: col.modes.map(m => ({ modeId: m.modeId, name: m.name })),
    vars: [],
  };
  let nullSkipped = 0;
  for (const vid of col.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(vid);
    if (!v) { nullSkipped++; continue; } // robustness: variable ID lingered in collection but the variable itself is gone (rare Figma sync edge)
    const entry = { name: v.name, type: v.resolvedType, byMode: {} };
    for (const m of col.modes) {
      entry.byMode[m.name] = await resolve(v.valuesByMode[m.modeId], m.modeId);
    }
    cEntry.vars.push(entry);
  }
  if (nullSkipped > 0) cEntry.nullVariablesSkipped = nullSkipped; // surface in Step 7 final report
  out.push(cEntry);
}
return out;
```

### Critical gotcha — `modeId` vs `id`

`VariableCollection.modes[i]` exposes the key as **`.modeId`, NOT `.id`**. If you write `v.valuesByMode[m.id]`, every lookup silently returns `undefined` and you get empty `byMode` objects for every variable. This is the single most common way this step breaks. Always use `modeId` for collection modes. If your first run comes back structurally empty, this is always the cause.

## Step 4 — Pull text and effect styles (raw, no analysis)

Text styles and effect styles are not variables and won't appear in Step 3. Pull them separately and **normalize to the emission schema** (the same shape Step 6 emits and apply skills consume). Do not emit raw Figma-API shapes — apply skills depend on a stable schema, not on Figma-API field names.

**Local only — published library styles invisible.** `getLocalTextStylesAsync` and `getLocalEffectStylesAsync` return only styles defined **locally** in the current Figma file. Styles published from an external library (referenced via component instances or applied directly to nodes) are NOT captured by these APIs. If the project is known to use a published library for type / effect styles, audit must surface this in `_meta.styles_capture: 'local-only'` so users understand the scale-gap analysis runs against a partial set. Detection: if `getLibraries` returns any non-empty list AND local style counts are zero or very low, set the meta flag and add a row to the final report alerting the user.

### 4a — Capture + normalize

```js
const text = await figma.getLocalTextStylesAsync();
const fx = await figma.getLocalEffectStylesAsync();
const toHex = /* same helper as Step 3 */;

// Map Figma font-style names to numeric font-weight per CSS spec.
// Order matters: check more-specific names before generic ones (e.g. "extrabold" before "bold").
const weightFromStyle = (style) => {
  const s = String(style || '').toLowerCase();
  if (s.includes('thin')) return 100;
  if (s.includes('extralight') || s.includes('extra light') || s.includes('ultralight')) return 200;
  if (s.includes('light')) return 300;
  if (s.includes('medium')) return 500;
  if (s.includes('semibold') || s.includes('semi bold') || s.includes('demibold')) return 600;
  if (s.includes('extrabold') || s.includes('extra bold') || s.includes('ultrabold')) return 800;
  if (s.includes('black') || s.includes('heavy')) return 900;
  if (s.includes('bold')) return 700;
  return 400; // default for "Regular" / "Normal" / unknown
};

// Figma lineHeight: { value, unit: 'PIXELS' } | { value, unit: 'PERCENT' } | { unit: 'AUTO' }.
// Emit as a px string; AUTO becomes null (apply will treat as "unspecified").
const lineHeightToPx = (lh, fontSize) => {
  if (!lh || lh.unit === 'AUTO') return null;
  if (lh.unit === 'PIXELS') return `${lh.value}px`;
  if (lh.unit === 'PERCENT') return `${(lh.value / 100) * fontSize}px`;
  return null;
};

const figma_styles = [
  ...text.map(s => ({
    name: s.name,
    type: 'text',
    decomposed: {
      size: `${s.fontSize}px`,
      lineHeight: lineHeightToPx(s.lineHeight, s.fontSize),
      fontWeight: weightFromStyle(s.fontName.style),
      fontFamily: s.fontName.family,
    },
  })),
  ...fx.map(s => ({
    name: s.name,
    type: 'shadow',
    effects: s.effects.map(e => ({
      kind: e.type === 'DROP_SHADOW' ? 'drop-shadow'
          : e.type === 'INNER_SHADOW' ? 'inner-shadow'
          : e.type.toLowerCase().replace(/_/g, '-'),
      offset_x: e.offset ? `${e.offset.x}px` : '0px',
      offset_y: e.offset ? `${e.offset.y}px` : '0px',
      blur: `${e.radius ?? 0}px`,
      spread: `${e.spread ?? 0}px`,
      color: e.color ? toHex({ r: e.color.r, g: e.color.g, b: e.color.b, a: e.color.a }) : null,
    })),
  })),
];

return figma_styles;
```

### 4b — Field mapping (capture → emission)

| Figma-API field | Emitted as |
|---|---|
| `s.fontSize` (number, px) | `decomposed.size: "{N}px"` |
| `s.lineHeight` (object) | `decomposed.lineHeight: "{N}px"` (or `null` if AUTO) |
| `s.fontName.style` (e.g., `"Bold"`) | `decomposed.fontWeight: 700` (numeric, via `weightFromStyle`) |
| `s.fontName.family` | `decomposed.fontFamily` |
| `s.letterSpacing` | **dropped** — apply skills do not use it; reintroduce only when a consumer needs it |
| `e.type === 'DROP_SHADOW'` | `kind: "drop-shadow"` |
| `e.offset.x` / `e.offset.y` (numbers) | `offset_x: "{N}px"` / `offset_y: "{N}px"` |
| `e.radius` (Gaussian blur) | `blur: "{N}px"` (renamed — `radius` is misleading) |
| `e.spread` | `spread: "{N}px"` |
| `e.color: { r, g, b, a }` | `color: "#RRGGBB[AA]"` (via `toHex`) |

Heads-up on shadow effects: `radius` on a Figma drop-shadow is the **Gaussian blur radius** (CSS `blur-radius`), not `border-radius`. The capture template renames it to `blur` precisely to avoid this confusion downstream.

## Step 5 — Classify variables and compute diff

### 5a — Classify by Figma collection

Each variable belongs to one of the file's collections. The collection name is preserved verbatim in JSON — this skill does NOT decide where a token belongs in the CSS. That's the apply skill's job.

The skill emits `figma_collection: "<collection name>"` on **every** `items[]` entry (drift and missing-in-css alike) for traceability and final-report grouping. It is informational — apply skills route by item shape (`value` for single-mode → primitive route; `values_by_block` for multi-mode → theme route), not by the literal collection name. Routing by shape keeps apply skills tolerant of project-specific names like `Semantic`, `Brand`, `Foundations`.

### 5b — Naming transform

Apply this transform pipeline to every Figma variable name to produce the CSS variable name:

1. **Lowercase the entire name** (`Brand/Colors/Blue` → `brand/colors/blue`). CSS variables are case-sensitive; lowercase is the prevailing CSS-token convention.
2. **Replace any non-alphanumeric character (other than `/`) with `-`** (`Border-Radius/sm` → `border-radius/sm`; `colors/blue 500` → `colors/blue-500`).
3. **Singularize the leading category** if it matches the recognized-plural allowlist below.
4. **Replace every remaining `/` with `-`**.
5. **Collapse repeated `-`** into a single `-`, trim leading/trailing `-`.
6. **Prepend `--`**.

**Recognized-plural allowlist** (Figma category → singular CSS prefix):

| Plural | Singular |
|---|---|
| `colors` | `color` |
| `radii` | `radius` |
| `shadows` | `shadow` |
| `weights` | `weight` |
| `borders` | `border` |
| `gradients` | `gradient` |
| `breakpoints` | `breakpoint` |
| `durations` | `duration` |

Any other leading category passes through unchanged (no implicit "strip-trailing-s" — the allowlist is the source of truth).

Examples:

- `colors/neutral/100` → `--color-neutral-100`
- `colors/red/500` → `--color-red-500`
- `colors/link` → `--color-link`
- `colors/success/alpha-10` → `--color-success-alpha-10`
- `Brand/Colors/Blue` → `--brand-color-blue` (lowercase + leading `Brand` is not in allowlist so passes through; nested `colors` is NOT the leading category and is not transformed)
- `spacing/sm` → `--spacing-sm` (already singular — no transform)
- `radius/md` → `--radius-md` (already singular — no transform)
- `radii/md` → `--radius-md` (plural → singular via allowlist)
- `primary` → `--primary` (theme tokens, no category prefix)
- `Foundations/text/body` → `--foundations-text-body` (Foundations not in allowlist; preserved verbatim, lowercased)

**The transform is deterministic.** Apply skills receive the transformed name in `items[].token` — they never re-derive it from `figma_source`.

**Collision detection.** After applying the transform across all variables in all collections, check for duplicate CSS names. If two or more Figma variables map to the same `--{name}`, abort with:

```
Naming collision: <FigmaName1> and <FigmaName2> both transform to <CSSName>.
Rename one in Figma, or define a project-specific transform override (out of scope for this skill), then re-run.
```

Do NOT silently pick one — collisions are configuration bugs that need human resolution before any drift comparison is meaningful.

### 5c — Selector-keyed comparison for theme tokens

Variables in collections with multiple modes (typically Theme/Semantic) are compared per-(token, block). A block is a `{ selector, condition }` pair (where `condition` is `null` for top-level blocks and a canonical at-rule string for promoted conditional blocks per Step 2). Audit needs to map Figma mode names to blocks. Default mapping resolves by priority — first available wins:

- Figma mode `Light` (or `Default`) → first available of:
  1. `{ selector: ":root", condition: null }`
  2. `{ selector: ":root", condition: "@media (prefers-color-scheme: light)" }`
- Figma mode `Dark` → first available of:
  1. `{ selector: ".dark", condition: null }`
  2. `{ selector: ":root", condition: "@media (prefers-color-scheme: dark)" }`

**When to prompt the user.** The default resolution above covers the common case where exactly one recognized candidate exists per mode. Prompt the user to confirm the mode→block mapping in any of these cases:

- Step 2 detected ZERO recognized dark candidates (none of: `.dark`, `:root` inside `@media (prefers-color-scheme: dark)`), OR MORE THAN ONE recognized dark candidate is present simultaneously, OR the only dark candidate is a non-default form (e.g., `[data-theme="dark"]`, `html.dark-mode`, `.theme-dark`).
- Step 2 detected MORE THAN ONE recognized light candidate (e.g., both `:root` and `:root` inside `@media (prefers-color-scheme: light)`), OR the only light candidate is a non-default form (e.g., `[data-theme="light"]`, `.theme-light`). The trivial case of a single `:root` is auto-mapped without prompting.
- The Figma collection has modes whose names are **not** in the default set (e.g., `Branded`, `High Contrast`, `Print`).
- Step 2 detected **more than two** theme blocks total, OR the Figma collection has more than two modes.
- The Figma collection has only a single mode but the project has multiple theme blocks (ambiguous — the single mode could apply to all blocks or to one specific block).

In all five cases, present the detected blocks + Figma modes and ask the user for the mapping before continuing. Do NOT guess.

**No-destination snippet for Dark / Light.** When prompting and the Figma collection has a Dark or Light mode but **no** matching candidate exists in the CSS, the user has two choices: skip the mode (it goes to `_meta.unmapped_modes`), or stop, add an empty block manually, and re-run. Surface the snippet directly in the prompt:

```css
/* Add ONE of these to the CSS file and re-run /figma-audit-tokens: */
.dark { }
/* OR */
@media (prefers-color-scheme: dark) {
  :root { }
}
```

(Symmetrically for Light when no light-mode block exists.)

**Constraint on user-provided blocks.** The blocks the user maps Figma modes to MUST be present in `css_blocks[]` as `{ selector, condition }` entries (i.e., were detected during Step 2). If the user supplies a block that does not exist in the file, re-prompt with the list of detected blocks. Audit will NOT emit a mapping referencing a non-existent block — apply inserts into existing blocks only and cannot create new ones. If the user wants to introduce a new theme block (e.g., add `[data-theme="contrast"]`, or an empty `@media (prefers-color-scheme: dark) { :root { } }`), that is a separate manual edit to the CSS file, performed before re-running this skill.

**Partial mappings — unmapped Figma modes.** The user MAY leave some Figma modes unmapped (e.g., a `Print` mode that's irrelevant for screen CSS, or a `WIP` mode still being designed). When the prompt is presented, accept "skip" / "ignore" / no-selector for any subset of modes. Audit then:
- Excludes unmapped modes from drift detection entirely (no `drift` items emitted, no `values_by_block` entries created for them).
- **Excludes from cross-block warnings as well** — variables whose Figma definition exists ONLY in unmapped modes are entirely outside the audit's comparison surface and produce no `cross_block_warnings[]` entries either, even if they happen to appear in CSS blocks. (Without this rule, a CSS-side `--print-only` would be flagged as `unexpected-block` even though the user explicitly told audit not to compare against the `Print` mode that defines it.) Variables with mixed mapped + unmapped modes follow the standard 5d.ii rule based on their MAPPED modes only.
- Records the decision in `_meta.unmapped_modes: ["Print", "WIP"]` (always present as `[]` when all modes are mapped, never absent — same rule as other top-level arrays).
- Surfaces the list in the final-report Step 7 alert: `Skipped Figma modes: <names> (no block mapped — values not audited).`

Filtering `items[]` and `cross_block_warnings[]` lets users scope audits without abandoning the entire run when only some modes are relevant to the current CSS.

**On user cancellation.** If the user provides no mapping or cancels the prompt, abort the audit cleanly with:
```
Audit aborted: mode→selector mapping required and not provided.
Re-run the skill when ready to confirm the mapping.
```
Do NOT emit a partial JSON. Do NOT fall back to default mapping when the defaults already failed (a wrong default would silently produce incorrect drift detection).

**Single-mode collections.** When a collection has only one mode (typically Primitives), it does not participate in block-keyed comparison. Its variables are either matched, drifted, or missing-in-css with a single `value` (not `values_by_block`); apply skills route them by item shape (per Step 5d.i).

### 5d — Diff per token, per selector

For each variable + selector combination:

- **Match** — values equal after normalization. No item emitted.
- **Drift** — CSS has the variable in this selector with a different value. Emit `kind: "drift"` item with `from` (current CSS value) and `to` (Figma value).
- **Missing in CSS** — CSS does not have the variable in **at least one** of the expected selectors (for multi-mode collections) OR has no entry anywhere (for single-mode collections). Emit `kind: "missing-in-css"` per the rules in 5d.i below.
- **Missing in Figma** — Figma has no equivalent. No-op (rule #4).
- **External-library alias** — the Figma side resolves to the sentinel `'MISSING_TARGET'` (returned by Step 3's `resolve` helper when `getVariableByIdAsync` returns `null`, typically because the variable points to a published external library not loaded in the current file). **Detect recursively:** for alias chains `A → B → C` where `C` (the leaf) is missing, the resolver returns nested `{ via: B, value: { via: C, value: 'MISSING_TARGET' } }`. Walk through `{ via, value }` wrappers — if ANY level resolves to the literal sentinel `'MISSING_TARGET'`, treat the entire chain as broken. (Implementation tip: a small helper `containsMissingTarget(v)` that recurses through wrappers keeps Step 5d's branch readable.) Skip drift/missing emission for this `(token, block)` pair. Append/merge into `external_library_aliases[]` with **one entry per affected token**, accumulating affected blocks (multi-mode case where only some modes resolve to `MISSING_TARGET`):
  ```json
  { "figma_source": "<collection>/<full-figma-name>", "reason": "MISSING_TARGET", "affected_blocks": [{ "selector": ".dark", "condition": null }] }
  ```
  - Single-mode collections: `affected_blocks` may be `[]` (no block concept — the whole token is opaque).
  - Multi-mode collections: list blocks corresponding to the failing modes per `_meta.mode_to_block`. If ALL modes fail, list all mapped blocks. Apply Step 7 sec 4 surfaces both the token and its affected blocks verbatim, so users can tell partial vs total alias failure apart.
  - **Merge semantics.** Maintain a token-keyed map (`figma_source` as key) during emission. On first encounter of a `(token, block)` pair with `MISSING_TARGET`, push a new entry `{ figma_source, reason: "MISSING_TARGET", affected_blocks: [<block>] }`. On subsequent encounters of the same `figma_source`, look up the existing entry and append the new block to `affected_blocks[]` only if not already present (compare by `(selector, condition)`, deduplicated, order-preserving). Never push a duplicate top-level entry — the final array has at most one entry per distinct `figma_source`.

#### 5d.i — `missing-in-css` emission rules

A single `missing-in-css` item is emitted **per token** (not per block), grouping all blocks where the variable is missing:

- **Multi-mode source collection** (e.g., Theme/Semantic with Light + Dark modes): emit `values_by_block` as an **array** of `{ selector, condition, $value }` entries, one per block where the variable is missing. Blocks where the variable already matches in CSS are excluded. Blocks where the variable drifts emit a separate `drift` item — these two kinds compose for the same token.
  - Example: Figma Theme has `warning` with Light=`#f59e0b`, Dark=`#d97706`. CSS has `--warning: #f59e0b` in `:root` only. Emit:
    ```json
    {
      "kind": "missing-in-css",
      "token": "--warning",
      "figma_collection": "Theme",
      "values_by_block": [
        { "selector": ":root", "condition": "@media (prefers-color-scheme: dark)", "$value": "#d97706" }
      ]
    }
    ```
- **Single-mode source collection** (e.g., Primitives with one mode): emit `value` (single object with `$value` field). The token is "missing" if it does not exist in any block. Apply routes single-mode missing items to its primitive destination by item shape, not by collection name.

Rule of thumb: drift items are per-(token, block); missing-in-css items are per-token with one or more blocks grouped (multi-mode `values_by_block[]`) or no block (single-mode `value` → apply chooses).

**Ordering inside `values_by_block[]`.** Sort entries lexicographically by `(condition || "", selector)` — non-conditional blocks first (`condition: null`), then conditional ones grouped by canonical at-rule. This produces a stable diff between re-runs of the audit.

#### 5d.ii — Cross-block variable collision

If the same variable name appears in **multiple CSS blocks**, audit needs to decide which blocks participate in the diff:

- **Multi-mode Figma source.** Compare against blocks listed in `_meta.mode_to_block` only. Other occurrences of the same variable in non-mapped blocks (e.g., `--ring` accidentally also in `@theme inline` while it's a Theme variable) are flagged in `cross_block_warnings[]` with `kind: "unexpected-block"`. `unexpected_block` and entries of `expected_blocks` are `{ selector, condition }` objects:
  ```json
  {
    "kind": "unexpected-block",
    "token": "--ring",
    "unexpected_block": { "selector": "@theme inline", "condition": null },
    "expected_blocks": [
      { "selector": ":root", "condition": null },
      { "selector": ".dark", "condition": null }
    ],
    "reason": "multi-mode token defined in non-mapped block"
  }
  ```
- **Single-mode Figma source.** Compare against the first block where the variable appears. Other occurrences are flagged similarly:
  ```json
  {
    "kind": "unexpected-block",
    "token": "--color-red-500",
    "unexpected_block": { "selector": ":root", "condition": null },
    "expected_blocks": [
      { "selector": "@theme inline", "condition": null }
    ],
    "reason": "single-mode token defined outside @theme inline"
  }
  ```

Apply skills surface these warnings in their final report (section 4: Not applied / surfaced). Audit does not abort — these may be intentional (legacy / migration-in-progress) — but they merit visibility.

### 5e — Normalization rules

Normalize before comparing. None of these are drift:

**Color (hex) values:**
- Case: `#FF0000` vs `#ff0000`
- Shorthand expansion: `#f00` vs `#ff0000`
- Fully-opaque alpha equivalence: `#ff0000ff` vs `#ff0000`
- Surrounding whitespace

For colors, lowercase and expand both sides to canonical 6- or 8-digit hex before comparing.

**Numeric (FLOAT) values — spacing, radius, sizes:**
- Figma returns FLOAT primitives in **pixels** (raw numbers). When the CSS uses `rem` (16px base unless the project overrides `font-size` on `:root` / `html`), convert Figma px → rem before comparing: `8 (Figma)` ↔ `0.5rem (CSS)` is a match. When the CSS uses `px`, compare as-is.
- Unit tolerance: `0` vs `0px` vs `0rem` are equivalent.
- Trailing-zero / format equivalence: `0.5rem` vs `0.50rem`, `1rem` vs `1.0rem` — match.
- If the project base font-size is non-default (e.g., 10px), use that base for the conversion. Detect by parsing `:root { font-size: ... }` if present.

For other numeric uses (opacity, line-height multipliers, etc.), normalize to a common decimal representation with no trailing zeros.

**String values (Figma `STRING` resolved type — typically font-family or arbitrary text tokens):**
- Trim leading/trailing whitespace.
- Collapse internal multiple spaces to a single space.
- Preserve case (CSS string values like `Inter, sans-serif` are case-significant for font-family lookup).
- Quote-style differences are NOT drift: `'Inter'`, `"Inter"`, and unquoted `Inter` are equivalent for single-token strings. For multi-token / comma-separated lists, normalize each segment the same way.

**Boolean values (Figma `BOOLEAN` resolved type):**
- BOOLEAN variables have no direct CSS equivalent. Do not emit them as `drift` or `missing-in-css`. Instead, append to a top-level `unsupported_for_css[]` array with `{ figma_source, type: "boolean", value: <true|false>, reason: "no CSS variable equivalent" }`. Apply skills surface these in section 4 of the final report for visibility, but never attempt Edits.

## Step 6 — Emit JSON

Write `docs/figma-audit.json`. Audit overwrites it on every run.

Schema:

```json
{
  "schema_version": "2.0",
  "generated_at": "2026-05-06T22:30:00Z",
  "figma": { "fileKey": "abc...", "branchKey": null, "nodeId": "0:1" },
  "css_file": "next-frontend/app/globals.css",
  "css_file_sha": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "css_blocks": [
    { "selector": ":root", "condition": null },
    { "selector": ".dark", "condition": null },
    { "selector": "@theme inline", "condition": null },
    { "selector": ":root", "condition": "@media (prefers-color-scheme: dark)" }
  ],
  "_meta": {
    "mode_to_block": {
      "Light": { "selector": ":root", "condition": null },
      "Dark":  { "selector": ".dark", "condition": null }
    },
    "unmapped_modes": [],
    "styles_capture": "local-only"
  },
  "items": [
    {
      "kind": "drift",
      "token": "--ring",
      "selector": ".dark",
      "condition": null,
      "from": { "$value": "#fb3748" },
      "to":   { "$value": "#e8203a" },
      "figma_collection": "Theme",
      "figma_source": "Theme/ring#Dark"
    },
    {
      "kind": "drift",
      "token": "--background",
      "selector": ":root",
      "condition": "@media (prefers-color-scheme: dark)",
      "from": { "$value": "#0a0a0a" },
      "to":   { "$value": "#0f0f0f" },
      "figma_collection": "Theme",
      "figma_source": "Theme/background#Dark"
    },
    {
      "kind": "missing-in-css",
      "token": "--warning",
      "figma_collection": "Theme",
      "values_by_block": [
        { "selector": ".dark", "condition": null, "$value": "#d97706" }
      ],
      "figma_source": "Theme/warning"
    },
    {
      "kind": "missing-in-css",
      "token": "--color-neutral-100",
      "figma_collection": "Primitives",
      "value": { "$value": "#f7f7f7" },
      "figma_source": "Primitives/colors/neutral/100"
    }
  ],
  "figma_styles": [
    {
      "name": "Heading/Display",
      "type": "text",
      "decomposed": { "size": "40px", "lineHeight": "48px", "fontWeight": 700, "fontFamily": "Inter" }
    },
    {
      "name": "Drop Shadow / Card",
      "type": "shadow",
      "effects": [
        { "kind": "drop-shadow", "offset_x": "0px", "offset_y": "10px", "blur": "15px", "spread": "0px", "color": "#00000010" }
      ]
    }
  ],
  "external_library_aliases": [
    {
      "figma_source": "Theme/ring",
      "reason": "MISSING_TARGET",
      "affected_blocks": [{ "selector": ".dark", "condition": null }]
    },
    { "figma_source": "Primitives/colors/red/500", "reason": "MISSING_TARGET", "affected_blocks": [] }
  ],
  "cross_block_warnings": [
    {
      "kind": "unexpected-block",
      "token": "--ring",
      "unexpected_block": { "selector": "@theme inline", "condition": null },
      "expected_blocks": [
        { "selector": ":root", "condition": null },
        { "selector": ".dark", "condition": null }
      ],
      "reason": "multi-mode token defined in non-mapped block"
    },
    {
      "kind": "multiple-declarations",
      "token": "--foo",
      "selector": ":root",
      "condition": null,
      "values_seen": ["#abc", "#def"],
      "reason": "same (selector, condition, var) declared with different values across multiple blocks"
    },
    {
      "kind": "conditional-block",
      "token": "--ring",
      "selector": ":root",
      "condition": "@media (prefers-reduced-motion: reduce)",
      "reason": "variable declared inside conditional at-rule; excluded from drift comparison"
    }
  ],
  "unsupported_for_css": [
    { "figma_source": "FeatureFlags/use-new-shadow", "type": "boolean", "value": true, "reason": "no CSS variable equivalent" }
  ]
}
```

**Schema notes:**

- Token values use the shape `{ "$value": <string> }` (or `$value` directly on entries of `values_by_block[]`). The `$value` key is borrowed from the W3C DTCG vocabulary for familiarity, but no other DTCG features (`$type`, aliases, etc.) are emitted. Apply skills read `item.from.$value`, `item.to.$value`, `item.value.$value`, and `block.$value` (per entry of `values_by_block[]`) directly.
- **A "block" is a `{ selector, condition }` pair**, where `condition` is `null` for top-level blocks and a canonical at-rule string (per Step 2) for promoted conditional blocks. This shape appears uniformly across `css_blocks[]`, drift items (`selector` + `condition` fields), `values_by_block[]` entries, `_meta.mode_to_block` values, `external_library_aliases[].affected_blocks[]`, and `cross_block_warnings[].unexpected_block` / `expected_blocks[]`.
- `figma_collection` is included on **every** `items[]` entry (drift and missing-in-css alike) for traceability and final-report grouping. It is informational; apply skills route by item shape (`value` vs `values_by_block`), not by this field.
- `figma_source` follows a single canonical format: `"<collection>/<full-figma-name>[#<mode>]"`. The trailing `#<mode>` segment is present only on `drift` items (where the diff is per-mode). Missing-in-css items omit it because the item already groups all modes via `values_by_block` or is single-mode via `value`.
- `_meta.mode_to_block` is informational: it preserves the audit's mapping decision for human inspection / future tooling. Apply skills do not consume it; block information needed for editing lives directly on items (`selector` + `condition` for drift, entries of `values_by_block[]` for theme missing).
- `_meta.unmapped_modes[]` lists Figma mode names the user explicitly chose not to map to any block during Step 5c (e.g., `["Print"]`). Always present as `[]` when all modes are mapped. Apply Step 7 sec 4 surfaces the list when non-empty so users can confirm intentional vs accidental exclusion.
- **Optional top-level arrays are always present, never omitted.** `external_library_aliases[]`, `cross_block_warnings[]`, `unsupported_for_css[]`, and `_meta.unmapped_modes[]` MUST be emitted as `[]` when empty. This lets apply skills read them via `audit.X` without null-guards or `?? []` fallbacks. Same rule for `figma_styles[]` and `items[]` (they are empty `[]` when there is nothing to report, never absent).
- **`cross_block_warnings[]` entries are discriminated by `kind`.** Three kinds exist: `"multiple-declarations"` (same `(selector, condition, var)` declared with different values across multiple blocks of the same `(selector, condition)` — has `selector` + `condition` + `values_seen[]` fields), `"unexpected-block"` (a token defined in a block outside its expected blocks per Step 5d.ii — has `unexpected_block` (a `{selector, condition}` object) + `expected_blocks[]` (array of `{selector, condition}` objects) fields), and `"conditional-block"` (a token declared inside a non-allowlisted conditional at-rule like `@media` / `@supports` / `@container` — has `selector` + `condition` fields; excluded from drift comparison per Step 2). Apply skills should branch on `kind` when formatting; consumers must not assume one shape.

## Step 7 — Final report (stdout)

After writing the file, output a brief summary:

```markdown
## Audit complete

- Wrote `docs/figma-audit.json`:
  - N drift items across X block(s)
  - M missing-in-css items (P touching `@theme inline`, Q touching theme blocks across Y block insertions)
  - K figma_styles captured
  - J token(s) with external-library alias failure (skipped)
  - W cross-block warning(s) (W1 unexpected-block, W2 multiple-declarations, W3 conditional-block)
  - U unsupported-for-CSS Figma variable(s) (BOOLEAN, etc.)
- CSS file: `<path>` (sha256: `<short>`)

[When _meta.unmapped_modes is non-empty:]
> Skipped Figma modes: <names joined by ", "> (no block mapped — values not audited).

[When any collection had nullVariablesSkipped > 0:]
> Warning: <total> variable(s) returned null from Figma and were skipped — possible Figma sync issue. Re-run if drift appears incomplete.

Next: invoke `figma-apply-tokens-tailwind-v4` (or another consumer) to apply the changes.
```

Counter definitions:
- `N drift items` = `audit.items[].kind === 'drift'` count.
- `X blocks` = number of distinct `(selector, condition)` pairs across drift items.
- `M missing-in-css items` = `audit.items[].kind === 'missing-in-css'` count.
- `P` = subset with `value` (single-mode → `@theme inline`).
- `Q` = subset with `values_by_block` (multi-mode).
- `Y` = sum of `item.values_by_block.length` across all multi-mode missing items (the actual number of block insertions apply will perform).
- `K` = `audit.figma_styles[].length`.
- `J` = `audit.external_library_aliases[].length`. **Semantics:** number of distinct **tokens** with at least one mode resolving to MISSING_TARGET (some tokens may have multiple `affected_blocks`). NOT a count of (token, block) skip-pairs.
- `W` = `audit.cross_block_warnings[].length`. `W1` / `W2` / `W3` = counts grouped by `kind` (`unexpected-block`, `multiple-declarations`, `conditional-block` respectively).
- `U` = `audit.unsupported_for_css[].length`.

If there are zero drift + zero missing items, say so explicitly and skip the `Next:` hint. Cross-block warnings, unsupported-for-CSS variables, and unmapped-modes alerts are still surfaced even when there are no actionable items, since they affect interpretation of the in-sync state.

## Things that look like drift but aren't

- **Hex formatting differences** — uppercase vs lowercase, `#f00` vs `#ff0000`, fully-opaque alpha (`#ff0000ff` vs `#ff0000`), surrounding whitespace. Normalize both sides before flagging drift (Step 5e).
- **Numeric (FLOAT) unit differences** — Figma returns px, CSS uses rem. `8` (Figma) ↔ `0.5rem` (CSS) is a match.
- **External-library variable bindings** — if the Figma file references variables from an external published library, `getVariableByIdAsync` may return `null` for those aliases. Treat as "opaque value" and compare on the resolved hex if possible; otherwise emit them in `external_library_aliases[]` with `reason: "MISSING_TARGET"` and skip the drift comparison.

## What NOT to do

- Don't rely on `get_variable_defs` alone for reconciliation. It's a one-mode snapshot — Step 3's `getLocalVariableCollectionsAsync` traversal is the only complete source.
