import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { StorageModule } from '../storage/storage.module';
import { VideosDataModule } from './videos-data.module';

@Module({
  imports: [VideosDataModule, StorageModule, ChannelsModule],
})
export class VideosModule {}
