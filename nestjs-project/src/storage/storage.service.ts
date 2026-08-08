import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import storageConfig from '../config/storage.config';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {
    this.s3Client = new S3Client({
      endpoint: this.config.endpoint,
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      forcePathStyle: this.config.forcePathStyle,
    });
  }

  async onModuleInit() {
    await this.ensureBucketsExist();
  }

  async ensureBucketsExist(): Promise<void> {
    const buckets = [this.config.bucketVideos, this.config.bucketThumbnails];
    await Promise.all(buckets.map((bucket) => this.ensureBucketExists(bucket)));
  }

  private async ensureBucketExists(bucket: string): Promise<void> {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (err: any) {
      if (
        err.name === 'NotFound' ||
        err.$metadata?.httpStatusCode === 404 ||
        err.name === 'NoSuchBucket'
      ) {
        this.logger.log(`Bucket ${bucket} not found. Creating bucket...`);
        try {
          await this.s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
        } catch (createErr) {
          this.logger.error(`Failed to create bucket ${bucket}:`, createErr);
        }
      } else {
        this.logger.error(`Error checking bucket ${bucket}:`, err);
      }
    }
  }

  async getPresignedUploadUrl(
    bucket: string,
    key: string,
    expiresIn = 3600,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  async getPresignedDownloadUrl(
    bucket: string,
    key: string,
    filename?: string,
    expiresIn = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: filename
        ? `attachment; filename="${encodeURIComponent(filename)}"`
        : undefined,
    });
    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  async headObject(bucket: string, key: string) {
    const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
    return this.s3Client.send(command);
  }

  async getObjectStream(bucket: string, key: string, range?: string) {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: range,
    });
    const response = await this.s3Client.send(command);
    return {
      stream: response.Body as Readable,
      contentLength: response.ContentLength,
      contentRange: response.ContentRange,
      acceptRanges: response.AcceptRanges || 'bytes',
      contentType: response.ContentType,
    };
  }

  async uploadBuffer(
    bucket: string,
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    });
    await this.s3Client.send(command);
  }
}
