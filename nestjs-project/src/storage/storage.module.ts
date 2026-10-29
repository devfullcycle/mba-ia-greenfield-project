import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { S3_INTERNAL_CLIENT, S3_SIGNING_CLIENT } from './storage.constants';
import { StorageService } from './storage.service';

function createS3Client(
  storage: ConfigType<typeof storageConfig>,
  endpoint: string,
): S3Client {
  return new S3Client({
    endpoint,
    region: storage.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
    },
    // Without this the SDK embeds the CRC32 of an empty body in presigned
    // UploadPart URLs and the storage engine rejects the real part (BadDigest).
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
}

@Module({
  providers: [
    {
      provide: S3_INTERNAL_CLIENT,
      inject: [storageConfig.KEY],
      useFactory: (storage: ConfigType<typeof storageConfig>) =>
        createS3Client(storage, storage.endpoint),
    },
    {
      provide: S3_SIGNING_CLIENT,
      inject: [storageConfig.KEY],
      useFactory: (storage: ConfigType<typeof storageConfig>) =>
        createS3Client(storage, storage.publicEndpoint),
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
