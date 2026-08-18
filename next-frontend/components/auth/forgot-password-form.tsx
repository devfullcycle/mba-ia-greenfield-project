"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { FieldError } from "@/components/auth/field-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ApiErrorEnvelope } from "@/lib/api/contracts"
import { mapForgotPasswordErrorToForm } from "@/lib/auth/error-mapping"
import { cn } from "@/lib/utils"

// Client-side validation mirror (authored per phase-02-auth-frontend/TD-04 —
// `ForgotPasswordDto` has no declared properties in the contract source yet;
// this schema is aligned to the upstream rules when the spec expands).
const forgotPasswordSchema = z.object({
  email: z.email("Endereço de e-mail inválido"),
})

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>

function ForgotPasswordForm({
  className,
  ...props
}: React.ComponentProps<"form">) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  })

  const [sent, setSent] = React.useState(false)

  async function onSubmit(values: ForgotPasswordValues) {
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: values.email }),
    })

    if (!res.ok) {
      const envelope = (await res.json()) as ApiErrorEnvelope
      mapForgotPasswordErrorToForm(envelope, setError)
      return
    }

    // 204 — identical response whether or not the e-mail is registered
    // (anti-enumeration upstream, per the API Contract).
    setSent(true)
  }

  if (sent) {
    return (
      <div
        data-slot="forgot-password-success"
        role="status"
        className={cn(
          "flex w-full flex-col items-center gap-2 text-center",
          className
        )}
      >
        <p className="text-label-lg text-foreground">Verifique seu e-mail</p>
        <p className="text-body-md text-muted-foreground">
          Se houver uma conta associada a esse endereço, enviamos um link para
          redefinir sua senha.
        </p>
      </div>
    )
  }

  return (
    <form
      data-slot="forgot-password-form"
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className={cn("flex w-full flex-col gap-4", className)}
      {...props}
    >
      {errors.root?.serverError?.message && (
        <p
          role="alert"
          className="text-caption text-destructive"
          data-slot="form-error"
        >
          {errors.root.serverError.message}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="Enter your email"
          aria-invalid={!!errors.email}
          {...register("email")}
        />
        <FieldError message={errors.email?.message} />
      </div>

      <Button type="submit" size="md" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  )
}

export { ForgotPasswordForm }
