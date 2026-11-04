import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';

export interface CompletedPartInput {
  partNumber: number;
  etag: string;
}

export interface ObjectHeadMetadata {
  contentLength: number;
  contentType?: string;
}

export interface ObjectStreamResult {
  stream: Readable;
  contentLength: number;
  contentRange?: string;
  contentType?: string;
}

function getS3ErrorInfo(error: unknown): { status?: number; name?: string } {
  if (typeof error === 'object' && error !== null) {
    const record = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return {
      status: record.$metadata?.httpStatusCode,
      name: record.name,
    };
  }
  return {};
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client;
  private bucketVerified = false;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {
    this.s3Client = new S3Client({
      endpoint: this.config.endpoint,
      region: this.config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.accessKey,
        secretAccessKey: this.config.secretKey,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureBucketExists();
    } catch (error) {
      this.logger.warn(
        `Could not verify bucket "${this.config.bucket}" at startup: ${(error as Error).message}`,
      );
    }
  }

  async ensureBucketExists(): Promise<void> {
    if (this.bucketVerified) {
      return;
    }

    try {
      await this.s3Client.send(
        new HeadBucketCommand({ Bucket: this.config.bucket }),
      );
      this.bucketVerified = true;
    } catch (error: unknown) {
      const { status, name } = getS3ErrorInfo(error);
      if (status === 404 || name === 'NotFound' || name === 'NoSuchBucket') {
        try {
          await this.s3Client.send(
            new CreateBucketCommand({ Bucket: this.config.bucket }),
          );
        } catch (createErr: unknown) {
          const { name: createName } = getS3ErrorInfo(createErr);
          if (
            createName !== 'BucketAlreadyOwnedByYou' &&
            createName !== 'BucketAlreadyExists'
          ) {
            throw createErr;
          }
        }
        this.bucketVerified = true;
        return;
      }
      throw error;
    }
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    await this.ensureBucketExists();
    const response = await this.s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!response.UploadId) {
      throw new Error('S3 did not return an UploadId for multipart upload');
    }
    return response.UploadId;
  }

  async getPresignedUploadPartUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresInSeconds?: number,
  ): Promise<string> {
    const command = new UploadPartCommand({
      Bucket: this.config.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    return getSignedUrl(this.s3Client, command, {
      expiresIn: expiresInSeconds ?? this.config.presignedUrlExpirationSeconds,
    });
  }

  async getPresignedPutUrl(
    key: string,
    contentType: string,
    expiresInSeconds?: number,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.s3Client, command, {
      expiresIn: expiresInSeconds ?? this.config.presignedUrlExpirationSeconds,
    });
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPartInput[],
  ): Promise<void> {
    const sortedParts = [...parts]
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((part) => ({
        PartNumber: part.partNumber,
        ETag: part.etag,
      }));

    await this.s3Client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: sortedParts,
        },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.s3Client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async putObject(
    key: string,
    body: Buffer | Readable,
    contentType: string,
  ): Promise<void> {
    await this.ensureBucketExists();
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async headObject(key: string): Promise<ObjectHeadMetadata | null> {
    try {
      const response = await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      );
      return {
        contentLength: Number(response.ContentLength ?? 0),
        contentType: response.ContentType,
      };
    } catch (error: unknown) {
      const { status, name } = getS3ErrorInfo(error);
      if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }

  async getObjectStream(
    key: string,
    range?: { start: number; end: number },
  ): Promise<ObjectStreamResult> {
    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }),
    );

    const fallbackLength = range ? range.end - range.start + 1 : 0;

    return {
      stream: response.Body as Readable,
      contentLength: Number(response.ContentLength ?? fallbackLength),
      contentRange: response.ContentRange,
      contentType: response.ContentType,
    };
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }),
    );
  }
}
