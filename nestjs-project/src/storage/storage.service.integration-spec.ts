import { randomUUID } from 'crypto';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import { S3_INTERNAL_CLIENT } from './storage.constants';
import { MultipartUploadRejectedError } from './storage.errors';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

const PART_BODY = Buffer.alloc(1024 * 1024, 'a');

function baseStorageConfig() {
  return storageConfig();
}

async function buildModule(publicEndpoint: string): Promise<TestingModule> {
  const cfg = { ...baseStorageConfig(), publicEndpoint };
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
      StorageModule,
    ],
  })
    .overrideProvider(storageConfig.KEY)
    .useValue(cfg)
    .compile();
}

describe('StorageService (integration)', () => {
  const createdKeys: string[] = [];
  let reachable: { module: TestingModule; service: StorageService };
  let remote: { module: TestingModule; service: StorageService };
  let internalClient: S3Client;

  beforeAll(async () => {
    // From inside the test container the "public" endpoint must be a host we
    // can actually fetch, so the reachable module signs with the internal one.
    const internalEndpoint = baseStorageConfig().endpoint;
    const reachableModule = await buildModule(internalEndpoint);
    reachable = {
      module: reachableModule,
      service: reachableModule.get(StorageService),
    };
    internalClient = reachableModule.get<S3Client>(S3_INTERNAL_CLIENT);

    const remoteModule = await buildModule('http://public.example.test:8333');
    remote = {
      module: remoteModule,
      service: remoteModule.get(StorageService),
    };
  });

  afterAll(async () => {
    const { bucket } = baseStorageConfig();
    await Promise.all(
      createdKeys.map((key) =>
        internalClient.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        ),
      ),
    );
    await reachable.module.close();
    await remote.module.close();
  });

  function newKey(): string {
    const key = `test/${randomUUID()}/original.mp4`;
    createdKeys.push(key);
    return key;
  }

  async function uploadObject(key: string): Promise<void> {
    const uploadId = await reachable.service.createMultipartUpload(
      key,
      'video/mp4',
    );
    const url = await reachable.service.presignUploadPart(key, uploadId, 1);
    const response = await fetch(url, { method: 'PUT', body: PART_BODY });
    expect(response.status).toBe(200);
    const etag = response.headers.get('etag')!;
    await reachable.service.completeMultipartUpload(key, uploadId, [
      { partNumber: 1, etag },
    ]);
  }

  it('should complete a multipart upload sent through a presigned part URL', async () => {
    const key = newKey();

    await uploadObject(key);

    const info = await reachable.service.headObject(key);
    expect(info).toEqual({ contentLength: PART_BODY.length });
  });

  it('should return null from headObject when the object does not exist', async () => {
    const info = await reachable.service.headObject(
      `test/${randomUUID()}/missing.mp4`,
    );

    expect(info).toBeNull();
  });

  it('should serve a presigned GET URL and honour the Range header', async () => {
    const key = newKey();
    await uploadObject(key);

    const url = await reachable.service.presignGet(key);
    const full = await fetch(url);
    const partial = await fetch(url, { headers: { Range: 'bytes=0-99' } });

    expect(full.status).toBe(200);
    expect(partial.status).toBe(206);
    expect((await partial.arrayBuffer()).byteLength).toBe(100);
  });

  it('should sign presignGetInternal URLs with the internal endpoint host', async () => {
    const key = newKey();
    await uploadObject(key);
    const internalHost = new URL(baseStorageConfig().endpoint).host;

    const url = await reachable.service.presignGetInternal(key);
    const response = await fetch(url);

    expect(new URL(url).host).toBe(internalHost);
    expect(response.status).toBe(200);
  });

  it('should add an attachment Content-Disposition when downloadFilename is given', async () => {
    const key = newKey();
    await uploadObject(key);

    const url = await reachable.service.presignGet(key, {
      downloadFilename: 'clip.mp4',
    });
    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="clip.mp4"',
    );
  });

  it('should write the object to a local file with getObjectToFile', async () => {
    const key = newKey();
    await uploadObject(key);
    const dir = await mkdtemp(join(tmpdir(), 'storage-spec-'));

    try {
      const destination = join(dir, 'video.mp4');
      await reachable.service.getObjectToFile(key, destination);

      const written = await readFile(destination);
      expect(written.equals(PART_BODY)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('should store a small object with putObject', async () => {
    const key = `test/${randomUUID()}/thumbnail.jpg`;
    createdKeys.push(key);

    await reachable.service.putObject(
      key,
      Buffer.from('jpg-bytes'),
      'image/jpeg',
    );

    const info = await reachable.service.headObject(key);
    expect(info).toEqual({ contentLength: 9 });
  });

  it('should reject completing an upload whose part ETag is wrong with a typed error', async () => {
    const key = newKey();
    const uploadId = await reachable.service.createMultipartUpload(
      key,
      'video/mp4',
    );
    const url = await reachable.service.presignUploadPart(key, uploadId, 1);
    await fetch(url, { method: 'PUT', body: PART_BODY });

    await expect(
      reachable.service.completeMultipartUpload(key, uploadId, [
        { partNumber: 1, etag: '"00000000000000000000000000000000"' },
      ]),
    ).rejects.toThrow(MultipartUploadRejectedError);
    await reachable.service.abortMultipartUpload(key, uploadId);
  });

  it('should reject completing an upload id that does not exist with a typed error', async () => {
    const key = newKey();

    await expect(
      reachable.service.completeMultipartUpload(key, 'no-such-upload', [
        { partNumber: 1, etag: '"abc"' },
      ]),
    ).rejects.toThrow(MultipartUploadRejectedError);
  });

  it('should treat aborting an upload that is already gone as a success', async () => {
    const key = newKey();
    const uploadId = await reachable.service.createMultipartUpload(
      key,
      'video/mp4',
    );
    await reachable.service.abortMultipartUpload(key, uploadId);

    await expect(
      reachable.service.abortMultipartUpload(key, uploadId),
    ).resolves.toBeUndefined();
  });

  it('should abort a multipart upload so its part URL stops working', async () => {
    const key = newKey();
    const uploadId = await reachable.service.createMultipartUpload(
      key,
      'video/mp4',
    );
    await reachable.service.abortMultipartUpload(key, uploadId);

    const url = await reachable.service.presignUploadPart(key, uploadId, 1);
    const response = await fetch(url, { method: 'PUT', body: PART_BODY });

    expect(response.ok).toBe(false);
  });

  it('should sign presigned URLs with the public endpoint host, never the internal one', async () => {
    const key = `test/${randomUUID()}/original.mp4`;

    const getUrl = await remote.service.presignGet(key);
    const partUrl = await remote.service.presignUploadPart(key, 'upload-1', 1);

    expect(new URL(getUrl).host).toBe('public.example.test:8333');
    expect(new URL(partUrl).host).toBe('public.example.test:8333');
    expect(partUrl).not.toContain('x-amz-checksum');
  });
});
