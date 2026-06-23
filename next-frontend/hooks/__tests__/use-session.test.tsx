// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import * as React from "react";
import { describe, it, expect } from "vitest";

import { SessionProvider } from "@/components/auth/session-provider";
import type { SessionState } from "@/components/auth/session-provider";
import { useSession } from "../use-session";

function makeWrapper(session: SessionState) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <SessionProvider initialSession={session}>{children}</SessionProvider>;
  };
}


describe("useSession", () => {
  it("returns the authenticated session when provider has isLoggedIn=true", () => {
    const session: SessionState = {
      userId: "user-1",
      email: "alice@example.com",
      channelSlug: "alice",
      isLoggedIn: true,
    };
    const { result } = renderHook(() => useSession(), { wrapper: makeWrapper(session) });
    expect(result.current.isLoggedIn).toBe(true);
    expect(result.current.userId).toBe("user-1");
    expect(result.current.email).toBe("alice@example.com");
    expect(result.current.channelSlug).toBe("alice");
  });

  it("returns unauthenticated state when provider has isLoggedIn=false", () => {
    const session: SessionState = {
      userId: "",
      email: "",
      channelSlug: "",
      isLoggedIn: false,
    };
    const { result } = renderHook(() => useSession(), { wrapper: makeWrapper(session) });
    expect(result.current.isLoggedIn).toBe(false);
    expect(result.current.userId).toBe("");
  });
});
