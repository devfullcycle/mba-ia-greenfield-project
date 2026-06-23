import * as React from "react"

import { cn } from "@/lib/utils"

function ArrowBackIcon({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn(className)}
      {...props}
    >
      <path
        d="M3.825 9L9.425 14.6L8 16L0 8L8 0L9.425 1.4L3.825 7H16V9H3.825Z"
        fill="currentColor"
      />
    </svg>
  )
}

export { ArrowBackIcon }
