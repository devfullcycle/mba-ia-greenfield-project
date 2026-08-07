import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
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
import type { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

export interface ObjectRange {
  stream: Readable;
  contentLength: number;
  contentType: string;
  contentRange?: string;
  acceptRanges: string;
}

/**
 * Thin wrapper around the AWS S3 v3 client pointed at MinIO (S3 in prod).
 * Owns every interaction with the object storage: multipart presigned upload,
 * head, range reads for streaming, presigned download and thumbnail writes.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly presignExpiration: number;

  constructor(
    @Inject(storageConfig.KEY)
    config: ConfigType<typeof storageConfig>,
  ) {
    this.bucket = config.bucket;
    this.presignExpiration = config.presignExpiration;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
  }

  /** Creates the bucket if it does not exist yet (idempotent). */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err: any) {
      const status = err?.$metadata?.httpStatusCode;
      if (
        status === 404 ||
        err?.name === 'NotFound' ||
        err?.name === 'NoSuchBucket'
      ) {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
        this.logger.log(`Created bucket "${this.bucket}"`);
      } else {
        throw err;
      }
    }
  }

  /** Starts a multipart upload and returns the uploadId. */
  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const out = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!out.UploadId) {
      throw new Error('S3 did not return an UploadId for the multipart upload');
    }
    return out.UploadId;
  }

  /** Presigned URL the client uses to PUT a single part directly to storage. */
  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: this.presignExpiration },
    );
  }

  /** Finalizes the multipart upload from the parts the client reported. */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: UploadedPart[],
  ): Promise<void> {
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: ordered.map((p) => ({
            PartNumber: p.partNumber,
            ETag: p.etag,
          })),
        },
      }),
    );
  }

  /** Aborts an in-flight multipart upload (cleanup on failure/cancel). */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  /** Returns object size/type, or throws if it does not exist. */
  async headObject(
    key: string,
  ): Promise<{ contentLength: number; contentType: string }> {
    const out = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return {
      contentLength: out.ContentLength ?? 0,
      contentType: out.ContentType ?? 'application/octet-stream',
    };
  }

  /** True when the object exists in the bucket. */
  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads an object (optionally a byte range) for streaming. When `range` is
   * provided, the returned `contentRange` carries the `bytes start-end/total`
   * header used to answer with 206 Partial Content.
   */
  async getObjectRange(key: string, range?: string): Promise<ObjectRange> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range }),
    );
    return {
      stream: out.Body as Readable,
      contentLength: out.ContentLength ?? 0,
      contentType: out.ContentType ?? 'application/octet-stream',
      contentRange: out.ContentRange,
      acceptRanges: out.AcceptRanges ?? 'bytes',
    };
  }

  /** Presigned GET URL for a full-file download (offloads bytes to storage). */
  async presignDownloadUrl(key: string, filename?: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: filename
          ? `attachment; filename="${filename}"`
          : 'attachment',
      }),
      { expiresIn: this.presignExpiration },
    );
  }

  /** Presigned GET URL for inline access (e.g. the thumbnail image). */
  async presignGetUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: this.presignExpiration },
    );
  }

  /** Uploads a small object (e.g. the generated thumbnail). */
  async putObject(
    key: string,
    body: Buffer,
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

  /** Best-effort delete of a single object. */
  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
