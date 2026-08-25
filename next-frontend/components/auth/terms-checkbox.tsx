"use client"

import * as React from "react"
import Link from "next/link"

import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

type TermsCheckboxProps = {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  className?: string
}

function TermsCheckbox({
  checked,
  onCheckedChange,
  className,
}: TermsCheckboxProps) {
  const [localChecked, setLocalChecked] = React.useState(false)
  const isControlled = checked !== undefined
  const isChecked = isControlled ? checked : localChecked

  function handleCheckedChange(value: boolean | "indeterminate") {
    const next = value === true
    if (!isControlled) setLocalChecked(next)
    onCheckedChange?.(next)
  }

  return (
    <div
      data-slot="terms-checkbox"
      className={cn("flex items-start gap-2", className)}
    >
      <Checkbox
        id="terms"
        checked={isChecked}
        onCheckedChange={handleCheckedChange}
        className="mt-0.5 shrink-0"
      />
      <label
        htmlFor="terms"
        className="text-body-md text-muted-foreground cursor-pointer select-none"
      >
        I agree to the{" "}
        <Link
          href="/terms"
          className="text-link hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-[var(--radius-0-5)]"
        >
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link
          href="/privacy"
          className="text-link hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-[var(--radius-0-5)]"
        >
          Privacy Policy
        </Link>
      </label>
    </div>
  )
}

export { TermsCheckbox }
