import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageErrorException } from './exceptions/storage-error.exception';
import { StorageService } from './storage.service';

jest.mock('@aws-sdk/s3-request-presigner');

describe('StorageService', () => {
  let service: StorageService;
  let send: jest.Mock;
  const config = {
    endpoint: 'http://minio:9000',
    region: 'us-east-1',
    bucket: 'streamtube-videos',
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
    forcePathStyle: true,
    presignExpiresSeconds: 3600,
  };

  beforeEach(() => {
    send = jest.fn();
    service = new StorageService({ send } as any, config);
    (getSignedUrl as jest.Mock).mockReset();
  });

  describe('key building', () => {
    it('builds the original key layout', () => {
      expect(service.buildOriginalKey('chan-1', 'vid-1', 'mp4')).toBe(
        'videos/chan-1/vid-1/original.mp4',
      );
    });

    it('builds the thumbnail key layout', () => {
      expect(service.buildThumbnailKey('chan-1', 'vid-1')).toBe(
        'videos/chan-1/vid-1/thumbnail.jpg',
      );
    });
  });

  describe('createMultipartUpload', () => {
    it('issues a CreateMultipartUploadCommand and returns the uploadId', async () => {
      send.mockResolvedValue({ UploadId: 'upload-1' });

      const result = await service.createMultipartUpload(
        'videos/chan/vid/original.mp4',
        'video/mp4',
      );

      expect(result).toEqual({ uploadId: 'upload-1' });
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: 'streamtube-videos',
            Key: 'videos/chan/vid/original.mp4',
            ContentType: 'video/mp4',
          },
        }),
      );
    });

    it('wraps SDK errors into StorageErrorException', async () => {
      send.mockRejectedValue(new Error('network down'));

      await expect(
        service.createMultipartUpload('key', 'video/mp4'),
      ).rejects.toThrow(StorageErrorException);
    });
  });

  describe('presignUploadPart', () => {
    it('presigns an UploadPartCommand with the configured expiry', async () => {
      (getSignedUrl as jest.Mock).mockResolvedValue('https://presigned-url');

      const url = await service.presignUploadPart('key', 'upload-1', 3);

      expect(url).toBe('https://presigned-url');
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          input: {
            Bucket: 'streamtube-videos',
            Key: 'key',
            UploadId: 'upload-1',
            PartNumber: 3,
          },
        }),
        { expiresIn: 3600 },
      );
    });

    it('wraps presigner errors into StorageErrorException', async () => {
      (getSignedUrl as jest.Mock).mockRejectedValue(new Error('boom'));

      await expect(
        service.presignUploadPart('key', 'upload-1', 1),
      ).rejects.toThrow(StorageErrorException);
    });
  });

  describe('completeMultipartUpload', () => {
    it('issues a CompleteMultipartUploadCommand with parts sorted and mapped', async () => {
      send.mockResolvedValue({});

      await service.completeMultipartUpload('key', 'upload-1', [
        { partNumber: 2, eTag: 'etag-2' },
        { partNumber: 1, eTag: 'etag-1' },
      ]);

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: 'streamtube-videos',
            Key: 'key',
            UploadId: 'upload-1',
            MultipartUpload: {
              Parts: [
                { PartNumber: 1, ETag: 'etag-1' },
                { PartNumber: 2, ETag: 'etag-2' },
              ],
            },
          },
        }),
      );
    });

    it('wraps SDK errors into StorageErrorException', async () => {
      send.mockRejectedValue(new Error('network down'));

      await expect(
        service.completeMultipartUpload('key', 'upload-1', []),
      ).rejects.toThrow(StorageErrorException);
    });
  });

  describe('presignGetObject', () => {
    it('presigns a GetObjectCommand with the given disposition', async () => {
      (getSignedUrl as jest.Mock).mockResolvedValue('https://presigned-get');

      const url = await service.presignGetObject('key', 'attachment');

      expect(url).toBe('https://presigned-get');
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          input: {
            Bucket: 'streamtube-videos',
            Key: 'key',
            ResponseContentDisposition: 'attachment',
          },
        }),
        { expiresIn: 3600 },
      );
    });

    it('wraps presigner errors into StorageErrorException', async () => {
      (getSignedUrl as jest.Mock).mockRejectedValue(new Error('boom'));

      await expect(service.presignGetObject('key', 'inline')).rejects.toThrow(
        StorageErrorException,
      );
    });
  });

  describe('putObject', () => {
    it('issues a PutObjectCommand with the given body and content type', async () => {
      send.mockResolvedValue({});
      const body = Buffer.from('thumbnail-bytes');

      await service.putObject('key', body, 'image/jpeg');

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: 'streamtube-videos',
            Key: 'key',
            Body: body,
            ContentType: 'image/jpeg',
          },
        }),
      );
    });

    it('wraps SDK errors into StorageErrorException', async () => {
      send.mockRejectedValue(new Error('network down'));

      await expect(
        service.putObject('key', Buffer.from(''), 'image/jpeg'),
      ).rejects.toThrow(StorageErrorException);
    });
  });
});
