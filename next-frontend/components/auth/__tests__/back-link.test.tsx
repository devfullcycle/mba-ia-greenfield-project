// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { BackLink } from "../back-link";

describe("BackLink", () => {
  it("renders a link with the given href", () => {
    render(<BackLink href="/login" />);
    const link = screen.getByRole("link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/login");
  });

  it("renders default label 'Back'", () => {
    render(<BackLink href="/login" />);
    expect(screen.getByRole("link", { name: /back/i })).toBeInTheDocument();
  });

  it("renders custom children", () => {
    render(<BackLink href="/home">Return home</BackLink>);
    expect(screen.getByRole("link", { name: "Return home" })).toBeInTheDocument();
  });

  it("sets data-slot=back-link", () => {
    render(<BackLink href="/login" />);
    expect(screen.getByRole("link")).toHaveAttribute("data-slot", "back-link");
  });
});
