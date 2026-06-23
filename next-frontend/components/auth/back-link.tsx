import * as React from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"

type BackLinkProps = {
  href: string
  className?: string
  children?: React.ReactNode
}

function BackLink({ href, className, children = "Back" }: BackLinkProps) {
  return (
    <Link
      href={href}
      data-slot="back-link"
      className={cn(
        "inline-flex items-center gap-1 text-body-md text-muted-foreground",
        "hover:text-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-[var(--radius-0-5)]",
        className
      )}
    >
      {children}
    </Link>
  )
}

export { BackLink }
