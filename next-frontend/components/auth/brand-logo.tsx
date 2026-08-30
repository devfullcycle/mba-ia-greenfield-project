import * as React from "react"

import { StreamTubeIcon } from "@/components/icons/streamtube-icon"
import { cn } from "@/lib/utils"

type BrandLogoProps = React.ComponentProps<"div"> & {
  size?: "md" | "lg"
}

function BrandLogo({ className, size = "lg", ...props }: BrandLogoProps) {
  return (
    <div
      data-slot="brand-logo"
      data-size={size}
      className={cn("flex items-center gap-2", className)}
      {...props}
    >
      <StreamTubeIcon
        className={cn(
          "text-red-700",
          size === "lg" ? "size-10" : "size-8"
        )}
      />
      <span className={cn("text-foreground", size === "lg" ? "text-h1" : "text-h2")}>
        StreamTube
      </span>
    </div>
  )
}

export { BrandLogo }
