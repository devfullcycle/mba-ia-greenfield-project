import { registerAs } from '@nestjs/config';

export default registerAs('queue', () => ({
  redisHost: process.env.REDIS_HOST || 'redis',
  redisPort: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  videoWorkerConcurrency: parseInt(
    process.env.VIDEO_WORKER_CONCURRENCY ?? '2',
    10,
  ),
  prefix:
    process.env.BULL_PREFIX ||
    (process.env.NODE_ENV === 'test' ? 'bull-test' : 'bull'),
}));
