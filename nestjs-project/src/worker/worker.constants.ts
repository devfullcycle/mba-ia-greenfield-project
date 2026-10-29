/** Injection token for the promisified `child_process.execFile`. */
export const EXEC_FILE = Symbol('EXEC_FILE');

/** Where in the video the thumbnail frame is taken (fraction of the duration). */
export const THUMBNAIL_POSITION = 0.1;

export const THUMBNAIL_CONTENT_TYPE = 'image/jpeg';
export const THUMBNAIL_MAX_WIDTH = 640;

/** Hard cap for ffprobe/ffmpeg runs (ms) so a stuck read cannot block a job forever. */
export const MEDIA_TOOL_TIMEOUT_MS = 10 * 60 * 1000;
export const FAILURE_REASON_MAX_LENGTH = 255;

/** Uploads idle for longer than this are considered abandoned (per phase-03-videos/TD-10). */
export const STALE_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const STALE_UPLOAD_FAILURE_REASON =
  'Upload was not completed within 24 hours';

/** How often the sweeper runs, and the id of its job scheduler. */
export const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
export const SWEEP_SCHEDULER_ID = 'sweep-stale-uploads';
