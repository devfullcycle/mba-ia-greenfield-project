import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import type { ConfigType } from '@nestjs/config';
import queueConfig from '../config/queue.config';
import { VIDEO_PROCESSING_SERVICE } from './queue.constants';
import { VideoProcessingProducer } from './video-processing.producer';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: VIDEO_PROCESSING_SERVICE,
        useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
          transport: Transport.RMQ,
          options: {
            urls: [cfg.rabbitmqUrl],
            queue: cfg.videoProcessingQueue,
            queueOptions: { durable: true },
          },
        }),
        inject: [queueConfig.KEY],
      },
    ]),
  ],
  providers: [VideoProcessingProducer],
  exports: [VideoProcessingProducer],
})
export class QueueModule {}
