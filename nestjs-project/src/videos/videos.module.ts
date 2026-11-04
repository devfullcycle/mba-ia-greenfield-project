import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsModule } from '../channels/channels.module';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { StorageModule } from '../storage/storage.module';
import { Video } from './entities/video.entity';
import { MediaProbeService } from './processing/media-probe.service';
import { VideoProcessor } from './processing/video.processor';
import { VideosController } from './videos.controller';
import { VIDEO_PROCESSING_QUEUE, VideosService } from './videos.service';

@Module({
  imports: [
    ConfigModule.forFeature(storageConfig),
    ConfigModule.forFeature(queueConfig),
    TypeOrmModule.forFeature([Video]),
    BullModule.registerQueue({
      name: VIDEO_PROCESSING_QUEUE,
    }),
    ChannelsModule,
    StorageModule,
  ],
  controllers: [VideosController],
  providers: [VideosService, MediaProbeService, VideoProcessor],
  exports: [VideosService, MediaProbeService],
})
export class VideosModule {}
