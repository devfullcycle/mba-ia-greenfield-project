import { http, HttpResponse } from "msw";
import { vi, describe, it, expect, beforeEach } from "vitest";

import { server } from "@/mocks/server";

// Shared cookie store for the session mock — same pattern as session.test.ts.
const cookieMap = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) =>
      cookieMap.has(name) ? { name, value: cookieMap.get(name)! } : undefined,
    set: (name: string, value: string) => { cookieMap.set(name, value); },
    delete: (name: string) => { cookieMap.delete(name); },
  }),
}));

const { withRefresh } = await import("@/lib/auth/refresh");
const { setSession, getSession } = await import("@/lib/auth/session");
const { env } = await import("@/lib/env");

const UPSTREAM_URL = `${env.API_URL}/protected-resource`;

const SEED_SESSION = {
  accessToken: "old-access-token",
  refreshToken: "old-refresh-token",
  userId: "user-1",
  email: "alice@example.com",
  channelSlug: "alice",
};

beforeEach(async () => {
  cookieMap.clear();
  await setSession(SEED_SESSION);
});

describe("withRefresh", () => {
  it("passes through a non-401 response without refreshing", async () => {
    let refreshCalls = 0;
    server.use(
      http.get(UPSTREAM_URL, () => HttpResponse.json({ ok: true })),
      http.post(`${env.API_URL}/auth/refresh`, () => {
        refreshCalls++;
        return HttpResponse.json({ access_token: "new-at", refresh_token: "new-rt" });
      })
    );

    const res = await withRefresh(() => fetch(UPSTREAM_URL));
    expect(res.status).toBe(200);
    expect(refreshCalls).toBe(0);
  });

  it("refreshes and retries on 401 — updates the session with new tokens", async () => {
    let callCount = 0;
    server.use(
      http.get(UPSTREAM_URL, () => {
        callCount++;
        // First call → 401; subsequent → 200 (simulating successful retry after refresh)
        return callCount === 1
          ? new HttpResponse(null, { status: 401 })
          : HttpResponse.json({ data: "protected" });
      }),
      http.post(`${env.API_URL}/auth/refresh`, () =>
        HttpResponse.json({ access_token: "refreshed-at", refresh_token: "refreshed-rt" })
      )
    );

    const res = await withRefresh(() => fetch(UPSTREAM_URL));
    expect(res.status).toBe(200);

    const session = await getSession();
    expect(session.accessToken).toBe("refreshed-at");
    expect(session.refreshToken).toBe("refreshed-rt");
  });

  it("single-flight: two concurrent 401s trigger exactly one refresh", async () => {
    let refreshCalls = 0;
    server.use(
      http.get(UPSTREAM_URL, () => new HttpResponse(null, { status: 401 })),
      http.post(`${env.API_URL}/auth/refresh`, () => {
        refreshCalls++;
        return HttpResponse.json({ access_token: "new-at", refresh_token: "new-rt" });
      })
    );

    await Promise.all([
      withRefresh(() => fetch(UPSTREAM_URL)),
      withRefresh(() => fetch(UPSTREAM_URL)),
    ]);

    expect(refreshCalls).toBe(1);
  });

  it("destroys the session and returns 401 when refresh itself fails", async () => {
    server.use(
      http.get(UPSTREAM_URL, () => new HttpResponse(null, { status: 401 })),
      http.post(`${env.API_URL}/auth/refresh`, () =>
        new HttpResponse(null, { status: 401 })
      )
    );

    const res = await withRefresh(() => fetch(UPSTREAM_URL));
    expect(res.status).toBe(401);

    const session = await getSession();
    expect(session.isLoggedIn).toBeFalsy();
  });
});
