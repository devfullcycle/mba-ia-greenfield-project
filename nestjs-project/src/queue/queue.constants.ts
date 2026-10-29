export const VIDEO_PROCESSING_QUEUE = 'video-processing';

export const PROCESS_VIDEO_JOB = 'process-video';
export const SWEEP_STALE_UPLOADS_JOB = 'sweep-stale-uploads';

export const VIDEO_PROCESSING_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: false,
} as const;
