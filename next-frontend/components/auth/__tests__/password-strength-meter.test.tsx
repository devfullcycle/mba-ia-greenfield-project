// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { PasswordStrengthMeter } from "../password-strength-meter";

describe("PasswordStrengthMeter", () => {
  it("renders with data-slot and empty strength for empty value", () => {
    const { container } = render(<PasswordStrengthMeter value="" />);
    const el = container.querySelector("[data-slot='password-strength-meter']");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("data-strength", "empty");
  });

  it("reflects weak strength for short passwords", () => {
    const { container } = render(<PasswordStrengthMeter value="abc" />);
    expect(
      container.querySelector("[data-strength='weak']")
    ).toBeInTheDocument();
    expect(screen.getByText(/weak/i)).toBeInTheDocument();
  });

  it("reflects fair strength for moderately complex passwords", () => {
    // "password1" → lowercase + number = 2 checks → fair
    const { container } = render(<PasswordStrengthMeter value="password1" />);
    expect(
      container.querySelector("[data-strength='fair']")
    ).toBeInTheDocument();
    expect(screen.getByText(/fair/i)).toBeInTheDocument();
  });

  it("reflects strong or very-strong for highly complex passwords", () => {
    const { container } = render(<PasswordStrengthMeter value="P@ssw0rd!" />);
    const el = container.querySelector("[data-slot='password-strength-meter']");
    expect(["strong", "very-strong"]).toContain(
      el?.getAttribute("data-strength")
    );
  });

  it("shows no label for empty value", () => {
    render(<PasswordStrengthMeter value="" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/weak|fair|strong/i)).not.toBeInTheDocument();
  });
});
