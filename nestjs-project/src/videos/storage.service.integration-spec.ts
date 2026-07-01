import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import { StorageService } from './storage.service';

describe('StorageService (integration)', () => {
  let storageService: StorageService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
      ],
      providers: [StorageService],
    }).compile();

    storageService = module.get(StorageService);
    await storageService.onModuleInit();
  });

  it('completes a multipart upload and serves the content via a presigned read URL', async () => {
    const key = `test/${crypto.randomUUID()}.txt`;
    const content = 'hello streamtube';

    const uploadId = await storageService.initiateMultipartUpload(key);
    expect(uploadId).toBeTruthy();

    const partUrl = await storageService.getPresignedPartUploadUrl(
      key,
      uploadId,
      1,
    );
    const putResponse = await fetch(partUrl, {
      method: 'PUT',
      body: content,
    });
    expect(putResponse.ok).toBe(true);
    const etag = putResponse.headers.get('etag');
    expect(etag).toBeTruthy();

    await storageService.completeMultipartUpload(key, uploadId, [
      { partNumber: 1, etag: etag! },
    ]);

    const readUrl = await storageService.getPresignedReadUrl(key);
    const getResponse = await fetch(readUrl);
    expect(getResponse.ok).toBe(true);
    expect(await getResponse.text()).toBe(content);
  });

  it('generates a presigned read URL with attachment content-disposition when requested', async () => {
    const key = `test/${crypto.randomUUID()}.txt`;
    const content = 'download me';

    const uploadId = await storageService.initiateMultipartUpload(key);
    const partUrl = await storageService.getPresignedPartUploadUrl(
      key,
      uploadId,
      1,
    );
    const putResponse = await fetch(partUrl, { method: 'PUT', body: content });
    const etag = putResponse.headers.get('etag');
    await storageService.completeMultipartUpload(key, uploadId, [
      { partNumber: 1, etag: etag! },
    ]);

    const attachmentUrl = await storageService.getPresignedReadUrl(key, {
      attachment: true,
    });
    const response = await fetch(attachmentUrl);

    expect(response.headers.get('content-disposition')).toContain('attachment');
  });
});
