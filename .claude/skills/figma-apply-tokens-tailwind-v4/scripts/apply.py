#!/usr/bin/env python3
"""Apply a figma-audit-tokens JSON to a Tailwind v4 CSS file.

Reads the audit JSON (default: docs/figma-audit.json) produced by
figma-audit-tokens, validates the CSS hasn't changed since audit, and
applies drift fixes + missing-token insertions following Tailwind v4
conventions (@theme inline for primitives, theme selector blocks for
multi-mode tokens, family grouping + ramp ordering).

Also runs scale-gap analysis on the audit's figma_styles[] against the
project's --text-* / --font-weight-* / --shadow-* scale.

Usage:
    python3 apply.py [--audit <path>] [--workspace <path>]

Exit codes:
    0  success
    1  aborted (see stderr for ERROR_CODE: message)

Error codes (stderr):
    AUDIT_NOT_FOUND
    SCHEMA_VERSION_INVALID
    SCHEMA_MAJOR_UNSUPPORTED
    CSS_NOT_FOUND
    SHA_MISMATCH
    FRAMEWORK_GATE
    JSON_INCONSISTENT
    BLOCK_NOT_FOUND
    NAMING_COLLISION

Run doctests:
    python3 -m doctest apply.py -v
"""
import argparse
import hashlib
import json
import re
import sys
from collections import OrderedDict
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
# Errors
# ─────────────────────────────────────────────────────────────────────────────


class ApplyError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

PLURAL_MAP = {
    "colors": "color",
    "radii": "radius",
    "shadows": "shadow",
    "weights": "weight",
    "borders": "border",
    "gradients": "gradient",
    "breakpoints": "breakpoint",
    "durations": "duration",
}

TSHIRT_ORDER = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl"]

MODIFIERS = ["dark", "light", "muted"]

SUPPORTED_SCHEMA_MAJOR = 2

# Allowlisted promoted at-rules — recognized by canonicalize_condition().
# Audit Step 2 uses the same allowlist; both sides must agree.
PROMOTED_AT_RULES = (
    "@media (prefers-color-scheme: dark)",
    "@media (prefers-color-scheme: light)",
)

# Snippets emitted in BLOCK_NOT_FOUND stderr messages.
DARK_NO_DEST_SNIPPET = (
    "Add ONE of the following empty blocks to the CSS file, re-run "
    "/figma-audit-tokens, then re-invoke this skill:\n"
    "    .dark { }\n"
    "    /* OR */\n"
    "    @media (prefers-color-scheme: dark) {\n"
    "      :root { }\n"
    "    }"
)
LIGHT_NO_DEST_SNIPPET = (
    "Add an empty light-mode block to the CSS file, re-run "
    "/figma-audit-tokens, then re-invoke this skill:\n"
    "    @media (prefers-color-scheme: light) {\n"
    "      :root { }\n"
    "    }"
)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers (doctest-covered)
# ─────────────────────────────────────────────────────────────────────────────


def transform(name: str) -> str:
    """Transform a Figma variable name to a CSS custom property name.

    Pipeline: lowercase → replace non-alphanumeric (except /) with - →
    singularize leading category if in plural allowlist → replace / with - →
    collapse repeated - → prepend --.

    >>> transform("colors/red/500")
    '--color-red-500'
    >>> transform("colors/almost-black/100")
    '--color-almost-black-100'
    >>> transform("Brand/Colors/Blue")
    '--brand-colors-blue'
    >>> transform("colors/red/alpha-10")
    '--color-red-alpha-10'
    >>> transform("radii/md")
    '--radius-md'
    >>> transform("radius/md")
    '--radius-md'
    >>> transform("colors/link")
    '--color-link'
    >>> transform("primary")
    '--primary'
    >>> transform("spacing/0_5")
    '--spacing-0-5'
    >>> transform("colors/red 500")
    '--color-red-500'
    """
    n = name.lower()
    n = re.sub(r"[^a-z0-9/]", "-", n)
    if "/" in n:
        head, rest = n.split("/", 1)
        if head in PLURAL_MAP:
            head = PLURAL_MAP[head]
        n = f"{head}/{rest}"
    elif n in PLURAL_MAP:
        n = PLURAL_MAP[n]
    n = n.replace("/", "-")
    n = re.sub(r"-+", "-", n).strip("-")
    return f"--{n}"


def fmt_hex(v: str) -> str:
    """Normalize a hex color: lowercase, expand shorthand, strip #ff alpha.

    >>> fmt_hex("#FF0000")
    '#ff0000'
    >>> fmt_hex("#f00")
    '#ff0000'
    >>> fmt_hex("#ff0000ff")
    '#ff0000'
    >>> fmt_hex("#FF0000AA")
    '#ff0000aa'
    >>> fmt_hex("  #aBc  ")
    '#aabbcc'
    >>> fmt_hex("not-a-color")
    'not-a-color'
    """
    s = v.strip()
    if not s.startswith("#"):
        return s
    body = s[1:].lower()
    if len(body) == 3:
        body = "".join(c * 2 for c in body)
    elif len(body) == 4:
        body = "".join(c * 2 for c in body)
    if len(body) == 8 and body[6:] == "ff":
        body = body[:6]
    return "#" + body


def fmt_value(raw: str) -> str:
    """Format a value string with the file's hex case convention (lowercase)."""
    s = raw.strip()
    return fmt_hex(s) if s.startswith("#") else s


