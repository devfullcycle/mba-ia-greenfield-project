import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { JOBS, QUEUES } from './queue.constants';

export interface ProcessVideoPayload {
  videoId: string;
  storageKey: string;
  channelId: string;
  slug: string;
}

@Injectable()
export class VideoQueueService {
  constructor(
    @InjectQueue(QUEUES.VIDEO_PROCESSING)
    private readonly videoProcessingQueue: Queue,
  ) {}

  async publishProcessingJob(payload: ProcessVideoPayload): Promise<void> {
    await this.videoProcessingQueue.add(JOBS.PROCESS_VIDEO, payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }
}
