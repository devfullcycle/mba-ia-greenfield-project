import { registerAs } from '@nestjs/config';

export default registerAs('queue', () => ({
  connectionString: process.env.QUEUE_CONNECTION_STRING!,
  retryLimit: parseInt(process.env.QUEUE_RETRY_LIMIT || '3', 10),
  retryDelaySeconds: parseInt(
    process.env.QUEUE_RETRY_DELAY_SECONDS || '30',
    10,
  ),
}));
