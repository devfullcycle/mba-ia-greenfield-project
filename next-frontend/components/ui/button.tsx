import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center min-w-20",
    "border border-transparent bg-clip-padding",
    "font-sans whitespace-nowrap select-none transition-all outline-none",
    "hover:opacity-90 active:opacity-80",
    "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring",
    "disabled:pointer-events-none disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
    "data-[loading=true]:opacity-70 data-[loading=true]:pointer-events-none",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        outline:
          "border-foreground bg-transparent text-foreground hover:bg-muted/40",
        secondary:
          "bg-secondary border-border text-secondary-foreground",
        ghost:
          "bg-transparent text-foreground hover:bg-muted",
        destructive:
          "bg-destructive text-destructive-foreground focus-visible:ring-destructive/40 focus-visible:border-destructive",
        link:
          "min-w-0 bg-transparent text-link underline-offset-4 hover:underline hover:opacity-100",
      },
      size: {
        sm: "gap-2 rounded-[var(--radius-3)] px-4 py-2 text-label-md [&_svg:not([class*='size-'])]:size-5",
        md: "gap-2 rounded-[var(--radius-4)] px-6 py-2 text-label-lg [&_svg:not([class*='size-'])]:size-6",
        lg: "gap-3 rounded-[var(--radius-full)] px-12 py-1.5 text-label-xl [&_svg:not([class*='size-'])]:size-8",
        icon: "min-w-0 size-9 rounded-[var(--radius-3)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "sm",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
