import { QueryFailedError } from 'typeorm';
import { VideosService } from './videos.service';
import { VideoStatus } from './videos.constants';
import {
  ChannelNotFoundException,
  VideoForbiddenException,
  VideoInvalidStateException,
  VideoNotFoundException,
  VideoNotReadyException,
} from './videos.exceptions';

function publicIdConflict(): QueryFailedError {
  const err = new QueryFailedError('insert', [], new Error('dup'));
  (err as unknown as { code: string; detail: string }).code = '23505';
  (err as unknown as { code: string; detail: string }).detail =
    'Key (public_id)=(abc) already exists.';
  return err;
}

describe('VideosService', () => {
  let videosRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
  };
  let channels: { findByUserId: jest.Mock };
  let storage: {
    createMultipartUpload: jest.Mock;
    getPresignedPartUrl: jest.Mock;
    completeMultipartUpload: jest.Mock;
    getObjectRange: jest.Mock;
  };
  let queue: { enqueueProcessing: jest.Mock };
  let service: VideosService;

  const config = { uploadPartSize: 10485760 } as never;

  beforeEach(() => {
    videosRepo = {
      create: jest.fn((v) => v),
      save: jest.fn(),
      findOne: jest.fn(),
    };
    channels = { findByUserId: jest.fn() };
    storage = {
      createMultipartUpload: jest.fn(),
      getPresignedPartUrl: jest.fn(),
      completeMultipartUpload: jest.fn(),
      getObjectRange: jest.fn(),
    };
    queue = { enqueueProcessing: jest.fn() };
    service = new VideosService(
      videosRepo as never,
      channels as never,
      storage as never,
      queue as never,
      config,
    );
  });

  const initDto = {
    title: 'Title',
    filename: 'clip.mp4',
    contentType: 'video/mp4',
    size: 26214400, // 25MB
  };

  describe('initUpload', () => {
    it('creates a draft, starts multipart, and returns the part plan', async () => {
      channels.findByUserId.mockResolvedValue({ id: 'ch1' });
      videosRepo.save
        .mockResolvedValueOnce({
          id: 'vid-uuid',
          public_id: 'pub1',
          channel_id: 'ch1',
        })
        .mockResolvedValueOnce({});
      storage.createMultipartUpload.mockResolvedValue('upload-1');

      const result = await service.initUpload('user1', initDto);

      expect(result).toEqual({
        videoId: 'pub1',
        uploadId: 'upload-1',
        partSize: 10485760,
        partCount: 3, // ceil(25MB / 10MB)
      });
      expect(storage.createMultipartUpload).toHaveBeenCalledWith(
        'videos/vid-uuid/original/clip.mp4',
        'video/mp4',
      );
    });

    it('throws when the user has no channel', async () => {
      channels.findByUserId.mockResolvedValue(null);
      await expect(service.initUpload('user1', initDto)).rejects.toBeInstanceOf(
        ChannelNotFoundException,
      );
    });

    it('retries public_id generation on unique-violation', async () => {
      channels.findByUserId.mockResolvedValue({ id: 'ch1' });
      videosRepo.save
        .mockRejectedValueOnce(publicIdConflict())
        .mockResolvedValueOnce({ id: 'vid-uuid', public_id: 'pub2' })
        .mockResolvedValueOnce({});
      storage.createMultipartUpload.mockResolvedValue('upload-1');

      const result = await service.initUpload('user1', initDto);

      expect(result.videoId).toBe('pub2');
      expect(videosRepo.save).toHaveBeenCalledTimes(3); // 1 fail + draft + update
    });
  });

  describe('getPartUrl', () => {
    it('rejects a non-owner with 403', async () => {
      videosRepo.findOne.mockResolvedValue({
        status: VideoStatus.DRAFT,
        channel: { user_id: 'someone-else' },
      });
      await expect(
        service.getPartUrl('user1', 'pub1', 1),
      ).rejects.toBeInstanceOf(VideoForbiddenException);
    });

    it('rejects when not in draft state with 409', async () => {
      videosRepo.findOne.mockResolvedValue({
        status: VideoStatus.PROCESSING,
        channel: { user_id: 'user1' },
      });
      await expect(
        service.getPartUrl('user1', 'pub1', 1),
      ).rejects.toBeInstanceOf(VideoInvalidStateException);
    });

    it('returns a presigned URL for the owner of a draft', async () => {
      videosRepo.findOne.mockResolvedValue({
        status: VideoStatus.DRAFT,
        channel: { user_id: 'user1' },
        storage_key: 'k',
        upload_id: 'u',
      });
      storage.getPresignedPartUrl.mockResolvedValue('https://signed');

      const result = await service.getPartUrl('user1', 'pub1', 2);
      expect(result).toEqual({ partNumber: 2, url: 'https://signed' });
    });
  });

  describe('completeUpload', () => {
    it('throws when the video does not exist', async () => {
      videosRepo.findOne.mockResolvedValue(null);
      await expect(
        service.completeUpload('user1', 'missing', { parts: [] }),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });

    it('completes, transitions to processing, and enqueues the job', async () => {
      videosRepo.findOne.mockResolvedValue({
        id: 'vid-uuid',
        public_id: 'pub1',
        status: VideoStatus.DRAFT,
        channel: { user_id: 'user1' },
        storage_key: 'k',
        upload_id: 'u',
      });
      videosRepo.save.mockResolvedValue({});

      const result = await service.completeUpload('user1', 'pub1', {
        parts: [{ partNumber: 1, etag: 'e1' }],
      });

      expect(storage.completeMultipartUpload).toHaveBeenCalledWith('k', 'u', [
        { partNumber: 1, etag: 'e1' },
      ]);
      expect(queue.enqueueProcessing).toHaveBeenCalledWith('vid-uuid');
      expect(result).toEqual({
        videoId: 'pub1',
        status: VideoStatus.PROCESSING,
      });
    });
  });

  describe('delivery guards', () => {
    it('openStream rejects a non-ready video with 409', async () => {
      videosRepo.findOne.mockResolvedValue({
        status: VideoStatus.PROCESSING,
      });
      await expect(service.openStream('pub1')).rejects.toBeInstanceOf(
        VideoNotReadyException,
      );
    });

    it('openStream delegates to storage for a ready video', async () => {
      videosRepo.findOne.mockResolvedValue({
        status: VideoStatus.READY,
        storage_key: 'k',
      });
      storage.getObjectRange.mockResolvedValue({
        stream: {},
        contentLength: 1,
      });

      await service.openStream('pub1', 'bytes=0-');
      expect(storage.getObjectRange).toHaveBeenCalledWith('k', 'bytes=0-');
    });

    it('getPublicMetadata maps fields and hasThumbnail', async () => {
      videosRepo.findOne.mockResolvedValue({
        public_id: 'pub1',
        title: 'T',
        status: VideoStatus.READY,
        duration_seconds: 42,
        thumbnail_key: 'videos/x/thumbnail.jpg',
        created_at: new Date('2026-01-01T00:00:00Z'),
      });

      const meta = await service.getPublicMetadata('pub1');
      expect(meta).toEqual({
        videoId: 'pub1',
        title: 'T',
        status: VideoStatus.READY,
        durationSeconds: 42,
        hasThumbnail: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
    });
  });
});
