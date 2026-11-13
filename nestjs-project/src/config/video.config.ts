import { registerAs } from '@nestjs/config';

export default registerAs('video', () => ({
  storageEndpoint: process.env.STORAGE_ENDPOINT || 'minio',
  storagePort: parseInt(process.env.STORAGE_PORT || '9000', 10),
  storageUseSsl: process.env.STORAGE_USE_SSL === 'true',
  storageAccessKey: process.env.STORAGE_ACCESS_KEY || 'streamtube',
  storageSecretKey: process.env.STORAGE_SECRET_KEY || 'streamtube-local-secret',
  storageBucket: process.env.STORAGE_BUCKET || 'streamtube-videos',
  storageUrlExpirySeconds: parseInt(
    process.env.STORAGE_URL_EXPIRY_SECONDS || '900',
    10,
  ),
  redisHost: process.env.REDIS_HOST || 'redis',
  redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
  videoQueueName: process.env.VIDEO_QUEUE_NAME || 'video-processing',
  workerConcurrency: parseInt(process.env.VIDEO_WORKER_CONCURRENCY || '1', 10),
}));
