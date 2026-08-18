---
kind: drift-report
phase: phase-02-auth-frontend
plan_mtime: "2026-05-16T07:06:50Z"
---

# phase-02-auth-frontend — Drift Report

## Screen: signup — audited at SI-02.10.0 (2026-05-16)

**Quick scan:** 11 components (8 alinhado, 2 drift menor, 1 drift relevante, 0 ausente)

**TOC:**
- `components/ui/card.tsx` — Card — alinhado → skip
- `components/ui/label.tsx` — Label — alinhado → skip
- `components/ui/input.tsx` — Input — alinhado → skip
- `components/ui/button.tsx` — Button — alinhado → skip
- `components/ui/checkbox.tsx` — Checkbox — drift relevante → auto-Edit (5 specifics)
- `components/auth/brand-logo.tsx` — BrandLogo — alinhado → skip
- `components/auth/auth-footer.tsx` — AuthFooter — alinhado → skip
- `components/auth/back-link.tsx` — BackLink — alinhado → skip
- `components/auth/terms-checkbox.tsx` — TermsCheckbox — alinhado → skip
- `components/auth/password-visibility-toggle.tsx` — PasswordVisibilityToggle — drift menor → auto-Edit (2 specifics)
- `components/auth/password-strength-meter.tsx` — PasswordStrengthMeter — drift menor → auto-Edit (2 specifics)

---

### components/ui/card.tsx — Card

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** _(none)_

---

### components/ui/label.tsx — Label

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** _(none)_

---

### components/ui/input.tsx — Input

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** _(none)_

---

### components/ui/button.tsx — Button

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** _(none)_

---

### components/ui/checkbox.tsx — Checkbox

- **Status:** `drift relevante`
- **Decision:** `auto-Edit`
  - retune border-radius: `rounded-[4px]` → `rounded-[var(--radius-0-5)]` (hardcoded px leak — Figma container: `rounded-[var(--radius/0_5,2px)]` = project token `--radius-0-5`)
  - retune border-width: `border` (1px) → `border-2` (Figma container: `border-2` 2px)
  - retune border-color: `border-input` → `border-border` (Figma: `var(--border)`, not `var(--input)`)
  - drop variant override: `dark:bg-input/30` (stale shadcn scaffold — Figma checkbox has no base fill; semantic-token cascade covers dark mode)
  - drop variant override: `dark:data-checked:bg-primary` (redundant — `data-checked:bg-primary` uses `--primary`, a dual-mode token whose cascade already covers dark)
- **Prior:** _(none)_

_Note: the prior interrupted-run report listed a 6th specific (+icon CheckIcon, replace lucide-react). On-disk `checkbox.tsx` already imports `@/components/icons/check-icon` (line 6) — no lucide-react import exists; that drift no longer applies and is omitted._

---

### components/auth/brand-logo.tsx — BrandLogo

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** _(none)_

---

### components/auth/auth-footer.tsx — AuthFooter

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** _(none)_

---

### components/auth/back-link.tsx — BackLink

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** _(none)_

_Note: the prior interrupted-run report classified this as `drift menor` with `size-9 → size-6` / `rounded-[var(--radius-3)] → rounded-[var(--radius-full)]`. Those anchors do not exist on disk — `back-link.tsx` is a thin `<Link>` text wrapper (`text-body-md text-muted-foreground … rounded-[var(--radius-0-5)]` focus ring), not an icon-button. Figma's `arrow_back` is a 24px icon absolutely positioned at the card's top-left; the icon child + `size-6` + absolute positioning are screen-composition concerns supplied by SI-02.10a at the call site (allowed positioning override), not DS-file drift. The component's tokens are DS-consistent → no DS edit._

---

### components/auth/terms-checkbox.tsx — TermsCheckbox

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** _(none)_

_Note: the prior interrupted-run report classified this as `drift menor` with label `text-foreground → text-muted-foreground`. On-disk the label is **already** `text-muted-foreground` (line 43) — the `text-foreground` anchor does not exist. Figma label color `var(--color-almost-black-300,#a9a9a9)` is the dimmed/muted treatment, which `text-muted-foreground` already provides; links use `text-link` matching Figma `#3ea6ff`. No drift._

---

### components/auth/password-visibility-toggle.tsx — PasswordVisibilityToggle

- **Status:** `drift menor`
- **Decision:** `auto-Edit`
  - retune shape: `rounded-[var(--radius-1)]` → `rounded-[var(--radius-full)]` (Figma trailing-icon Content: `rounded-[var(--radius-full,999px)]` — round icon affordance; same radius token family)
  - retune icon size: `[&_svg]:size-4` → `[&_svg]:size-6` (Figma eye Icon node is `size-[24px]`; current 16px is one step under — within the spacing scale)
- **Prior:** _(none)_

_Note: the prior interrupted-run report assumed this toggle consumes `IconButton` (add `icon-round` size to `icon-button.tsx`, set `size="icon-round"`). On-disk the toggle is a **raw `<button>`** that does not import/consume `IconButton`; the retune is applied directly on the toggle's own className. No `icon-button.tsx` edit._

