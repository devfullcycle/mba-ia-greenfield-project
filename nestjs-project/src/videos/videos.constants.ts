export const VideoStatus = {
  UPLOADING: 'uploading',
  PROCESSING: 'processing',
  READY: 'ready',
  FAILED: 'failed',
} as const;
export type VideoStatus = (typeof VideoStatus)[keyof typeof VideoStatus];

export const VideoVisibility = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
} as const;
export type VideoVisibility =
  (typeof VideoVisibility)[keyof typeof VideoVisibility];

export const MAX_VIDEO_SIZE_BYTES = 10 * 1024 * 1024 * 1024;

export const ACCEPTED_VIDEO_CONTENT_TYPES: readonly string[] = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/x-msvideo',
];

// S3 multipart limits: parts of at least 5 MiB and at most 10,000 parts.
// 100 MiB keeps a 10 GB file at ~103 parts, far from the part-count cap.
export const PART_SIZE_BYTES = 100 * 1024 * 1024;
export const MAX_UPLOAD_PARTS = 10_000;

export const PUBLIC_ID_MAX_ATTEMPTS = 5;

/** Validity of presigned stream/download URLs (no TD defines it). */
export const PLAYBACK_URL_EXPIRES_IN_SECONDS = 3600;
