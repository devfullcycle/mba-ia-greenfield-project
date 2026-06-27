// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect } from "vitest";

import { IconButton } from "../icon-button";

describe("IconButton", () => {
  it("renders with role=button, data-slot, and required aria-label", () => {
    render(<IconButton aria-label="Go back">←</IconButton>);
    const btn = screen.getByRole("button", { name: "Go back" });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("data-slot", "icon-button");
  });

  it("defaults to ghost variant and md size", () => {
    render(<IconButton aria-label="Close">×</IconButton>);
    const btn = screen.getByRole("button", { name: "Close" });
    expect(btn).toHaveAttribute("data-variant", "ghost");
    expect(btn).toHaveAttribute("data-size", "md");
  });

  it("reflects explicit variant and size via data attributes", () => {
    render(
      <IconButton aria-label="Submit" variant="default" size="lg">
        →
      </IconButton>
    );
    const btn = screen.getByRole("button", { name: "Submit" });
    expect(btn).toHaveAttribute("data-variant", "default");
    expect(btn).toHaveAttribute("data-size", "lg");
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <IconButton aria-label="Delete" onClick={onClick}>
        🗑
      </IconButton>
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is not clickable when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <IconButton aria-label="Save" disabled onClick={onClick}>
        💾
      </IconButton>
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
