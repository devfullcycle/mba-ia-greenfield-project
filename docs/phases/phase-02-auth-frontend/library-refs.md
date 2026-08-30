---
libs:
  iron-session:
    version: "^8.x"
    context7_id: "/vvo/iron-session"
    fetched_at: "2026-05-14T11:05:00-03:00"
  react-hook-form:
    version: "^7.66.0"
    context7_id: "/react-hook-form/documentation"
    fetched_at: "2026-05-14T11:05:00-03:00"
  "@hookform/resolvers":
    version: "^3.x"
    context7_id: "/react-hook-form/resolvers"
    fetched_at: "2026-05-14T11:05:00-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-02-auth-frontend.md: "2026-05-14T11:03:30-03:00"
---

# phase-02-auth-frontend — Library References

Distilled docs for libraries decided in this slice. Pulled via Context7. Re-fetch when the underlying TD changes (resolve refreshes this file when the lib set in `## Decisions Index` drifts from the cached set here).

## iron-session

**Source:** `/vvo/iron-session` (Context7) — High reputation, 86 snippets, benchmark 87.4. Maps directly to `phase-02-auth-frontend/TD-02` Decision B.

### Core API for Next.js App Router

`iron-session` is the encrypted cookie-store primitive used by `lib/auth/session.ts`. The canonical pattern for App Router uses `getIronSession<T>(cookies(), sessionOptions)` — `cookies()` comes from `next/headers` and works in **Route Handlers, Server Components, Server Actions, and Middleware**.

```typescript
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  channelSlug: string;
  isLoggedIn: boolean;
}

export const defaultSession: SessionData = {
  accessToken: "",
  refreshToken: "",
  userId: "",
  email: "",
  channelSlug: "",
  isLoggedIn: false,
};

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_PASSWORD!,          // server-only env, ≥32 chars
  cookieName: "streamtube_session",
  ttl: 60 * 60 * 24 * 14,                          // 14 days (matches refresh-token horizon)
  cookieOptions: {
    httpOnly: true,                                 // default but pin explicitly
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",                                // CSRF default
    path: "/",
  },
};
```

### Reading / writing the session

In every consumer (Route Handler, RSC, Server Action):

```typescript
const session = await getIronSession<SessionData>(cookies(), sessionOptions);

// Login (POST /api/auth/login)
session.accessToken = upstream.accessToken;
session.refreshToken = upstream.refreshToken;
session.userId = upstream.userId;
session.email = upstream.email;
session.channelSlug = upstream.channelSlug;
session.isLoggedIn = true;
await session.save();

// Logout (POST /api/auth/logout)
session.destroy();

// Read (RSC layout)
if (!session.isLoggedIn) {
  // unauthenticated chrome
}
```

### Key contracts for Phase 02

- **`password` must be ≥32 chars** — validate in `lib/env.ts` (Zod 4 schema, server-only key) at app startup.
- **`httpOnly` is the default but should be pinned explicitly** in `cookieOptions` so any future copy-paste of the config retains the guarantee.
- **`session.destroy()` clears both the in-memory object and the cookie**; the logout Route Handler does NOT need to call `cookies().delete()` separately.
- **`getIronSession` is `await`-required** — every consumer is async; `lib/auth/session.ts` should export an `async getSession()` helper to centralize this and make signature drift easy to grep.
- **Password rotation** — `password` accepts either `string` or `{ [version: string]: string }` for rotation. Not used in Phase 02 but worth keeping the abstraction in `sessionOptions`.

### MSW integration notes (TD-02 + `next-frontend-msw-foundation/TD-04`)

BFF integration tests call the Route Handler as a function and assert on the `Response` headers. MSW intercepts upstream `fetch` to NestJS; iron-session itself is NOT mocked — the cookie crypto runs for real inside the handler. Tests must seed `process.env.SESSION_PASSWORD` in `vitest.setup.ts`.

---

## react-hook-form

**Source:** `/react-hook-form/documentation` (Context7) — High reputation, 672 snippets, benchmark 87.38. Maps to `phase-02-auth-frontend/TD-04` Decision A.

### useForm + zodResolver — canonical pattern for shadcn Form

The project commits to shadcn's `Form` primitive (`components/ui/form.tsx`), which is a react-hook-form wrapper. The canonical wiring inside an auth Client Component:

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const signupSchema = z.object({
  email: z.string().email("Endereço de e-mail inválido"),
  password: z.string().min(8, "Mínimo 8 caracteres"),
});

