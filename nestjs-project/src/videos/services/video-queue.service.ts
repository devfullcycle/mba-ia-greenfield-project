import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_QUEUE,
  type ProcessVideoJobData,
} from '../../queue/video-jobs';

/** Producer side of the video processing queue. */
@Injectable()
export class VideoQueueService {
  constructor(@InjectQueue(VIDEO_QUEUE) private readonly queue: Queue) {}

  async enqueueProcessing(videoId: string): Promise<void> {
    const data: ProcessVideoJobData = { videoId };
    await this.queue.add(PROCESS_VIDEO_JOB, data);
  }
}
