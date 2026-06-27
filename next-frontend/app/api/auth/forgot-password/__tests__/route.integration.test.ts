import { describe, it, expect, beforeAll } from "vitest";
import { server } from "@/mocks/server";
import { http, HttpResponse } from "msw";
import { env } from "@/lib/env";

let POST: (req: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import("@/app/api/auth/forgot-password/route"));
});

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/auth/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/forgot-password", () => {
  it("returns 204 with no body and no cookie for a valid email", async () => {
    const res = await POST(makeRequest({ email: "alice@example.com" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("returns 204 for an unknown email (anti-enumeration — same response)", async () => {
    server.use(
      http.post(`${env.API_URL}/auth/forgot-password`, () =>
        new HttpResponse(null, { status: 204 })
      )
    );
    const res = await POST(makeRequest({ email: "unknown@example.com" }));
    expect(res.status).toBe(204);
  });

  it("returns 400 with ApiErrorEnvelope for badrequest@example.com (reserved trigger)", async () => {
    const res = await POST(makeRequest({ email: "badrequest@example.com" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ statusCode: 400, error: "VALIDATION_FAILED" });
  });
});
