"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type StrengthLevel = "empty" | "weak" | "fair" | "strong" | "very-strong"

function getStrengthLevel(password: string): StrengthLevel {
  if (!password) return "empty"
  if (password.length < 8) return "weak"
  const checks = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/]
  const passed = checks.filter((re) => re.test(password)).length
  if (passed <= 1) return "weak"
  if (passed === 2) return "fair"
  if (passed === 3) return "strong"
  return "very-strong"
}

const SEGMENTS: Record<StrengthLevel, { filled: number; label: string }> = {
  empty:       { filled: 0, label: "" },
  weak:        { filled: 1, label: "Weak" },
  fair:        { filled: 2, label: "Fair" },
  strong:      { filled: 3, label: "Strong" },
  "very-strong": { filled: 4, label: "Very strong" },
}

const FILL_COLOR: Record<StrengthLevel, string> = {
  empty:        "bg-muted",
  weak:         "bg-destructive",
  fair:         "bg-warning",
  strong:       "bg-success",
  "very-strong": "bg-success",
}

type PasswordStrengthMeterProps = {
  value: string
  className?: string
}

function PasswordStrengthMeter({ value, className }: PasswordStrengthMeterProps) {
  const level = getStrengthLevel(value)
  const { filled, label } = SEGMENTS[level]
  const fillColor = FILL_COLOR[level]

  return (
    <div
      data-slot="password-strength-meter"
      data-strength={level}
      className={cn("flex flex-col gap-1", className)}
    >
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-[var(--radius-0-5)] transition-colors",
              i < filled ? fillColor : "bg-muted"
            )}
          />
        ))}
      </div>
      {label && (
        <span className="text-caption text-muted-foreground" aria-live="polite">
          {label}
        </span>
      )}
    </div>
  )
}

export { PasswordStrengthMeter }
