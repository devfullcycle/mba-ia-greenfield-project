export const PUBLIC_ID_LENGTH = 11;
export const PUBLIC_ID_MAX_RETRIES = 5;

export const MAX_PARTS_PER_SIGN_REQUEST = 100;
/** S3 hard limit on the number of parts of a multipart upload. */
export const MAX_UPLOAD_PARTS = 10000;

export const VIDEO_OBJECT_PREFIX = 'videos';

/** Object key of the generated thumbnail (per phase-03-videos/TD-03). */
export function thumbnailKey(videoId: string): string {
  return `${VIDEO_OBJECT_PREFIX}/${videoId}/thumbnail.jpg`;
}

/** Narrow allowlist: formats browsers play natively (per phase-03-videos/TD-12). */
export const ALLOWED_VIDEO_TYPES: Record<string, readonly string[]> = {
  'video/mp4': ['mp4'],
  'video/webm': ['webm'],
};

export const PG_UNIQUE_VIOLATION = '23505';
