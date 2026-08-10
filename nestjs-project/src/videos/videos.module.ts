import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Video } from './entities/video.entity';
import { Channel } from '../channels/entities/channel.entity';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { VIDEO_QUEUE_NAME } from './videos.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video, Channel]),
    BullModule.registerQueue({ name: VIDEO_QUEUE_NAME }),
  ],
  controllers: [VideosController],
  providers: [VideosService],
})
export class VideosModule {}
