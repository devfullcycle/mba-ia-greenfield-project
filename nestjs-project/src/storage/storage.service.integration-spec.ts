import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Readable } from 'node:stream';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('StorageService (integration)', () => {
  let service: StorageService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), StorageModule],
    }).compile();

    service = moduleRef.get(StorageService);
    // onModuleInit is not called automatically without init(); ensure the bucket
    await service.ensureBucket();
  });

  it('ensureBucket is idempotent (already created by minio-setup)', async () => {
    await expect(service.ensureBucket()).resolves.not.toThrow();
  });

  it('round-trips a multipart upload via presigned part URLs', async () => {
    const key = `test/${Date.now()}-roundtrip.bin`;
    const body = Buffer.from('hello world from streamtube storage test');

    const uploadId = await service.createMultipartUpload(
      key,
      'application/octet-stream',
    );
    expect(uploadId).toBeTruthy();

    const url = await service.presignUploadPart(key, uploadId, 1);
    expect(url).toContain('partNumber=1');

    const putRes = await fetch(url, { method: 'PUT', body });
    expect(putRes.ok).toBe(true);
    const etag = putRes.headers.get('etag');
    expect(etag).toBeTruthy();

    await service.completeMultipartUpload(key, uploadId, [
      { partNumber: 1, etag: etag as string },
    ]);

    const head = await service.headObject(key);
    expect(head.contentLength).toBe(body.length);

    await service.deleteObject(key);
  });

  it('reads a byte range for streaming (206 semantics)', async () => {
    const key = `test/${Date.now()}-range.bin`;
    const body = Buffer.from('0123456789ABCDEF');
    await service.putObject(key, body, 'application/octet-stream');

    const range = await service.getObjectRange(key, 'bytes=0-4');
    expect(range.contentLength).toBe(5);
    expect(range.contentRange).toMatch(/^bytes 0-4\/16$/);
    const bytes = await readStream(range.stream);
    expect(bytes.toString()).toBe('01234');

    await service.deleteObject(key);
  });

  it('presigns a download URL that returns the object', async () => {
    const key = `test/${Date.now()}-download.txt`;
    const body = Buffer.from('downloadable content');
    await service.putObject(key, body, 'text/plain');

    const url = await service.presignDownloadUrl(key, 'file.txt');
    const res = await fetch(url);
    expect(res.ok).toBe(true);
    const text = await res.text();
    expect(text).toBe('downloadable content');

    await service.deleteObject(key);
  });
});
