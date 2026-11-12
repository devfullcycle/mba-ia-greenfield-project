import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";

import { env } from "@/lib/env";
import { server } from "@/mocks/server";

const OWNER = "owner-secret-token-xyz";
const OTHER = "other-secret-token-abc";

type Handler = (req: Request, ctx: { params: Promise<{ path?: string[] }> }) => Promise<Response>;
let GET: Handler;
let POST: Handler;
let DELETE: Handler;

async function load() {
  vi.resetModules();
  ({ GET, POST, DELETE } = (await import("../route")) as unknown as Record<"GET" | "POST" | "DELETE", Handler>);
}

beforeAll(async () => {
  vi.stubEnv("QA_OWNER_TOKEN", OWNER);
  vi.stubEnv("QA_OTHER_TOKEN", OTHER);
  await load();
});

afterEach(() => vi.unstubAllEnvs());

const call = (h: Handler, method: string, path: string, init: RequestInit = {}) =>
  h(new Request(`http://localhost/api/qa/phase-03/api${path}`, { method, ...init }), {
    params: Promise.resolve({ path: path.split("/").filter(Boolean) }),
  });

describe("/api/qa/phase-03/api (QA proxy)", () => {
  it("attaches the owner token server-side and never leaks it in the response", async () => {
    let auth: string | null = null;
    server.use(
      http.get(`${env.API_URL}/videos/abc`, ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json({ id: "abc", status: "READY" });
      }),
    );
    const res = await call(GET, "GET", "/videos/abc", { headers: { "x-qa-profile": "owner" } });
    expect(auth).toBe(`Bearer ${OWNER}`);
    expect(res.status).toBe(200);
    const dump = JSON.stringify([await res.text(), [...res.headers.entries()]]);
    expect(dump).not.toContain(OWNER);
    expect(dump).not.toContain(OTHER);
  });

  it("selects the token by profile and sends none for anonymous", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${env.API_URL}/videos/abc`, ({ request }) => {
        seen.push(request.headers.get("authorization"));
        return HttpResponse.json({});
      }),
    );
    await call(GET, "GET", "/videos/abc", { headers: { "x-qa-profile": "other" } });
    await call(GET, "GET", "/videos/abc", { headers: { "x-qa-profile": "anonymous" } });
    await call(GET, "GET", "/videos/abc");
    await call(GET, "GET", "/videos/abc", { headers: { "x-qa-profile": "invalid" } });
    expect(seen).toEqual([`Bearer ${OTHER}`, null, null, "Bearer token-invalido"]);
  });

  it("accepts the profile via query string (for <video>/<img>) and forwards Range and media headers", async () => {
    let range: string | null = null;
    server.use(
      http.get(`${env.API_URL}/videos/abc/stream`, ({ request }) => {
        range = request.headers.get("range");
        return new HttpResponse("x".repeat(1024), {
          status: 206,
          headers: {
            "content-type": "video/mp4",
            "content-range": "bytes 0-1023/905702",
            "accept-ranges": "bytes",
            "content-length": "1024",
            "set-cookie": "sid=1",
            "x-internal": "nope",
          },
        });
      }),
    );
    const res = await call(GET, "GET", "/videos/abc/stream", {
      headers: { range: "bytes=0-1023", "x-qa-profile": "owner" },
    });
    expect(range).toBe("bytes=0-1023");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-1023/905702");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-internal")).toBeNull();
    expect((await res.arrayBuffer()).byteLength).toBe(1024);

    let viaQuery: string | null = null;
    server.use(
      http.get(`${env.API_URL}/videos/abc/thumbnail`, ({ request }) => {
        viaQuery = request.headers.get("authorization");
        return new HttpResponse("img", { headers: { "content-type": "image/jpeg" } });
      }),
    );
    const q = await GET(new Request("http://localhost/api/qa/phase-03/api/videos/abc/thumbnail?profile=owner"), {
      params: Promise.resolve({ path: ["videos", "abc", "thumbnail"] }),
    });
    expect(q.status).toBe(200);
    expect(viaQuery).toBe(`Bearer ${OWNER}`);
  });

  it("relays upstream errors (416 envelope) and 204 without body", async () => {
    server.use(
      http.get(`${env.API_URL}/videos/abc/stream`, () =>
        HttpResponse.json({ error: { code: "RANGE_NOT_SATISFIABLE" } }, { status: 416, headers: { "content-range": "bytes */905702" } }),
      ),
      http.delete(`${env.API_URL}/videos/abc/uploads`, () => new HttpResponse(null, { status: 204 })),
    );
    const r416 = await call(GET, "GET", "/videos/abc/stream");
    expect(r416.status).toBe(416);
    expect(r416.headers.get("content-range")).toBe("bytes */905702");
    expect((await r416.json()).error.code).toBe("RANGE_NOT_SATISFIABLE");
    const r204 = await call(DELETE, "DELETE", "/videos/abc/uploads", { headers: { "x-qa-profile": "owner" } });
    expect(r204.status).toBe(204);
  });

  it("serves the API root (health check) when no path segment is given", async () => {
    server.use(http.get(`${env.API_URL}/`, () => HttpResponse.text("ok")));
    const res = await GET(new Request("http://localhost/api/qa/phase-03/api"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
  });

  it("forwards JSON bodies of POST routes", async () => {
    let body: unknown;
    server.use(
      http.post(`${env.API_URL}/videos/uploads`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "n1", status: "DRAFT" }, { status: 201 });
      }),
    );
    const res = await call(POST, "POST", "/videos/uploads", {
      headers: { "x-qa-profile": "owner", "content-type": "application/json" },
      body: JSON.stringify({ original_filename: "a.mp4" }),
    });
    expect(res.status).toBe(201);
    expect(body).toEqual({ original_filename: "a.mp4" });
  });

  it("rejects routes outside the whitelist without calling the upstream (not an open proxy)", async () => {
    // No MSW handler registered: an upstream call would fail the test (onUnhandledRequest: error).
    const res = await call(GET, "GET", "/auth/me", { headers: { "x-qa-profile": "owner" } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("QA_ROUTE_NOT_ALLOWED");
    expect((await call(DELETE, "DELETE", "/videos/abc")).status).toBe(404);
  });

  it("answers 503 when the profile token is not configured", async () => {
    vi.stubEnv("QA_OWNER_TOKEN", "");
    await load();
    const res = await call(GET, "GET", "/videos/abc", { headers: { "x-qa-profile": "owner" } });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("QA_TOKEN_MISSING");
  });

  it("answers 404 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await load();
    const res = await call(GET, "GET", "/videos/abc");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });
});
