import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

describe('StorageService (integration, real MinIO)', () => {
  let moduleRef: TestingModule;
  let service: StorageService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(StorageService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('ensureBucket is idempotent', async () => {
    await expect(service.ensureBucket()).resolves.toBeUndefined();
    await expect(service.ensureBucket()).resolves.toBeUndefined();
  });

  it('round-trips an object through the multipart presigned flow', async () => {
    const key = `test/${Date.now()}-multipart.bin`;
    const payload = Buffer.from('hello-streamtube');

    const uploadId = await service.createMultipartUpload(
      key,
      'application/octet-stream',
    );
    const url = await service.getPresignedPartUrl(key, uploadId, 1);

    const putResponse = await fetch(url, { method: 'PUT', body: payload });
    expect(putResponse.ok).toBe(true);
    const etag = putResponse.headers.get('etag');
    expect(etag).toBeTruthy();

    await service.completeMultipartUpload(key, uploadId, [
      { partNumber: 1, etag: etag as string },
    ]);

    const { stream, contentLength } = await service.getObjectRange(key);
    const body = await streamToBuffer(stream);
    expect(body.equals(payload)).toBe(true);
    expect(contentLength).toBe(payload.length);

    await service.deleteObject(key);
  });

  it('returns the requested byte range with a Content-Range', async () => {
    const key = `test/${Date.now()}-range.txt`;
    await service.putObject(key, Buffer.from('ABCDEFGHIJ'), 'text/plain');

    const { stream, contentRange } = await service.getObjectRange(
      key,
      'bytes=0-4',
    );
    const body = await streamToBuffer(stream);
    expect(body.toString()).toBe('ABCDE');
    expect(body.length).toBe(5);
    expect(contentRange).toContain('bytes 0-4/10');

    await service.deleteObject(key);
  });

  it('putObject + headObject for a thumbnail', async () => {
    const key = `test/${Date.now()}-thumb.jpg`;
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    await service.putObject(key, jpeg, 'image/jpeg');

    const head = await service.headObject(key);
    expect(head.contentLength).toBe(jpeg.length);
    expect(head.contentType).toBe('image/jpeg');

    await service.deleteObject(key);
  });

  it('aborts a multipart upload', async () => {
    const key = `test/${Date.now()}-abort.bin`;
    const uploadId = await service.createMultipartUpload(
      key,
      'application/octet-stream',
    );
    await expect(
      service.abortMultipartUpload(key, uploadId),
    ).resolves.toBeUndefined();
  });
});
