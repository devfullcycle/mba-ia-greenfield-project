export const VIDEO_PROCESSING_QUEUE = 'video-processing';

export const PROCESS_VIDEO_JOB = 'process-video';

/** Resolved by the worker's `settings.backoffStrategy` (TD-09). */
export const CAPPED_EXPONENTIAL_BACKOFF = 'capped-exponential';

/** Fail fast instead of hanging when Redis is down. */
export const ENQUEUE_TIMEOUT_MS = 5000;

/** Job states that mean a job is still going to run. */
export const ACTIVE_JOB_STATES = [
  'waiting',
  'delayed',
  'active',
  'prioritized',
] as const;
