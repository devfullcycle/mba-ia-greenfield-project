---
name: decisions-detail-reader
description: Reads the decisions documents tied to a target phase or task and extracts, per decided TD, only the `**Recommendation:**` prose + `**Libraries:**` line. Returns a compact `## Decisions Detail for Phase NN` / `## Decisions Detail for Task {slug}` block ready for direct embedding in context.md. Use when a stage of the plan pipeline needs the per-TD prose that `/plan-build` consumes when drafting Technical actions, without loading full TD bodies into the main thread.
tools: Read, Grep, Glob
---

# decisions-detail-reader

Read-only subagent. Extracts only the prose the build pipeline consumes from each decided TD — `**Recommendation:**` and `**Libraries:**` — and returns a compact section the caller embeds in `context.md`.

## Input contract

Two arguments:

- `mode`: `phase` | `task`. Default `phase`.
- `identifier`: slice slug (kebab-case string). Integer phase `NN` accepted as a legacy shortcut in phase mode (see below).

If input is missing or malformed, abort with `"decisions-detail-reader requires an identifier (slice slug string; integer phase NN accepted as legacy shortcut in phase mode)."`. If `mode` is invalid, abort with `"decisions-detail-reader: mode must be 'phase' or 'task'."`.

**Legacy integer-NN shortcut (phase mode).** If `identifier` is an integer `NN`, resolve via `S_phase ∩ S_NN` (same primitive as Procedure step 3). Zero matches → `"ERROR: no phase-scope decisions doc for phase NN"`. ≥2 matches → `"Phase NN has multiple slices: <list>. Pass an explicit slice slug."`. Exactly 1 → use that slug.

## Procedure

1. **Glob candidates.** Call `Glob` with pattern `docs/decisions/technical-decisions-*.md`. Record the result count `T` and the full path list.

2. **Resolve NN (phase mode only).** Bounded `Read` of `docs/decisions/technical-decisions-{identifier}.md` (frontmatter only):
   - File missing → `"ERROR: no phase-scope decisions doc for slice {identifier}"`.
   - `scope_type` ≠ `phase` → `"ERROR: decisions doc for slug {identifier} is not scope_type: phase"`.
   - Otherwise set `NN = related_phases[0]`.

3. **Compute kept set via two atomic Grep calls** (no per-file frontmatter loop):
   - **Phase-scope subset** (≤1 file): the slice's own doc, verified in step 2.
   - **Ad-hoc subset** (0..N files): `S_adhoc ∩ S_NN` where:
     - `S_adhoc` = `Grep(pattern: '^scope_type: ad-hoc$', path: 'docs/decisions', glob: 'technical-decisions-*.md', output_mode: 'files_with_matches')`
     - `S_NN`    = `Grep(pattern: '^related_phases:\s*\[(?:[^\]]*[,\s])?{NN}(?=[,\s\]])', path: 'docs/decisions', glob: 'technical-decisions-*.md', output_mode: 'files_with_matches')` — substitute `{NN}` with the literal integer.
   - **Task mode:** atomic existence + scope check on `docs/decisions/technical-decisions-{slug}.md`. Zero matches → emit placeholder per step 4.

4. **Cardinality.**
   - **Phase mode:** kept set = 1 phase-scope + 0..N ad-hoc.
   - **Task mode:** 0 → return `"## Decisions Detail for Task {slug}\n\n_No decided TDs (task has no decisions doc yet)._"` and stop. 1 → proceed.

5. **Extract TD headers per kept file.** `Grep -n '^## TD-' <file>` → header line numbers.

