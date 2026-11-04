import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('StorageService (integration — MinIO)', () => {
  let moduleRef: TestingModule;
  let storageService: StorageService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig],
        }),
        StorageModule,
      ],
    }).compile();

    await moduleRef.init();
    storageService = moduleRef.get(StorageService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('uploads an object, reads its head metadata, streams a byte range, and deletes it', async () => {
    const key = `test-objects/${Date.now()}-sample.bin`;
    const payload = Buffer.from(
      '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
      'utf-8',
    );

    await storageService.putObject(key, payload, 'application/octet-stream');

    const head = await storageService.headObject(key);
    expect(head).not.toBeNull();
    expect(head!.contentLength).toBe(payload.length);

    const ranged = await storageService.getObjectStream(key, {
      start: 10,
      end: 19,
    });
    const rangedBytes = await streamToBuffer(ranged.stream);
    expect(rangedBytes.toString('utf-8')).toBe('abcdefghij');
    expect(ranged.contentLength).toBe(10);

    await storageService.deleteObject(key);
    const afterDelete = await storageService.headObject(key);
    expect(afterDelete).toBeNull();
  });

  it('completes a multipart upload using presigned part URLs directly against MinIO', async () => {
    const key = `test-multipart/${Date.now()}-video.mp4`;
    const uploadId = await storageService.createMultipartUpload(
      key,
      'video/mp4',
    );
    expect(uploadId).toBeDefined();

    const partUrl = await storageService.getPresignedUploadPartUrl(
      key,
      uploadId,
      1,
    );
    const partPayload = Buffer.alloc(64 * 1024, 0x41); // 64KB of 'A'

    const putResponse = await fetch(partUrl, {
      method: 'PUT',
      body: partPayload,
    });
    expect(putResponse.ok).toBe(true);
    const etag = putResponse.headers.get('etag');
    expect(etag).toBeTruthy();

    await storageService.completeMultipartUpload(key, uploadId, [
      { partNumber: 1, etag: etag! },
    ]);

    const head = await storageService.headObject(key);
    expect(head).not.toBeNull();
    expect(head!.contentLength).toBe(partPayload.length);

    await storageService.deleteObject(key);
  });
});
