import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { Video } from './entities/video.entity';
import { StorageService } from './services/storage.service';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';
import { ChannelsModule } from '../channels/channels.module';
import { VideoProcessor } from './processors/video.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    BullModule.registerQueue({
      name: 'video-processing',
    }),
    ChannelsModule,
  ],
  controllers: [VideosController],
  providers: [
    VideosService,
    StorageService,
    ...(process.env.IS_WORKER === 'true' ? [VideoProcessor] : []),
  ],
  exports: [TypeOrmModule, VideosService, StorageService],
})
export class VideosModule {}
