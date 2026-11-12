import { describe, expect, it, vi } from "vitest";

import {
  applyPatch,
  buildReport,
  evaluateChecks,
  executeStep,
  missingNeeds,
  shouldStop,
  summarize,
  type RunnerDeps,
} from "../runner";
import { STEPS } from "../steps";
import type { StepResponse, StepResult } from "../types";

const step = (id: string) => STEPS.find((s) => s.id === id)!;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function deps(fetchImpl: RunnerDeps["fetchImpl"], extra: Partial<RunnerDeps> = {}): RunnerDeps {
  return { fetchImpl, getFile: () => undefined, ...extra };
}

describe("evaluateChecks", () => {
  const res: StepResponse = {
    status: 206,
    headers: { "content-range": "bytes 0-1023/905702", "content-type": "image/jpeg" },
    json: { status: "READY", error: { code: "X" }, parts: [1] },
  };

  it("passes matching status, header, json and error code", () => {
    const out = evaluateChecks(
      [
        { type: "status", expected: 206 },
        { type: "header", name: "Content-Range", equals: "bytes 0-1023/905702" },
        { type: "header", name: "content-type", matches: /image\/jpeg/ },
        { type: "json", path: "status", equals: "READY" },
        { type: "json", path: "parts.length", equals: 1 },
        { type: "jsonPresent", path: "status" },
        { type: "errorCode", code: "X" },
      ],
      res,
    );
    expect(out.every((c) => c.ok)).toBe(true);
  });

  it("reads the error code from the flat NestJS shape too", () => {
    const [c] = evaluateChecks([{ type: "errorCode", code: "VIDEO_NOT_FOUND" }], { status: 404, headers: {}, json: { statusCode: 404, error: "VIDEO_NOT_FOUND" } });
    expect(c.ok).toBe(true);
  });

  it("reports expected vs received on divergence", () => {
    const [status, header, field, code] = evaluateChecks(
      [
        { type: "status", expected: 200 },
        { type: "header", name: "accept-ranges", equals: "bytes" },
        { type: "json", path: "status", equals: "PROCESSING" },
        { type: "errorCode", code: "Y" },
      ],
      res,
    );
    expect(status).toMatchObject({ ok: false, expected: "200", received: "206" });
    expect(header).toMatchObject({ ok: false, received: "(ausente)" });
    expect(field).toMatchObject({ ok: false, expected: "PROCESSING", received: "READY" });
    expect(code).toMatchObject({ ok: false, expected: "Y", received: "X" });
  });
});

