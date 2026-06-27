import type { JobsOptions } from 'bullmq';

export const VIDEO_PROCESSING_QUEUE = 'video-processing' as const;
export const PROCESS_VIDEO_JOB = 'process-video' as const;

export enum VideoStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}

export interface ProcessVideoJobData {
  videoId: string;
}

// Absolute ceiling enforced at the DTO layer (10GB). The effective limit and
// the multipart part plan are derived from storage config at request time.
export const DEFAULT_UPLOAD_MAX_SIZE = 10737418240;

export const PROCESSING_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: true,
  removeOnFail: false,
};

export const storageKey = {
  original: (videoId: string, filename: string): string =>
    `videos/${videoId}/original/${filename}`,
  thumbnail: (videoId: string): string => `videos/${videoId}/thumbnail.jpg`,
} as const;
