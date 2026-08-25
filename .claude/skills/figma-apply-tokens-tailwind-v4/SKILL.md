---
name: figma-apply-tokens-tailwind-v4
description: Apply a Figma → CSS audit report to a Tailwind v4 project. Reads `docs/figma-audit.json` produced by `figma-audit-tokens`, validates the CSS file hasn't changed since audit, applies drift fixes and inserts missing tokens following Tailwind v4 conventions (`@theme inline` for primitives, theme selector blocks for multi-mode tokens), and runs scale-gap analysis. Invoke ONLY when the user explicitly asks to apply, sync, or commit the audit — phrases like "apply figma audit", "sync figma tokens to CSS", "aplica os tokens do figma", "atualiza o CSS com o audit". Requires `docs/figma-audit.json`; if missing, instruct the user to run `figma-audit-tokens` first.
disable-model-invocation: true
---

# Apply Figma Tokens (Tailwind v4)

The deterministic work of this skill lives entirely in `scripts/apply.py`. This file tells the agent **when to invoke it** and **what to do when it aborts**. For algorithmic detail (naming transform rules, family ordering, shadow normalization, hash check, scale-gap analysis), read the script — it's self-documenting via docstrings + doctests.

## Trigger

Invoke when ALL true:
- User explicitly asks to apply / sync / commit the audit (see `description` for phrasing).
- `docs/figma-audit.json` exists at the workspace root (or a path the user passes).

If the audit JSON is missing, do NOT improvise edits — instruct the user to run `/figma-audit-tokens` first and stop.

## Run

Single Bash invocation. The script does hash check, framework gate, edit planning, edit application, scale-gap analysis, and final report — all of it.

```bash
python3 ${CLAUDE_PLUGIN_ROOT:-.}/.claude/skills/figma-apply-tokens-tailwind-v4/scripts/apply.py \
  [--audit docs/figma-audit.json] \
  [--workspace .]
```

- `--audit` (default `docs/figma-audit.json`): path to the audit JSON, resolved relative to `--workspace`.
- `--workspace` (default `.`): root used to resolve `audit.css_file` and search for `package.json`.

**Exit 0:** echo stdout (markdown report with 4 sections) verbatim to the user.

**Exit 1:** read stderr — first colon-separated token is the error code. Map to user-facing recovery:

| Code | What to tell the user |
|---|---|
| `AUDIT_NOT_FOUND` | "Audit JSON missing. Run `/figma-audit-tokens` first to generate it, then re-invoke this skill." |
| `SCHEMA_VERSION_INVALID` | "Audit JSON has malformed `schema_version`. Re-run `/figma-audit-tokens` to regenerate." |
| `SCHEMA_MAJOR_UNSUPPORTED` | "Audit JSON major version doesn't match this skill. Either upgrade the apply skill or regenerate the audit with a compatible audit skill." |
| `CSS_NOT_FOUND` | "The CSS path recorded in the audit doesn't exist anymore. Re-run `/figma-audit-tokens` after restoring or relocating the file." |
| `SHA_MISMATCH` | "CSS file changed since audit was generated. Re-run `/figma-audit-tokens`, then re-invoke this skill." |
| `FRAMEWORK_GATE` | "Project doesn't appear to be Tailwind v4 (missing `@theme inline` block, or `tailwindcss` not at v4+ in package.json). This skill is Tailwind v4-specific." |
| `JSON_INCONSISTENT` | "Audit JSON has internal contradictions. Re-run `/figma-audit-tokens` and report the issue." |
| `BLOCK_NOT_FOUND` | "Audit references a destination block that doesn't exist (a CSS selector OR a conditional at-rule). The script's stderr message identifies the missing level and prints a copy-pasteable empty-block snippet — paste it into the CSS file, re-run `/figma-audit-tokens`, then re-invoke this skill." |
| `NAMING_COLLISION` | "Two Figma vars map to the same CSS name. Rename one in Figma, then re-run `/figma-audit-tokens`." |

In every recovery, propose the action and stop — do NOT improvise edits, fall back to manual `Edit` calls, or try to auto-fix the audit JSON.

## Out of scope (the script does NOT do these)

- Move existing token declarations from one block to another (e.g., relocate a declaration from `.dark` to `@media (prefers-color-scheme: dark) :root`). That's a refactor — separate operation. Apply only edits the block each item points to.
- Modify values not listed in `audit.items[]`. The audit decides; apply executes faithfully.
- Create new blocks (selector or conditional at-rule). The script aborts with `BLOCK_NOT_FOUND` and prints a copy-pasteable empty-block snippet when the destination is missing.
- Edit Figma. Apply is one-way: JSON → CSS.

## See also

- `/figma-audit-tokens` — prerequisite, generates the audit JSON.
- `scripts/apply.py` — full algorithmic detail + doctests. Run `python3 -m doctest scripts/apply.py -v` to validate after editing.
