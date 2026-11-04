import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { StorageService } from './storage.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

describe('StorageService (unit)', () => {
  const mockConfig = {
    endpoint: 'http://minio:9000',
    region: 'us-east-1',
    accessKey: 'minioadmin',
    secretKey: 'minioadmin',
    bucket: 'streamtube-videos',
    presignedUrlExpirationSeconds: 3600,
    partSizeBytes: 10485760,
    maxUploadSizeBytes: 10737418240,
  };

  let service: StorageService;
  let sendSpy: jest.SpyInstance<Promise<unknown>, [command: unknown]>;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StorageService(mockConfig);
    const internals = service as unknown as { s3Client: S3Client };
    sendSpy = jest.spyOn(
      internals.s3Client,
      'send',
    ) as unknown as typeof sendSpy;
  });

  describe('ensureBucketExists', () => {
    it('succeeds without creating bucket when HeadBucketCommand resolves', async () => {
      sendSpy.mockResolvedValueOnce({});

      await service.ensureBucketExists();
      await service.ensureBucketExists(); // second call should short-circuit

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
    });

    it('creates bucket when HeadBucketCommand throws 404 NotFound', async () => {
      const notFoundErr = Object.assign(new Error('NotFound'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      });
      sendSpy.mockRejectedValueOnce(notFoundErr).mockResolvedValueOnce({});

      await service.ensureBucketExists();

      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect(sendSpy.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
      expect(sendSpy.mock.calls[1][0]).toBeInstanceOf(CreateBucketCommand);
    });
  });

  describe('multipart upload lifecycle', () => {
    beforeEach(() => {
      (service as unknown as { bucketVerified: boolean }).bucketVerified = true;
    });

    it('createMultipartUpload sends CreateMultipartUploadCommand and returns UploadId', async () => {
      sendSpy.mockResolvedValueOnce({ UploadId: 'upload-123' });

      const uploadId = await service.createMultipartUpload(
        'videos/v1/original.mp4',
        'video/mp4',
      );

      expect(uploadId).toBe('upload-123');
      expect(sendSpy.mock.calls[0][0]).toBeInstanceOf(
        CreateMultipartUploadCommand,
      );
    });

    it('getPresignedUploadPartUrl signs UploadPartCommand with configured expiration', async () => {
      (getSignedUrl as jest.Mock).mockResolvedValueOnce(
        'http://minio:9000/signed-part-1',
      );

      const url = await service.getPresignedUploadPartUrl(
        'videos/v1/original.mp4',
        'upload-123',
        1,
      );

      expect(url).toBe('http://minio:9000/signed-part-1');
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.any(S3Client),
        expect.any(UploadPartCommand),
        { expiresIn: 3600 },
      );
    });

    it('completeMultipartUpload sorts parts by PartNumber ascending and sends CompleteMultipartUploadCommand', async () => {
      sendSpy.mockResolvedValueOnce({});

      await service.completeMultipartUpload(
        'videos/v1/original.mp4',
        'upload-123',
        [
          { partNumber: 2, etag: '"etag-2"' },
          { partNumber: 1, etag: '"etag-1"' },
        ],
      );

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const cmd = sendSpy.mock.calls[0][0] as CompleteMultipartUploadCommand;
      expect(cmd).toBeInstanceOf(CompleteMultipartUploadCommand);
      expect(cmd.input.MultipartUpload?.Parts).toEqual([
        { PartNumber: 1, ETag: '"etag-1"' },
        { PartNumber: 2, ETag: '"etag-2"' },
      ]);
    });

    it('abortMultipartUpload sends AbortMultipartUploadCommand', async () => {
      sendSpy.mockResolvedValueOnce({});

      await service.abortMultipartUpload(
        'videos/v1/original.mp4',
        'upload-123',
      );

      expect(sendSpy.mock.calls[0][0]).toBeInstanceOf(
        AbortMultipartUploadCommand,
      );
    });
  });

  describe('object operations', () => {
    beforeEach(() => {
      (service as unknown as { bucketVerified: boolean }).bucketVerified = true;
    });

    it('putObject sends PutObjectCommand', async () => {
      sendSpy.mockResolvedValueOnce({});
      const buf = Buffer.from('jpeg-bytes');

      await service.putObject('thumbnails/v1/thumb.jpg', buf, 'image/jpeg');

      const cmd = sendSpy.mock.calls[0][0] as PutObjectCommand;
      expect(cmd).toBeInstanceOf(PutObjectCommand);
      expect(cmd.input.Key).toBe('thumbnails/v1/thumb.jpg');
      expect(cmd.input.ContentType).toBe('image/jpeg');
    });

    it('headObject returns metadata when object exists and null on 404', async () => {
      sendSpy.mockResolvedValueOnce({
        ContentLength: 2048,
        ContentType: 'video/mp4',
      });

      const found = await service.headObject('videos/v1/original.mp4');
      expect(found).toEqual({ contentLength: 2048, contentType: 'video/mp4' });
      expect(sendSpy.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);

      sendSpy.mockRejectedValueOnce({
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      });
      const missing = await service.headObject('videos/missing/original.mp4');
      expect(missing).toBeNull();
    });

    it('getObjectStream passes Range header when byte range is requested', async () => {
      const dummyStream = Readable.from(Buffer.alloc(100));
      sendSpy.mockResolvedValueOnce({
        Body: dummyStream,
        ContentLength: 100,
        ContentRange: 'bytes 0-99/1000',
        ContentType: 'video/mp4',
      });

      const result = await service.getObjectStream('videos/v1/original.mp4', {
        start: 0,
        end: 99,
      });

      const cmd = sendSpy.mock.calls[0][0] as GetObjectCommand;
      expect(cmd).toBeInstanceOf(GetObjectCommand);
      expect(cmd.input.Range).toBe('bytes=0-99');
      expect(result.contentLength).toBe(100);
      expect(result.contentRange).toBe('bytes 0-99/1000');
    });

    it('deleteObject sends DeleteObjectCommand', async () => {
      sendSpy.mockResolvedValueOnce({});
      await service.deleteObject('videos/v1/original.mp4');
      expect(sendSpy.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
    });
  });
});
