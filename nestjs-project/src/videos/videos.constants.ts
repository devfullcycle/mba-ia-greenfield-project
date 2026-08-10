export enum VideoStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}

export const VIDEO_QUEUE_NAME = 'video-processing' as const;

export interface VideoProcessingJob {
  videoId: string;
  storageKey: string;
  bucketName: string;
}
