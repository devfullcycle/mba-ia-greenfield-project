import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchUpload,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { attachmentDisposition } from './content-disposition.util';
import { S3_INTERNAL_CLIENT, S3_SIGNING_CLIENT } from './storage.constants';
import { MultipartUploadRejectedError } from './storage.errors';

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

export interface StoredObjectInfo {
  contentLength: number;
}

export interface PresignGetOptions {
  downloadFilename?: string;
}

@Injectable()
export class StorageService {
  constructor(
    @Inject(S3_INTERNAL_CLIENT) private readonly internalClient: S3Client,
    @Inject(S3_SIGNING_CLIENT) private readonly signingClient: S3Client,
    @Inject(storageConfig.KEY)
    private readonly storage: ConfigType<typeof storageConfig>,
  ) {}

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const result = await this.internalClient.send(
      new CreateMultipartUploadCommand({
        Bucket: this.storage.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    return result.UploadId!;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: UploadedPart[],
  ): Promise<void> {
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    try {
      await this.internalClient.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.storage.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: sorted.map((p) => ({
              PartNumber: p.partNumber,
              ETag: p.etag,
            })),
          },
        }),
      );
    } catch (error) {
      const status =
        error instanceof S3ServiceException
          ? error.$metadata.httpStatusCode
          : undefined;
      if (status !== undefined && status >= 400 && status < 500) {
        throw new MultipartUploadRejectedError(
          `${error instanceof Error ? error.name : 'Error'}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      throw error;
    }
  }

  /** Idempotent: aborting an upload that no longer exists is not an error. */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.internalClient.send(
        new AbortMultipartUploadCommand({
          Bucket: this.storage.bucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
    } catch (error) {
      if (error instanceof NoSuchUpload) {
        return;
      }
      throw error;
    }
  }

  async headObject(key: string): Promise<StoredObjectInfo | null> {
    try {
      const result = await this.internalClient.send(
        new HeadObjectCommand({ Bucket: this.storage.bucket, Key: key }),
      );
      return { contentLength: result.ContentLength ?? 0 };
    } catch (error) {
      if (error instanceof NotFound) {
        return null;
      }
      throw error;
    }
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.internalClient.send(
      new PutObjectCommand({
        Bucket: this.storage.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getObjectToFile(key: string, destinationPath: string): Promise<void> {
    const result = await this.internalClient.send(
      new GetObjectCommand({ Bucket: this.storage.bucket, Key: key }),
    );
    await pipeline(result.Body as Readable, createWriteStream(destinationPath));
  }

  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    return getSignedUrl(
      this.signingClient,
      new UploadPartCommand({
        Bucket: this.storage.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: this.storage.presignUploadTtlSeconds },
    );
  }

  /**
   * Presigned GET signed with the INTERNAL endpoint: for server-side readers
   * (the worker's ffprobe/ffmpeg) that run inside the Compose network and
   * cannot reach the browser-facing public endpoint.
   */
  async presignGetInternal(key: string): Promise<string> {
    return getSignedUrl(
      this.internalClient,
      new GetObjectCommand({ Bucket: this.storage.bucket, Key: key }),
      { expiresIn: this.storage.presignReadTtlSeconds },
    );
  }

  async presignGet(
    key: string,
    options: PresignGetOptions = {},
  ): Promise<string> {
    return getSignedUrl(
      this.signingClient,
      new GetObjectCommand({
        Bucket: this.storage.bucket,
        Key: key,
        ...(options.downloadFilename !== undefined && {
          ResponseContentDisposition: attachmentDisposition(
            options.downloadFilename,
          ),
        }),
      }),
      { expiresIn: this.storage.presignReadTtlSeconds },
    );
  }
}
