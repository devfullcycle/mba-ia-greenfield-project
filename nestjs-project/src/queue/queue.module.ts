import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import queueConfig from '../config/queue.config';
import videoConfig from '../config/video.config';
import { VIDEO_QUEUE } from './video-jobs';

/**
 * Central BullMQ wiring: Redis connection + the video-processing queue with the
 * retry/backoff defaults. Imported by the API (producer) and the worker
 * (consumer); only the worker registers a @Processor.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [
        ConfigModule.forFeature(queueConfig),
        ConfigModule.forFeature(videoConfig),
      ],
      inject: [queueConfig.KEY, videoConfig.KEY],
      useFactory: (
        queue: ReturnType<typeof queueConfig>,
        video: ReturnType<typeof videoConfig>,
      ) => ({
        connection: { host: queue.host, port: queue.port },
        defaultJobOptions: {
          attempts: video.processingAttempts,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      }),
    }),
    BullModule.registerQueue({ name: VIDEO_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
