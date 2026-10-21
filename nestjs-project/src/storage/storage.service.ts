import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';

const DEFAULT_URL_EXPIRATION_SECONDS = 3600;

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

export interface OpenMultipartUpload {
  key: string;
  uploadId: string;
  initiated?: Date;
}

export interface ObjectHead {
  contentLength: number;
  contentType?: string;
}

export interface PresignGetOptions {
  download?: boolean;
  filename?: string;
  expiresIn?: number;
}

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly signer: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {
    this.bucket = config.bucket;
    this.client = this.createClient(config.endpoint);
    // Presigned URLs are consumed by the browser, so they are signed against
    // the public endpoint (the host is part of the SigV4 signature).
    this.signer = this.createClient(config.publicEndpoint);
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const { UploadId } = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    return UploadId as string;
  }

  presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn = DEFAULT_URL_EXPIRATION_SECONDS,
  ): Promise<string> {
    return getSignedUrl(
      this.signer,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn },
    );
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: UploadedPart[],
  ): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
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

  async listMultipartUploads(prefix?: string): Promise<OpenMultipartUpload[]> {
    const uploads: OpenMultipartUpload[] = [];
    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    do {
      const page = await this.client.send(
        new ListMultipartUploadsCommand({
          Bucket: this.bucket,
          Prefix: prefix,
          KeyMarker: keyMarker,
          UploadIdMarker: uploadIdMarker,
        }),
      );
      for (const upload of page.Uploads ?? []) {
        uploads.push({
          key: upload.Key as string,
          uploadId: upload.UploadId as string,
          initiated: upload.Initiated,
        });
      }
      keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
      uploadIdMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined;
    } while (keyMarker);
    return uploads;
  }

  presignGetUrl(key: string, options: PresignGetOptions = {}): Promise<string> {
    const { download = false, filename, expiresIn } = options;
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: download
          ? this.attachmentDisposition(filename)
          : undefined,
      }),
      { expiresIn: expiresIn ?? DEFAULT_URL_EXPIRATION_SECONDS },
    );
  }

  /**
   * Presigned GET for processes inside the Compose network (the worker), signed
   * against the internal endpoint. Do not hand this URL to browsers.
   */
  presignInternalGetUrl(
    key: string,
    expiresIn = DEFAULT_URL_EXPIRATION_SECONDS,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  async putObject(
    key: string,
    body: Buffer | Uint8Array,
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

  /** Returns `null` when the object does not exist. */
  async headObject(key: string): Promise<ObjectHead | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        contentLength: head.ContentLength ?? 0,
        contentType: head.ContentType,
      };
    } catch (error) {
      if (error instanceof NotFound || this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  private createClient(endpoint: string): S3Client {
    return new S3Client({
      endpoint,
      region: this.config.region,
      forcePathStyle: this.config.forcePathStyle,
      credentials: {
        accessKeyId: this.config.accessKey,
        secretAccessKey: this.config.secretKey,
      },
      // Keep presigned URLs free of flexible-checksum query params, which a
      // browser PUT would have to reproduce.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  private isNotFound(error: unknown): boolean {
    const e = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
  }

  private attachmentDisposition(filename?: string): string {
    if (!filename) {
      return 'attachment';
    }
    const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  }
}
