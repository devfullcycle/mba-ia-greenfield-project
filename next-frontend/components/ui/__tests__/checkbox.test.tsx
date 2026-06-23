// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect } from "vitest";

import { Checkbox } from "../checkbox";

describe("Checkbox", () => {
  it("renders with role=checkbox and data-slot=checkbox", () => {
    render(<Checkbox />);
    const el = screen.getByRole("checkbox");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("data-slot", "checkbox");
  });

  it("is unchecked by default (aria-checked=false)", () => {
    render(<Checkbox />);
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
  });

  it("reflects checked state (aria-checked=true)", () => {
    render(<Checkbox checked />);
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  });

  it("reflects indeterminate state (aria-checked=mixed)", () => {
    render(<Checkbox checked="indeterminate" />);
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "mixed");
  });

  it("calls onCheckedChange with true when clicked while unchecked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox onCheckedChange={onChange} />);
    await user.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("calls onCheckedChange with false when clicked while checked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox checked onChange={() => {}} onCheckedChange={onChange} />);
    await user.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
