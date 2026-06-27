import { BullModule, Processor, WorkerHost } from '@nestjs/bullmq';
import { INestApplication, Injectable } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Job, Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import { VideoQueueService } from './video-queue.service';
import {
  PROCESS_VIDEO_JOB,
  ProcessVideoJobData,
  VIDEO_PROCESSING_QUEUE,
} from './videos.constants';

let resolveProcessed: (job: Job<ProcessVideoJobData>) => void;
let processed: Promise<Job<ProcessVideoJobData>>;

@Processor(VIDEO_PROCESSING_QUEUE)
@Injectable()
class CapturingProcessor extends WorkerHost {
  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    resolveProcessed(job);
  }
}

describe('VideoQueueService (integration, real Redis)', () => {
  let app: INestApplication;
  let producer: VideoQueueService;
  let queue: Queue<ProcessVideoJobData>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        BullModule.forRootAsync({
          inject: [queueConfig.KEY],
          useFactory: (config: ConfigType<typeof queueConfig>) => ({
            connection: { host: config.host, port: config.port },
          }),
        }),
        BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
      ],
      providers: [VideoQueueService, CapturingProcessor],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    producer = app.get(VideoQueueService);
    queue = app.get<Queue<ProcessVideoJobData>>(
      `BullQueue_${VIDEO_PROCESSING_QUEUE}`,
    );
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await app.close();
  });

  beforeEach(() => {
    processed = new Promise((resolve) => {
      resolveProcessed = resolve;
    });
  });

  it('delivers an enqueued job to the consumer with the correct payload', async () => {
    await producer.enqueueProcessing('video-abc');

    const job = await processed;

    expect(job.name).toBe(PROCESS_VIDEO_JOB);
    expect(job.data).toEqual({ videoId: 'video-abc' });
  }, 15000);

  it('applies the configured retry/backoff options', async () => {
    await producer.enqueueProcessing('video-retry');

    const job = await processed;

    expect(job.opts.attempts).toBe(3);
    expect(job.opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
  }, 15000);
});
