import { Readable } from 'node:stream';
import type { ConfigType } from '@nestjs/config';
import type { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import storageConfig from '../config/storage.config';
import { StorageService } from './storage.service';

jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation(() => ({
    done: jest.fn().mockResolvedValue(undefined),
  })),
}));

const CONFIG = {
  endpoint: 'minio',
  port: 9000,
  accessKey: 'minioadmin',
  secretKey: 'minioadmin',
  bucketVideos: 'videos',
  bucketThumbnails: 'thumbnails',
  useSsl: false,
} as ConfigType<typeof storageConfig>;

describe('StorageService', () => {
  let send: jest.Mock;
  let service: StorageService;

  beforeEach(() => {
    send = jest.fn();
    service = new StorageService({ send } as unknown as S3Client, CONFIG);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('ensureBucketExists', () => {
    it('does not create a bucket when it already exists', async () => {
      send.mockResolvedValue({});

      await service.ensureBucketExists('videos');

      expect(send).toHaveBeenCalledTimes(1);
    });

    it('creates the bucket when HeadBucket returns 404', async () => {
      send
        .mockRejectedValueOnce({
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        })
        .mockResolvedValueOnce({});

      await service.ensureBucketExists('videos');

      expect(send).toHaveBeenCalledTimes(2);
      expect((send.mock.calls[1][0] as { input: unknown }).input).toEqual({
        Bucket: 'videos',
      });
    });

    it('ignores BucketAlreadyOwnedByYou on creation', async () => {
      send
        .mockRejectedValueOnce({ name: 'NotFound' })
        .mockRejectedValueOnce({ name: 'BucketAlreadyOwnedByYou' });

      await expect(
        service.ensureBucketExists('videos'),
      ).resolves.toBeUndefined();
    });

    it('rethrows unexpected HeadBucket errors', async () => {
      send.mockRejectedValue(new Error('network down'));

      await expect(service.ensureBucketExists('videos')).rejects.toThrow(
        'network down',
      );
    });
  });

  describe('onModuleInit', () => {
    it('ensures both configured buckets exist', async () => {
      const ensureSpy = jest
        .spyOn(service, 'ensureBucketExists')
        .mockResolvedValue(undefined);

      await service.onModuleInit();

      expect(ensureSpy).toHaveBeenCalledWith('videos');
      expect(ensureSpy).toHaveBeenCalledWith('thumbnails');
    });
  });

  describe('uploadStream', () => {
    it('streams the object through the multipart Upload helper', async () => {
      const stream = Readable.from('content');

      await service.uploadStream(
        'videos/1/file.mp4',
        stream,
        'video/mp4',
        'videos',
      );

      const uploadMock = Upload as unknown as jest.Mock;
      expect(uploadMock).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            Bucket: 'videos',
            Key: 'videos/1/file.mp4',
            Body: stream,
            ContentType: 'video/mp4',
          }),
        }),
      );

      const instance = uploadMock.mock.results[0].value as {
        done: jest.Mock;
      };
      expect(instance.done).toHaveBeenCalled();
    });
  });

  describe('getObjectStream', () => {
    it('returns the object stream and metadata', async () => {
      const body = Readable.from('content');
      send.mockResolvedValue({
        Body: body,
        ContentLength: 7,
        ContentType: 'video/mp4',
      });

      const result = await service.getObjectStream(
        'videos/1/file.mp4',
        'videos',
      );

      expect(result.stream).toBe(body);
      expect(result.contentLength).toBe(7);
      expect(result.contentType).toBe('video/mp4');
      expect(result.contentRange).toBeUndefined();
    });

    it('forwards the Range header to the storage API', async () => {
      send.mockResolvedValue({
        Body: Readable.from('cont'),
        ContentLength: 4,
        ContentRange: 'bytes 0-3/7',
      });

      const result = await service.getObjectStream(
        'videos/1/file.mp4',
        'videos',
        'bytes=0-3',
      );

      expect((send.mock.calls[0][0] as { input: unknown }).input).toEqual({
        Bucket: 'videos',
        Key: 'videos/1/file.mp4',
        Range: 'bytes=0-3',
      });
      expect(result.contentRange).toBe('bytes 0-3/7');
    });
  });

  describe('deleteObject', () => {
    it('sends a DeleteObject command', async () => {
      send.mockResolvedValue({});

      await service.deleteObject('videos/1/file.mp4', 'videos');

      expect((send.mock.calls[0][0] as { input: unknown }).input).toEqual({
        Bucket: 'videos',
        Key: 'videos/1/file.mp4',
      });
    });
  });
});
