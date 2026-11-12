import { readFile } from "node:fs/promises";

import { getSamplePath } from "@/lib/qa/phase-03/sample";
import { isQaEnabled, notFound } from "@/lib/qa/phase-03/server";

export async function GET(): Promise<Response> {
  if (!isQaEnabled()) return notFound();
  try {
    const file = await readFile(getSamplePath());
    return new Response(new Uint8Array(file), {
      headers: { "content-type": "video/mp4", "content-length": String(file.length) },
    });
  } catch {
    return notFound();
  }
}
