import { AuthFooter } from "@/components/auth/auth-footer"
import { BackLink } from "@/components/auth/back-link"
import { BrandLogo } from "@/components/auth/brand-logo"
import { SignupForm } from "@/components/auth/signup-form"
import { Card } from "@/components/ui/card"
import { ArrowBackIcon } from "@/components/icons/arrow-back-icon"

export default function SignupPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-background px-6 py-10">
      <Card className="relative w-full max-w-[448px] items-center gap-6 px-6 py-10">
        <BackLink
          href="/"
          aria-label="Go back"
          className="absolute left-4 top-4 gap-0"
        >
          <ArrowBackIcon className="size-6" />
        </BackLink>

        <BrandLogo size="lg" />

        <h1 className="text-h1 text-foreground text-center">Create account</h1>
        <p className="text-body-md text-muted-foreground text-center">
          Join the community and start sharing.
        </p>

        <SignupForm />

        <AuthFooter
          question="Already have an account?"
          linkLabel="Sign in"
          linkHref="/login"
        />
      </Card>
    </main>
  )
}
