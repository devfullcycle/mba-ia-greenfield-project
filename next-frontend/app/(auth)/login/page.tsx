import { AuthFooter } from "@/components/auth/auth-footer"
import { BrandLogo } from "@/components/auth/brand-logo"
import { LoginForm } from "@/components/auth/login-form"
import { Card } from "@/components/ui/card"

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-background px-6 py-10">
      <Card className="w-full max-w-[448px] items-center gap-6 px-6 py-10">
        <BrandLogo size="lg" />

        <h1 className="text-h1 text-foreground text-center">Sign in</h1>

        <LoginForm className="w-full" />

        <AuthFooter
          question="Don't have an account?"
          linkLabel="Sign up"
          linkHref="/signup"
        />
      </Card>
    </main>
  )
}
