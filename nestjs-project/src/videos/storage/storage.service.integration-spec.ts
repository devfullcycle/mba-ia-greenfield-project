import { Client } from 'minio';
import { StorageService } from './storage.service';

describe('StorageService (integration)', () => {
  const client = new Client({
    endPoint: process.env.STORAGE_ENDPOINT ?? 'localhost',
    port: Number(process.env.STORAGE_PORT ?? 9000),
    useSSL: false,
    accessKey: process.env.STORAGE_ACCESS_KEY ?? 'streamtube',
    secretKey: process.env.STORAGE_SECRET_KEY ?? 'streamtube-local-secret',
  });
  const service = new StorageService(client, 'streamtube-videos', 900);
  const objectKey = `integration/${Date.now()}/source.bin`;

  beforeAll(async () => {
    await service.ensureBucket();
  });

  it('uploads and reads a completed multipart object', async () => {
    const uploadId = await service.initiateMultipartUpload(
      objectKey,
      'application/octet-stream',
    );
    const url = await service.getPresignedPartUrl(objectKey, uploadId, 1);
    const response = await fetch(url, {
      method: 'PUT',
      body: Buffer.from('streamtube'),
    });
    const etag = response.headers.get('etag');

    expect(response.ok).toBe(true);
    expect(etag).toBeTruthy();

    await service.completeMultipartUpload(objectKey, uploadId, [
      { part: 1, etag: etag as string },
    ]);

    const stat = await service.statObject(objectKey);
    expect(Number(stat.size)).toBe(10);

    const range = await service.getObjectRange(objectKey, 0, 4);
    const chunks: Buffer[] = [];
    for await (const chunk of range) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).toString()).toBe('stre');
  });

  afterAll(async () => {
    await client.removeObject('streamtube-videos', objectKey);
  });
});
