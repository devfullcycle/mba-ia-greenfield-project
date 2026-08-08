export const VIDEO_PROCESSING_QUEUE = 'video-processing';
export const PROCESS_VIDEO_JOB = 'process-video';

export interface VideoJobData {
  videoId: string;
  urlCode: string;
  storageKey: string;
}
