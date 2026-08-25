"use client"

import * as React from "react"

import { EyeIcon } from "@/components/icons/eye-icon"
import { EyeOffIcon } from "@/components/icons/eye-off-icon"
import { cn } from "@/lib/utils"

type PasswordVisibilityToggleProps = {
  onTypeChange?: (type: "password" | "text") => void
  className?: string
}

function PasswordVisibilityToggle({
  onTypeChange,
  className,
}: PasswordVisibilityToggleProps) {
  const [visible, setVisible] = React.useState(false)

  function handleToggle() {
    const next = !visible
    setVisible(next)
    onTypeChange?.(next ? "text" : "password")
  }

  return (
    <button
      type="button"
      data-slot="password-visibility-toggle"
      aria-pressed={visible}
      aria-label={visible ? "Hide password" : "Show password"}
      onClick={handleToggle}
      className={cn(
        "inline-flex items-center justify-center text-muted-foreground",
        "hover:text-foreground transition-colors outline-none",
        "focus-visible:ring-3 focus-visible:ring-ring/50 rounded-[var(--radius-full)]",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:size-6 [&_svg]:pointer-events-none",
        className
      )}
    >
      {visible ? <EyeOffIcon /> : <EyeIcon />}
    </button>
  )
}

export { PasswordVisibilityToggle }
