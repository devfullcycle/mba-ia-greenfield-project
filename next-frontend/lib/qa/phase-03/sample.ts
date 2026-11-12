import "server-only";
import { stat } from "node:fs/promises";

import { env } from "@/lib/env";

export function getSamplePath(): string {
  return env.QA_SAMPLE_PATH ?? "/fixtures/sample.mp4";
}

/** Size in bytes of the sample video, or undefined when it is not available in this container. */
export async function getSampleSize(): Promise<number | undefined> {
  try {
    return (await stat(getSamplePath())).size;
  } catch {
    return undefined;
  }
}
