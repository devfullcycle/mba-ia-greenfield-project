import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import storageConfig from '../../config/storage.config';
import { Readable } from 'node:stream';

@Injectable()
export class StorageService {
  private s3Client: S3Client;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly storageCfg: ConfigType<typeof storageConfig>,
  ) {
    this.s3Client = new S3Client({
      endpoint: this.storageCfg.endpoint,
      credentials: {
        accessKeyId: this.storageCfg.accessKey,
        secretAccessKey: this.storageCfg.secretKey,
      },
      forcePathStyle: true,
      region: 'us-east-1',
    });
  }

  async initializeMultipartUpload(
    bucket: string,
    key: string,
    contentType: string,
  ): Promise<{ uploadId: string }> {
    const command = new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });
    const response = await this.s3Client.send(command);
    if (!response.UploadId) {
      throw new Error(
        'Failed to retrieve UploadId from S3 CreateMultipartUpload',
      );
    }
    return { uploadId: response.UploadId };
  }

  async generatePresignedUploadPartUrl(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    const command = new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    // Link generated signed URL valid for 1 hour
    return getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
  }

  async completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: { ETag: string; PartNumber: number }[],
  ): Promise<void> {
    // Sort parts by PartNumber (S3 requires parts list to be in order)
    const sortedParts = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);
    const command = new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: sortedParts.map((p) => ({
          ETag: p.ETag,
          PartNumber: p.PartNumber,
        })),
      },
    });
    await this.s3Client.send(command);
  }

  async abortMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
  ): Promise<void> {
    const command = new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
    });
    await this.s3Client.send(command);
  }

  async uploadBuffer(
    bucket: string,
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    });
    await this.s3Client.send(command);
  }

  async getObjectStream(
    bucket: string,
    key: string,
    range?: string,
  ): Promise<{
    stream: Readable;
    contentLength: number;
    contentRange?: string;
    acceptRanges: string;
    contentType: string;
  }> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(range && { Range: range }),
    });

    const response = await this.s3Client.send(command);

    if (!(response.Body instanceof Readable)) {
      // In Node.js environment, the SDK returns Readable stream for GetObject
      // We check and cast or wrap it.
      const bodyObj = response.Body as unknown as Record<string, unknown>;
      if (response.Body && typeof bodyObj.pipe === 'function') {
        return {
          stream: response.Body as unknown as Readable,
          contentLength: response.ContentLength ?? 0,
          contentRange: response.ContentRange,
          acceptRanges: response.AcceptRanges ?? 'bytes',
          contentType: response.ContentType ?? 'video/mp4',
        };
      }
      throw new Error('S3 GetObject response body is not a readable stream');
    }

    return {
      stream: response.Body,
      contentLength: response.ContentLength ?? 0,
      contentRange: response.ContentRange,
      acceptRanges: response.AcceptRanges ?? 'bytes',
      contentType: response.ContentType ?? 'video/mp4',
    };
  }
}
