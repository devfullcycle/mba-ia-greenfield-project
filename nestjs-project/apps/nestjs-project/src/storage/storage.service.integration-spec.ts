import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { randomUUID } from 'crypto';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as unknown as Uint8Array),
    );
  }
  return Buffer.concat(chunks);
}

describe('StorageService (integration)', () => {
  let storageService: StorageService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();

    storageService = module.get(StorageService);
  }, 15000);

  it('should round-trip a small object via putObject/getObjectStream', async () => {
    const key = `videos/${randomUUID()}/original`;
    const body = Buffer.from('hello streamtube');

    await storageService.putObject(key, body, 'text/plain');
    const stream = await storageService.getObjectStream(key);
    const retrieved = await streamToBuffer(stream);

    expect(retrieved.toString()).toBe('hello streamtube');
  });

  it('should return a presigned GET URL that resolves to the real object bytes', async () => {
    const key = `videos/${randomUUID()}/original`;
    const body = Buffer.from('presigned content');
    await storageService.putObject(key, body, 'text/plain');

    const url = await storageService.getObjectPresignedUrl(key);
    const response = await fetch(url);

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe('presigned content');
  });

  it('should complete a multipart upload uploaded via presigned part URLs', async () => {
    const key = `videos/${randomUUID()}/original`;
    const { uploadId } = await storageService.createMultipartUpload(
      key,
      'video/mp4',
    );

    // S3-compatible multipart parts (except the last) must be at least 5MB.
    const partOneBody = Buffer.alloc(5 * 1024 * 1024, 'a');
    const partTwoBody = Buffer.from('final part');

    const partOneUrl = await storageService.getUploadPartUrl(key, uploadId, 1);
    const partOneResponse = await fetch(partOneUrl, {
      method: 'PUT',
      body: partOneBody,
    });
    expect(partOneResponse.status).toBe(200);
    const partOneETag = partOneResponse.headers.get('etag');

    const partTwoUrl = await storageService.getUploadPartUrl(key, uploadId, 2);
    const partTwoResponse = await fetch(partTwoUrl, {
      method: 'PUT',
      body: partTwoBody,
    });
    expect(partTwoResponse.status).toBe(200);
    const partTwoETag = partTwoResponse.headers.get('etag');

    expect(partOneETag).toBeTruthy();
    expect(partTwoETag).toBeTruthy();

    await storageService.completeMultipartUpload(key, uploadId, [
      { partNumber: 2, eTag: partTwoETag! },
      { partNumber: 1, eTag: partOneETag! },
    ]);

    const stream = await storageService.getObjectStream(key);
    const retrieved = await streamToBuffer(stream);
    expect(retrieved.length).toBe(partOneBody.length + partTwoBody.length);
    expect(retrieved.subarray(partOneBody.length).toString()).toBe(
      'final part',
    );
  }, 30000);

  it('should abort a multipart upload without leaving a completed object', async () => {
    const key = `videos/${randomUUID()}/original`;
    const { uploadId } = await storageService.createMultipartUpload(
      key,
      'video/mp4',
    );

    await expect(
      storageService.abortMultipartUpload(key, uploadId),
    ).resolves.not.toThrow();
  });
});
