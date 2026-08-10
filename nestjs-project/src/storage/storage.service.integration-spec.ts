import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

describe('StorageService (integration)', () => {
  let storageService: StorageService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();

    storageService = module.get(StorageService);
  });

  async function uploadSinglePartObject(
    key: string,
    body: Buffer,
    mimeType: string,
  ): Promise<void> {
    const { uploadId } = await storageService.createMultipartUpload(
      key,
      mimeType,
    );
    const partUrl = await storageService.presignUploadPart(key, uploadId, 1);

    const uploadResponse = await fetch(partUrl, {
      method: 'PUT',
      body: new Uint8Array(body),
    });
    expect(uploadResponse.ok).toBe(true);
    const eTag = uploadResponse.headers.get('etag');
    expect(eTag).toBeTruthy();

    await storageService.completeMultipartUpload(key, uploadId, [
      { partNumber: 1, eTag: eTag! },
    ]);
  }

  it('round-trips a multipart upload: create -> presign part -> upload -> complete -> download', async () => {
    const key = `videos/test-channel/test-video-${Date.now()}/original.txt`;
    const body = Buffer.from('hello from the storage integration test');

    await uploadSinglePartObject(key, body, 'text/plain');

    const downloadUrl = await storageService.presignGetObject(key, 'inline');
    const downloadResponse = await fetch(downloadUrl);
    expect(downloadResponse.ok).toBe(true);
    const downloaded = Buffer.from(await downloadResponse.arrayBuffer());
    expect(downloaded.equals(body)).toBe(true);
  });

  it('presignGetObject sets Content-Disposition according to the requested mode', async () => {
    const key = `videos/test-channel/test-video-${Date.now()}/disposition.txt`;
    const body = Buffer.from('disposition test');

    await uploadSinglePartObject(key, body, 'text/plain');

    const attachmentUrl = await storageService.presignGetObject(
      key,
      'attachment',
    );
    const attachmentResponse = await fetch(attachmentUrl);
    expect(attachmentResponse.headers.get('content-disposition')).toContain(
      'attachment',
    );

    const inlineUrl = await storageService.presignGetObject(key, 'inline');
    const inlineResponse = await fetch(inlineUrl);
    expect(inlineResponse.headers.get('content-disposition')).toContain(
      'inline',
    );
  });

  it('putObject writes an object directly, retrievable via presignGetObject', async () => {
    const key = `videos/test-channel/test-video-${Date.now()}/thumbnail.jpg`;
    const body = Buffer.from('fake-thumbnail-bytes');

    await storageService.putObject(key, body, 'image/jpeg');

    const downloadUrl = await storageService.presignGetObject(key, 'inline');
    const downloadResponse = await fetch(downloadUrl);
    expect(downloadResponse.ok).toBe(true);
    const downloaded = Buffer.from(await downloadResponse.arrayBuffer());
    expect(downloaded.equals(body)).toBe(true);
  });
});
