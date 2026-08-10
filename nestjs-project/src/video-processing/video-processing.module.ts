import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Video } from '../videos/entities/video.entity';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { VideoProcessingProcessor } from './video-processing.processor';
import { VIDEO_QUEUE_NAME } from '../videos/videos.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video, Channel, User]),
    BullModule.registerQueue({ name: VIDEO_QUEUE_NAME }),
  ],
  providers: [VideoProcessingProcessor],
})
export class VideoProcessingModule {}
