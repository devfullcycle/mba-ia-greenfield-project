import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import queueConfig from '../config/queue.config';
import { ChannelsModule } from '../channels/channels.module';
import { StorageModule } from '../storage/storage.module';
import { Video } from './entities/video.entity';
import { VideoQueueService } from './video-queue.service';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { VIDEO_PROCESSING_QUEUE } from './videos.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    ChannelsModule,
    StorageModule,
    BullModule.forRootAsync({
      inject: [queueConfig.KEY],
      useFactory: (config: ConfigType<typeof queueConfig>) => ({
        connection: { host: config.host, port: config.port },
      }),
    }),
    BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
  ],
  controllers: [VideosController],
  providers: [VideosService, VideoQueueService],
  exports: [TypeOrmModule, VideosService],
})
export class VideosModule {}
