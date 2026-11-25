# Tech Spec subsection — UI Contracts

Emitted only when `ui_in_scope: true`. One `#### Screen: {name}` subsection per screen from the inventory.

## Template

> **Builder note (do NOT transcribe into artifact):** this subsection is emitted only when `ui_in_scope: true`. One `#### Screen: {name}` block per screen from the inventory.

````markdown
### UI Contracts

#### Screen: {screen name}

**Route:** `{route}`
**Figma:** {URL} (node `fileKey:nodeId`)
**Purpose:** {one-sentence quote of the capability this screen primarily serves}

**Auth requirement:** {Anonymous | Authenticated | Authenticated+Owner | ...} _(source: §Authorization Matrix — row matching primary endpoint of this screen)_

**Rendering strategy:** {Client Component | Server Component (RSC) | Server Action | SSR | SSG | ...} _(source: {slug}/TD-XX — frontend-architecture TD)_
  _(or literal placeholder `_No rendering architecture TD — implementer decides per screen (drift risk)._` when no such TD exists)_

**Reused DS components:**
- `components/ui/{name}` — {component from inventory Reuse? path} — {short note from inventory, if any}

**Server-connected components:**
- `{ComponentName}` — verbs: {list} | endpoint: `{METHOD} {fe-facing path}` (§API Contracts → BFF tier — see for `forwards-to` + request/response/projection) | reuse: {path | new}

**Behaviors:**

*Rendered states:*
- Loading: {description}
- Empty: {description or "not applicable"}
- Success: {description}
- Error: {short description; detailed mapping below}

*Interactions:* _(intra-screen — sourced from inventory Observations bucketed as `interaction` per `## Field derivation for UI Contracts` 7-bucket classifier + Figma prototype hints; omit sub-block when no interactions identified)_
- {trigger component / event} → {effect on which component(s)}
- ex: `<FilterButton>` click → fecha `<SortDropdown>` and refilters `<ResultsList>` locally

**Error Catalog → UX mapping:**

| errorCode (from §Error Catalog) | UX treatment |
|---------------------------------|--------------|
| `VALIDATION_ERROR` | Inline form field error beneath offending field |
| `EMAIL_ALREADY_EXISTS` | Inline email field hint with "login instead" CTA link |
| `UNAUTHORIZED` | Redirect to /login with returnTo param |
| `SERVER_ERROR` | Toast notification with retry CTA |

_(one row per errorCode relevant to this screen's endpoints; exclude codes that don't apply)_

**Client-side validation mirror:** _(source: §API Contracts → Validation Rules for endpoints referenced above — applied pre-submit for immediate UX feedback)_

- `email`: required, valid email format, min 3, max 255
- `password`: required, min 8, must include 1 digit
- _(one bullet per validated field; mirrors BE validation exactly)_

**Accessibility notes:**
- {bullet from inventory Observations if routed to a11y bucket; else "follow DS defaults"}
````

## Field derivation for UI Contracts

