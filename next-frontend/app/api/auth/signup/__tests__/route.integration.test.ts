import { describe, it, expect, beforeAll } from "vitest";
import { server } from "@/mocks/server";
import { http, HttpResponse } from "msw";
import { env } from "@/lib/env";

// Import the handler AFTER MSW starts listening (server.listen() runs in
// mocks/setup.ts beforeAll, which fires before test-file beforeAlls).
// Dynamic import here prevents the openapi-fetch client from capturing the
// unpatched global fetch reference (see project memory: route-handler import order).
let POST: (req: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import("@/app/api/auth/signup/route"));
});

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/signup", () => {
  it("returns 201 with {id,email} and no Set-Cookie on success", async () => {
    const res = await POST(makeRequest({ email: "alice@example.com", password: "pw" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ id: "user-fixture-id", email: "alice@example.com" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("returns 409 with ApiErrorEnvelope for conflict@example.com (reserved trigger)", async () => {
    const res = await POST(makeRequest({ email: "conflict@example.com", password: "pw" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ statusCode: 409, error: "EMAIL_ALREADY_REGISTERED" });
  });

  it("returns 400 with ApiErrorEnvelope for badrequest@example.com (reserved trigger)", async () => {
    const res = await POST(makeRequest({ email: "badrequest@example.com", password: "" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ statusCode: 400, error: "VALIDATION_FAILED" });
  });

  it("passes through any upstream error status verbatim", async () => {
    server.use(
      http.post(`${env.API_URL}/auth/register`, () =>
        HttpResponse.json({ statusCode: 422, error: "UNPROCESSABLE", message: "bad" }, { status: 422 })
      )
    );
    const res = await POST(makeRequest({ email: "x@y.z", password: "pw" }));
    expect(res.status).toBe(422);
  });
});
