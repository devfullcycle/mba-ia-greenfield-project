import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import {
  SWEEP_STALE_UPLOADS_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../queue/queue.constants';
import { QueueModule } from '../queue/queue.module';
import { StaleUploadScheduler } from './stale-upload.scheduler';
import { SWEEP_INTERVAL_MS, SWEEP_SCHEDULER_ID } from './worker.constants';

describe('StaleUploadScheduler (integration)', () => {
  let module: TestingModule;
  let queue: Queue;
  let scheduler: StaleUploadScheduler;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        QueueModule,
      ],
      providers: [StaleUploadScheduler],
    }).compile();
    queue = module.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
    scheduler = module.get(StaleUploadScheduler);
  });

  afterAll(async () => {
    await queue.removeJobScheduler(SWEEP_SCHEDULER_ID);
    // remove the delayed job the scheduler left behind
    const delayed = await queue.getJobs(['delayed', 'waiting']);
    await Promise.all(
      delayed
        .filter((job) => job.name === SWEEP_STALE_UPLOADS_JOB)
        .map((job) => job.remove().catch(() => undefined)),
    );
    await module.close();
  });

  it('should leave exactly one 15-minute scheduler after the bootstrap runs several times (worker restarts)', async () => {
    await scheduler.onApplicationBootstrap();
    await scheduler.onApplicationBootstrap();
    await scheduler.onApplicationBootstrap();

    const schedulers = await queue.getJobSchedulers();
    const sweepSchedulers = schedulers.filter(
      (item) => item.key === SWEEP_SCHEDULER_ID,
    );
    expect(sweepSchedulers).toHaveLength(1);
    expect(sweepSchedulers[0].every).toBe(SWEEP_INTERVAL_MS);
    expect(sweepSchedulers[0].name).toBe(SWEEP_STALE_UPLOADS_JOB);
  });
});
