import { randomUUID } from 'crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue, Worker } from 'bullmq';
import queueConfig from '../config/queue.config';
import { PROCESS_VIDEO_JOB, VIDEO_PROCESSING_QUEUE } from './queue.constants';
import { QueueModule } from './queue.module';
import {
  ProcessVideoJobData,
  VideoProcessingProducer,
} from './video-processing.producer';

describe('VideoProcessingProducer (integration)', () => {
  let module: TestingModule;
  let producer: VideoProcessingProducer;
  let queue: Queue<ProcessVideoJobData>;
  const enqueuedIds: string[] = [];

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        QueueModule,
      ],
    }).compile();
    producer = module.get(VideoProcessingProducer);
    queue = module.get<Queue<ProcessVideoJobData>>(
      getQueueToken(VIDEO_PROCESSING_QUEUE),
    );
  });

  afterAll(async () => {
    for (const id of enqueuedIds) {
      const job = await queue.getJob(id);
      await job?.remove().catch(() => undefined);
    }
    await module.close();
  });

  function newVideoId(): string {
    const id = randomUUID();
    enqueuedIds.push(id);
    return id;
  }

  it('should enqueue a process-video job carrying { videoId } with the default retry options', async () => {
    const videoId = newVideoId();

    await producer.enqueueProcessVideo(videoId);

    const job = await queue.getJob(videoId);
    expect(job).toBeDefined();
    expect(job!.name).toBe(PROCESS_VIDEO_JOB);
    expect(job!.data).toEqual({ videoId });
    expect(job!.opts.attempts).toBe(3);
    expect(job!.opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
  });

  it('should deduplicate jobs enqueued twice for the same videoId', async () => {
    const videoId = newVideoId();

    await producer.enqueueProcessVideo(videoId);
    await producer.enqueueProcessVideo(videoId);

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    expect(jobs.filter((job) => job.data.videoId === videoId)).toHaveLength(1);
  });

  it('should keep a job in the failed set after it exhausts its attempts', async () => {
    const videoId = newVideoId();
    const config = queueConfig();
    // Only this test runs a worker, so the other tests' jobs stay untouched.
    const worker = new Worker(
      VIDEO_PROCESSING_QUEUE,
      () => Promise.reject(new Error('boom')),
      { connection: { host: config.host, port: config.port } },
    );
    const exhausted = new Promise<void>((resolve) => {
      worker.on('failed', (job) => {
        if (job?.id === videoId && job.attemptsMade >= 3) resolve();
      });
    });

    try {
      await producer.enqueueProcessVideo(videoId);
      await exhausted;

      const job = await queue.getJob(videoId);
      expect(await job!.getState()).toBe('failed');
      expect(job!.attemptsMade).toBe(3);
    } finally {
      await worker.close();
    }
  }, 60000);
});
