// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect } from "vitest";

import { TermsCheckbox } from "../terms-checkbox";

describe("TermsCheckbox", () => {
  it("renders checkbox and terms label with links", () => {
    render(<TermsCheckbox />);
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /terms of service/i })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: /privacy policy/i })).toHaveAttribute("href", "/privacy");
  });

  it("is unchecked by default (uncontrolled)", () => {
    render(<TermsCheckbox />);
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
  });

  it("toggles local state when clicked (uncontrolled)", async () => {
    const user = userEvent.setup();
    render(<TermsCheckbox />);
    const checkbox = screen.getByRole("checkbox");

    await user.click(checkbox);
    expect(checkbox).toHaveAttribute("aria-checked", "true");

    await user.click(checkbox);
    expect(checkbox).toHaveAttribute("aria-checked", "false");
  });

  it("calls onCheckedChange with true then false across clicks", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<TermsCheckbox onCheckedChange={onCheckedChange} />);

    await user.click(screen.getByRole("checkbox"));
    expect(onCheckedChange).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole("checkbox"));
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it("reflects controlled checked prop", () => {
    render(<TermsCheckbox checked={true} onCheckedChange={() => {}} />);
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  });

  it("sets data-slot=terms-checkbox on the container", () => {
    const { container } = render(<TermsCheckbox />);
    expect(container.querySelector("[data-slot='terms-checkbox']")).toBeInTheDocument();
  });
});
