import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

type Get = () => Promise<Response>;

async function load(): Promise<Get> {
  vi.resetModules();
  return ((await import("../route")) as unknown as { GET: Get }).GET;
}

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/qa/phase-03/sample", () => {
  it("serves the sample file from QA_SAMPLE_PATH as video/mp4", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qa-sample-"));
    const file = join(dir, "sample.mp4");
    await writeFile(file, Buffer.from("fake-mp4"));
    vi.stubEnv("QA_SAMPLE_PATH", file);
    const res = await (await load())();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(await res.text()).toBe("fake-mp4");
  });

  it("answers 404 when the file does not exist in this container", async () => {
    vi.stubEnv("QA_SAMPLE_PATH", "/nope/missing.mp4");
    expect((await (await load())()).status).toBe(404);
  });

  it("answers 404 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await (await load())()).status).toBe(404);
  });
});
