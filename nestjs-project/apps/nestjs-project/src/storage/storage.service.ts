import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Readable } from 'stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import storageConfig from '../config/storage.config';
import { S3_CLIENT } from './storage.constants';

export interface UploadPart {
  partNumber: number;
  eTag: string;
}

@Injectable()
export class StorageService {
  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {}

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<{ uploadId: string }> {
    const response = await this.s3.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.bucketVideos,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!response.UploadId) {
      throw new Error('S3 did not return an UploadId for multipart upload');
    }
    return { uploadId: response.UploadId };
  }

  async getUploadPartUrl(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    const command = new UploadPartCommand({
      Bucket: this.config.bucketVideos,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    return getSignedUrl(this.s3, command, {
      expiresIn: this.config.presignedUrlExpirationSeconds,
    });
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: UploadPart[],
  ): Promise<void> {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.config.bucketVideos,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts
            .slice()
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((part) => ({
              PartNumber: part.partNumber,
              ETag: part.eTag,
            })),
        },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.s3.send(
      new AbortMultipartUploadCommand({
        Bucket: this.config.bucketVideos,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async getObjectPresignedUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucketVideos,
      Key: key,
    });
    return getSignedUrl(this.s3, command, {
      expiresIn: this.config.presignedUrlExpirationSeconds,
    });
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.bucketVideos,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getObjectStream(key: string): Promise<Readable> {
    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.config.bucketVideos,
        Key: key,
      }),
    );
    return response.Body as Readable;
  }
}
