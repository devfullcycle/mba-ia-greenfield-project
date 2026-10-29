import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsModule } from '../channels/channels.module';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { Video } from './entities/video.entity';
import { VideoAccessPolicy } from './video-access.policy';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    ChannelsModule,
    QueueModule,
    StorageModule,
  ],
  controllers: [VideosController],
  providers: [VideoAccessPolicy, VideosService],
  exports: [TypeOrmModule],
})
export class VideosModule {}
