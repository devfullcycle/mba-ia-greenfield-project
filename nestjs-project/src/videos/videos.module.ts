import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsModule } from '../channels/channels.module';
import videoConfig from '../config/video.config';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { Video } from './entities/video.entity';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { PublicIdService } from './services/public-id.service';
import { VideoQueueService } from './services/video-queue.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    ConfigModule.forFeature(videoConfig),
    StorageModule,
    QueueModule,
    ChannelsModule,
  ],
  controllers: [VideosController],
  providers: [VideosService, PublicIdService, VideoQueueService],
  exports: [TypeOrmModule, VideosService],
})
export class VideosModule {}
