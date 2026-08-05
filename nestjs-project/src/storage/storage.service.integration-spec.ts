import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { StorageService } from './storage.service';

describe('StorageService (integration)', () => {
  let service: StorageService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig],
        }),
      ],
      providers: [StorageService],
    }).compile();

    service = module.get<StorageService>(StorageService);
    await service.onModuleInit();
  });

  it('should generate a presigned upload URL and allow uploading a file', async () => {
    const presignedUrl = await service.getPresignedUploadUrl(
      'videos',
      'test/sample.txt',
    );
    expect(presignedUrl).toContain('http://');
    expect(presignedUrl).toContain('videos/test/sample.txt');

    const res = await fetch(presignedUrl, {
      method: 'PUT',
      body: 'Hello MinIO',
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(res.status).toBe(200);

    const head = await service.headObject('videos', 'test/sample.txt');
    expect(head.ContentLength).toBe(Buffer.byteLength('Hello MinIO'));
  });

  it('should retrieve object stream', async () => {
    const { stream, contentLength } = await service.getObjectStream(
      'videos',
      'test/sample.txt',
    );
    expect(contentLength).toBe(Buffer.byteLength('Hello MinIO'));

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const content = Buffer.concat(chunks).toString('utf-8');
    expect(content).toBe('Hello MinIO');
  });

  it('should upload a buffer directly', async () => {
    await service.uploadBuffer(
      'thumbnails',
      'thumb/sample.jpg',
      Buffer.from('dummy image data'),
      'image/jpeg',
    );

    const head = await service.headObject('thumbnails', 'thumb/sample.jpg');
    expect(head.ContentLength).toBe(Buffer.byteLength('dummy image data'));
  });

  it('should retrieve a byte range of an object', async () => {
    const { stream, contentRange } = await service.getObjectStream(
      'videos',
      'test/sample.txt',
      'bytes=0-4',
    );

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const content = Buffer.concat(chunks).toString('utf-8');
    expect(content).toBe('Hello');
    expect(contentRange).toContain('bytes 0-4');
  });

  it('should be idempotent when buckets already exist', async () => {
    await expect(service.ensureBucketsExist()).resolves.not.toThrow();
  });
});
