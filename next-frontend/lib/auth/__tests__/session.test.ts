import { vi, describe, it, expect, beforeEach } from "vitest";

// In-memory cookie store shared across the mock and assertions.
const cookieMap = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) =>
      cookieMap.has(name) ? { name, value: cookieMap.get(name)! } : undefined,
    set: (name: string, value: string) => {
      cookieMap.set(name, value);
    },
    delete: (name: string) => {
      cookieMap.delete(name);
    },
  }),
}));

// Dynamic imports so env vars from vitest.setup.ts are applied first.
const { getSession, setSession, destroySession } = await import(
  "@/lib/auth/session"
);

const SAMPLE: Parameters<typeof setSession>[0] = {
  accessToken: "at-abc",
  refreshToken: "rt-xyz",
  userId: "user-1",
  email: "alice@example.com",
  channelSlug: "alice-channel",
};

describe("lib/auth/session", () => {
  beforeEach(() => {
    cookieMap.clear();
  });

  it("getSession without a cookie returns an empty (not-logged-in) session", async () => {
    const session = await getSession();
    expect(session.isLoggedIn).toBeFalsy();
    expect(session.userId).toBeFalsy();
  });

  it("setSession persists all fields and marks isLoggedIn=true", async () => {
    await setSession(SAMPLE);

    const session = await getSession();
    expect(session.isLoggedIn).toBe(true);
    expect(session.userId).toBe(SAMPLE.userId);
    expect(session.email).toBe(SAMPLE.email);
    expect(session.channelSlug).toBe(SAMPLE.channelSlug);
    expect(session.accessToken).toBe(SAMPLE.accessToken);
    expect(session.refreshToken).toBe(SAMPLE.refreshToken);
  });

  it("cookie value is encrypted (not readable in plain text)", async () => {
    await setSession(SAMPLE);
    const rawCookieValue = cookieMap.get("streamtube_session") ?? "";
    expect(rawCookieValue).not.toContain(SAMPLE.accessToken);
    expect(rawCookieValue).not.toContain(SAMPLE.email);
  });

  it("destroySession clears isLoggedIn and tokens", async () => {
    await setSession(SAMPLE);
    await destroySession();

    const session = await getSession();
    expect(session.isLoggedIn).toBeFalsy();
    expect(session.userId).toBeFalsy();
  });
});
