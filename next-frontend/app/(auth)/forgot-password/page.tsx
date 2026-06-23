import { AuthFooter } from "@/components/auth/auth-footer"
import { BrandLogo } from "@/components/auth/brand-logo"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"
import { ArrowBackIcon } from "@/components/icons/arrow-back-icon"
import { Card } from "@/components/ui/card"
import { IconButton } from "@/components/ui/icon-button"

export default function ForgotPasswordPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-background px-6 py-10">
      <Card className="relative w-full max-w-[448px] items-center gap-6 px-6 py-10">
        <IconButton
          aria-label="Back to login"
          className="absolute left-4 top-4"
        >
          <ArrowBackIcon className="size-6" />
        </IconButton>

        <BrandLogo size="lg" />

        <h1 className="text-h1 text-foreground text-center">Reset password</h1>
        <p className="text-body-md text-muted-foreground text-center">
          Enter your email and we&apos;ll send you a reset link
        </p>

        <ForgotPasswordForm className="w-full" />

        <AuthFooter
          question="Remember your password?"
          linkLabel="Sign up"
          linkHref="/signup"
        />
      </Card>
    </main>
  )
}