- **Auth requirement**: lookup in `### Authorization Matrix` table for ALL endpoints referenced by this screen's Server-connected components. Then apply **most-restrictive heuristic**: if any endpoint requires `Authenticated+Owner`, screen Auth = `Authenticated+Owner`; else if any requires `Authenticated`, screen Auth = `Authenticated`; else if all are `Anonymous`, screen Auth = `Anonymous`. **Edge case — mixed endpoints with legitimately-public routes that ALSO benefit from authenticated UX** (e.g., public feed where logged-in users see personalized content): heuristic picks Authenticated (most restrictive) conservatively. When this conservative default is wrong, emit literal placeholder `**Auth requirement:** Mixed — specify manually per screen Observations hint.`. User edits post-hoc. **Opt-out mechanism**: when the screen's Observations contain a bullet with the literal textual marker `mixed-auth-intentional` (classified into the **other** bucket — this is NOT a separate bucket, just a recognized string within the existing `other` bucket), the placeholder fires and the most-restrictive heuristic is bypassed; absence of the marker → most-restrictive wins silently.
- **Rendering strategy**: search `## Decisions Detail` + `## Inherited Decisions Detail` for TDs where Topic or Recommendation matches keyword heuristic `rendering | component | SSR | CSR | RSC | hydration | Client | Server`. First match wins. If no match → emit literal placeholder.
- **Server-connected components endpoint**: lookup in the UI ↔ API Traceability Matrix data **computed in memory earlier in Step 4** (joining API Contracts + UI Inventory Capability Join), though serialized later per canonical order. Build order: compute Matrix first (in memory) → serialize UI Contracts using in-memory Matrix lookups → serialize Matrix as the canonical-order-last subsection. The in-memory Matrix is the single source-of-truth for endpoint references; both UI Contracts (position 6) and serialized Matrix (position 7) consume the same computed data. **When a BFF tier is emitted in `### API Contracts`** (per `phase-a.md` § A2's "`### API Contracts` — BFF tier" rule), the endpoint line cites `(§API Contracts → BFF tier)` and the FE-facing path is the one derived there; UI Contracts **does NOT restate** the `forwards-to`, request/response shapes, status codes, or projection — those live once in the BFF tier (single source-of-truth, zero duplication). Never transcribe the upstream path into UI Contracts from inventory/SI prose; the upstream mapping exists only in the BFF tier where it was derived from the project contract source.
- **Error Catalog → UX mapping**: the mapping prose is **not auto-generated** — main writes each row with `{UX treatment inferred from inventory Observations for this screen, OR "_TBD — implementer decides per screen_"}`. UX taxonomy is judgment-dependent; placeholder lets user edit post-hoc.
- **Client-side validation mirror**: lookup in `### API Contracts` → `#### Validation Rules` (if present) for endpoints referenced in Server-connected components; copy rules verbatim with field names preserved.
- **Other fields** (Route, Figma, Purpose, Reused DS, Behaviors *Rendered states*, Behaviors *Interactions*, Accessibility): bounded-read the inventory file's `## Screen: ...` section. **For Reused DS components specifically:** transcribe the `Reuse?` path byte-verbatim, including any `(new)` suffix and the inventory's Notes column verbatim — the suffix is the load-bearing detection signal for `phase-b.md` § B2.6 (bootstrap SI sweep) and the Notes column carries the signal-keywords for B2.6's complex/simple sub-classification. Stripping or normalizing the suffix silently disables B2.6 detection. Observations routed via **7-bucket classifier** (matches `screen-inventory/SKILL.md` Output Contract item 6):
  - **validation blocker** → emit `FAILED at step-4-specs`.
  - **open question** → **passive classification only**. The actual routing to `## Open questions` is performed upstream by `screen-inventory` during its Final sections step (collecting residual decision dependencies from Observations into the dedicated section). Main does **not** edit the inventory file — this bucket label exists so that when main encounters such items in Observations during UI Contract rendering, it knows NOT to treat them as validation blockers or TD mentions. `plan-validate` ingests them as OQ-N via `inventory-digest-reader`'s `### Open Questions from Inventory` extraction (which reads only the `## Open questions` section, not Observations).
  - **TD mention** → add inline cross-ref next to the relevant UI Contract field (e.g., `(per {slug}/TD-XX)`).
  - **a11y keyword** → Accessibility notes.
  - **interaction** → `*Interactions:*` sub-block of Behaviors. Heuristic: bullet describes a **trigger → effect** intra-screen (ex: "clicking X closes Y", "submit disables Z while pending", "selecting filter rebuilds list"). Distinct from `a11y keyword` (focused on assistive technology semantics) and from `TD mention` (where the bullet names a {slug}/TD-NN reference). **Tie-breaker for dual-classification:** when a bullet qualifies as BOTH `interaction` (trigger → effect) AND `a11y keyword` (assistive-tech concern) — e.g., "Escape closes the modal", "Tab moves focus from filter to results" — route to BOTH sinks: render in `*Interactions:*` AND in `**Accessibility notes:**`. The two sub-blocks are non-mutually-exclusive; duplicating is correct because the reader audience differs (interaction reader = builder of the screen; a11y reader = audit / WCAG check). When no Observations route here for a given screen, omit the `*Interactions:*` sub-block entirely (not an empty header).
  - **reuse mention** → Reused DS components note.
  - **other** → ignored silently, **except for a small registry of recognized opt-out markers** that trigger specific derivation overrides (e.g., `mixed-auth-intentional` for the Auth requirement field — see Auth requirement bullet above for the full mechanism). Future opt-out markers added to the registry must be documented alongside the field they affect.

  Routing logic is self-contained here (not referenced from extinct files).

**Zero duplication of source-of-truth**: all cross-refs are materialized in memory during assembly; next `/plan-build` refresh automatically after upstream changes (Authorization Matrix, Error Catalog, Validation Rules, TD updates).
