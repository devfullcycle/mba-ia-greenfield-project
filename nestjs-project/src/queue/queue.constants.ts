export const QUEUES = {
  VIDEO_PROCESS: 'video.process',
  VIDEO_UPLOAD_REAP: 'video.upload.reap',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface VideoProcessPayload {
  videoId: string;
}

export interface QueueRetryOptions {
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
}

/** Retry policy applied when a queue is created (pg-boss retries before failing a job). */
export const QUEUE_OPTIONS: Partial<Record<QueueName, QueueRetryOptions>> = {
  [QUEUES.VIDEO_PROCESS]: { retryLimit: 3, retryDelay: 30, retryBackoff: true },
};