---

### components/auth/password-strength-meter.tsx — PasswordStrengthMeter

- **Status:** `drift menor`
- **Decision:** `auto-Edit`
  - retune bar radius: `rounded-full` → `rounded-[var(--radius-0-5)]` (Figma ProgressLinear track/indicator: `rounded-[2px]` = `--radius-0-5`; same radius token family)
  - retune caption token: `text-helper` → `text-caption` (Figma caption `143:2444` = Inter Regular 12/18/400 = project `text-caption`; `text-helper` is a different typography token)
- **Prior:** _(none)_

_Note: Figma also tints the strength caption with `var(--warning-text)` for the "Weak password" state; varying caption color by strength level is component-logic (mirrored in `FILL_COLOR`), handled in the wiring SI, not a DS-token drift the audit edits — omitted here by scope._

---

## Screen: login — audited at SI-02.11.0 (2026-05-16)

**Quick scan:** 8 components (7 alinhado, 1 drift menor, 0 drift relevante, 0 ausente)

**TOC:**
- `components/auth/login-form.tsx` — LoginForm — drift menor → auto-Edit (1 specific)
- `components/ui/card.tsx` — Card — alinhado → skip
- `components/auth/brand-logo.tsx` — BrandLogo — alinhado → skip
- `components/icons/streamtube-icon.tsx` — StreamTubeIcon — alinhado → skip
- `components/ui/label.tsx` — Label — alinhado → skip
- `components/ui/input.tsx` — Input — alinhado → skip
- `components/ui/button.tsx` — Button — alinhado → skip
- `components/auth/auth-footer.tsx` — AuthFooter — alinhado → skip

---

### components/auth/login-form.tsx — LoginForm

- **Status:** `drift menor`
- **Decision:** `auto-Edit`
  - retune link typography: `text-label-md` → `text-body-md` (Figma "Forgot password?" `147:539` = Inter Regular 14/20/400 = project `text-body-md`; `text-label-md` is the Medium-weight label token — wrong typography family for body-weight link text. Same typography token system → menor)
- **Prior:** _(none)_

_Note: form structure (email field, password field + inline "Forgot password?" link, "Sign in" submit) matches Figma `143:2265`. `<Button size="md">` resolves to `rounded-[var(--radius-4)] px-6 py-2 text-label-lg bg-primary` = Figma Button `147:541` exactly (alinhado, no edit). `<Label>`/`<Input>` token usage is DS-consistent (covered by their own rows below). BrandLogo + "Sign in" heading + AuthFooter are page-level composition supplied by SI-02.11a, not part of this form component._

---

### components/ui/card.tsx — Card

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** `alinhado/skip at SI-02.10.0 honored` — login Figma Card `143:1250` (`rounded-[var(--radius-2)]` / `border border-[var(--border)]` / `bg-[var(--card)]`) reproduces the signup-audit outcome; on-disk `rounded-[var(--radius-2)] border border-border bg-card` matches.

---

### components/auth/brand-logo.tsx — BrandLogo

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** `alinhado/skip at SI-02.10.0 honored` — login Figma BrandLogo `2387:2244` (icon 40px + "StreamTube" Inter Bold 24/32 foreground, gap 8px) reproduces the signup outcome; on-disk `size="lg"` → `size-10` + `text-h1` + `gap-2` + `text-foreground` matches.

---

### components/icons/streamtube-icon.tsx — StreamTubeIcon

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** _(none)_

_Note: Figma renders the brand icon as a remote `<img>` (`I2387:2244;2417:133`); per `next-frontend-ui.md` § Icons the DS component is reused, not the asset. On-disk `streamtube-icon.tsx` is a compliant custom `<svg viewBox="0 0 40 40" fill="currentColor">` with no hardcoded width/height, `aria-hidden`, spread props, `cn(className)` — consumer (BrandLogo) sizes via `size-10` + `text-red-700`. No DS-token surface to drift._

---

### components/ui/label.tsx — Label

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** `alinhado/skip at SI-02.10.0 honored` — login Figma FormLabel `2172:253`/`2172:263` (Inter Regular 14/20/400 foreground, gap 2px) reproduces the signup outcome; on-disk `text-body-md text-foreground gap-0.5` matches.

---

### components/ui/input.tsx — Input

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** `alinhado/skip at SI-02.10.0 honored` — login Figma TextField `147:536`/`147:540` (`bg-[var(--input-background)]` / `border border-[var(--border)]` / `rounded-[var(--radius-1)]` / h-36 / py-6 / text-16-24) reproduces the signup outcome; on-disk `h-9 rounded-[var(--radius-1)] border border-border bg-input-background px-4 py-1.5 text-body-lg` matches.

---

### components/ui/button.tsx — Button

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** `alinhado/skip at SI-02.10.0 honored` — login Figma Button `147:541` (`bg-[var(--primary)]` / `rounded-[var(--radius-4)]` / px-24 py-8 / Inter Medium 16/24/500 / primary-foreground) reproduces the signup outcome; on-disk `size="md"` variant (`rounded-[var(--radius-4)] px-6 py-2 text-label-lg`, default `bg-primary text-primary-foreground`) matches.

