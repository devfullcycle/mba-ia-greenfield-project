export const VIDEO_PUBLIC_ID_MIN_LENGTH = 10;

export const VIDEO_SEQUENCE = 'videos_seq_seq';

export const MAX_VIDEO_SIZE_BYTES = 10_737_418_240; // 10GB

export const VIDEO_MIME_TYPE_PATTERN = /^video\/[\w.+-]+$/;

/** Presigned part URLs stay valid for 6h (TD-04). */
export const UPLOAD_URL_TTL_SECONDS = 21_600;

export const videoSourceKey = (videoId: string): string =>
  `videos/${videoId}/source`;

export const videoThumbnailKey = (videoId: string): string =>
  `videos/${videoId}/thumbnail.jpg`;
