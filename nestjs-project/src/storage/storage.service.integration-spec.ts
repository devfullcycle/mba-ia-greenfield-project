import { DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'crypto';
import type { Readable } from 'stream';
import storageConfig from '../config/storage.config';
import { S3_INTERNAL_CLIENT, S3_PUBLIC_CLIENT } from './storage.constants';
import {
  StorageInvalidPartsError,
  StorageInvalidRangeError,
  StorageNotFoundError,
} from './storage.errors';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

const MIN_PART_SIZE = 5 * 1024 * 1024; // S3 minimum for every part except the last
const PRESIGN_TTL_SECONDS = 300;

const putPart = async (
  url: string,
  chunk: Buffer,
): Promise<{ ok: boolean; etag: string | null }> => {
  const response = await fetch(url, {
    method: 'PUT',
    body: new Uint8Array(chunk),
  });
  return { ok: response.ok, etag: response.headers.get('etag') };
};

const readAll = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

describe('StorageService (integration)', () => {
  let module: TestingModule;
  let storage: StorageService;
  let internalClient: S3Client;
  const createdKeys: string[] = [];

  const newKey = (): string => {
    const key = `test/storage/${randomUUID()}`;
    createdKeys.push(key);
    return key;
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), StorageModule],
    }).compile();
    storage = module.get(StorageService);
    internalClient = module.get(S3_INTERNAL_CLIENT);
  });

  afterAll(async () => {
    const bucket = process.env.S3_BUCKET;
    await Promise.all(
      createdKeys.map((Key) =>
        internalClient.send(new DeleteObjectCommand({ Bucket: bucket, Key })),
      ),
    );
    await module.close();
  });

  it('should run against the isolated test bucket', () => {
    expect(process.env.S3_BUCKET).toBe('streamtube-test');
  });

  describe('multipart upload via presigned URLs', () => {
    it('should assemble an object with the total size of the uploaded parts', async () => {
      const key = newKey();
      const parts = [randomBytes(MIN_PART_SIZE), randomBytes(1024)];
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
      const urls = await storage.presignUploadParts(
        key,
        uploadId,
        [1, 2],
        PRESIGN_TTL_SECONDS,
      );

      const uploaded = await Promise.all(
        urls.map(async ({ partNumber, url }) => {
          const { ok, etag } = await putPart(url, parts[partNumber - 1]);
          expect(ok).toBe(true);
          expect(etag).toBeTruthy();
          return { partNumber, etag: etag! };
        }),
      );
      await storage.completeMultipartUpload(key, uploadId, uploaded);

      const head = await storage.headObject(key);
      expect(head.contentLength).toBe(MIN_PART_SIZE + 1024);
      expect(head.contentType).toBe('video/mp4');
    });

    it('should map an invalid ETag on complete to StorageInvalidPartsError', async () => {
      const key = newKey();
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
      const [{ url }] = await storage.presignUploadParts(
        key,
        uploadId,
        [1],
        PRESIGN_TTL_SECONDS,
      );
      await putPart(url, randomBytes(1024));

      await expect(
        storage.completeMultipartUpload(key, uploadId, [
          { partNumber: 1, etag: '"00000000000000000000000000000000"' },
        ]),
      ).rejects.toBeInstanceOf(StorageInvalidPartsError);

      await storage.abortMultipartUpload(key, uploadId);
    });

    it('should make later part uploads fail after abortMultipartUpload', async () => {
      const key = newKey();
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
      const [{ url }] = await storage.presignUploadParts(
        key,
        uploadId,
        [1],
        PRESIGN_TTL_SECONDS,
      );

      await storage.abortMultipartUpload(key, uploadId);
      const { ok } = await putPart(url, randomBytes(1024));

      expect(ok).toBe(false);
    });

    it('should treat aborting an already-aborted multipart upload as success', async () => {
      const key = newKey();
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
      await storage.abortMultipartUpload(key, uploadId);

      await expect(
        storage.abortMultipartUpload(key, uploadId),
      ).resolves.toBeUndefined();
    });

    it('should still map an unknown UploadId on complete to StorageInvalidPartsError', async () => {
      const key = newKey();
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
      await storage.abortMultipartUpload(key, uploadId);

      await expect(
        storage.completeMultipartUpload(key, uploadId, [
          { partNumber: 1, etag: '"00000000000000000000000000000000"' },
        ]),
      ).rejects.toBeInstanceOf(StorageInvalidPartsError);
    });
  });

  describe('object reads', () => {
    const size = 1000;
    let key: string;
    let content: Buffer;

    beforeAll(async () => {
      key = newKey();
      content = randomBytes(size);
      await storage.putObject(key, content, 'application/octet-stream');
    });

    it('should stream exactly the requested range with its Content-Range', async () => {
      const result = await storage.getObjectStream(key, 'bytes=0-99');
      const body = await readAll(result.body);

      expect(body).toHaveLength(100);
      expect(body.equals(content.subarray(0, 100))).toBe(true);
      expect(result.contentRange).toBe(`bytes 0-99/${size}`);
      expect(result.contentLength).toBe(100);
    });

    it('should map a range beyond the object size to StorageInvalidRangeError', async () => {
      await expect(
        storage.getObjectStream(key, `bytes=${size + 10}-${size + 20}`),
      ).rejects.toBeInstanceOf(StorageInvalidRangeError);
    });

    it('should map a missing key to StorageNotFoundError on get and head', async () => {
      const missing = `test/storage/missing-${randomUUID()}`;
      await expect(storage.getObjectStream(missing)).rejects.toBeInstanceOf(
        StorageNotFoundError,
      );
      await expect(storage.headObject(missing)).rejects.toBeInstanceOf(
        StorageNotFoundError,
      );
    });

    it('should presign an internal GET URL that serves the object', async () => {
      const url = await storage.presignInternalGet(key, PRESIGN_TTL_SECONDS);
      const response = await fetch(url);

      expect(new URL(url).host).toBe('minio:9000');
      expect(Buffer.from(await response.arrayBuffer()).equals(content)).toBe(
        true,
      );
    });
  });
});

describe('StorageService endpoint topology', () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), StorageModule],
    })
      .overrideProvider(storageConfig.KEY)
      .useValue({
        endpoint: 'http://minio:9000',
        publicEndpoint: 'http://public.streamtube.test:9000',
        region: 'us-east-1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
        bucket: 'streamtube-test',
      })
      .compile();
  });

  afterAll(async () => {
    await module.close();
  });

  it('should sign part URLs with the public host', async () => {
    const storage = module.get(StorageService);
    const [{ url }] = await storage.presignUploadParts(
      'any/key',
      'upload-id',
      [1],
      PRESIGN_TTL_SECONDS,
    );

    expect(new URL(url).host).toBe('public.streamtube.test:9000');
  });

  it('should point the internal (server-side) client at S3_ENDPOINT and the public one at S3_PUBLIC_ENDPOINT', async () => {
    const internal = module.get<S3Client>(S3_INTERNAL_CLIENT);
    const publicClient = module.get<S3Client>(S3_PUBLIC_CLIENT);

    const internalEndpoint = await internal.config.endpoint!();
    const publicEndpoint = await publicClient.config.endpoint!();

    expect(internalEndpoint.hostname).toBe('minio');
    expect(publicEndpoint.hostname).toBe('public.streamtube.test');
  });
});
