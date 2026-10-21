import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'crypto';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

const MIN_PART_SIZE = 5 * 1024 * 1024;

describe('StorageService (integration)', () => {
  let module: TestingModule;
  let storage: StorageService;
  const prefix = `test/${randomUUID()}`;
  const createdKeys: string[] = [];

  const newKey = (name: string) => {
    const key = `${prefix}/${name}`;
    createdKeys.push(key);
    return key;
  };

  const uploadParts = async (key: string, uploadId: string, parts: Buffer[]) =>
    Promise.all(
      parts.map(async (body, index) => {
        const url = await storage.presignUploadPart(key, uploadId, index + 1);
        const response = await fetch(url, {
          method: 'PUT',
          body: new Uint8Array(body),
        });
        expect(response.status).toBe(200);
        return { partNumber: index + 1, etag: response.headers.get('etag')! };
      }),
    );

  beforeAll(async () => {
    // Tests run inside the container, where the browser-facing endpoint is
    // not reachable; sign against the internal host instead.
    process.env.STORAGE_PUBLIC_ENDPOINT = process.env.STORAGE_ENDPOINT;
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();
    storage = module.get(StorageService);
  });

  afterAll(async () => {
    await Promise.all(createdKeys.map((key) => storage.deleteObject(key)));
    await module.close();
  });

  describe('multipart upload', () => {
    it('should complete a multipart upload and make the object readable via presigned GET', async () => {
      const key = newKey('multipart.bin');
      const parts = [randomBytes(MIN_PART_SIZE), randomBytes(1024)];
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');

      const uploaded = await uploadParts(key, uploadId, parts);
      await storage.completeMultipartUpload(key, uploadId, uploaded);

      const response = await fetch(await storage.presignGetUrl(key));
      expect(response.status).toBe(200);
      const body = Buffer.from(await response.arrayBuffer());
      expect(body.equals(Buffer.concat(parts))).toBe(true);
    });

    it('should return the ETag header when a part is PUT to the presigned URL', async () => {
      const key = newKey('etag.bin');
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');

      const url = await storage.presignUploadPart(key, uploadId, 1);
      const response = await fetch(url, {
        method: 'PUT',
        body: new Uint8Array(randomBytes(1024)),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('etag')).toBeTruthy();
      await storage.abortMultipartUpload(key, uploadId);
    });

    it('should remove an aborted upload from the open uploads listing', async () => {
      const key = newKey('abort.bin');
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
      const before = await storage.listMultipartUploads(prefix);
      expect(before.map((u) => u.uploadId)).toContain(uploadId);

      await storage.abortMultipartUpload(key, uploadId);

      const after = await storage.listMultipartUploads(prefix);
      expect(after.map((u) => u.uploadId)).not.toContain(uploadId);
    });
  });

  describe('presigned GET', () => {
    it('should answer a Range request with 206 and the requested bytes', async () => {
      const key = newKey('range.bin');
      await storage.putObject(key, randomBytes(1024), 'video/mp4');

      const response = await fetch(await storage.presignGetUrl(key), {
        headers: { Range: 'bytes=0-99' },
      });

      expect(response.status).toBe(206);
      expect((await response.arrayBuffer()).byteLength).toBe(100);
    });

    it('should return an attachment Content-Disposition with the requested filename on download', async () => {
      const key = newKey('download.bin');
      await storage.putObject(key, randomBytes(64), 'video/mp4');

      const url = await storage.presignGetUrl(key, {
        download: true,
        filename: 'my video.mp4',
      });
      const response = await fetch(url);

      expect(response.status).toBe(200);
      const disposition = response.headers.get('content-disposition')!;
      expect(disposition).toContain('attachment');
      expect(disposition).toContain('my video.mp4');
    });
  });

  describe('objects', () => {
    it('should report an object as missing after deleteObject', async () => {
      const key = newKey('delete.bin');
      await storage.putObject(key, randomBytes(16), 'video/mp4');
      expect(await storage.headObject(key)).toEqual({
        contentLength: 16,
        contentType: 'video/mp4',
      });

      await storage.deleteObject(key);

      expect(await storage.headObject(key)).toBeNull();
    });
  });
});
