import {
  FfmpegProcessError,
  NoDurationError,
  NoVideoStreamError,
} from './processing.errors';

export type PermanentFailureReason =
  | 'INVALID_FILE'
  | 'NO_VIDEO_STREAM'
  | 'NO_DURATION';

export type ProcessingErrorClass =
  | { kind: 'permanent'; reason: PermanentFailureReason }
  | { kind: 'infra' };

const INVALID_DATA_PATTERNS = [
  /Invalid data found when processing input/i,
  /moov atom not found/i,
];

const NETWORK_PATTERNS = [
  /Connection refused/i,
  /Server returned/i,
  /timed out/i,
];

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 60 * 60 * 1000;

/** Frame used for the thumbnail: 10% into the video, never past its end. */
export function thumbnailTimestamp(durationSeconds: number): number {
  return Math.max(0, Math.min(0.1 * durationSeconds, durationSeconds - 0.1));
}

/**
 * Only failures proven to be caused by the file itself are permanent.
 * Network errors, timeouts and anything unknown are infra (retried forever).
 */
export function classifyProcessingError(err: unknown): ProcessingErrorClass {
  if (err instanceof NoVideoStreamError) {
    return { kind: 'permanent', reason: 'NO_VIDEO_STREAM' };
  }
  if (err instanceof NoDurationError) {
    return { kind: 'permanent', reason: 'NO_DURATION' };
  }
  if (
    err instanceof FfmpegProcessError &&
    err.command === 'ffprobe' &&
    err.exitCode !== 0 &&
    INVALID_DATA_PATTERNS.some((pattern) => pattern.test(err.stderr)) &&
    !NETWORK_PATTERNS.some((pattern) => pattern.test(err.stderr))
  ) {
    return { kind: 'permanent', reason: 'INVALID_FILE' };
  }
  return { kind: 'infra' };
}

/** Retry delay: 30s doubling per attempt, capped at 1h. */
export function processingBackoff(attemptsMade: number): number {
  return Math.min(
    BACKOFF_BASE_MS * 2 ** Math.max(0, attemptsMade - 1),
    BACKOFF_CAP_MS,
  );
}
