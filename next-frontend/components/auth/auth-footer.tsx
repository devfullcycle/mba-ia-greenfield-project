import * as React from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"

type AuthFooterProps = React.ComponentProps<"div"> & {
  question: string
  linkLabel: string
  linkHref: string
}

function AuthFooter({
  className,
  question,
  linkLabel,
  linkHref,
  ...props
}: AuthFooterProps) {
  return (
    <div
      data-slot="auth-footer"
      className={cn(
        "flex w-full flex-col items-center gap-2 text-body-md",
        className
      )}
      {...props}
    >
      <p className="text-muted-foreground">{question}</p>
      <Link
        href={linkHref}
        className="text-link hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-[var(--radius-0-5)]"
      >
        {linkLabel}
      </Link>
    </div>
  )
}

export { AuthFooter }
