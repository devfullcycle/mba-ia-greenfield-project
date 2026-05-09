import Image from "next/image";
import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-background px-4 py-10">
      <section className="flex w-full max-w-md flex-col items-center gap-6 rounded-2 border border-border bg-card px-6 py-10">
        <div className="flex items-center gap-2">
          <Image
            src="/brand/streamtube-logo.svg"
            alt=""
            width={40}
            height={40}
            priority
          />
          <span className="text-h1 text-foreground">StreamTube</span>
        </div>

        <h1 className="text-h1 text-foreground">Sign in</h1>

        <form className="flex w-full flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="email"
              className="text-body-md text-foreground"
            >
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="Enter your email"
              className="h-9 rounded-1 border border-border bg-input-background px-4 py-1.5 text-body-lg text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="password"
                className="text-body-md text-foreground"
              >
                Password
              </label>
              <Link
                href="/forgot-password"
                className="text-body-md text-link"
              >
                Forgot password?
              </Link>
            </div>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              className="h-9 rounded-1 border border-border bg-input-background px-4 py-1.5 text-body-lg text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <button
            type="submit"
            className="rounded-4 bg-primary px-6 py-2 text-label-lg text-primary-foreground"
          >
            Sign in
          </button>
        </form>

        <footer className="flex w-full flex-col items-center gap-2">
          <p className="text-body-md text-muted-foreground">
            Don&apos;t have an account?
          </p>
          <Link href="/signup" className="text-body-md text-link">
            Sign up
          </Link>
        </footer>
      </section>
    </main>
  );
}
