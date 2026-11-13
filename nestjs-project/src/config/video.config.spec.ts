import videoConfig from './video.config';

describe('video config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.STORAGE_ENDPOINT;
    delete process.env.STORAGE_PORT;
    delete process.env.STORAGE_USE_SSL;
    delete process.env.STORAGE_ACCESS_KEY;
    delete process.env.STORAGE_SECRET_KEY;
    delete process.env.STORAGE_BUCKET;
    delete process.env.STORAGE_URL_EXPIRY_SECONDS;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    delete process.env.VIDEO_QUEUE_NAME;
    delete process.env.VIDEO_WORKER_CONCURRENCY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses Docker-compatible defaults', () => {
    expect(videoConfig()).toEqual({
      storageEndpoint: 'minio',
      storagePort: 9000,
      storageUseSsl: false,
      storageAccessKey: 'streamtube',
      storageSecretKey: 'streamtube-local-secret',
      storageBucket: 'streamtube-videos',
      storageUrlExpirySeconds: 900,
      redisHost: 'redis',
      redisPort: 6379,
      videoQueueName: 'video-processing',
      workerConcurrency: 1,
    });
  });

  it('parses explicitly configured values', () => {
    Object.assign(process.env, {
      STORAGE_ENDPOINT: 'storage.internal',
      STORAGE_PORT: '9443',
      STORAGE_USE_SSL: 'true',
      STORAGE_ACCESS_KEY: 'access',
      STORAGE_SECRET_KEY: 'secret',
      STORAGE_BUCKET: 'videos',
      STORAGE_URL_EXPIRY_SECONDS: '60',
      REDIS_HOST: 'cache.internal',
      REDIS_PORT: '6380',
      VIDEO_QUEUE_NAME: 'custom-video-queue',
      VIDEO_WORKER_CONCURRENCY: '3',
    });

    expect(videoConfig()).toEqual({
      storageEndpoint: 'storage.internal',
      storagePort: 9443,
      storageUseSsl: true,
      storageAccessKey: 'access',
      storageSecretKey: 'secret',
      storageBucket: 'videos',
      storageUrlExpirySeconds: 60,
      redisHost: 'cache.internal',
      redisPort: 6380,
      videoQueueName: 'custom-video-queue',
      workerConcurrency: 3,
    });
  });
});
