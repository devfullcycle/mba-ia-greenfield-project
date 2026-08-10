import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Readable } from 'stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import storageConfig from '../config/storage.config';

export interface GetObjectResult {
  stream: Readable;
  contentType: string;
  contentLength: number;
  contentRange?: string;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly cfg: ConfigType<typeof storageConfig>,
  ) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: cfg.accessKey,
        secretAccessKey: cfg.secretKey,
      },
    });
    this.bucket = cfg.bucket;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
      } catch (createErr: unknown) {
        if (
          createErr instanceof Error &&
          (createErr.name === 'BucketAlreadyOwnedByYou' ||
            createErr.name === 'BucketAlreadyExists')
        )
          return;
        throw createErr;
      }
    }
  }

  async generatePresignedPutUrl(
    key: string,
    mimeType: string,
    expiresIn = 900,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async getObject(key: string, rangeHeader?: string): Promise<GetObjectResult> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(rangeHeader && { Range: rangeHeader }),
    });
    const response = await this.client.send(command);
    return {
      stream: response.Body as Readable,
      contentType: response.ContentType ?? 'application/octet-stream',
      contentLength: response.ContentLength ?? 0,
      contentRange: response.ContentRange,
    };
  }

  async putObject(
    key: string,
    body: Buffer | Readable,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'NoSuchKey') return;
      throw err;
    }
  }

  getBucketName(): string {
    return this.bucket;
  }
}
