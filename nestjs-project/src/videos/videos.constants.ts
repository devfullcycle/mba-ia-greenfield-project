export const ACCEPTED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
] as const;

export const MAX_VIDEO_SIZE_BYTES = 10 * 1024 * 1024 * 1024; // 10GB

export const VIDEO_PROCESSING_QUEUE = 'video-processing';

export const VIDEO_PROCESS_JOB = 'process-video';
