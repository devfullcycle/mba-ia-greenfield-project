import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import storageConfig from '../config/storage.config';
import { StorageErrorException } from './exceptions/storage-error.exception';
import { S3_CLIENT } from './storage.constants';

export interface CompletedPart {
  partNumber: number;
  eTag: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject(S3_CLIENT) private readonly s3Client: S3Client,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {}

  buildOriginalKey(channelId: string, videoId: string, ext: string): string {
    return `videos/${channelId}/${videoId}/original.${ext}`;
  }

  buildThumbnailKey(channelId: string, videoId: string): string {
    return `videos/${channelId}/${videoId}/thumbnail.jpg`;
  }

  async createMultipartUpload(
    key: string,
    mimeType: string,
  ): Promise<{ uploadId: string }> {
    try {
      const result = await this.s3Client.send(
        new CreateMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: key,
          ContentType: mimeType,
        }),
      );
      if (!result.UploadId) {
        throw new Error('S3 did not return an UploadId');
      }
      return { uploadId: result.UploadId };
    } catch (error) {
      this.logger.error('createMultipartUpload failed', error as Error);
      throw new StorageErrorException();
    }
  }

  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    try {
      return await getSignedUrl(
        this.s3Client,
        new UploadPartCommand({
          Bucket: this.config.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: this.config.presignExpiresSeconds },
      );
    } catch (error) {
      this.logger.error('presignUploadPart failed', error as Error);
      throw new StorageErrorException();
    }
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void> {
    try {
      await this.s3Client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: [...parts]
              .sort((a, b) => a.partNumber - b.partNumber)
              .map((part) => ({
                PartNumber: part.partNumber,
                ETag: part.eTag,
              })),
          },
        }),
      );
    } catch (error) {
      this.logger.error('completeMultipartUpload failed', error as Error);
      throw new StorageErrorException();
    }
  }

  async presignGetObject(
    key: string,
    disposition: 'inline' | 'attachment',
  ): Promise<string> {
    try {
      return await getSignedUrl(
        this.s3Client,
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          ResponseContentDisposition: disposition,
        }),
        { expiresIn: this.config.presignExpiresSeconds },
      );
    } catch (error) {
      this.logger.error('presignGetObject failed', error as Error);
      throw new StorageErrorException();
    }
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    } catch (error) {
      this.logger.error('putObject failed', error as Error);
      throw new StorageErrorException();
    }
  }
}
