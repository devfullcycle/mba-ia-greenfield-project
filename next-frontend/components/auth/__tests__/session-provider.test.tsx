// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { useContext } from "react";
import { describe, it, expect } from "vitest";

import { SessionContext, SessionProvider } from "../session-provider";
import type { SessionState } from "../session-provider";

function SessionDisplay() {
  const s = useContext(SessionContext);
  return (
    <div>
      <span data-testid="logged-in">{String(s.isLoggedIn)}</span>
      <span data-testid="email">{s.email}</span>
      <span data-testid="user-id">{s.userId}</span>
    </div>
  );
}

const authedSession: SessionState = {
  userId: "user-1",
  email: "alice@example.com",
  channelSlug: "alice",
  isLoggedIn: true,
};

describe("SessionProvider", () => {
  it("exposes the initial authenticated session via context", () => {
    render(
      <SessionProvider initialSession={authedSession}>
        <SessionDisplay />
      </SessionProvider>
    );
    expect(screen.getByTestId("logged-in").textContent).toBe("true");
    expect(screen.getByTestId("email").textContent).toBe("alice@example.com");
    expect(screen.getByTestId("user-id").textContent).toBe("user-1");
  });

  it("exposes an unauthenticated state when isLoggedIn=false", () => {
    render(
      <SessionProvider
        initialSession={{ userId: "", email: "", channelSlug: "", isLoggedIn: false }}
      >
        <SessionDisplay />
      </SessionProvider>
    );
    expect(screen.getByTestId("logged-in").textContent).toBe("false");
    expect(screen.getByTestId("email").textContent).toBe("");
  });
});
