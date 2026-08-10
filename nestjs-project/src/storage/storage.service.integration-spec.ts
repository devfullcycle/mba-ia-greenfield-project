import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import type { CompletedPart } from '@aws-sdk/client-s3';
import appConfig from '../config/app.config';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

async function uploadSinglePartObject(
  storageService: StorageService,
  key: string,
  body: string,
): Promise<void> {
  const uploadId = await storageService.createMultipartUpload(key, 'video/mp4');
  const [{ uploadUrl }] = await storageService.generatePartPresignedUrls(
    key,
    uploadId,
    1,
  );

  const putResponse = await fetch(uploadUrl, {
    method: 'PUT',
    body,
  });
  const etag = putResponse.headers.get('etag');
  if (!etag) {
    throw new Error('MinIO did not return an ETag for the uploaded part');
  }

  const parts: CompletedPart[] = [{ ETag: etag, PartNumber: 1 }];
  await storageService.completeMultipartUpload(key, uploadId, parts);
}

describe('StorageService (integration)', () => {
  let storageService: StorageService;
  let storageModule: StorageModule;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [appConfig, storageConfig],
        }),
        StorageModule,
      ],
    }).compile();

    storageService = module.get(StorageService);
    storageModule = module.get(StorageModule);

    await storageModule.onApplicationBootstrap();
  });

  it('StorageModule.onApplicationBootstrap is idempotent across consecutive calls', async () => {
    await storageModule.onApplicationBootstrap();
    await storageModule.onApplicationBootstrap();
  });

  it('createMultipartUpload returns a non-empty UploadId', async () => {
    const uploadId = await storageService.createMultipartUpload(
      'test-key-create',
      'video/mp4',
    );

    expect(typeof uploadId).toBe('string');
    expect(uploadId.length).toBeGreaterThan(0);
  });

  it('generatePartPresignedUrls returns one presigned URL per part, pointing at MinIO', async () => {
    const uploadId = await storageService.createMultipartUpload(
      'test-key-parts',
      'video/mp4',
    );

    const urls = await storageService.generatePartPresignedUrls(
      'test-key-parts',
      uploadId,
      3,
    );

    expect(urls).toHaveLength(3);
    urls.forEach((entry, index) => {
      expect(entry.partNumber).toBe(index + 1);
      expect(entry.uploadUrl.startsWith('http://minio:9000/')).toBe(true);
    });
  });

  it('PUT against a part presigned URL succeeds and returns an ETag', async () => {
    const key = 'test-key-put';
    const uploadId = await storageService.createMultipartUpload(
      key,
      'video/mp4',
    );
    const [{ uploadUrl }] = await storageService.generatePartPresignedUrls(
      key,
      uploadId,
      1,
    );

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      body: 'integration-test-payload',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBeTruthy();
  });

  it('completeMultipartUpload consolidates the object in MinIO without throwing', async () => {
    const key = 'test-key-complete';

    await uploadSinglePartObject(
      storageService,
      key,
      'integration-test-payload-for-completion',
    );

    const { url } = await storageService.generatePresignedGetUrl(key, 3600);
    const getResponse = await fetch(url);

    expect(getResponse.status).toBe(200);
    expect(await getResponse.text()).toBe(
      'integration-test-payload-for-completion',
    );
  });

  it('generatePresignedGetUrl returns a URL whose GET resolves with 200', async () => {
    const key = 'test-key-get';

    await uploadSinglePartObject(
      storageService,
      key,
      'integration-test-payload-for-get',
    );

    const { url } = await storageService.generatePresignedGetUrl(key, 3600);
    const response = await fetch(url);

    expect(response.status).toBe(200);
  });

  it('uploadObject stores an object directly (single PUT, no multipart)', async () => {
    const key = 'test-key-direct-upload';

    await storageService.uploadObject(
      key,
      Buffer.from('direct-upload-payload'),
      'image/jpeg',
    );

    const { url } = await storageService.generatePresignedGetUrl(key, 3600);
    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('direct-upload-payload');
  });
});
