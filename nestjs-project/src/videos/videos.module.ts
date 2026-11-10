import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { VideoUploadsController } from './video-uploads.controller';
import { VideoUploadsService } from './video-uploads.service';
import { VideosDataModule } from './videos-data.module';

@Module({
  imports: [VideosDataModule, StorageModule, QueueModule, ChannelsModule],
  controllers: [VideoUploadsController],
  providers: [VideoUploadsService],
})
export class VideosModule {}
