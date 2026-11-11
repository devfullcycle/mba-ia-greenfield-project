import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  ACTIVE_JOB_STATES,
  CAPPED_EXPONENTIAL_BACKOFF,
  ENQUEUE_TIMEOUT_MS,
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
} from './queue.constants';

export interface ProcessVideoJobData {
  videoId: string;
}

export class EnqueueTimeoutError extends Error {
  constructor(videoId: string) {
    super(`Timed out after ${ENQUEUE_TIMEOUT_MS}ms enqueuing video ${videoId}`);
    this.name = 'EnqueueTimeoutError';
  }
}

/** Producer for `video-processing`. `jobId = videoId` makes enqueue idempotent. */
@Injectable()
export class VideoProcessingQueue {
  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly queue: Queue<ProcessVideoJobData>,
  ) {}

  async enqueue(videoId: string): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new EnqueueTimeoutError(videoId)),
        ENQUEUE_TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([
        this.queue.add(
          PROCESS_VIDEO_JOB,
          { videoId },
          {
            jobId: videoId,
            attempts: Number.MAX_SAFE_INTEGER,
            backoff: { type: CAPPED_EXPONENTIAL_BACKOFF },
            removeOnComplete: true,
          },
        ),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * True when a job for `videoId` is still going to run. A finished
   * (failed/completed) job is removed so its jobId can be enqueued again.
   */
  async hasActiveJob(videoId: string): Promise<boolean> {
    const job = await this.queue.getJob(videoId);
    if (!job) return false;

    const state = await job.getState();
    if ((ACTIVE_JOB_STATES as readonly string[]).includes(state)) return true;

    if (state === 'failed' || state === 'completed') {
      await job.remove();
    }
    return false;
  }
}
