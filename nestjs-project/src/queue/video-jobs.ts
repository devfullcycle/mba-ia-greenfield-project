/** Name of the BullMQ queue that carries video processing jobs. */
export const VIDEO_QUEUE = 'video-processing';

/** Job name within the queue. */
export const PROCESS_VIDEO_JOB = 'process';

/** Payload of a video processing job. */
export interface ProcessVideoJobData {
  videoId: string;
}
