import queueConfig from './queue.config';

describe('queueConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns default Redis and worker configuration in test environment', () => {
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    delete process.env.VIDEO_WORKER_CONCURRENCY;
    delete process.env.BULL_PREFIX;
    process.env.NODE_ENV = 'test';

    const cfg = queueConfig();
    expect(cfg).toEqual({
      redisHost: 'redis',
      redisPort: 6379,
      videoWorkerConcurrency: 2,
      prefix: 'bull-test',
    });
  });

  it('uses bull prefix in development environment and respects custom env vars', () => {
    process.env.NODE_ENV = 'development';
    process.env.REDIS_HOST = 'redis-cluster';
    process.env.REDIS_PORT = '6380';
    process.env.VIDEO_WORKER_CONCURRENCY = '4';
    delete process.env.BULL_PREFIX;

    const cfg = queueConfig();
    expect(cfg).toEqual({
      redisHost: 'redis-cluster',
      redisPort: 6380,
      videoWorkerConcurrency: 4,
      prefix: 'bull',
    });
  });
});
