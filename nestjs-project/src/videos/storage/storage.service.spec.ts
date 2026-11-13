import { Readable } from 'node:stream';
import { Client } from 'minio';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  const client = {
    bucketExists: jest.fn(),
    makeBucket: jest.fn(),
    initiateNewMultipartUpload: jest.fn(),
    presignedUrl: jest.fn(),
    completeMultipartUpload: jest.fn(),
    abortMultipartUpload: jest.fn(),
    statObject: jest.fn(),
    getObject: jest.fn(),
    getPartialObject: jest.fn(),
    putObject: jest.fn(),
  } as unknown as jest.Mocked<Client>;
  let service: StorageService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StorageService(client, 'videos', 900);
  });

  it('creates the bucket only when it does not exist', async () => {
    client.bucketExists.mockResolvedValueOnce(false);
    await service.ensureBucket();
    expect(client.makeBucket).toHaveBeenCalledWith('videos');

    client.bucketExists.mockResolvedValueOnce(true);
    await service.ensureBucket();
    expect(client.makeBucket).toHaveBeenCalledTimes(1);
  });

  it('creates a multipart upload and signs each part', async () => {
    client.initiateNewMultipartUpload.mockResolvedValueOnce('upload-1');
    client.presignedUrl.mockResolvedValueOnce('https://storage/part-1');

    await expect(
      service.initiateMultipartUpload('videos/id/source.mp4', 'video/mp4'),
    ).resolves.toBe('upload-1');
    await expect(
      service.getPresignedPartUrl('videos/id/source.mp4', 'upload-1', 1),
    ).resolves.toBe('https://storage/part-1');

    expect(client.presignedUrl).toHaveBeenCalledWith(
      'PUT',
      'videos',
      'videos/id/source.mp4',
      900,
      { partNumber: '1', uploadId: 'upload-1' },
    );
  });

  it('completes and aborts multipart uploads', async () => {
    await service.completeMultipartUpload('source.mp4', 'upload-1', [
      { part: 1, etag: 'etag-1' },
    ]);
    await service.abortMultipartUpload('source.mp4', 'upload-1');

    expect(client.completeMultipartUpload).toHaveBeenCalledWith(
      'videos',
      'source.mp4',
      'upload-1',
      [{ part: 1, etag: 'etag-1' }],
    );
    expect(client.abortMultipartUpload).toHaveBeenCalledWith(
      'videos',
      'source.mp4',
      'upload-1',
    );
  });

  it('delegates stat, full read, range read, and thumbnail upload', async () => {
    const stream = Readable.from(['data']);
    client.getObject.mockResolvedValueOnce(stream);
    client.getPartialObject.mockResolvedValueOnce(stream);

    await service.statObject('source.mp4');
    await service.getObject('source.mp4');
    await service.getObjectRange('source.mp4', 10, 20);
    await service.putObject('thumbnail.jpg', Buffer.from('jpg'), 'image/jpeg');

    expect(client.statObject).toHaveBeenCalledWith('videos', 'source.mp4');
    expect(client.getObject).toHaveBeenCalledWith('videos', 'source.mp4');
    expect(client.getPartialObject).toHaveBeenCalledWith(
      'videos',
      'source.mp4',
      10,
      20,
    );
    expect(client.putObject).toHaveBeenCalledWith(
      'videos',
      'thumbnail.jpg',
      expect.any(Buffer),
      3,
      { 'Content-Type': 'image/jpeg' },
    );
  });
});
