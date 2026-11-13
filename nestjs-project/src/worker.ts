import { Worker } from 'bullmq';
import {
  createWorkerDataSource,
  createWorkerStorageClient,
  VideoProcessor,
  workerBucket,
} from './video-processor';

const redisHost = process.env.REDIS_HOST || 'redis';
const redisPort = Number(process.env.REDIS_PORT || 6379);
const queueName = process.env.VIDEO_QUEUE_NAME || 'video-processing';
const concurrency = Number(process.env.VIDEO_WORKER_CONCURRENCY || 1);

async function bootstrap() {
  const dataSource = createWorkerDataSource();
  await dataSource.initialize();
  const processor = new VideoProcessor(
    dataSource,
    createWorkerStorageClient(),
    workerBucket(),
  );
  const worker = new Worker(
    queueName,
    async (job) => {
      console.log(`Processing video job ${job.id} (${job.name})`);
      const result = await processor.process(job.data);
      console.log(`Video ${result.videoId} is ${result.status}`);
      return result;
    },
    {
      connection: { host: redisHost, port: redisPort },
      concurrency,
    },
  );

  worker.on('ready', () => {
    console.log(`Video worker ready on ${redisHost}:${redisPort}`);
  });
  worker.on('failed', (job, error) => {
    console.error(`Video job ${job?.id ?? 'unknown'} failed: ${error.message}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`Video worker received ${signal}; shutting down`);
    await worker.close();
    await dataSource.destroy();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((error) => {
  console.error('Video worker failed to start:', error);
  process.exitCode = 1;
});