---

### components/auth/auth-footer.tsx — AuthFooter

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** `alinhado/skip at SI-02.10.0 honored` — login Figma AuthFooter `2394:2271` ("Don't have an account?" muted-foreground + "Sign up" link, Inter Regular 14/20, gap 8px) reproduces the signup outcome; on-disk `flex w-full flex-col items-center gap-2 text-body-md` + `text-muted-foreground` + `text-link` matches.

---

## Screen: forgot-password — audited at SI-02.12.0 (2026-05-16)

**Quick scan:** 8 components (8 alinhado, 0 drift menor, 0 drift relevante, 0 ausente)

**TOC:**
- `components/auth/forgot-password-form.tsx` — ForgotPasswordForm — alinhado → skip
- `components/ui/card.tsx` — Card — alinhado → skip
- `components/ui/icon-button.tsx` — IconButton — alinhado → skip
- `components/auth/brand-logo.tsx` — BrandLogo — alinhado → skip
- `components/ui/label.tsx` — Label — alinhado → skip
- `components/ui/input.tsx` — Input — alinhado → skip
- `components/ui/button.tsx` — Button — alinhado → skip
- `components/auth/auth-footer.tsx` — AuthFooter — alinhado → skip

---

### components/auth/forgot-password-form.tsx — ForgotPasswordForm

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** _(none)_

_Note: on-disk form composes only DS primitives (`<Label>` / `<Input>` / `<Button size="md">`), all of which the prior audits validated as DS-aligned; wrapper classes are layout-only (`flex flex-col gap-4`/`gap-2`), no hardcoded color/radius/typography token. Figma `143:2307` form (Email field group `2713:2086` + Button `143:2354` "Send reset link") matches structurally. The presentational→RHF rewrite is SI-02.12b's concern, not a DS-token drift._

---

### components/ui/card.tsx — Card

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** `alinhado/skip at SI-02.10.0 honored` — forgot-password Figma Card `143:2308` (`rounded-[var(--radius-2)]` / `border border-[var(--border)]` / `bg-[var(--card)]`) reproduces the signup/login outcome; on-disk matches.

---

### components/ui/icon-button.tsx — IconButton

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** _(none)_

_Note: Figma `arrow_back` `143:2343` is the M3 "Standard Icon button" (`101:181`) — container invisible until interaction — rendered as a 24px arrow glyph absolutely positioned at the card's top-left. The DS `ghost` variant (`bg-transparent` until hover, `focus-visible:ring`, `rounded-[var(--radius-N)]`) maps cleanly; no variant/prop/state is demanded that the primitive lacks, no hardcoded leak. Sizing the arrow to 24px is a call-site `<ArrowBackIcon className="size-6">` override (the cva selector `[&_svg:not([class*='size-'])]` explicitly yields to it) and the absolute top-left placement is screen composition — both supplied by SI-02.12a, exactly the precedent set by the signup `back-link` audit note. No DS-file drift._

---

### components/auth/brand-logo.tsx — BrandLogo

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** `alinhado/skip at SI-02.10.0 honored` — forgot-password Figma BrandLogo `2387:2252` (icon 40px + "StreamTube" Inter Bold 24/32 foreground, gap 8px) reproduces the signup/login outcome; on-disk `size="lg"` → `size-10` + `text-h1` + `gap-2` matches.

---

### components/ui/label.tsx — Label

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** `alinhado/skip at SI-02.10.0 honored` — forgot-password Figma FormLabel `2172:282` (Inter Regular 14/20/400 foreground, gap 2px) reproduces the signup/login outcome; on-disk `text-body-md text-foreground gap-0.5` matches.

---

### components/ui/input.tsx — Input

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** `alinhado/skip at SI-02.10.0 honored` — forgot-password Figma TextField `143:2351` (`bg-[var(--input-background)]` / `border border-[var(--border)]` / `rounded-[var(--radius-1)]` / h-36 / py-6 / text-16-24) reproduces the signup/login outcome; on-disk matches.

---

### components/ui/button.tsx — Button

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** `alinhado/skip at SI-02.10.0 honored` — forgot-password Figma Button `143:2354` (`bg-[var(--primary)]` / `rounded-[var(--radius-4)]` / px-24 py-8 / Inter Medium 16/24/500 / primary-foreground, "Send reset link") reproduces the signup/login outcome; on-disk `size="md"` variant matches.

---

### components/auth/auth-footer.tsx — AuthFooter

- **Status:** `alinhado`
- **Decision:** `skip`
- **Prior:** `alinhado/skip at SI-02.10.0 honored` — forgot-password Figma AuthFooter `2394:2276` (Inter Regular 14/20, gap 8px, question muted-foreground + link `text-link`) reproduces the signup/login outcome; on-disk matches.

_Note: Figma renders the footer link as "Sign up" where the usual UX is "Sign in" — this is a content/prop value (and a documented design-gap open question in the UI Contract), NOT a DS-token drift the audit edits. Footer copy/href are screen-composition props passed by SI-02.12a._
