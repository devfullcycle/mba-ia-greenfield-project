export const MIN_PART_SIZE_BYTES = 5 * 1024 * 1024; // S3 minimum part size
export const MAX_PART_SIZE_BYTES = 100 * 1024 * 1024;
export const MAX_PART_COUNT = 10_000; // S3 multipart limit

export interface UploadPlan {
  part_size: number;
  part_count: number;
}

/** Splits an upload into as few parts as S3 allows: >= 5 MiB each, at most 10,000 parts, capped at 100 MiB. */
export function computeUploadPlan(sizeBytes: number): UploadPlan {
  const partSize = Math.min(
    MAX_PART_SIZE_BYTES,
    Math.max(MIN_PART_SIZE_BYTES, Math.ceil(sizeBytes / MAX_PART_COUNT)),
  );
  return { part_size: partSize, part_count: Math.ceil(sizeBytes / partSize) };
}