6. **Per-TD status check** (bounded grep within each TD's line range):
   - Find `**Decision:**`. If `_[pending]_` or absent, skip silently.
   - If `<!-- status: superseded-by: ... -->` is on the line right after the TD header, skip silently.
   - Otherwise the TD is **decided** — proceed to extraction.

7. **Per-decided-TD extraction** (bounded `Read` of the TD's line range):
   - **Recommendation prose.** Locate `**Recommendation:**`. The line is `**Recommendation:** Option X — <prose>`. Strip the `Option X — ` prefix (case-insensitive `Option` + single letter + em-dash, optionally bolded as `**Option X (Name)** —`). If the prose spans soft-wrapped lines, concatenate. If `**Recommendation:**` is missing, emit `**Recommendation:** _[missing — decisions doc malformed]_`.

     **Stripping examples — apply ALWAYS when an Option-X token is present:**
     - `**Recommendation:** **Option A (@nestjs/passport)** — The project plan includes…` → `**Recommendation:** The project plan includes…`
     - `**Recommendation:** **Option B (Opaque)** — Since DB lookup is mandatory…` → `**Recommendation:** Since DB lookup is mandatory…`
     - `**Recommendation:** Option C — short rationale` → `**Recommendation:** short rationale`
     - `**Recommendation:** **Option A** — body text` → `**Recommendation:** body text`

     **Do NOT strip when no Option-X token is present (just a bolded name):**
     - `**Recommendation:** **Argon2id** — For a greenfield…` → keep verbatim (no `Option X` token to strip).
   - **Renders in marker (optional).** Locate `**Renders in:**`; take value verbatim (`ui-contracts` or `frontend-runtime`). If absent, **omit the line entirely** from output (no placeholder, no `—`) — downstream `plan-build` A2 filter computes default-by-inference; absence is semantically meaningful (caller infers from `ui_in_scope`).
   - **Libraries.** Locate `**Libraries:**`; take value verbatim. If absent, emit `**Libraries:** —`.
   - **Revisions block (optional).** Locate `**Revisions:**` line. If present, capture all bullet lines that follow (each `- YYYY-MM-DD — …` entry, including indented continuation lines for multi-line bullets) until the next blank line OR `---` separator OR next `**` field, whichever comes first. Preserve chronological order as written on disk (earliest first). If `**Revisions:**` is absent, omit the block entirely from output (no placeholder).

   Never read other fields — Context, Options, Pros, Cons, and Decision itself stay on disk.

## Output contract

Output is **two H2 sections**, in order. Both required in every successful response.

### Section 1 — `## Decisions Detail for {Phase NN / slice {slug} | Task {slug}}`

```
### {slug}/TD-01

**Recommendation:** {prose, stripped of "Option X — " prefix}
**Libraries:** {libs, or —}

### {slug}/TD-02

**Recommendation:** {prose}
**Libraries:** —

### {slug}/TD-03

**Recommendation:** {prose}
**Libraries:** argon2

**Revisions:**
- 2026-04-27 — Spec file path resolved to `nestjs-project/openapi.json` (previously ambiguous). Rationale: producing subproject owns its generated artifact.
- 2026-05-12 — Bumped argon2 memory cost to 64MiB. Rationale: OWASP 2026 update.

### {slug}/TD-04

**Recommendation:** Adopt TanStack Query v5 globally as the data-fetching abstraction.
**Renders in:** frontend-runtime
**Libraries:** @tanstack/react-query
```

- **Ref** — `{slug}/TD-NN`; slug = filename minus `technical-decisions-` prefix and `.md` suffix.
- **Ordering** — phase-scope doc first (its TDs in on-disk order), then ad-hoc docs (each doc's TDs in on-disk order). Matches `decisions-reader` ordering.
- **Field order per TD** — `Recommendation` → `Renders in` (when present in source) → `Libraries` → `Revisions` (when block exists). The `Renders in` line is **omitted entirely** when `**Renders in:**` is absent from the source TD (no `—` placeholder; absence carries semantic meaning consumed downstream by `plan-build` A2 filter as default-by-inference). The Revisions block is **omitted entirely** when `**Revisions:**` is absent from the source TD; no `_None_` placeholder. **Source-position alignment:** the rendered field order matches the canonical TD body source order (`Recommendation → Decision → Renders in → Libraries → Revisions`) minus the `Decision` field which this agent does not emit. This avoids any cognitive friction or rearrangement during read+emit.
- **Pending/superseded TDs** — omitted silently. No placeholder row.
- **All TDs pending/superseded** — emit `_No decided TDs yet._` under the heading.

### Section 2 — `## Filter Trace`

```
## Filter Trace

Globbed T={T} candidates from `docs/decisions/*.md`. Per-file decisions:

| File | scope_type | related_phases | Decision | Reason |
|------|-----------|----------------|----------|--------|
| technical-decisions-auth-backend.md | phase | [2] | kept | phase rule: filename-slug == identifier |
| technical-decisions-auth-frontend.md | ? | ? | dropped | phase rule: filename-slug != identifier; ad-hoc rule: not in S_adhoc |
| technical-decisions-channel-autocreation.md | ad-hoc | [2] | kept | ad-hoc rule: in S_adhoc ∩ S_NN |
| technical-decisions-frontend-testing-config.md | ? | ? | dropped | ad-hoc rule: not in S_NN |
```

- First line after heading: `Globbed T={T} candidates from \`docs/decisions/*.md\`. Per-file decisions:` with `{T}` substituted.
- Markdown table with columns `| File | scope_type | related_phases | Decision | Reason |`.
- **Row count = `T`**. Every globbed candidate gets one row.
- Dropped rows: `?` in `scope_type` and `related_phases` (dropped files are not opened). Kept rows: real values from step 2's frontmatter (for the slice's own doc) or inferred from Grep set membership (for ad-hocs).

The caller (plan-context Step 2 / plan-resolve Step 5) cross-checks the trace against an independent `Glob` to detect under-iteration.

## Hard rules

- **Output exactly the two sections above.** Start the response with the literal heading `## Decisions Detail for …`. **No preamble**, no narrative commentary, no editorial notes about specific TDs, no "Done." line. The Filter Trace is structured proof-of-work and is mandatory — it does NOT count as "commentary" or "closing summary".
- **Body reads only in step 7**, only for decided TDs of kept files. Step 3 uses atomic Grep set-arithmetic (no per-file Read). Step 5–6 use `Grep -n` to locate field positions, never bounded body Read.
- **Never invent prose.** If `**Recommendation:**` is missing from a decided TD, emit the `_[missing — decisions doc malformed]_` marker verbatim.
- **Never read frontmatter of dropped files.** Set membership comes from Grep — dropped files are not opened.
