import { Inject, Injectable } from '@nestjs/common';
import { Client } from 'minio';
import { VIDEO_STORAGE_CLIENT } from './storage.constants';

export interface MultipartPart {
  part: number;
  etag: string;
}

@Injectable()
export class StorageService {
  constructor(
    @Inject(VIDEO_STORAGE_CLIENT) private readonly client: Client,
    private readonly bucket: string,
    private readonly urlExpirySeconds: number,
  ) {}

  async ensureBucket(): Promise<void> {
    if (!(await this.client.bucketExists(this.bucket))) {
      await this.client.makeBucket(this.bucket);
    }
  }

  async initiateMultipartUpload(
    objectKey: string,
    contentType: string,
  ): Promise<string> {
    return this.client.initiateNewMultipartUpload(this.bucket, objectKey, {
      'Content-Type': contentType,
    });
  }

  async getPresignedPartUrl(
    objectKey: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    return this.client.presignedUrl(
      'PUT',
      this.bucket,
      objectKey,
      this.urlExpirySeconds,
      {
        partNumber: String(partNumber),
        uploadId,
      },
    );
  }

  async completeMultipartUpload(
    objectKey: string,
    uploadId: string,
    parts: MultipartPart[],
  ): Promise<void> {
    await this.client.completeMultipartUpload(
      this.bucket,
      objectKey,
      uploadId,
      parts,
    );
  }

  async abortMultipartUpload(
    objectKey: string,
    uploadId: string,
  ): Promise<void> {
    await this.client.abortMultipartUpload(this.bucket, objectKey, uploadId);
  }

  async statObject(objectKey: string) {
    return this.client.statObject(this.bucket, objectKey);
  }

  async getObject(objectKey: string) {
    return this.client.getObject(this.bucket, objectKey);
  }

  async getObjectRange(objectKey: string, offset: number, length: number) {
    return this.client.getPartialObject(this.bucket, objectKey, offset, length);
  }

  async putObject(
    objectKey: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.client.putObject(this.bucket, objectKey, body, body.length, {
      'Content-Type': contentType,
    });
  }
}
