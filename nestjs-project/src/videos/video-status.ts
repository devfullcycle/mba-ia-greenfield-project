import { InvalidVideoStateException } from './exceptions/video.exceptions';

/**
 * Lifecycle of a video:
 *   draft       — created when the upload starts (multipart initiated)
 *   processing  — upload finalized; queued for the worker
 *   ready       — worker extracted metadata + thumbnail
 *   error       — processing failed after exhausting retries
 */
export enum VideoStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}

const VALID_TRANSITIONS: Record<VideoStatus, VideoStatus[]> = {
  [VideoStatus.DRAFT]: [VideoStatus.PROCESSING],
  [VideoStatus.PROCESSING]: [VideoStatus.READY, VideoStatus.ERROR],
  [VideoStatus.READY]: [],
  [VideoStatus.ERROR]: [],
};

/** Throws InvalidVideoStateException when the transition is not allowed. */
export function assertTransition(from: VideoStatus, to: VideoStatus): void {
  if (!VALID_TRANSITIONS[from]?.includes(to)) {
    throw new InvalidVideoStateException(
      `Cannot transition video from "${from}" to "${to}"`,
    );
  }
}
