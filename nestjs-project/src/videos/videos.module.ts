import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { Video } from './entities/video.entity';
import { StorageModule } from './storage/storage.module';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video, Channel]),
    BullModule.registerQueue({ name: 'video-processing' }),
    StorageModule,
  ],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [TypeOrmModule],
})
export class VideosModule {}
