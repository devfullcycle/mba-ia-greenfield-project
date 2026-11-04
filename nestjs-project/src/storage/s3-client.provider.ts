import type { Provider } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';

export const S3_CLIENT = Symbol('S3_CLIENT');

export const s3ClientProvider: Provider = {
  provide: S3_CLIENT,
  inject: [storageConfig.KEY],
  useFactory: (cfg: ConfigType<typeof storageConfig>): S3Client =>
    new S3Client({
      endpoint: `${cfg.useSsl ? 'https' : 'http'}://${cfg.endpoint}:${cfg.port}`,
      region: 'us-east-1',
      credentials: {
        accessKeyId: cfg.accessKey,
        secretAccessKey: cfg.secretKey,
      },
      forcePathStyle: true,
    }),
};
