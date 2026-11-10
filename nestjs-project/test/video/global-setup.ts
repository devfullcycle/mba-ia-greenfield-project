import { Queue } from 'bullmq';
import { VIDEO_PROCESSING_QUEUE } from '../../src/queue/queue.constants';

// globalSetup runs outside the test environment, so `setupFiles` (and thus
// setup-test-env.ts / dotenv) never apply here: the test prefix and Redis
// connection must be set explicitly to avoid touching development jobs.
const TEST_QUEUE_PREFIX = 'streamtube-test';

export default async function globalSetup(): Promise<void> {
  const queue = new Queue(VIDEO_PROCESSING_QUEUE, {
    prefix: TEST_QUEUE_PREFIX,
    connection: {
      host: process.env.REDIS_HOST ?? 'redis',
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
  });
  try {
    await queue.obliterate({ force: true });
  } finally {
    await queue.close();
  }
}
