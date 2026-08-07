import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { QueueModule } from '../../queue/queue.module';
import { VIDEO_QUEUE } from '../../queue/video-jobs';
import { VideoQueueService } from './video-queue.service';

describe('VideoQueueService (integration)', () => {
  let moduleRef: TestingModule;
  let service: VideoQueueService;
  let queue: Queue;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), QueueModule],
      providers: [VideoQueueService],
    }).compile();

    service = moduleRef.get(VideoQueueService);
    queue = moduleRef.get<Queue>(getQueueToken(VIDEO_QUEUE));
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await moduleRef.close();
  });

  it('enqueues a process job with the videoId and retry/backoff options', async () => {
    await service.enqueueProcessing('video-123');

    const jobs = await queue.getJobs([
      'waiting',
      'delayed',
      'active',
      'paused',
    ]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe('process');
    expect(jobs[0].data).toEqual({ videoId: 'video-123' });
    expect(jobs[0].opts.attempts).toBeGreaterThanOrEqual(1);
    expect(jobs[0].opts.backoff).toMatchObject({ type: 'exponential' });
  });
});
