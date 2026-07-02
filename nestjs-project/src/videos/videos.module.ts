import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ChannelsModule } from '../channels/channels.module';
import { Video } from './video.entity';
import { StorageService } from './storage.service';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { VIDEO_PROCESSING_QUEUE } from './videos.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
    ChannelsModule,
  ],
  controllers: [VideosController],
  providers: [StorageService, VideosService],
  exports: [TypeOrmModule, StorageService, VideosService],
})
export class VideosModule {}
