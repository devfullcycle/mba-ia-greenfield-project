import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { server } from "@/mocks/server";
import { http, HttpResponse } from "msw";
import { env } from "@/lib/env";

const cookieMap = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) =>
      cookieMap.has(name) ? { name, value: cookieMap.get(name)! } : undefined,
    set: (name: string, value: string) => { cookieMap.set(name, value); },
    delete: (name: string) => { cookieMap.delete(name); },
  }),
}));

let POST: () => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import("@/app/api/auth/logout/route"));
});

const { setSession, getSession } = await import("@/lib/auth/session");

beforeEach(async () => {
  cookieMap.clear();
  await setSession({
    accessToken: "active-at",
    refreshToken: "active-rt",
    userId: "u1",
    email: "alice@example.com",
    channelSlug: "alice",
  });
});

describe("POST /api/auth/logout", () => {
  it("returns 204 and destroys the session on success", async () => {
    const res = await POST();
    expect(res.status).toBe(204);

    const session = await getSession();
    expect(session.isLoggedIn).toBeFalsy();
  });

  it("returns 204 and still destroys session even when upstream returns 401", async () => {
    server.use(
      http.post(`${env.API_URL}/auth/logout`, () =>
        new HttpResponse(null, { status: 401 })
      )
    );
    const res = await POST();
    expect(res.status).toBe(204);

    const session = await getSession();
    expect(session.isLoggedIn).toBeFalsy();
  });
});