describe("executeStep", () => {
  it("passes L1 against a conforming response and sends the profile + upstream path", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        status: "READY", duration_seconds: 6, width: 640, height: 360, codec: "h264",
        stream_url: "/s", download_url: "/d", thumbnail_url: "/t",
      }),
    );
    const { result } = await executeStep(step("L1"), {}, deps(fetchImpl as unknown as typeof fetch));
    expect(result.status).toBe("pass");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/qa/phase-03/api/videos/ThlVOZkDUF");
    expect((init.headers as Record<string, string>)["x-qa-profile"]).toBe("anonymous");
  });

  it("fails with the divergent field when the API answers differently", async () => {
    const fetchImpl = async () => json({ status: "PROCESSING" });
    const { result } = await executeStep(step("L4"), {}, deps(fetchImpl as unknown as typeof fetch));
    expect(result.status).toBe("pass");
    const bad = await executeStep(step("L5"), {}, deps((async () => json({ status: "READY" })) as unknown as typeof fetch));
    expect(bad.result.status).toBe("fail");
    expect(bad.result.checks.filter((c) => !c.ok).map((c) => c.label)).toContain("status = ERROR");
  });

  it("sends Range for media steps and does not need a body", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 206, headers: { "content-range": "bytes 0-1023/905702" } }));
    const { result } = await executeStep(step("M2"), {}, deps(fetchImpl as unknown as typeof fetch));
    expect(result.status).toBe("pass");
    expect(((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>).Range).toBe("bytes=0-1023");
  });

  it("blocks steps whose prerequisite state is missing, without calling the API", async () => {
    const fetchImpl = vi.fn();
    const { result } = await executeStep(step("U4"), {}, deps(fetchImpl as unknown as typeof fetch));
    expect(result.status).toBe("blocked");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(missingNeeds(step("U4"), { videoId: "v", etag: "e" })).toBeUndefined();
  });

  it("U1 shares videoId through the context patch", async () => {
    const fetchImpl = async () => json({ id: "v9", status: "DRAFT", part_size: 100, parts: [{ part_number: 1, url: "http://localhost:9000/p" }] }, 201);
    const { result, ctxPatch } = await executeStep(step("U1"), {}, deps(fetchImpl as unknown as typeof fetch));
    expect(result.status).toBe("pass");
    expect(applyPatch({}, ctxPatch, "U1")).toMatchObject({ videoId: "v9", sessionVideoIds: ["v9"] });
  });

  it("U2 blocks without a file and uploads through the BFF with it", async () => {
    const ctx = { videoId: "v", partUrl: "http://localhost:9000/p", partSize: 10 };
    const none = await executeStep(step("U2"), ctx, deps(vi.fn() as unknown as typeof fetch));
    expect(none.result.status).toBe("blocked");

    const tooBig = await executeStep(step("U2"), ctx, deps(vi.fn() as unknown as typeof fetch, { getFile: () => new Blob(["x".repeat(11)]) }));
    expect(tooBig.result.message).toMatch(/uma parte/);

    const fetchImpl = vi.fn(async () => json({ status: 200, etag: "abc" }));
    const ok = await executeStep(step("U2"), ctx, deps(fetchImpl as unknown as typeof fetch, { getFile: () => new Blob(["x"]) }));
    expect(ok.result.status).toBe("pass");
    expect(ok.ctxPatch).toEqual({ etag: "abc" });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("/api/qa/phase-03/upload-part");
  });

  it("U5 polls until READY and records the status trail", async () => {
    const seq = ["PROCESSING", "PROCESSING", "READY"];
    const fetchImpl = async () =>
      json({ status: seq.shift(), duration_seconds: 6, width: 640, height: 360, codec: "h264" });
    const seen: string[] = [];
    const { result } = await executeStep(
      step("U5"),
      { videoId: "v" },
      deps(fetchImpl as unknown as typeof fetch, { sleep: async () => undefined, onPoll: (s) => seen.push(s) }),
    );
    expect(result.status).toBe("pass");
    expect(result.videoStatusTrail).toEqual(["PROCESSING", "READY"]);
    expect(seen).toEqual(["PROCESSING", "PROCESSING", "READY"]);
  });

  it("U5 times out with a helpful message while still PROCESSING", async () => {
    let t = 0;
    const { result } = await executeStep(
      step("U5"),
      { videoId: "v" },
      deps((async () => json({ status: "PROCESSING" })) as unknown as typeof fetch, {
        sleep: async () => undefined,
        now: () => (t += 20_000),
      }),
    );
    expect(result.status).toBe("fail");
    expect(result.message).toMatch(/worker/);
  });

  it("reports a network error without throwing", async () => {
    const { result } = await executeStep(step("L2"), {}, deps((async () => { throw new Error("offline"); }) as unknown as typeof fetch));
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/offline/);
  });
});

describe("run control and report", () => {
  const r = (status: StepResult["status"]): StepResult => ({ stepId: "x", status, checks: [], durationMs: 1, at: "" });

  it("stops on blocked/error, and on failed critical steps only", () => {
    expect(shouldStop(step("L1"), r("blocked"))).toBe(true);
    expect(shouldStop(step("L1"), r("error"))).toBe(true);
    expect(shouldStop(step("L1"), r("fail"))).toBe(false);
    expect(shouldStop(step("U1"), r("fail"))).toBe(true);
    expect(shouldStop(step("U1"), r("pass"))).toBe(false);
  });

  it("summarizes and renders a markdown report with failures", () => {
    const results = {
      L1: { ...r("pass"), stepId: "L1", httpStatus: 200 },
      L2: { ...r("fail"), stepId: "L2", httpStatus: 401, checks: [{ label: "HTTP 200", expected: "200", received: "401", ok: false }] },
    };
    const s = summarize(results);
    expect(s.passed).toBe(1);
    expect(s.failed.map((x) => x.id)).toEqual(["L2"]);
    const md = buildReport(results, { videoId: "abc" }, new Date("2026-01-01T00:00:00Z"));
    expect(md).toContain(`1 de ${STEPS.length} passos passaram`);
    expect(md).toContain("videoId do upload: abc");
    expect(md).toContain("esperado 200, recebido 401");
    expect(md).toContain("- L2 —");
  });
});
