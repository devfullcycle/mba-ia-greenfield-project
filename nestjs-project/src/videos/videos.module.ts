import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import storageConfig from '../config/storage.config';
import { ChannelsModule } from '../channels/channels.module';
import { StorageModule } from '../storage/storage.module';
import { QueueModule } from '../queue/queue.module';
import { Video } from './entities/video.entity';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    ConfigModule.forFeature(storageConfig),
    ChannelsModule,
    StorageModule,
    QueueModule,
  ],
  controllers: [VideosController],
  providers: [VideosService],
})
export class VideosModule {}
