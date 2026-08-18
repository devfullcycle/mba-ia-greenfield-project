import type { FieldValues, Path, UseFormSetError } from "react-hook-form"

import type { ApiErrorEnvelope } from "@/lib/api/contracts"

function flattenMessage(message: ApiErrorEnvelope["message"]): string {
  return Array.isArray(message) ? message.join(" ") : message
}

/**
 * Maps the upstream `ApiErrorEnvelope` (passed through by the BFF Route Handler)
 * onto react-hook-form field/root errors.
 *
 * The signup contract does not enumerate machine-readable per-field codes
 * (`RegisterDto` has no declared properties yet), so the mapping keys on the
 * HTTP `statusCode` per the screen's Error Catalog → UX mapping:
 *  - 409: e-mail already registered → inline hint on the `email` field
 *          (the field's hint renders a "fazer login" CTA at the call site).
 *  - 400: validation failed → form-level inline message (`root.serverError`),
 *          deliberately NOT bound to the `email` field so it is visually
 *          distinct from the 409 email hint.
 *  - anything else → `root.serverError`.
 */
export function mapSignupErrorToForm<T extends FieldValues>(
  envelope: ApiErrorEnvelope,
  setError: UseFormSetError<T>,
): void {
  const message = flattenMessage(envelope.message)

  if (envelope.statusCode === 409) {
    setError("email" as Path<T>, { type: "server", message })
    return
  }

  setError("root.serverError" as Path<T>, { type: "server", message })
}

/**
 * Maps the upstream `ApiErrorEnvelope` onto react-hook-form errors for the
 * login screen, per its Error Catalog → UX mapping:
 *  - 403: e-mail not confirmed → distinct form-level root error
 *          (`root.confirmation`) so the form renders a resend-confirmation CTA.
 *  - 400: validation failed → inline message on the `email` field (the
 *          offending field; the login contract has no machine-readable
 *          per-field codes — `LoginDto` has no declared properties yet).
 *  - 401 / anything else → form-level alert (`root.serverError`).
 */
export function mapLoginErrorToForm<T extends FieldValues>(
  envelope: ApiErrorEnvelope,
  setError: UseFormSetError<T>,
): void {
  const message = flattenMessage(envelope.message)

  if (envelope.statusCode === 403) {
    setError("root.confirmation" as Path<T>, { type: "server", message })
    return
  }

  if (envelope.statusCode === 400) {
    setError("email" as Path<T>, { type: "server", message })
    return
  }

  setError("root.serverError" as Path<T>, { type: "server", message })
}

/**
 * Maps the upstream `ApiErrorEnvelope` onto react-hook-form errors for the
 * forgot-password screen. The only enumerated error is:
 *  - 400: validation failed → inline message on the `email` field
 *          (the only field on this form).
 * Anything else falls back to a form-level error (`root.serverError`).
 */
export function mapForgotPasswordErrorToForm<T extends FieldValues>(
  envelope: ApiErrorEnvelope,
  setError: UseFormSetError<T>,
): void {
  const message = flattenMessage(envelope.message)

  if (envelope.statusCode === 400) {
    setError("email" as Path<T>, { type: "server", message })
    return
  }

  setError("root.serverError" as Path<T>, { type: "server", message })
}
