import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
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
import { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface ObjectRange {
  stream: Readable;
  contentLength: number;
  contentType: string;
  contentRange?: string;
}

export interface ObjectHead {
  contentLength: number;
  contentType: string;
}

@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly presignExpiration: number;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {
    this.bucket = config.bucket;
    this.presignExpiration = config.presignExpiration;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
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

  onModuleDestroy(): void {
    // Release the S3 client's keep-alive sockets so the process can exit
    // cleanly (otherwise idle connections to MinIO keep the event loop alive).
    this.client.destroy();
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      this.logger.log(`Creating bucket "${this.bucket}"`);
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!result.UploadId) {
      throw new Error('Storage did not return an UploadId');
    }
    return result.UploadId;
  }

  async getPresignedPartUrl(
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

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts
            .slice()
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ ETag: p.etag, PartNumber: p.partNumber })),
        },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async getObjectRange(key: string, range?: string): Promise<ObjectRange> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(range ? { Range: range } : {}),
      }),
    );
    return {
      stream: result.Body as Readable,
      contentLength: result.ContentLength ?? 0,
      contentType: result.ContentType ?? 'application/octet-stream',
      contentRange: result.ContentRange,
    };
  }

  async headObject(key: string): Promise<ObjectHead> {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return {
      contentLength: result.ContentLength ?? 0,
      contentType: result.ContentType ?? 'application/octet-stream',
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
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
