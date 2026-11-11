import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { UnrecoverableError, Worker, type Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { QueueModule } from './queue.module';
import { VIDEO_PROCESSING_QUEUE } from './queue.constants';
import { VideoProcessingQueue } from './video-processing.queue';

describe('VideoProcessingQueue (integration)', () => {
  let module: TestingModule;
  let producer: VideoProcessingQueue;
  let queue: Queue;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), QueueModule],
    }).compile();
    producer = module.get(VideoProcessingQueue);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  afterEach(async () => {
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await module.close();
  });

  it('should use the isolated test prefix', () => {
    expect(queue.opts.prefix).toBe('streamtube-test');
  });

  it('should keep a single job when the same videoId is enqueued twice', async () => {
    const videoId = randomUUID();

    await producer.enqueue(videoId);
    await producer.enqueue(videoId);

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(videoId);
    expect(jobs[0].data).toEqual({ videoId });
  });

  it('should enqueue process-video with retry-forever and capped backoff options', async () => {
    const videoId = randomUUID();

    await producer.enqueue(videoId);

    const job = await queue.getJob(videoId);
    expect(job?.name).toBe('process-video');
    // Redis stores `attempts` as a double, so MAX_SAFE_INTEGER round-trips as
    // 9007199254741000; what matters is that the cap is effectively unreachable.
    expect(job?.opts.attempts).toBeGreaterThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(job?.opts.backoff).toEqual({ type: 'capped-exponential' });
    expect(job?.opts.removeOnComplete).toBe(true);
  });

  it('should report an active job for a waiting job', async () => {
    const videoId = randomUUID();
    await producer.enqueue(videoId);

    expect(await producer.hasActiveJob(videoId)).toBe(true);
  });

  it('should report no active job when no job exists', async () => {
    expect(await producer.hasActiveJob(randomUUID())).toBe(false);
  });

  it('should report no active job for a failed job and remove it so it can be re-enqueued', async () => {
    const videoId = randomUUID();
    await producer.enqueue(videoId);
    await failNextJob(queue);

    expect(await producer.hasActiveJob(videoId)).toBe(false);
    expect(await queue.getJob(videoId)).toBeUndefined();

    await producer.enqueue(videoId);
    expect(await producer.hasActiveJob(videoId)).toBe(true);
  });
});

/** Runs a throwaway worker that permanently fails the next job, then stops. */
async function failNextJob(queue: Queue): Promise<void> {
  const worker = new Worker(
    queue.name,
    () => {
      throw new UnrecoverableError('forced failure');
    },
    { connection: queue.opts.connection, prefix: queue.opts.prefix },
  );
  await new Promise<void>((resolve) => worker.once('failed', () => resolve()));
  await worker.close();
}
