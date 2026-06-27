import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  PROCESS_VIDEO_JOB,
  PROCESSING_JOB_OPTIONS,
  ProcessVideoJobData,
  VIDEO_PROCESSING_QUEUE,
} from './videos.constants';

@Injectable()
export class VideoQueueService {
  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly queue: Queue<ProcessVideoJobData>,
  ) {}

  async enqueueProcessing(videoId: string): Promise<void> {
    await this.queue.add(
      PROCESS_VIDEO_JOB,
      { videoId },
      PROCESSING_JOB_OPTIONS,
    );
  }
}
