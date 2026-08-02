import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Video } from '../../../nestjs-project/src/videos/entities/video.entity';
import { Channel } from '../../../nestjs-project/src/channels/entities/channel.entity';
import { User } from '../../../nestjs-project/src/users/entities/user.entity';
import { StorageModule } from '../../../nestjs-project/src/storage/storage.module';
import { QueueModule } from '../../../nestjs-project/src/queue/queue.module';
import { VideoProcessorService } from './video-processor.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video, Channel, User]),
    StorageModule,
    QueueModule,
  ],
  providers: [VideoProcessorService],
})
export class VideoProcessingModule {}
