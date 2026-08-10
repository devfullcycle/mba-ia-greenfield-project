import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import storageConfig from '../config/storage.config';

export interface PartPresignedUrl {
  partNumber: number;
  uploadUrl: string;
}

export interface PresignedGetUrl {
  url: string;
  expiresAt: Date;
}

@Injectable()
export class StorageService {
  private readonly client: S3Client;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {
    this.client = new S3Client({
      region: 'us-east-1',
      endpoint: `http${this.config.useSSL ? 's' : ''}://${this.config.endpoint}:${this.config.port}`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.accessKey,
        secretAccessKey: this.config.secretKey,
      },
    });
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const { UploadId } = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.bucketName,
        Key: key,
        ContentType: contentType,
      }),
    );

    if (!UploadId) {
      throw new Error(
        `Object storage did not return an UploadId for key "${key}"`,
      );
    }

    return UploadId;
  }

  async generatePartPresignedUrls(
    key: string,
    uploadId: string,
    partCount: number,
  ): Promise<PartPresignedUrl[]> {
    const urls: PartPresignedUrl[] = [];

    for (let partNumber = 1; partNumber <= partCount; partNumber++) {
      const uploadUrl = await getSignedUrl(
        this.client,
        new UploadPartCommand({
          Bucket: this.config.bucketName,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: 3600 },
      );

      urls.push({ partNumber, uploadUrl });
    }

    return urls;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.config.bucketName,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
  }

  async generatePresignedGetUrl(
    key: string,
    expiresIn: number,
    responseContentDisposition?: string,
  ): Promise<PresignedGetUrl> {
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.bucketName,
        Key: key,
        ResponseContentDisposition: responseContentDisposition,
      }),
      { expiresIn },
    );

    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
  }

  async uploadObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async initializeBucket(): Promise<void> {
    try {
      await this.client.send(
        new HeadBucketCommand({ Bucket: this.config.bucketName }),
      );
    } catch (error) {
      const statusCode = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;

      if (statusCode !== 404) {
        throw error;
      }

      await this.client.send(
        new CreateBucketCommand({ Bucket: this.config.bucketName }),
      );
    }
  }
}
