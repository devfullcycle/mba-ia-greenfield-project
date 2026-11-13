import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { Client } from 'minio';
import videoConfig from '../../config/video.config';
import { VIDEO_STORAGE_CLIENT } from './storage.constants';
import { StorageService } from './storage.service';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: VIDEO_STORAGE_CLIENT,
      inject: [videoConfig.KEY],
      useFactory: (config: ConfigType<typeof videoConfig>) =>
        new Client({
          endPoint: config.storageEndpoint,
          port: config.storagePort,
          useSSL: config.storageUseSsl,
          accessKey: config.storageAccessKey,
          secretKey: config.storageSecretKey,
        }),
    },
    {
      provide: StorageService,
      inject: [VIDEO_STORAGE_CLIENT, videoConfig.KEY],
      useFactory: (client: Client, config: ConfigType<typeof videoConfig>) =>
        new StorageService(
          client,
          config.storageBucket,
          config.storageUrlExpirySeconds,
        ),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
