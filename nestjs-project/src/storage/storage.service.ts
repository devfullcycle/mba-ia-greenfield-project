import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Readable } from 'stream';
import storageConfig from '../config/storage.config';
import { S3_INTERNAL_CLIENT, S3_PUBLIC_CLIENT } from './storage.constants';
import { isUploadGone, toStorageError } from './storage.errors';
import type {
  ObjectHead,
  ObjectStream,
  PresignedPart,
  UploadedPart,
} from './storage.types';

/**
 * Single gateway to object storage. Server-side operations use the internal
 * client (Docker network); only upload-part URLs handed to external clients
 * are signed with the public client, since signatures are host-bound.
 */
@Injectable()
export class StorageService {
  private readonly bucket: string;

  constructor(
    @Inject(S3_INTERNAL_CLIENT) private readonly internalClient: S3Client,
    @Inject(S3_PUBLIC_CLIENT) private readonly publicClient: S3Client,
    @Inject(storageConfig.KEY)
    config: ConfigType<typeof storageConfig>,
  ) {
    this.bucket = config.bucket;
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const { UploadId } = await this.run(() =>
      this.internalClient.send(
        new CreateMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          ContentType: contentType,
        }),
      ),
    );
    return UploadId!;
  }

  async presignUploadParts(
    key: string,
    uploadId: string,
    partNumbers: number[],
    expiresIn: number,
  ): Promise<PresignedPart[]> {
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await getSignedUrl(
          this.publicClient,
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
          }),
          { expiresIn },
        ),
      })),
    );
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: UploadedPart[],
  ): Promise<void> {
    await this.run(() =>
      this.internalClient.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map(({ partNumber, etag }) => ({
              PartNumber: partNumber,
              ETag: etag,
            })),
          },
        }),
      ),
    );
  }

  /**
   * Idempotent: an upload that is already gone (aborted before, completed, or
   * expired by the stale-uploads sweep) counts as aborted.
   */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.internalClient.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
    } catch (err) {
      if (isUploadGone(err)) return;
      throw toStorageError(err);
    }
  }

  /** Returns the object body as an unbuffered stream; the caller must consume or destroy it. */
  async getObjectStream(key: string, range?: string): Promise<ObjectStream> {
    const output = await this.run(() =>
      this.internalClient.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range }),
      ),
    );
    return {
      body: output.Body as Readable,
      contentLength: output.ContentLength ?? 0,
      contentRange: output.ContentRange,
      contentType: output.ContentType,
    };
  }

  async headObject(key: string): Promise<ObjectHead> {
    const output = await this.run(() =>
      this.internalClient.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      ),
    );
    return {
      contentLength: output.ContentLength ?? 0,
      contentType: output.ContentType,
      lastModified: output.LastModified,
    };
  }

  /** Internal-network GET URL, meant for in-cluster consumers such as ffprobe. */
  async presignInternalGet(key: string, expiresIn: number): Promise<string> {
    return getSignedUrl(
      this.internalClient,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.run(() =>
      this.internalClient.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      ),
    );
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (err) {
      throw toStorageError(err);
    }
  }
}
