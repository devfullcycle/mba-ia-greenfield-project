import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const putToPresignedUrl = vi.fn();

type Post = (req: Request) => Promise<Response>;
let POST: Post;

async function load() {
  vi.resetModules();
  vi.doMock("@/lib/qa/phase-03/server", async (orig) => ({
    ...(await orig<typeof import("@/lib/qa/phase-03/server")>()),
    putToPresignedUrl,
  }));
  ({ POST } = (await import("../route")) as unknown as { POST: Post });
}

const URL_OK = "http://localhost:9000/streamtube/videos/x/source?X-Amz-Signature=s";
const req = (headers: Record<string, string>, body: BodyInit | null = "hello") =>
  new Request("http://localhost/api/qa/phase-03/upload-part", { method: "POST", headers, body });

beforeEach(async () => {
  putToPresignedUrl.mockReset();
  vi.stubEnv("QA_OWNER_TOKEN", "t");
  vi.stubEnv("QA_STORAGE_CONNECT", "host.docker.internal:9000");
  await load();
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/qa/phase-03/upload-part", () => {
  it("PUTs the file server-side to the presigned URL via the connect target and returns the ETag", async () => {
    putToPresignedUrl.mockResolvedValue({ status: 200, etag: "abc" });
    const res = await POST(req({ "x-qa-profile": "owner", "x-qa-part-url": URL_OK, "content-type": "video/mp4" }));
    expect(await res.json()).toEqual({ status: 200, etag: "abc" });
    const [url, body, type, connect] = putToPresignedUrl.mock.calls[0];
    expect((url as URL).host).toBe("localhost:9000");
    expect(Buffer.isBuffer(body) && body.toString()).toBe("hello");
    expect(type).toBe("video/mp4");
    expect(connect).toBe("host.docker.internal:9000");
  });

  it("returns 502 when the storage does not answer 200", async () => {
    putToPresignedUrl.mockResolvedValue({ status: 403 });
    const res = await POST(req({ "x-qa-profile": "owner", "x-qa-part-url": URL_OK }));
    expect(res.status).toBe(502);
  });

  it("returns 502 with a message when the storage is unreachable", async () => {
    putToPresignedUrl.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await POST(req({ "x-qa-profile": "owner", "x-qa-part-url": URL_OK }));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("QA_STORAGE_UNREACHABLE");
  });

  it("refuses unknown storage hosts (no SSRF), anonymous profile and empty/oversized bodies", async () => {
    const bad = await POST(req({ "x-qa-profile": "owner", "x-qa-part-url": "http://169.254.169.254:9000/x" }));
    expect(bad.status).toBe(400);
    const anon = await POST(req({ "x-qa-profile": "anonymous", "x-qa-part-url": URL_OK }));
    expect(anon.status).toBe(401);
    const empty = await POST(req({ "x-qa-profile": "owner", "x-qa-part-url": URL_OK }, new Uint8Array(0)));
    expect(empty.status).toBe(400);
    const big = await POST(req({ "x-qa-profile": "owner", "x-qa-part-url": URL_OK }, new Uint8Array(5 * 1024 * 1024 + 1)));
    expect(big.status).toBe(413);
    expect(putToPresignedUrl).not.toHaveBeenCalled();
  });

  it("answers 404 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await load();
    const res = await POST(req({ "x-qa-profile": "owner", "x-qa-part-url": URL_OK }));
    expect(res.status).toBe(404);
  });
});
