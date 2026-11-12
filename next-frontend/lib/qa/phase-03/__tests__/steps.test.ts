import { describe, expect, it } from "vitest";

import { SECTIONS, STEPS } from "../steps";

const SCRIPT_IDS = [
  "P1","P2","P3",
  "L1","L2","L3","L4","L5","L6","L7","L8",
  "M1","M2","M3","M4","M5","M6","M7","M8","M9","M10","M11",
  "U1","U1a","U1b","U2","U3","U3a","U3b","U3c","U4a","U4","U4b","U4c","U4d","U5","U6a","U6b","U6c",
  "A1","A2","A3",
  "E1","E2","E3","E4","E5",
];

describe("Phase 03 steps definition", () => {
  it("covers every step of the manual script, once each", () => {
    expect(STEPS.map((s) => s.id).sort()).toEqual([...SCRIPT_IDS].sort());
  });

  it("assigns every step to a declared section and gives it checks", () => {
    const sections = new Set(SECTIONS.map((s) => s.id));
    for (const s of STEPS) {
      expect(sections.has(s.section)).toBe(true);
      expect(s.checks.length).toBeGreaterThan(0);
    }
  });

  it("builds only whitelist-shaped upstream paths", () => {
    const ctx = { videoId: "abc123", abortVideoId: "zzz999", partUrl: "http://localhost:9000/x", etag: "e" };
    for (const s of STEPS.filter((x) => x.kind !== "upload")) {
      const spec = s.build(ctx);
      expect(spec.path).toMatch(/^\/(videos(\/[\w-]+)*)?$/);
    }
  });

  it("U1 stores videoId, part url and part size from a 201 response", () => {
    const u1 = STEPS.find((s) => s.id === "U1")!;
    const patch = u1.after!(
      { status: 201, headers: {}, json: { id: "v1", part_size: 5, parts: [{ url: "http://localhost:9000/p" }] } },
      {},
    );
    expect(patch).toMatchObject({ videoId: "v1", partUrl: "http://localhost:9000/p", partSize: 5 });
  });

  it("U1 stores nothing when the API does not answer 201", () => {
    const u1 = STEPS.find((s) => s.id === "U1")!;
    expect(u1.after!({ status: 400, headers: {}, json: {} }, {})).toEqual({});
  });
});
