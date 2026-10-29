import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  SWEEP_STALE_UPLOADS_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../queue/queue.constants';
import { SWEEP_INTERVAL_MS, SWEEP_SCHEDULER_ID } from './worker.constants';

/**
 * Registers the repeatable `sweep-stale-uploads` job when the worker starts.
 * `upsertJobScheduler` is idempotent, so restarts keep a single scheduler.
 */
@Injectable()
export class StaleUploadScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_SCHEDULER_ID,
      { every: SWEEP_INTERVAL_MS },
      {
        name: SWEEP_STALE_UPLOADS_JOB,
        data: {},
        opts: {
          attempts: 1,
          removeOnComplete: { count: 5 },
          removeOnFail: { count: 20 },
        },
      },
    );
  }
}
