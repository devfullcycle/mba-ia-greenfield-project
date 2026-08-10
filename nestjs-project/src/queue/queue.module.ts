import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import type { ConfigType } from '@nestjs/config';
import queueConfig from '../config/queue.config';
import { QUEUES } from './queue.constants';
import { VideoQueueService } from './video-queue.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [queueConfig.KEY],
      useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
        connection: { host: cfg.host, port: cfg.port },
      }),
    }),
    BullModule.registerQueue({ name: QUEUES.VIDEO_PROCESSING }),
  ],
  providers: [VideoQueueService],
  exports: [VideoQueueService],
})
export class QueueModule {}
