"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { FieldError } from "@/components/auth/field-error"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ApiErrorEnvelope } from "@/lib/api/contracts"
import { mapLoginErrorToForm } from "@/lib/auth/error-mapping"
import { cn } from "@/lib/utils"

// Client-side validation mirror (authored per phase-02-auth-frontend/TD-04 —
// `LoginDto` has no declared properties in the contract source yet; this schema
// is aligned to the upstream rules when the spec expands).
const loginSchema = z.object({
  email: z.email("Endereço de e-mail inválido"),
  password: z.string().min(1, "Informe sua senha"),
})

type LoginValues = z.infer<typeof loginSchema>

function LoginForm({ className, ...props }: React.ComponentProps<"form">) {
  const router = useRouter()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  })

  async function onSubmit(values: LoginValues) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: values.email, password: values.password }),
    })

    if (!res.ok) {
      const envelope = (await res.json()) as ApiErrorEnvelope
      mapLoginErrorToForm(envelope, setError)
      return
    }

    // On 200 the BFF has already sealed the iron-session cookie (tokens never
    // cross to the browser, per TD-02). Refresh so server chrome reflects the
    // authenticated session (per phase-02-auth-frontend/TD-06).
    router.refresh()
  }

  return (
    <form
      data-slot="login-form"
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

      {errors.root?.confirmation?.message && (
        <div
          role="alert"
          className="flex flex-col gap-1 text-caption text-destructive"
          data-slot="form-confirmation-error"
        >
          <span>{errors.root.confirmation.message}</span>
          <Link
            href="/resend-confirmation"
            className="text-link hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-[var(--radius-0-5)]"
          >
            Reenviar e-mail de confirmação
          </Link>
        </div>
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

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="text-body-md text-link hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-[var(--radius-0-5)]"
          >
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!errors.password}
          {...register("password")}
        />
        <FieldError message={errors.password?.message} />
      </div>

      <Button type="submit" size="md" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  )
}

export { LoginForm }