def parse_step(figma_full: str):
    """Parse a Figma source name into a sort key.

    Returns (bucket, numeric_key, str_key). Buckets:
        0 = base/none
        1 = numeric / T-shirt
        2 = alpha-N
        3 = full
        4 = named modifier

    Critical: detects "_" as fraction separator BEFORE float() because
    Python (PEP 515) parses int("0_5") == 5.

    >>> parse_step("colors/red/500")
    (1, 500.0, '')
    >>> parse_step("colors/red/alpha-10")
    (2, 10, '')
    >>> parse_step("colors/red/alpha-50")
    (2, 50, '')
    >>> parse_step("spacing/1_5")
    (1, 1.5, '')
    >>> parse_step("spacing/0_5")
    (1, 0.5, '')
    >>> parse_step("radius/full")
    (3, 0, '')
    >>> parse_step("radius/none")
    (0, -1, '')
    >>> parse_step("size/md")
    (1, 2, '')
    >>> parse_step("colors/link")
    (0, 0, 'link')
    >>> parse_step("colors/link-dark")
    (4, 0, 'link-dark')
    """
    parts = figma_full.split("/")
    if len(parts) >= 3:
        rest = "/".join(parts[2:])
    elif len(parts) == 2:
        rest = parts[1]
    else:
        return (0, 0, "")

    # alpha-N (must check BEFORE float — alpha-10 is a separate bucket)
    if rest.startswith("alpha-"):
        try:
            return (2, int(rest[6:]), "")
        except ValueError:
            pass

    if rest == "none":
        return (0, -1, "")
    if rest == "full":
        return (3, 0, "")

    # Fraction "1_5" → 1.5 (must check BEFORE float — Python parses "0_5" as 5)
    if "_" in rest:
        a, b = rest.split("_", 1)
        try:
            return (1, int(a) + int(b) / 10, "")
        except ValueError:
            pass

    # Pure numeric (no underscore — already handled)
    if "_" not in rest:
        try:
            return (1, float(rest), "")
        except ValueError:
            pass

    if rest in TSHIRT_ORDER:
        return (1, TSHIRT_ORDER.index(rest), "")

    if len(parts) == 2 and not any(c.isdigit() for c in rest):
        for mod in MODIFIERS:
            if rest.endswith(f"-{mod}"):
                return (4, 0, rest)
        return (0, 0, rest)

    return (4, 0, rest)


def shadow_sort(figma_full: str):
    """Sort key for shadow-family primitives (sub-axis y/blur/spread × T-shirt).

    >>> shadow_sort("shadow/y/xs")
    (0, 0, '')
    >>> shadow_sort("shadow/blur/md")
    (1, 2, '')
    >>> shadow_sort("shadow/spread/xl")
    (2, 4, '')
    """
    parts = figma_full.split("/")
    if len(parts) >= 3:
        sub = parts[1]
        size = parts[2]
        sub_order = {"y": 0, "blur": 1, "spread": 2}.get(sub, 99)
        size_idx = TSHIRT_ORDER.index(size) if size in TSHIRT_ORDER else 99
        return (sub_order, size_idx, "")
    return parse_step(figma_full)


def parse_schema_version(s: str):
    """Parse audit schema_version into (major, minor). Strict MAJOR.MINOR.

    >>> parse_schema_version("1.0")
    (1, 0)
    >>> parse_schema_version("1.5")
    (1, 5)
    >>> parse_schema_version("2.3")
    (2, 3)

    Malformed (exactly two integer parts joined by '.'):

    >>> parse_schema_version("1")
    Traceback (most recent call last):
    ...
    apply.ApplyError: SCHEMA_VERSION_INVALID: invalid schema_version "1": expected MAJOR.MINOR
    >>> parse_schema_version("1.0.0")
    Traceback (most recent call last):
    ...
    apply.ApplyError: SCHEMA_VERSION_INVALID: invalid schema_version "1.0.0": expected MAJOR.MINOR
    >>> parse_schema_version("1.x")
    Traceback (most recent call last):
    ...
    apply.ApplyError: SCHEMA_VERSION_INVALID: invalid schema_version "1.x": expected MAJOR.MINOR
    """
    parts = s.split(".")
    if len(parts) != 2:
        raise ApplyError(
            "SCHEMA_VERSION_INVALID",
            f'invalid schema_version "{s}": expected MAJOR.MINOR',
        )
    try:
        return (int(parts[0]), int(parts[1]))
    except ValueError:
        raise ApplyError(
            "SCHEMA_VERSION_INVALID",
            f'invalid schema_version "{s}": expected MAJOR.MINOR',
        )


def family_for(token: str, figma_full: str) -> str:
    """Determine the @theme inline family for a token.

    >>> family_for("--color-red-500", "colors/red/500")
    'red'
    >>> family_for("--color-link", "colors/link")
    'link'
    >>> family_for("--color-link-dark", "colors/link-dark")
    'link-dark'
    >>> family_for("--spacing-4", "spacing/4")
    'spacing'
    >>> family_for("--radius-md", "radius/md")
    'radius'
    >>> family_for("--shadow-y-xs", "shadow/y/xs")
    'shadow'
    >>> family_for("--font-weight-500", "font-weight/500")
    'font-weight'
    """
    if figma_full.startswith("colors/"):
        parts = figma_full.split("/")
        if len(parts) >= 3:
            return parts[1]
        return parts[1]
    n = token[2:]
    for prefix in (
        "spacing-",
        "radius-",
        "font-weight-",
        "font-size-",
        "line-height-",
        "shadow-",
    ):
        if n.startswith(prefix):
            return prefix.rstrip("-")
    return n


