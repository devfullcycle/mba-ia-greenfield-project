import { Readable } from 'node:stream';
import {
  ChannelNotFoundException,
  InvalidByteRangeException,
  UnsupportedVideoFormatException,
  VideoFileTooLargeException,
  VideoForbiddenException,
  VideoInvalidStateException,
  VideoNotFoundException,
  VideoNotReadyException,
  VideoUploadIncompleteException,
} from '../common/exceptions/domain.exception';
import { TEN_GIGABYTES_IN_BYTES } from '../config/storage.config';
import { Video, VideoStatus } from './entities/video.entity';
import { PROCESS_VIDEO_JOB, VideosService } from './videos.service';

describe('VideosService (unit)', () => {
  const mockStorageConfig = {
    endpoint: 'http://minio:9000',
    region: 'us-east-1',
    accessKey: 'minioadmin',
    secretKey: 'minioadmin',
    bucket: 'streamtube-videos',
    presignedUrlExpirationSeconds: 3600,
    partSizeBytes: 10 * 1024 * 1024, // 10MB
    maxUploadSizeBytes: TEN_GIGABYTES_IN_BYTES,
  };

  let videoRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let channelsService: {
    findByUserId: jest.Mock;
  };
  let storageService: {
    createMultipartUpload: jest.Mock;
    getPresignedUploadPartUrl: jest.Mock;
    completeMultipartUpload: jest.Mock;
    abortMultipartUpload: jest.Mock;
    headObject: jest.Mock;
    getObjectStream: jest.Mock;
  };
  let videoQueue: {
    add: jest.Mock;
  };
  let service: VideosService;

  beforeEach(() => {
    videoRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: Record<string, unknown>) => ({
        ...data,
        created_at: new Date(),
        updated_at: new Date(),
      })),
      save: jest.fn((entity: unknown) => Promise.resolve(entity)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    channelsService = {
      findByUserId: jest.fn().mockResolvedValue({
        id: 'channel-uuid-1',
        user_id: 'user-uuid-1',
        nickname: 'creator',
      }),
    };
    storageService = {
      createMultipartUpload: jest.fn().mockResolvedValue('s3-upload-id-1'),
      getPresignedUploadPartUrl: jest
        .fn()
        .mockImplementation((_k: string, _u: string, part: number) =>
          Promise.resolve(`http://minio:9000/signed-part-${part}`),
        ),
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
      headObject: jest.fn().mockResolvedValue({
        contentLength: 20 * 1024 * 1024,
        contentType: 'video/mp4',
      }),
      getObjectStream: jest.fn(),
    };
    videoQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    service = new VideosService(
      videoRepository as any,
      channelsService as any,
      storageService as any,
      videoQueue as any,
      mockStorageConfig,
    );
  });

  describe('initiateUpload', () => {
    it('creates a draft video, initiates S3 multipart upload, and returns presigned part URLs', async () => {
      const result = await service.initiateUpload('user-uuid-1', {
        title: 'Nested Queues Lecture',
        description: 'Deep dive into BullMQ',
        original_filename: 'lecture.mp4',
        mime_type: 'video/mp4',
        size_bytes: 25 * 1024 * 1024, // 25MB -> 3 parts of 10MB
      });

      expect(result.status).toBe(VideoStatus.DRAFT);
      expect(result.slug).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(result.upload_id).toBe('s3-upload-id-1');
      expect(result.total_parts).toBe(3);
      expect(result.presigned_urls).toHaveLength(3);
      expect(videoRepository.save).toHaveBeenCalledTimes(1);
    });

    it('supports 10GB file uploads without exceeding S3 10,000-part limit', async () => {
      const result = await service.initiateUpload('user-uuid-1', {
        title: '10GB Raw Recording',
        original_filename: 'raw-10gb.mp4',
        mime_type: 'video/mp4',
        size_bytes: TEN_GIGABYTES_IN_BYTES,
      });

      expect(result.status).toBe(VideoStatus.DRAFT);
      expect(result.total_parts).toBeLessThanOrEqual(10000);
      expect(result.presigned_urls.length).toBeGreaterThan(0);
    });

    it('throws VideoFileTooLargeException (413) when size_bytes exceeds 10GB', async () => {
      await expect(
        service.initiateUpload('user-uuid-1', {
          title: 'Over 10GB',
          original_filename: 'huge.mp4',
          mime_type: 'video/mp4',
          size_bytes: TEN_GIGABYTES_IN_BYTES + 1,
        }),
      ).rejects.toBeInstanceOf(VideoFileTooLargeException);
    });

    it('throws UnsupportedVideoFormatException (400) for non-video MIME type', async () => {
      await expect(
        service.initiateUpload('user-uuid-1', {
          title: 'Executable disguised',
          original_filename: 'app.exe',
          mime_type: 'application/octet-stream',
          size_bytes: 1024,
        }),
      ).rejects.toBeInstanceOf(UnsupportedVideoFormatException);
    });

    it('throws ChannelNotFoundException (404) when user has no channel', async () => {
      channelsService.findByUserId.mockResolvedValueOnce(null);

      await expect(
        service.initiateUpload('user-without-channel', {
          title: 'Test',
          original_filename: 'v.mp4',
          mime_type: 'video/mp4',
          size_bytes: 1024,
        }),
      ).rejects.toBeInstanceOf(ChannelNotFoundException);
    });

    it('retries slug generation on collision during pre-check', async () => {
      videoRepository.findOne
        .mockResolvedValueOnce({ id: 'existing-video' })
        .mockResolvedValueOnce(null);

      const result = await service.initiateUpload('user-uuid-1', {
        title: 'Slug Collision Test',
        original_filename: 'v.mp4',
        mime_type: 'video/mp4',
        size_bytes: 1024,
      });

      expect(videoRepository.findOne).toHaveBeenCalledTimes(2);
      expect(result.slug).toHaveLength(11);
    });
  });

  describe('completeUpload', () => {
    function makeDraftVideo(): Video {
      return {
        id: 'video-uuid-1',
        channel_id: 'channel-uuid-1',
        slug: 'AbCdEf12345',
        title: 'Draft Video',
        description: null,
        status: VideoStatus.DRAFT,
        storage_key: 'videos/video-uuid-1/original.mp4',
        thumbnail_key: null,
        upload_id: 's3-upload-id-1',
        original_filename: 'draft.mp4',
        mime_type: 'video/mp4',
        size_bytes: 1024,
        duration_seconds: null,
        width: null,
        height: null,
        codec: null,
        processing_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      } as Video;
    }

    it('completes multipart upload, transitions status to processing, and enqueues BullMQ job', async () => {
      const draft = makeDraftVideo();
      videoRepository.findOne.mockResolvedValueOnce(draft);

      const res = await service.completeUpload('user-uuid-1', draft.id, {
        parts: [{ part_number: 1, etag: '"etag-1"' }],
      });

      expect(storageService.completeMultipartUpload).toHaveBeenCalledWith(
        draft.storage_key,
        's3-upload-id-1',
        [{ partNumber: 1, etag: '"etag-1"' }],
      );
      expect(res.status).toBe(VideoStatus.PROCESSING);
      expect(videoQueue.add).toHaveBeenCalledWith(
        PROCESS_VIDEO_JOB,
        { videoId: draft.id, storageKey: draft.storage_key },
        expect.objectContaining({
          jobId: `video-${draft.id}`,
          attempts: 3,
        }),
      );
    });

    it('throws VideoUploadIncompleteException when object does not exist in storage', async () => {
      const draft = makeDraftVideo();
      videoRepository.findOne.mockResolvedValueOnce(draft);
      storageService.headObject.mockResolvedValueOnce(null);

      await expect(
        service.completeUpload('user-uuid-1', draft.id, {}),
      ).rejects.toBeInstanceOf(VideoUploadIncompleteException);
    });

    it('throws VideoForbiddenException when another user attempts to complete', async () => {
      const draft = makeDraftVideo();
      videoRepository.findOne.mockResolvedValueOnce(draft);
      channelsService.findByUserId.mockResolvedValueOnce({
        id: 'other-channel-id',
      });

      await expect(
        service.completeUpload('other-user', draft.id, {}),
      ).rejects.toBeInstanceOf(VideoForbiddenException);
    });

    it('throws VideoInvalidStateException when video is already processing or ready', async () => {
      const readyVideo = makeDraftVideo();
      readyVideo.status = VideoStatus.READY;
      videoRepository.findOne.mockResolvedValueOnce(readyVideo);

      await expect(
        service.completeUpload('user-uuid-1', readyVideo.id, {}),
      ).rejects.toBeInstanceOf(VideoInvalidStateException);
    });
  });

  describe('parseByteRange & streaming/download', () => {
    it('parses explicit, open-ended, and suffix byte ranges accurately', () => {
      expect(service.parseByteRange('bytes=0-499', 1000)).toEqual({
        start: 0,
        end: 499,
      });
      expect(service.parseByteRange('bytes=500-', 1000)).toEqual({
        start: 500,
        end: 999,
      });
      expect(service.parseByteRange('bytes=-200', 1000)).toEqual({
        start: 800,
        end: 999,
      });
    });

    it('throws InvalidByteRangeException (416) for malformed or out-of-bounds ranges', () => {
      expect(() => service.parseByteRange('items=0-5', 1000)).toThrow(
        InvalidByteRangeException,
      );
      expect(() => service.parseByteRange('bytes=1000-1500', 1000)).toThrow(
        InvalidByteRangeException,
      );
      expect(() => service.parseByteRange('bytes=500-200', 1000)).toThrow(
        InvalidByteRangeException,
      );
    });

    it('throws VideoNotReadyException (409) when streaming or downloading a non-ready video', async () => {
      videoRepository.findOne.mockResolvedValue({
        id: 'v1',
        slug: 'DraftSlug11',
        status: VideoStatus.PROCESSING,
        size_bytes: 1000,
      });

      await expect(
        service.getVideoStreamBySlug('DraftSlug11', 'bytes=0-100'),
      ).rejects.toBeInstanceOf(VideoNotReadyException);

      await expect(
        service.getVideoDownloadBySlug('DraftSlug11'),
      ).rejects.toBeInstanceOf(VideoNotReadyException);
    });

    it('returns partial stream payload with Content-Range for ready video', async () => {
      const dummyStream = Readable.from(Buffer.alloc(100));
      videoRepository.findOne.mockResolvedValueOnce({
        id: 'v1',
        slug: 'ReadySlug11',
        status: VideoStatus.READY,
        storage_key: 'videos/v1/original.mp4',
        mime_type: 'video/mp4',
        size_bytes: 1000,
      });
      storageService.getObjectStream.mockResolvedValueOnce({
        stream: dummyStream,
        contentLength: 100,
      });

      const payload = await service.getVideoStreamBySlug(
        'ReadySlug11',
        'bytes=0-99',
      );

      expect(payload.isPartial).toBe(true);
      expect(payload.contentLength).toBe(100);
      expect(payload.contentRange).toBe('bytes 0-99/1000');
    });

    it('throws VideoNotFoundException (404) when slug does not exist', async () => {
      videoRepository.findOne.mockResolvedValueOnce(null);
      await expect(service.findBySlug('NonExistent')).rejects.toBeInstanceOf(
        VideoNotFoundException,
      );
    });
  });
});
