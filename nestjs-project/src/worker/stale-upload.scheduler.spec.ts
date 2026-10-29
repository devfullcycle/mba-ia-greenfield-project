import type { Queue } from 'bullmq';
import { SWEEP_STALE_UPLOADS_JOB } from '../queue/queue.constants';
import { StaleUploadScheduler } from './stale-upload.scheduler';
import { SWEEP_INTERVAL_MS, SWEEP_SCHEDULER_ID } from './worker.constants';

describe('StaleUploadScheduler', () => {
  it('should upsert the repeatable sweep job every 15 minutes when the app boots', async () => {
    const queue = {
      upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
    };
    const scheduler = new StaleUploadScheduler(queue as unknown as Queue);

    await scheduler.onApplicationBootstrap();

    expect(SWEEP_INTERVAL_MS).toBe(15 * 60 * 1000);
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      SWEEP_SCHEDULER_ID,
      { every: SWEEP_INTERVAL_MS },
      expect.objectContaining({
        name: SWEEP_STALE_UPLOADS_JOB,
        opts: expect.objectContaining({ attempts: 1 }) as unknown,
      }),
    );
  });

  it('should let a failing registration abort the bootstrap', async () => {
    const queue = {
      upsertJobScheduler: jest.fn().mockRejectedValue(new Error('redis down')),
    };
    const scheduler = new StaleUploadScheduler(queue as unknown as Queue);

    await expect(scheduler.onApplicationBootstrap()).rejects.toThrow(
      'redis down',
    );
  });
});
