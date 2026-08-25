import {
  CreateBucketCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { StorageService } from './storage.service';

const client = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT ?? 'http://minio:9000',
  region: process.env.STORAGE_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? 'minioadmin',
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? 'minioadmin',
  },
  forcePathStyle: true,
});
const bucket = process.env.STORAGE_BUCKET_VIDEOS ?? 'videos';

async function ensureBucketExists(): Promise<void> {
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (err) {
    const code = (err as { name?: string }).name;
    if (code !== 'BucketAlreadyOwnedByYou' && code !== 'BucketAlreadyExists') {
      throw err;
    }
  }
}

describe('StorageService (integration)', () => {
  let service: StorageService;

  beforeAll(async () => {
    await ensureBucketExists();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
      ],
      providers: [StorageService],
    }).compile();

    service = moduleRef.get(StorageService);
  }, 30000);

  it('should round-trip a multipart upload and confirm the object exists', async () => {
    const key = `test/${Date.now()}-multipart.txt`;
    const { uploadId } = await service.createMultipartUpload(key, 'text/plain');
    expect(uploadId).toBeTruthy();

    const [{ url }] = await service.getUploadPartUrls(key, uploadId, 1);
    expect(url).toContain(key);

    const body = 'a'.repeat(1024);
    const putResponse = await fetch(url, { method: 'PUT', body });
    expect(putResponse.status).toBe(200);
    const etag = putResponse.headers.get('etag')!;
    expect(etag).toBeTruthy();

    await service.completeMultipartUpload(key, uploadId, [
      { part_number: 1, etag },
    ]);

    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    expect(head.ContentLength).toBe(body.length);

    const size = await service.getObjectSize(key);
    expect(size).toBe(body.length);
  }, 30000);

  it('should abort a multipart upload and leave no object behind', async () => {
    const key = `test/${Date.now()}-abort.txt`;
    const { uploadId } = await service.createMultipartUpload(key, 'text/plain');

    await service.abortMultipartUpload(key, uploadId);

    await expect(
      client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
    ).rejects.toThrow();
  }, 30000);

  it('should return a presigned GET URL that serves 206 Partial Content on a Range request', async () => {
    const key = `test/${Date.now()}-range.txt`;
    const { uploadId } = await service.createMultipartUpload(key, 'text/plain');
    const [{ url: putUrl }] = await service.getUploadPartUrls(key, uploadId, 1);
    const body = 'range-content-'.repeat(100);
    const putResponse = await fetch(putUrl, { method: 'PUT', body });
    const etag = putResponse.headers.get('etag')!;
    await service.completeMultipartUpload(key, uploadId, [
      { part_number: 1, etag },
    ]);

    const getUrl = await service.getPresignedGetUrl(key, { expiresIn: 60 });
    const rangeResponse = await fetch(getUrl, {
      headers: { Range: 'bytes=0-9' },
    });

    expect(rangeResponse.status).toBe(206);
  }, 30000);

  it('should return a presigned GET URL with attachment content-disposition', async () => {
    const key = `test/${Date.now()}-download.txt`;
    const { uploadId } = await service.createMultipartUpload(key, 'text/plain');
    const [{ url: putUrl }] = await service.getUploadPartUrls(key, uploadId, 1);
    const putResponse = await fetch(putUrl, { method: 'PUT', body: 'x' });
    const etag = putResponse.headers.get('etag')!;
    await service.completeMultipartUpload(key, uploadId, [
      { part_number: 1, etag },
    ]);

    const downloadUrl = await service.getPresignedGetUrl(key, {
      expiresIn: 60,
      responseContentDisposition: 'attachment; filename="video.txt"',
    });
    const response = await fetch(downloadUrl);

    expect(response.headers.get('content-disposition')).toContain('attachment');
  }, 30000);
});
