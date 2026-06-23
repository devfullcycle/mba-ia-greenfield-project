"use client"

import * as React from "react"
import Link from "next/link"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"

import { FieldError } from "@/components/auth/field-error"
import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter"
import { PasswordVisibilityToggle } from "@/components/auth/password-visibility-toggle"
import { TermsCheckbox } from "@/components/auth/terms-checkbox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ApiErrorEnvelope } from "@/lib/api/contracts"
import { mapSignupErrorToForm } from "@/lib/auth/error-mapping"
import { cn } from "@/lib/utils"

// Client-side validation mirror (authored per phase-02-auth-frontend/TD-04 —
// `RegisterDto` has no declared properties in the contract source yet; this
// schema is aligned to the upstream rules when the spec expands).
const signupSchema = z
  .object({
    fullName: z.string().min(1, "Informe seu nome completo"),
    email: z.email("Endereço de e-mail inválido"),
    password: z
      .string()
      .min(8, "Mínimo 8 caracteres")
      .regex(/[a-zA-Z]/, "Inclua ao menos uma letra")
      .regex(/[0-9]/, "Inclua ao menos um número"),
    confirmPassword: z.string().min(1, "Confirme sua senha"),
    terms: z.boolean().refine((v) => v === true, {
      message: "Você precisa aceitar os termos",
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem",
    path: ["confirmPassword"],
  })

type SignupValues = z.infer<typeof signupSchema>

function SignupForm({ className, ...props }: React.ComponentProps<"form">) {
  const {
    register,
    handleSubmit,
    control,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      confirmPassword: "",
      terms: false,
    },
  })

  const [passwordType, setPasswordType] = React.useState<"password" | "text">(
    "password"
  )
  const [confirmType, setConfirmType] = React.useState<"password" | "text">(
    "password"
  )
  const [created, setCreated] = React.useState(false)

  const passwordValue = watch("password")

  async function onSubmit(values: SignupValues) {
    // RegisterDto has no declared properties in the contract source yet; the
    // payload is authored per phase-02-auth-frontend/TD-04 and passed through
    // by the BFF route (which casts to the upstream shape).
    const payload = {
      email: values.email,
      password: values.password,
    }

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const envelope = (await res.json()) as ApiErrorEnvelope
      mapSignupErrorToForm(envelope, setError)
      return
    }

    setCreated(true)
  }

  if (created) {
    return (
      <div
        data-slot="signup-success"
        role="status"
        className={cn(
          "flex w-full flex-col items-center gap-2 text-center",
          className
        )}
      >
        <p className="text-label-lg text-foreground">Conta criada!</p>
        <p className="text-body-md text-muted-foreground">
          Enviamos um e-mail de confirmação. Confirme seu endereço para ativar
          sua conta.
        </p>
      </div>
    )
  }

  const emailIsServerError = errors.email?.type === "server"

  return (
    <form
      data-slot="signup-form"
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      className={cn("flex w-full flex-col gap-6", className)}
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
        <Label htmlFor="fullName">Full Name</Label>
        <Input
          id="fullName"
          type="text"
          autoComplete="name"
          placeholder="Enter your full name"
          aria-invalid={!!errors.fullName}
          {...register("fullName")}
        />
        <FieldError message={errors.fullName?.message} />
      </div>

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
        {errors.email?.message && (
          <p className="text-caption text-destructive">
            {errors.email.message}
            {emailIsServerError && (
              <>
                {" "}
                <Link
                  href="/login"
                  className="text-link hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-[var(--radius-0-5)]"
                >
                  fazer login
                </Link>
              </>
            )}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            type={passwordType}
            autoComplete="new-password"
            placeholder="Create password"
            className="pr-12"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          <PasswordVisibilityToggle
            onTypeChange={setPasswordType}
            className="absolute inset-y-0 right-2 my-auto"
          />
        </div>
        <PasswordStrengthMeter value={passwordValue} />
        <FieldError message={errors.password?.message} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmPassword">Confirm Password</Label>
        <div className="relative">
          <Input
            id="confirmPassword"
            type={confirmType}
            autoComplete="new-password"
            placeholder="Confirm your password"
            className="pr-12"
            aria-invalid={!!errors.confirmPassword}
            {...register("confirmPassword")}
          />
          <PasswordVisibilityToggle
            onTypeChange={setConfirmType}
            className="absolute inset-y-0 right-2 my-auto"
          />
        </div>
        <FieldError message={errors.confirmPassword?.message} />
      </div>

      <div className="flex flex-col gap-2">
        <Controller
          control={control}
          name="terms"
          render={({ field }) => (
            <TermsCheckbox
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
        <FieldError message={errors.terms?.message} />
      </div>

      <Button
        type="submit"
        size="md"
        disabled={isSubmitting}
        className="w-full"
      >
        {isSubmitting ? "Creating account…" : "Create account"}
      </Button>
    </form>
  )
}

export { SignupForm }
