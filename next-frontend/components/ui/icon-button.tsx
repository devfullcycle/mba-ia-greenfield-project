import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const iconButtonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center",
    "border border-transparent bg-clip-padding",
    "transition-all outline-none",
    "hover:opacity-90 active:opacity-80",
    "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        outline: "border-foreground bg-transparent text-foreground hover:bg-muted/40",
        ghost: "bg-transparent text-foreground hover:bg-muted",
      },
      size: {
        sm: "size-8 rounded-[var(--radius-2)] [&_svg:not([class*='size-'])]:size-4",
        md: "size-9 rounded-[var(--radius-3)] [&_svg:not([class*='size-'])]:size-5",
        lg: "size-10 rounded-[var(--radius-3)] [&_svg:not([class*='size-'])]:size-6",
      },
    },
    defaultVariants: {
      variant: "ghost",
      size: "md",
    },
  }
)

// aria-label is required for icon-only buttons — no visible text to describe the action.
type IconButtonProps = Omit<React.ComponentProps<"button">, "aria-label"> &
  VariantProps<typeof iconButtonVariants> & {
    "aria-label": string
  }

function IconButton({
  className,
  variant,
  size,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      data-slot="icon-button"
      data-variant={variant ?? "ghost"}
      data-size={size ?? "md"}
      className={cn(iconButtonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { IconButton, iconButtonVariants }
