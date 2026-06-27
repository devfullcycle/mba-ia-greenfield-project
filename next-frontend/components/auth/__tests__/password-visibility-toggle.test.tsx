// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect } from "vitest";

import { PasswordVisibilityToggle } from "../password-visibility-toggle";

describe("PasswordVisibilityToggle", () => {
  it("renders a button with data-slot and hidden state by default", () => {
    render(<PasswordVisibilityToggle />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("data-slot", "password-visibility-toggle");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(btn).toHaveAttribute("aria-label", "Show password");
  });

  it("toggles aria-pressed and aria-label when clicked", async () => {
    const user = userEvent.setup();
    render(<PasswordVisibilityToggle />);
    const btn = screen.getByRole("button");

    await user.click(btn);
    expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(btn).toHaveAttribute("aria-label", "Hide password");

    await user.click(btn);
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(btn).toHaveAttribute("aria-label", "Show password");
  });

  it("calls onTypeChange with 'text' on first click and 'password' on second", async () => {
    const user = userEvent.setup();
    const onTypeChange = vi.fn();
    render(<PasswordVisibilityToggle onTypeChange={onTypeChange} />);
    const btn = screen.getByRole("button");

    await user.click(btn);
    expect(onTypeChange).toHaveBeenCalledWith("text");

    await user.click(btn);
    expect(onTypeChange).toHaveBeenCalledWith("password");
    expect(onTypeChange).toHaveBeenCalledTimes(2);
  });
});
