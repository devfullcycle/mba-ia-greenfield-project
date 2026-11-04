import { Global, Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import queueConfig from '../config/queue.config';
import { VIDEO_PROCESSING_QUEUE } from './queue.constants';

// Shared dynamic module so every importing module resolves the same queue
// instance (and BullMQ connection) instead of registering duplicates.
export const videoProcessingQueueModule = BullModule.registerQueue({
  name: VIDEO_PROCESSING_QUEUE,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5_000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [queueConfig.KEY],
      useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
        connection: {
          host: cfg.host,
          port: cfg.port,
        },
      }),
    }),
    videoProcessingQueueModule,
  ],
})
export class QueueModule {}
