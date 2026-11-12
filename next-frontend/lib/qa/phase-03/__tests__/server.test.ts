import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { isAllowedRoute, isAllowedStorageUrl, parseProfile, putToPresignedUrl } from "../server";

describe("isAllowedRoute", () => {
  it.each([
    ["GET", "/"],
    ["POST", "/videos/uploads"],
    ["GET", "/videos/ThlVOZkDUF"],
    ["GET", "/videos/ThlVOZkDUF/stream"],
    ["GET", "/videos/ThlVOZkDUF/download"],
    ["GET", "/videos/ThlVOZkDUF/thumbnail"],
    ["POST", "/videos/abc/uploads/parts"],
    ["POST", "/videos/abc/uploads/complete"],
    ["DELETE", "/videos/abc/uploads"],
  ])("allows %s %s", (m, p) => expect(isAllowedRoute(m, p)).toBe(true));

  it.each([
    ["GET", "/auth/me"],
    ["DELETE", "/videos/abc"],
    ["POST", "/videos/abc/stream"],
    ["GET", "/videos/../auth/login"],
    ["GET", "/videos/a/b/stream"],
    ["PUT", "/videos/abc"],
    ["GET", "/videos/uploads/x/y"],
  ])("rejects %s %s", (m, p) => expect(isAllowedRoute(m, p)).toBe(false));
});

describe("isAllowedStorageUrl", () => {
  it("accepts the local MinIO hosts only", () => {
    expect(isAllowedStorageUrl("http://localhost:9000/b/k?X=1")).toBeDefined();
    expect(isAllowedStorageUrl("http://evil.example:9000/b")).toBeUndefined();
    expect(isAllowedStorageUrl("http://localhost:1234/b")).toBeUndefined();
    expect(isAllowedStorageUrl("file:///etc/passwd")).toBeUndefined();
    expect(isAllowedStorageUrl("not a url")).toBeUndefined();
  });
});

describe("parseProfile", () => {
  it("accepts known profiles only", () => {
    expect(parseProfile("owner")).toBe("owner");
    expect(parseProfile("admin")).toBeUndefined();
    expect(parseProfile(null)).toBeUndefined();
  });
});

describe("putToPresignedUrl", () => {
  it("dials the connect target but keeps the signed Host header, and returns the unquoted ETag", async () => {
    let seen: { host?: string; method?: string; url?: string; body: string } = { body: "" };
    const server = createServer((req, res) => {
      req.on("data", (c) => (seen.body += c));
      req.on("end", () => {
        seen = { ...seen, host: req.headers.host, method: req.method, url: req.url };
        res.setHeader("ETag", '"abc123"');
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const out = await putToPresignedUrl(new URL("http://localhost:9000/bucket/key?X-Amz-Signature=s"), Buffer.from("hello"), "video/mp4", `127.0.0.1:${port}`);
      expect(out).toEqual({ status: 200, etag: "abc123" });
      expect(seen).toMatchObject({ host: "localhost:9000", method: "PUT", url: "/bucket/key?X-Amz-Signature=s", body: "hello" });
    } finally {
      server.close();
    }
  });
});