def sha256_of(path: Path) -> str:
    """Compute lowercase hex SHA-256 of a file."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonicalize_condition(s: str) -> str | None:
    """Normalize a CSS at-rule string to its canonical promoted form.

    Returns the canonical string when ``s`` matches the allowlist
    (`@media (prefers-color-scheme: dark|light)`), or None when it falls
    outside the allowlist. The audit's Step 2 uses the same allowlist; both
    sides must agree byte-for-byte.

    Canonical rules:
      1. Lowercase ``@media`` and the inner value (``dark`` / ``light``).
      2. Exactly one space between ``@media`` and the opening ``(``.
      3. Exactly one space after ``:`` inside the parens; no space before.
      4. Strip leading optional media-type prefix (``screen and``, ``all and``).

    >>> canonicalize_condition("@media (prefers-color-scheme: dark)")
    '@media (prefers-color-scheme: dark)'
    >>> canonicalize_condition("@media(prefers-color-scheme:dark)")
    '@media (prefers-color-scheme: dark)'
    >>> canonicalize_condition("@media   (prefers-color-scheme:   dark)")
    '@media (prefers-color-scheme: dark)'
    >>> canonicalize_condition("@media screen and (prefers-color-scheme: dark)")
    '@media (prefers-color-scheme: dark)'
    >>> canonicalize_condition("@media all and (prefers-color-scheme: DARK)")
    '@media (prefers-color-scheme: dark)'
    >>> canonicalize_condition("@MEDIA (PREFERS-COLOR-SCHEME: LIGHT)")
    '@media (prefers-color-scheme: light)'
    >>> canonicalize_condition("@media (prefers-color-scheme: light)")
    '@media (prefers-color-scheme: light)'
    >>> canonicalize_condition("@media (prefers-color-scheme: no-preference)") is None
    True
    >>> canonicalize_condition("@media (max-width: 768px)") is None
    True
    >>> canonicalize_condition("@supports (color: oklch(0 0 0))") is None
    True
    >>> canonicalize_condition("@container (min-width: 400px)") is None
    True
    """
    pattern = (
        r"^\s*@media\s*"
        r"(?:(?:all|screen)\s+and\s+)?"
        r"\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)\s*$"
    )
    m = re.match(pattern, s, flags=re.IGNORECASE)
    if not m:
        return None
    value = m.group(1).lower()
    return f"@media (prefers-color-scheme: {value})"


def block_label(selector: str, condition: str | None) -> str:
    """Human-readable label for a (selector, condition) pair.

    >>> block_label(":root", None)
    "':root'"
    >>> block_label(":root", "@media (prefers-color-scheme: dark)")
    "':root' inside '@media (prefers-color-scheme: dark)'"
    >>> block_label("@theme inline", None)
    "'@theme inline'"
    """
    if condition is None:
        return f"'{selector}'"
    return f"'{selector}' inside '{condition}'"


def block_match(a_selector: str, a_condition: str | None,
                b_selector: str, b_condition: str | None) -> bool:
    """Compare two blocks structurally.

    >>> block_match(":root", None, ":root", None)
    True
    >>> block_match(":root", None, ":root", "@media (prefers-color-scheme: dark)")
    False
    >>> block_match(":root", "@media (prefers-color-scheme: dark)", ":root", "@media (prefers-color-scheme: dark)")
    True
    """
    return a_selector == b_selector and a_condition == b_condition


# ─────────────────────────────────────────────────────────────────────────────
# Framework gate
# ─────────────────────────────────────────────────────────────────────────────


def find_package_json(css_path: Path, workspace: Path) -> Path | None:
    """Find the nearest package.json walking up from the css file."""
    cur = css_path.parent.resolve()
    ws = workspace.resolve()
    while cur >= ws or cur == ws:
        pj = cur / "package.json"
        if pj.is_file():
            return pj
        if cur == ws:
            break
        if cur.parent == cur:
            break
        cur = cur.parent
    return None


def framework_gate(css_path: Path, workspace: Path, css_text: str) -> None:
    """Verify Tailwind v4. Raises ApplyError(FRAMEWORK_GATE) on mismatch."""
    if "@theme inline" not in css_text:
        raise ApplyError(
            "FRAMEWORK_GATE",
            f"CSS file at {css_path} has no `@theme inline` block — not Tailwind v4 layout",
        )
    pj_path = find_package_json(css_path, workspace)
    if pj_path is None:
        raise ApplyError(
            "FRAMEWORK_GATE",
            f"no package.json found near {css_path} or above (up to {workspace})",
        )
    try:
        pj = json.loads(pj_path.read_text())
    except Exception as e:
        raise ApplyError("FRAMEWORK_GATE", f"failed to parse {pj_path}: {e}")
    deps = {**pj.get("dependencies", {}), **pj.get("devDependencies", {})}
    tw = deps.get("tailwindcss")
    if not tw:
        raise ApplyError(
            "FRAMEWORK_GATE",
            f"tailwindcss not found in {pj_path} dependencies",
        )
    # Accept "^4", "^4.0.0", "4.x", etc. Reject v3-style.
    if not re.search(r"(?:^|[^\d])4(?:\.|$)", tw):
        raise ApplyError(
            "FRAMEWORK_GATE",
            f"tailwindcss version {tw!r} in {pj_path} is not v4",
        )


# ─────────────────────────────────────────────────────────────────────────────
# CSS block utilities
# ─────────────────────────────────────────────────────────────────────────────


def _brace_count_close(css: str, body_start: int) -> int:
    """Find the position of the matching close-brace given a body start (just
    past an opening '{'). Returns the position of the close-brace.
    """
    pos = body_start
    depth = 1
    while pos < len(css) and depth > 0:
        if css[pos] == "{":
            depth += 1
        elif css[pos] == "}":
            depth -= 1
        pos += 1
    return pos - 1


def find_block(
    css: str, selector: str, condition: str | None = None
) -> tuple[int, int, int]:
    """Locate a (selector, condition) block in CSS by brace-counting.

    Returns (outer_start, body_start, inner_close):
      - outer_start: position where the unique anchor begins (the at-rule opener
        when condition is set, otherwise the inner selector opener). Callers
        use this for line-disambiguation when an old_line is non-unique.
      - body_start: position just past the inner '{' (where insertions go).
      - inner_close: position of the inner matching '}'.

    Raises ApplyError(BLOCK_NOT_FOUND, ...) with a descriptive message and
    a copy-pasteable empty-block snippet when:
      - condition is given but no @media at-rule canonicalizes to it
        (DARK_NO_DEST_SNIPPET / LIGHT_NO_DEST_SNIPPET appended);
      - condition is given, the at-rule exists, but the inner selector is
        missing inside it;
      - condition is None and the selector block is missing.
    """
    if condition is None:
        # Top-level scope: search the whole CSS.
        if selector == "@theme inline":
            m = re.search(r"@theme\s+inline\s*\{", css)
        else:
            m = re.search(rf"(?m)^{re.escape(selector)}\s*\{{", css)
        if not m:
            raise ApplyError(
                "BLOCK_NOT_FOUND",
                f"item references selector {selector!r} but block not found in CSS.",
            )
        body_start = m.end()
        inner_close = _brace_count_close(css, body_start)
        return (m.start(), body_start, inner_close)

    # Conditional case: find the matching at-rule first, then the inner selector.
    at_rule_match = None
    for m in re.finditer(r"(?m)^@media\b[^{]*\{", css):
        raw = m.group(0).rstrip("{").rstrip()
        if canonicalize_condition(raw) == condition:
            at_rule_match = m
            break
    if at_rule_match is None:
        snippet = (
            DARK_NO_DEST_SNIPPET
            if "dark" in condition
            else LIGHT_NO_DEST_SNIPPET
        )
        raise ApplyError(
            "BLOCK_NOT_FOUND",
            f"item references condition {condition!r} but no matching at-rule "
            f"found in CSS.\n  {snippet}",
        )

    at_rule_outer_start = at_rule_match.start()
    at_rule_body_start = at_rule_match.end()
    at_rule_close = _brace_count_close(css, at_rule_body_start)
    at_rule_body = css[at_rule_body_start:at_rule_close]

    # Inner selector inside the at-rule body — typically indented; tolerate
    # leading whitespace.
    if selector == "@theme inline":
        # @theme inline shouldn't appear inside @media in practice, but be
        # consistent with the top-level branch.
        inner = re.search(r"@theme\s+inline\s*\{", at_rule_body)
    else:
        inner = re.search(
            rf"(?m)^[ \t]*{re.escape(selector)}\s*\{{", at_rule_body
        )
    if not inner:
        raise ApplyError(
            "BLOCK_NOT_FOUND",
            f"item references selector {selector!r} inside {condition!r} but "
            f"the inner selector is missing from that at-rule. Add an empty "
            f"'{selector} {{ }}' inside the existing at-rule, re-run "
            f"/figma-audit-tokens, then re-invoke this skill.",
        )
    body_start = at_rule_body_start + inner.end()
    inner_close = _brace_count_close(css, body_start)
    return (at_rule_outer_start, body_start, inner_close)


# ─────────────────────────────────────────────────────────────────────────────
# Plan: drift edits
# ─────────────────────────────────────────────────────────────────────────────


def plan_drift_edits(audit: dict, css: str) -> list[dict]:
    """Build (old, new) pairs for each drift item, with anchors disambiguated."""
    edits = []
    for item in audit["items"]:
        if item["kind"] != "drift":
            continue
        sel = item["selector"]
        cond = item.get("condition")
        token = item["token"]
        new_val = fmt_value(item["to"]["$value"])

        outer_start, body_start, inner_close = find_block(css, sel, cond)
        body = css[body_start:inner_close]

        m = re.search(
            rf"^([ \t]*){re.escape(token)}\s*:\s*([^;]*);", body, re.MULTILINE
        )
        if not m:
            raise ApplyError(
                "JSON_INCONSISTENT",
                f"drift item for {token} in {block_label(sel, cond)}: "
                f"token line not found in block",
            )
        indent = m.group(1)
        literal_val = m.group(2)
        old_line = m.group(0)
        new_line = f"{indent}{token}: {new_val};"

        # Whole-line uniqueness check across the whole file.
        line_re = re.compile(rf"(?m)^{re.escape(old_line)}$")
        n_matches = len(line_re.findall(css))

        if n_matches > 1:
            # Disambiguate by prepending everything from outer_start (start of
            # the at-rule when nested, or start of the selector when not) up
            # to the position of old_line in the body.
            anchor_prefix = css[outer_start : body_start + m.start()]
            old_str = anchor_prefix + old_line
            new_str = anchor_prefix + new_line
        else:
            old_str = old_line
            new_str = new_line

        edits.append(
            {
                "selector": sel,
                "condition": cond,
                "token": token,
                "literal_before": literal_val,
                "after": new_val,
                "old": old_str,
                "new": new_str,
            }
        )
    return edits


# ─────────────────────────────────────────────────────────────────────────────
# Plan: missing-in-css insertions
# ─────────────────────────────────────────────────────────────────────────────


def plan_theme_block_lines(
    audit: dict,
) -> "OrderedDict[tuple[str, str | None], list[str]]":
    """Lines to insert into theme blocks (multi-mode missing items).

    Keyed by (selector, condition). Indent is 4 spaces when condition is
    set (block is nested inside an @media), 2 spaces otherwise.
    """
    out: OrderedDict = OrderedDict()
    for item in audit["items"]:
        if item["kind"] != "missing-in-css" or "values_by_block" not in item:
            continue
        token = item["token"]
        for block in item["values_by_block"]:
            sel = block["selector"]
            cond = block.get("condition")
            indent = "    " if cond else "  "
            key = (sel, cond)
            out.setdefault(key, []).append(
                f"{indent}{token}: {fmt_value(block['$value'])};"
            )
    return out


def plan_theme_inline_lines(audit: dict) -> tuple[list[str], "OrderedDict[str, list]"]:
    """Lines to insert into @theme inline (single-mode missing items),
    grouped by family in encounter order, sorted within each family."""
    primitive_items = []
    for item in audit["items"]:
        if item["kind"] != "missing-in-css" or "value" not in item:
            continue
        figma_full = item["figma_source"].split("/", 1)[1]
        primitive_items.append((item["token"], item["value"]["$value"], figma_full))

    families_raw: OrderedDict = OrderedDict()
    for token, value, figma_full in primitive_items:
        fam = family_for(token, figma_full)
        families_raw.setdefault(fam, []).append((token, value, figma_full))

    # Merge modifier-only families (e.g. "link-dark" → "link") into parent
    families: OrderedDict = OrderedDict()
    for fam, entries in families_raw.items():
        parent = None
        for mod in MODIFIERS:
            if fam.endswith(f"-{mod}"):
                cand = fam[: -len(f"-{mod}")]
                if cand in families_raw:
                    parent = cand
                    break
        target = parent if parent else fam
        families.setdefault(target, []).extend(entries)

    # Sort within each family
    for fam in families:
        if fam == "shadow":
            families[fam].sort(key=lambda e: shadow_sort(e[2]))
        else:
            families[fam].sort(key=lambda e: parse_step(e[2]))

    lines = []
    for fam, entries in families.items():
        for token, value, figma_full in entries:
            lines.append(f"  {token}: {fmt_value(value)};")

    return lines, families


# ─────────────────────────────────────────────────────────────────────────────
# Naming collision check
# ─────────────────────────────────────────────────────────────────────────────


def check_naming_collisions(audit: dict) -> None:
    """Flag distinct Figma source paths that would map to the same CSS token.

    Compares on `<collection>/<path>` only — the `#<mode>` suffix that the
    audit appends to drift items per Step 6 of the audit spec is stripped
    before comparison, so two drift items for the same Figma variable across
    Light/Dark modes are NOT a collision.

    >>> a = {"items": [
    ...   {"kind": "drift", "token": "--foreground", "figma_source": "Theme/foreground#Light"},
    ...   {"kind": "drift", "token": "--foreground", "figma_source": "Theme/foreground#Dark"},
    ... ]}
    >>> check_naming_collisions(a)  # same Figma var, different modes — OK

    >>> b = {"items": [
    ...   {"kind": "missing-in-css", "token": "--ring", "figma_source": "Theme/ring"},
    ...   {"kind": "missing-in-css", "token": "--ring", "figma_source": "Theme/ring-other"},
    ... ]}
    >>> check_naming_collisions(b)  # genuinely distinct sources — collide
    Traceback (most recent call last):
        ...
    apply.ApplyError: NAMING_COLLISION: two Figma vars map to --ring: 'Theme/ring' and 'Theme/ring-other'
    """
    seen: dict[str, str] = {}
    for item in audit["items"]:
        token = item.get("token")
        src = item.get("figma_source", "<unknown>").split("#", 1)[0]
        if not token:
            continue
        prev = seen.get(token)
        if prev is not None and prev != src:
            # Same token from two different Figma sources → collision
            raise ApplyError(
                "NAMING_COLLISION",
                f"two Figma vars map to {token}: {prev!r} and {src!r}",
            )
        seen[token] = src


# ─────────────────────────────────────────────────────────────────────────────
# Apply edits
# ─────────────────────────────────────────────────────────────────────────────


def apply_drift(css: str, edits: list[dict]) -> str:
    for edit in edits:
        old = edit["old"]
        new = edit["new"]
        if "\n" not in old:
            line_re = re.compile(rf"(?m)^{re.escape(old)}$")
            n = len(line_re.findall(css))
            if n == 0:
                raise ApplyError(
                    "JSON_INCONSISTENT",
                    f"drift anchor not found for {edit['token']} ({edit['selector']})",
                )
            if n > 1:
                raise ApplyError(
                    "JSON_INCONSISTENT",
                    f"drift anchor not unique for {edit['token']} ({edit['selector']}): {n} matches",
                )
            css = re.sub(rf"(?m)^{re.escape(old)}$", lambda _: new, css, count=1)
        else:
            n = css.count(old)
            if n == 0:
                raise ApplyError(
                    "JSON_INCONSISTENT",
                    f"drift anchor not found for {edit['token']} ({edit['selector']})",
                )
            if n > 1:
                raise ApplyError(
                    "JSON_INCONSISTENT",
                    f"drift anchor not unique for {edit['token']} ({edit['selector']}): {n} matches",
                )
            css = css.replace(old, new, 1)
    return css


def insert_before_close(
    css: str, selector: str, new_lines: list[str], condition: str | None = None
) -> str:
    _, _, inner_close = find_block(css, selector, condition)
    # Anchor at the start of the line containing `}` so the closing brace
    # keeps its existing indent (especially important for nested blocks where
    # the `}` is preceded by indentation).
    line_start = css.rfind("\n", 0, inner_close) + 1
    insertion = "\n".join(new_lines) + "\n"
    return css[:line_start] + insertion + css[line_start:]


# ─────────────────────────────────────────────────────────────────────────────
# Scale-gap analysis
# ─────────────────────────────────────────────────────────────────────────────


def build_var_table(css: str) -> dict:
    """Map `--name` → raw declared value across all blocks (last-wins).

    Values are returned verbatim and may themselves contain unresolved
    `var()` references — call `resolve_vars` to fully expand.

    >>> t = build_var_table(":root { --a: 10px; --b: var(--a); }")
    >>> t["--a"], t["--b"]
    ('10px', 'var(--a)')
    """
    out = {}
    for m in re.finditer(r"--([\w-]+)\s*:\s*([^;{}]+?)\s*;", css):
        out["--" + m.group(1)] = m.group(2).strip()
    return out


_VAR_REF_RE = re.compile(r"var\(\s*(--[\w-]+)(?:\s*,\s*([^()]*))?\s*\)")


def resolve_vars(value: str, table: dict, max_depth: int = 12) -> str:
    """Expand `var(--x)` references recursively against `table`.

    Stops on cycle (no progress between iterations) or `max_depth`. When a
    var is unresolved and has a fallback, the fallback is used; otherwise
    the original `var(--x)` token is left in place.

    >>> tbl = {"--a": "10px", "--b": "var(--a)", "--c": "var(--c)"}
    >>> resolve_vars("var(--a)", tbl)
    '10px'
    >>> resolve_vars("var(--b)", tbl)
    '10px'
    >>> resolve_vars("var(--missing, 1rem)", tbl)
    '1rem'
    >>> resolve_vars("var(--c)", tbl)  # cycle: returns last unresolved form
    'var(--c)'
    >>> resolve_vars("0 0 var(--a) var(--b)", tbl)
    '0 0 10px 10px'
    """
    out = value
    for _ in range(max_depth):
        if "var(" not in out:
            break
        new_out = _VAR_REF_RE.sub(
            lambda m: table.get(m.group(1), (m.group(2) or m.group(0)).strip()),
            out,
        )
        if new_out == out:
            break
        out = new_out
    return out


def normalize_number_tokens(value: str) -> str:
    """Round decimal numeric tokens to 4 places to remove IEEE-754 noise.

    Only acts on tokens with an explicit decimal point — integer tokens
    pass through unchanged. Hex literals and other non-numeric segments
    are untouched.

    >>> normalize_number_tokens("35.70000076293945px")
    '35.7px'
    >>> normalize_number_tokens("0.5000000000001rem")
    '0.5rem'
    >>> normalize_number_tokens("1px")
    '1px'
    >>> normalize_number_tokens("0 4px 35.70000076293945px 33px #00000040")
    '0 4px 35.7px 33px #00000040'
    """
    def fix(m):
        try:
            n = round(float(m.group(1)), 4)
        except ValueError:
            return m.group(0)
        s = f"{n:.4f}".rstrip("0").rstrip(".")
        return s + (m.group(2) or "")
    return re.sub(r"(-?\d+\.\d+)([a-z%]*)", fix, value)


def parse_text_scale(css: str) -> dict:
    """Parse --text-* paired entries from any block in css."""
    sizes = {}
    line_heights = {}
    weights = {}
    for m in re.finditer(r"--text-([\w-]+?)(--line-height|--font-weight)?\s*:\s*([^;]+);", css):
        name = m.group(1)
        suffix = m.group(2)
        val = m.group(3).strip()
        if suffix is None:
            sizes[name] = val
        elif suffix == "--line-height":
            line_heights[name] = val
        elif suffix == "--font-weight":
            weights[name] = val
    return {"sizes": sizes, "line_heights": line_heights, "weights": weights}


def parse_font_weight_scale(css: str) -> dict:
    out = {}
    for m in re.finditer(r"--font-weight-([\w-]+)\s*:\s*([^;]+);", css):
        out[m.group(1)] = m.group(2).strip()
    return out


def parse_shadow_scale(css: str) -> dict:
    out = {}
    for m in re.finditer(r"--shadow-([\w-]+)\s*:\s*([^;]+);", css):
        out[m.group(1)] = m.group(2).strip()
    return out


def scale_gap_rows(audit: dict, css: str) -> list[dict]:
    """Compare audit.figma_styles[] against the CSS scale. Returns rows.

    `var()` references in CSS values are resolved against the CSS-wide
    var table before comparison, and decimal numeric tokens on both sides
    are rounded to 4 places to remove float noise. So
    `--text-display: var(--font-size-30)` matches Figma `30px`, and
    `35.7px` matches Figma `35.70000076293945px`.
    """
    var_table = build_var_table(css)
    text_scale = parse_text_scale(css)
    shadow_scale = parse_shadow_scale(css)
    rows = []
    for s in audit.get("figma_styles", []):
        if s["type"] == "text":
            d = s["decomposed"]
            size = normalize_number_tokens(d.get("size") or "")
            lh_raw = d.get("lineHeight")
            lh = normalize_number_tokens(lh_raw) if lh_raw else None
            fw = d.get("fontWeight")
            covered_name = None
            for name, ssize_raw in text_scale["sizes"].items():
                ssize = normalize_number_tokens(resolve_vars(ssize_raw, var_table))
                if not size or not ssize.endswith(size):
                    continue
                slh_raw = text_scale["line_heights"].get(name)
                sfw_raw = text_scale["weights"].get(name)
                slh = normalize_number_tokens(resolve_vars(slh_raw, var_table)) if slh_raw else None
                sfw = resolve_vars(sfw_raw, var_table).strip() if sfw_raw else None
                lh_match = (lh is None) or (slh is not None and slh.endswith(lh))
                fw_match = sfw is not None and (sfw == str(fw) or sfw.endswith(str(fw)))
                if lh_match and fw_match:
                    covered_name = name
                    break
            if covered_name:
                rows.append({
                    "name": s["name"],
                    "decomposed": f"{size} / {lh or 'AUTO'} / {fw}",
                    "coverage": f"`--text-{covered_name}` (size+lh+weight)",
                    "status": "✓",
                })
            else:
                rows.append({
                    "name": s["name"],
                    "decomposed": f"{size} / {lh or 'AUTO'} / {fw}",
                    "coverage": "no `--text-*` matches",
                    "status": "⚠ scale gap",
                })
        elif s["type"] == "shadow":
            parts = []
            for e in s["effects"]:
                seg = f"{e['offset_x']} {e['offset_y']} {e['blur']} {e['spread']} {e['color']}"
                seg = normalize_number_tokens(seg)
                parts.append(re.sub(r"\b0px\b", "0", seg))
            target = ", ".join(parts)

            covered = None
            for name, val in shadow_scale.items():
                resolved = resolve_vars(val, var_table)
                norm = re.sub(r"\s+", " ", resolved.strip())
                norm = re.sub(r"\b0px\b", "0", normalize_number_tokens(norm))
                if norm == target:
                    covered = name
                    break
            rows.append({
                "name": s["name"],
                "decomposed": target,
                "coverage": f"`--shadow-{covered}` matches" if covered else "no `--shadow-{name}` matches",
                "status": "✓" if covered else "⚠ scale gap",
            })
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# Report
# ─────────────────────────────────────────────────────────────────────────────


def format_report(
    audit: dict,
    drift_edits: list[dict],
    theme_block_lines: dict,
    theme_inline_lines: list[str],
    families: dict,
    scale_gap: list[dict],
    css_path: Path,
    new_sha: str,
) -> str:
    lines = []
    out = lines.append

    out("## 1. Changes applied — theme blocks")
    out("")
    if not drift_edits and not theme_block_lines:
        out("No changes applied — CSS is in sync with the audit.")
        out("")
    else:
        out("| Token (block) | Before | After | Collection |")
        out("|---|---|---|---|")
        for e in drift_edits:
            if e["selector"] != "@theme inline":
                col = "Theme"  # heuristic; precise collection needs lookup
                label = block_label(e["selector"], e.get("condition"))
                out(
                    f"| `{e['token']}` ({label}) | `{e['literal_before']}` | "
                    f"`{e['after']}` | {col} |"
                )
        # Missing-in-css per (token, block)
        for item in audit["items"]:
            if item["kind"] == "missing-in-css" and "values_by_block" in item:
                for block in item["values_by_block"]:
                    label = block_label(block["selector"], block.get("condition"))
                    out(
                        f"| `{item['token']}` ({label}) | *(new)* | "
                        f"`{fmt_value(block['$value'])}` | "
                        f"{item.get('figma_collection', '?')} |"
                    )
        out("")

    out("## 2. Changes applied — `@theme inline`")
    out("")
    inline_drift = [e for e in drift_edits if e["selector"] == "@theme inline"]
    inline_missing = sum(1 for it in audit["items"]
                         if it["kind"] == "missing-in-css" and "value" in it)
    if not inline_drift and not inline_missing:
        out("No changes applied — `@theme inline` is in sync with the audit.")
        out("")
    else:
        out(f"{inline_missing} primitive token(s) inserted into `@theme inline`, "
            f"grouped by family in encounter order:")
        out("")
        out("| Family | Count |")
        out("|---|---|")
        for fam, entries in families.items():
            out(f"| `{fam}` | {len(entries)} |")
        out("")
        if inline_drift:
            out("**Drift edits (in `@theme inline`):**")
            out("")
            out("| Token | Before | After |")
            out("|---|---|---|")
            for e in inline_drift:
                out(f"| `{e['token']}` | `{e['literal_before']}` | `{e['after']}` |")
            out("")

    out("## 3. Scale-gap report")
    out("")
    if not scale_gap:
        out("No `figma_styles[]` captured.")
    else:
        out("| Figma style | Decomposed | CSS coverage | Status |")
        out("|---|---|---|---|")
        for r in scale_gap:
            out(f"| `{r['name']}` | {r['decomposed']} | {r['coverage']} | {r['status']} |")
    out("")

    out("## 4. Not applied and why")
    out("")
    cb = audit.get("cross_block_warnings", [])
    if cb:
        out(f"**Cross-block warnings ({len(cb)}):**")
        for w in cb:
            kind = w["kind"]
            if kind == "conditional-block":
                out(
                    f"- `{w['token']}` in `{w['selector']}` declared under "
                    f"`{w['condition']}` — excluded from drift comparison."
                )
            elif kind == "unexpected-block":
                ub = w["unexpected_block"]
                eb = ", ".join(
                    block_label(b["selector"], b.get("condition"))
                    for b in w["expected_blocks"]
                )
                out(
                    f"- `{w['token']}` defined in "
                    f"{block_label(ub['selector'], ub.get('condition'))}; "
                    f"expected {eb}."
                )
            elif kind == "multiple-declarations":
                out(
                    f"- `{w['token']}` in "
                    f"{block_label(w['selector'], w.get('condition'))} has "
                    f"conflicting values: {' vs '.join(w['values_seen'])}."
                )
        out("")
    ela = audit.get("external_library_aliases", [])
    if ela:
        out(f"**External-library aliases ({len(ela)} token(s)):**")
        for a in ela:
            blocks = a.get("affected_blocks", [])
            labels = ", ".join(
                block_label(b["selector"], b.get("condition")) for b in blocks
            )
            tail = f" (affected: {labels})" if labels else ""
            out(f"- `{a['figma_source']}` — {a['reason']}{tail}")
        out("")
    um = audit.get("_meta", {}).get("unmapped_modes", [])
    if um:
        out(
            f"**Unmapped Figma modes:** {', '.join(um)} "
            "(no block mapped — values not audited)."
        )
        out("")
    uns = audit.get("unsupported_for_css", [])
    if uns:
        out(f"**Unsupported-for-CSS Figma vars ({len(uns)}):**")
        for u in uns:
            out(f"- `{u['figma_source']}` ({u.get('type', '?')}) — {u['reason']}")
        out("")
    if audit.get("_meta", {}).get("styles_capture") == "local-only":
        out("**Styles capture = local-only:** library-published styles are invisible to the audit.")
        out("")
    if not (cb or ela or um or uns):
        out("Nothing surfaced.")
        out("")

    out("---")
    out(f"CSS now at SHA `{new_sha[:8]}...` (`{css_path}`).")

    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Main flow
# ─────────────────────────────────────────────────────────────────────────────


def run(audit_path: Path, workspace: Path) -> str:
    if not audit_path.is_file():
        raise ApplyError("AUDIT_NOT_FOUND", f"audit JSON not found at {audit_path}")
    audit = json.loads(audit_path.read_text())

    # Schema check
    sv = audit.get("schema_version", "")
    major, minor = parse_schema_version(str(sv))
    if major != SUPPORTED_SCHEMA_MAJOR:
        raise ApplyError(
            "SCHEMA_MAJOR_UNSUPPORTED",
            f"unsupported schema major version {major} — apply skill expects "
            f"major version {SUPPORTED_SCHEMA_MAJOR}; upgrade apply or downgrade audit",
        )

    # Resolve CSS path (workspace-relative per audit's emission contract)
    css_rel = audit.get("css_file")
    if not css_rel:
        raise ApplyError("JSON_INCONSISTENT", "audit JSON missing css_file field")
    css_path = (workspace / css_rel).resolve()
    if not css_path.is_file():
        raise ApplyError("CSS_NOT_FOUND", f"css file not found at {css_path}")

    # Hash check
    expected_sha = audit.get("css_file_sha", "")
    current_sha = sha256_of(css_path)
    if current_sha != expected_sha:
        raise ApplyError(
            "SHA_MISMATCH",
            f"CSS file at {css_path} changed since audit was generated.\n"
            f"  Audit hash:   {expected_sha}\n"
            f"  Current hash: {current_sha}\n"
            f"  Re-run /figma-audit-tokens to regenerate the JSON.",
        )

    css = css_path.read_text()

    # Framework gate
    framework_gate(css_path, workspace, css)

    # Validate blocks in items exist in css_blocks (each entry is
    # {selector, condition}).
    css_blocks = audit.get("css_blocks", [])
    block_set = {(b.get("selector"), b.get("condition")) for b in css_blocks}

    for item in audit["items"]:
        refs: list[tuple[str, str | None]] = []
        if item["kind"] == "drift":
            refs.append((item["selector"], item.get("condition")))
        elif "values_by_block" in item:
            for block in item["values_by_block"]:
                refs.append((block["selector"], block.get("condition")))
        for sel, cond in refs:
            if (sel, cond) not in block_set:
                raise ApplyError(
                    "JSON_INCONSISTENT",
                    f"item references block {block_label(sel, cond)} not in "
                    f"audit.css_blocks",
                )

    # Naming collision check
    check_naming_collisions(audit)

    # Plan
    drift = plan_drift_edits(audit, css)
    theme_block = plan_theme_block_lines(audit)
    theme_inline, families = plan_theme_inline_lines(audit)

    # Apply
    css = apply_drift(css, drift)
    for (sel, cond), lines in theme_block.items():
        css = insert_before_close(css, sel, lines, cond)
    if theme_inline:
        css = insert_before_close(css, "@theme inline", theme_inline)

    # Write
    css_path.write_text(css)
    new_sha = sha256_of(css_path)

    # Scale gap (against the post-apply CSS)
    sg = scale_gap_rows(audit, css)

    return format_report(
        audit, drift, theme_block, theme_inline, families, sg, css_path, new_sha
    )


def main():
    p = argparse.ArgumentParser(description="Apply figma-audit-tokens JSON to Tailwind v4 CSS")
    p.add_argument("--audit", default="docs/figma-audit.json",
                   help="path to audit JSON (default: docs/figma-audit.json)")
    p.add_argument("--workspace", default=".",
                   help="workspace root for resolving relative paths (default: cwd)")
    args = p.parse_args()

    workspace = Path(args.workspace).resolve()
    audit_path = (workspace / args.audit).resolve() if not Path(args.audit).is_absolute() \
        else Path(args.audit)

    try:
        report = run(audit_path, workspace)
    except ApplyError as e:
        print(f"{e.code}: {e.message}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"UNEXPECTED: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)
    print(report)
    sys.exit(0)


if __name__ == "__main__":
    main()
