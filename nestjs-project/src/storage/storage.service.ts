import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';
import { S3_CLIENT } from './s3-client.provider';

export interface ObjectStream {
  stream: Readable;
  contentLength: number;
  contentRange?: string;
  contentType?: string;
}

interface AwsError {
  name?: string;
  $metadata?: { httpStatusCode?: number };
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject(S3_CLIENT) private readonly s3Client: S3Client,
    @Inject(storageConfig.KEY)
    private readonly storageCfg: ConfigType<typeof storageConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.ensureBucketExists(this.storageCfg.bucketVideos),
      this.ensureBucketExists(this.storageCfg.bucketThumbnails),
    ]);
  }

  async ensureBucketExists(bucketName: string): Promise<void> {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
      return;
    } catch (error) {
      if (!this.isNotFound(error)) {
        throw error;
      }
    }

    try {
      await this.s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
      this.logger.log(`Bucket "${bucketName}" created`);
    } catch (error) {
      const name = (error as AwsError).name;
      if (
        name === 'BucketAlreadyOwnedByYou' ||
        name === 'BucketAlreadyExists'
      ) {
        return;
      }
      throw error;
    }
  }

  async uploadStream(
    key: string,
    stream: Readable,
    contentType: string,
    bucket: string,
  ): Promise<void> {
    const upload = new Upload({
      client: this.s3Client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: stream,
        ContentType: contentType,
      },
      queueSize: 4,
      partSize: 5 * 1024 * 1024,
      leavePartsOnError: false,
    });

    await upload.done();
  }

  async getObjectStream(
    key: string,
    bucket: string,
    range?: string,
  ): Promise<ObjectStream> {
    const output = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(range ? { Range: range } : {}),
      }),
    );

    return {
      stream: output.Body as Readable,
      contentLength: output.ContentLength ?? 0,
      contentRange: output.ContentRange,
      contentType: output.ContentType,
    };
  }

  async deleteObject(key: string, bucket: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
    );
  }

  private isNotFound(error: unknown): boolean {
    const awsError = error as AwsError;
    return (
      awsError.name === 'NotFound' ||
      awsError.name === 'NoSuchBucket' ||
      awsError.$metadata?.httpStatusCode === 404
    );
  }
}