type SignupValues = z.infer<typeof signupSchema>;

export function SignupForm() {
  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: SignupValues) {
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      const err = await res.json();             // { statusCode, error, message } per phase-02-auth/TD-07
      mapErrorEnvelopeToForm(err, form);        // helper sets per-field errors via form.setError
      return;
    }

    // redirect or router.refresh()
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>E-mail</FormLabel>
              <FormControl><Input type="email" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Senha</FormLabel>
              <FormControl><Input type="password" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Cadastrando…" : "Cadastrar"}
        </Button>
      </form>
    </Form>
  );
}
```

### Mapping the backend error envelope to fields (OQ-12 resolution)

The error envelope `{ statusCode, error, message }` from `phase-02-auth/TD-07` flows back from the BFF Route Handler. A single helper in `lib/auth/error-mapping.ts` switches on the machine-readable `error` code and calls `form.setError` per-field; unknown codes fall through to a top-of-form `<Alert>` (per OQ-12 inline resolution). React-hook-form's `setError` API:

```typescript
form.setError("email", { type: "server", message: "Este e-mail já está em uso." });
form.setError("root.serverError", { type: "server", message: "Falha no servidor." });
```

`form.formState.errors.root?.serverError` is the canonical key for form-level errors not bound to a single field.

### Submission state for the loading UI (OQ-12 follow-up)

`form.formState.isSubmitting` is the canonical loading flag. Wrap the submit button's label/spinner with it. For the forgot-password success state (OQ-14), use `form.formState.isSubmitSuccessful` AND a local `useState` if the success card must persist past navigation.

### Testing notes (`testing-guide-next-frontend`)

- The form lives inside a `"use client"` Client Component → `*.test.ts` (RTL) per the testing guide. Mock `next/navigation` (`useRouter`, `useSearchParams`) and `fetch`.
- Vitest cannot render async RSC; the page wrapping `SignupForm` is covered via `*.e2e-spec.ts` (Playwright).
- Submit with invalid data → assert `FormMessage` text per field (the Zod error message). Submit with valid data + mocked fetch returning the error envelope → assert `form.setError` propagation by reading `screen.getByText(...)`.

---

## @hookform/resolvers

**Source:** `/react-hook-form/resolvers` (Context7) — High reputation, 80 snippets, benchmark 75.55. Maps to `phase-02-auth-frontend/TD-04` Decision A (companion to react-hook-form).

### zodResolver entry point

Import from the `/zod` subpath specifier:

```typescript
import { zodResolver } from "@hookform/resolvers/zod";
```

### Zod 4 compatibility

`@hookform/resolvers` automatically detects Zod v3 vs v4 at runtime. Project uses **Zod 4** (`next-frontend-config-base/TD-01`); import via the standard `zod` package (the runtime detection handles the version dispatch). If a future codebase migration ever splits to dual-version support, the resolver also accepts `import { z } from "zod/v4"`.

### Type inference

Two equivalent patterns:

```typescript
// Automatic (recommended for Phase 02 — every schema goes through this path):
const form = useForm({
  resolver: zodResolver(schema),
  defaultValues: schemaDefaults,
});

// Explicit (when input ≠ output, e.g., string→number coercion):
const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
  resolver: zodResolver(schema),
});
```

Phase 02's auth schemas (email + password) have no coerce; the automatic form is sufficient.

### Async vs sync, criteriaMode

- Default mode is **async** (`schema.parseAsync`). Required for any Zod refinement that uses async work; safe for sync schemas too.
- `resolverOptions: { mode: 'sync' }` forces sync — not needed in Phase 02.
- `criteriaMode: 'all'` (set on `useForm`, not the resolver) collects every error per field into `formState.errors.{field}.types`. Phase 02 default is single-error-per-field (`criteriaMode: 'firstError'`); switch to `all` only if a future UX shows all rule violations simultaneously.

### Raw values mode

`resolverOptions: { raw: true }` skips Zod coercion and returns the un-parsed input. Not used in Phase 02 (we want post-coerce values for backend POSTs).

### Validation always covers the full schema

`zodResolver` calls `schema.parseAsync(values)` against the entire schema on every validation pass, regardless of which field triggered the validation. This means cross-field refinements (`.refine((data) => data.password === data.confirmPassword, ...)` for the reset-password screen) work without special wiring.
