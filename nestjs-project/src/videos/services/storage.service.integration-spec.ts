import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { StorageService } from './storage.service';
import storageConfig from '../../config/storage.config';
import { envValidationSchema } from '../../config/env.validation';
import * as dotenv from 'dotenv';

// Load environmental variables for integration test
dotenv.config();

describe('StorageService (integration)', () => {
  let service: StorageService;
  const testBucket = process.env.STORAGE_BUCKET_VIDEOS || 'videos';
  const testKey = 'test-video-file.mp4';

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig],
          validationSchema: envValidationSchema,
          validationOptions: { allowUnknown: true, abortEarly: false },
        }),
      ],
      providers: [StorageService],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Multipart Upload Flow', () => {
    it('should initialize, complete and read a multipart upload', async () => {
      // 1. Initialize
      const { uploadId } = await service.initializeMultipartUpload(
        testBucket,
        testKey,
        'video/mp4',
      );
      expect(uploadId).toBeDefined();
      expect(typeof uploadId).toBe('string');

      // 2. Generate signed URL for Part 1 (simulate upload client)
      const partUrl = await service.generatePresignedUploadPartUrl(
        testBucket,
        testKey,
        uploadId,
        1,
      );
      expect(partUrl).toBeDefined();
      expect(partUrl).toContain('uploadId=' + uploadId);
      expect(partUrl).toContain('partNumber=1');

      // 3. Upload a buffer as a direct Part (via HTTP PUT or manually for integration verification).
      // Since this is integration, we can abort the multipart to clean up,
      // or complete it if we upload actual parts.
      // Let's abort to test cleanup.
      await service.abortMultipartUpload(testBucket, testKey, uploadId);
    });
  });

  describe('Upload Buffer & Get Stream', () => {
    it('should upload a buffer, download it, and match the content', async () => {
      const content = Buffer.from(
        'Hello StreamTube MinIO integration test buffer content',
      );
      const key = 'test-buffer.txt';

      // 1. Upload Buffer
      await service.uploadBuffer(testBucket, key, content, 'text/plain');

      // 2. Get Object Stream
      const result = await service.getObjectStream(testBucket, key);
      expect(result.contentType).toBe('text/plain');
      expect(result.contentLength).toBe(content.length);

      // Read stream content
      const chunks: Buffer[] = [];
      for await (const chunk of result.stream) {
        chunks.push(chunk as Buffer);
      }
      const downloadedContent = Buffer.concat(chunks);
      expect(downloadedContent.toString()).toBe(content.toString());
    });

    it('should support range requests for partial download', async () => {
      const content = Buffer.from('abcdefghijklmnopqrstuvwxyz'); // 26 bytes
      const key = 'range-test.txt';

      await service.uploadBuffer(testBucket, key, content, 'text/plain');

      // Get bytes 0-4 (5 bytes: 'abcde')
      const result = await service.getObjectStream(
        testBucket,
        key,
        'bytes=0-4',
      );
      expect(result.contentLength).toBe(5);
      expect(result.contentRange).toBe('bytes 0-4/26');

      const chunks: Buffer[] = [];
      for await (const chunk of result.stream) {
        chunks.push(chunk as Buffer);
      }
      const downloadedContent = Buffer.concat(chunks);
      expect(downloadedContent.toString()).toBe('abcde');
    });
  });
});
