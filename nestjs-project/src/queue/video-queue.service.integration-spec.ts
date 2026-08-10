import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import appConfig from '../config/app.config';
import queueConfig from '../config/queue.config';
import { JOBS, QUEUES } from './queue.constants';
import { QueueModule } from './queue.module';
import { VideoQueueService } from './video-queue.service';

describe('VideoQueueService (integration)', () => {
  let videoQueueService: VideoQueueService;
  let queue: Queue;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [appConfig, queueConfig],
        }),
        QueueModule,
      ],
    }).compile();

    videoQueueService = module.get(VideoQueueService);
    queue = module.get<Queue>(getQueueToken(QUEUES.VIDEO_PROCESSING));
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await queue.close();
  });

  it('publishProcessingJob adds a job to the video-processing queue with the exact payload', async () => {
    const payload = {
      videoId: 'video-uuid-1',
      storageKey: 'videos/video-uuid-1/original.mp4',
      channelId: 'channel-uuid-1',
      slug: 'abc123def456',
    };

    await videoQueueService.publishProcessingJob(payload);

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe(JOBS.PROCESS_VIDEO);
    expect(jobs[0].data).toEqual(payload);
  });

  it('publishProcessingJob configures 3 attempts with exponential backoff of 5000ms', async () => {
    await videoQueueService.publishProcessingJob({
      videoId: 'video-uuid-2',
      storageKey: 'videos/video-uuid-2/original.mp4',
      channelId: 'channel-uuid-2',
      slug: 'def456ghi789',
    });

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].opts.attempts).toBe(3);
    expect(jobs[0].opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
  });
});
