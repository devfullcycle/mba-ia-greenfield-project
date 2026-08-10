import { FileTooLargeException } from './exceptions/file-too-large.exception';
import { InvalidVideoStatusException } from './exceptions/invalid-video-status.exception';
import { VideoNotFoundException } from './exceptions/video-not-found.exception';
import { VideoNotOwnedException } from './exceptions/video-not-owned.exception';
import { Video } from './entities/video.entity';
import { VideosService } from './videos.service';

function makeVideo(overrides: Partial<Video> = {}): Video {
  const video = new Video();
  video.id = 'video-1';
  video.slug = 'video-1-slug';
  video.channel_id = 'channel-1';
  video.status = 'draft';
  video.title = 'Movie';
  video.original_filename = 'movie.mp4';
  video.mime_type = 'video/mp4';
  video.size_bytes = '1000';
  video.original_key = 'videos/channel-1/video-1/original.mp4';
  video.upload_id = 'upload-1';
  video.thumbnail_key = null;
  video.duration_seconds = null;
  video.metadata = null;
  video.failure_reason = null;
  video.created_at = new Date();
  video.updated_at = new Date();
  return Object.assign(video, overrides);
}

function makeChannel(id = 'channel-1') {
  return { id, user_id: 'user-1' };
}

describe('VideosService', () => {
  const storageCfg = { bucket: 'streamtube-videos' };
  let create: jest.Mock;
  let save: jest.Mock;
  let findOneBy: jest.Mock;
  let update: jest.Mock;
  let queryRunner: { query: jest.Mock };
  let manager: { update: jest.Mock; queryRunner: typeof queryRunner };
  let transaction: jest.Mock;
  let findByUserId: jest.Mock;
  let buildOriginalKey: jest.Mock;
  let createMultipartUpload: jest.Mock;
  let presignUploadPart: jest.Mock;
  let completeMultipartUpload: jest.Mock;
  let presignGetObject: jest.Mock;
  let enqueueVideoProcessing: jest.Mock;
  let service: VideosService;

  beforeEach(() => {
    create = jest.fn((v: unknown) => v);
    save = jest.fn();
    findOneBy = jest.fn();
    update = jest.fn();
    queryRunner = { query: jest.fn() };
    manager = { update, queryRunner };
    transaction = jest.fn((cb: (m: typeof manager) => Promise<unknown>) =>
      cb(manager),
    );
    findByUserId = jest.fn();
    buildOriginalKey = jest.fn(
      (channelId: string, videoId: string, ext: string) =>
        `videos/${channelId}/${videoId}/original.${ext}`,
    );
    createMultipartUpload = jest
      .fn()
      .mockResolvedValue({ uploadId: 'upload-1' });
    presignUploadPart = jest.fn().mockResolvedValue('https://presigned-url');
    completeMultipartUpload = jest.fn().mockResolvedValue(undefined);
    presignGetObject = jest.fn().mockResolvedValue('https://presigned-get-url');
    enqueueVideoProcessing = jest.fn().mockResolvedValue(undefined);

    service = new VideosService(
      { create, save, findOneBy } as any,
      { transaction, manager } as any,
      { findByUserId } as any,
      {
        buildOriginalKey,
        createMultipartUpload,
        presignUploadPart,
        completeMultipartUpload,
        presignGetObject,
      } as any,
      { enqueueVideoProcessing } as any,
      storageCfg as any,
    );
  });

  describe('initiateUpload', () => {
    it('rejects sizeBytes over 10GB', async () => {
      await expect(
        service.initiateUpload('user-1', {
          filename: 'movie.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 10 * 1024 * 1024 * 1024 + 1,
        }),
      ).rejects.toThrow(FileTooLargeException);

      expect(findByUserId).not.toHaveBeenCalled();
    });

    it('persists a draft video and opens a multipart upload', async () => {
      findByUserId.mockResolvedValue(makeChannel());
      // Simulates Postgres applying the column default and TypeORM's
      // RETURNING clause populating it back onto the saved entity.
      save.mockImplementation((v: Video) =>
        Promise.resolve({ ...v, status: v.status ?? 'draft' }),
      );

      const result = await service.initiateUpload('user-1', {
        filename: 'movie.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 1000,
      });

      expect(createMultipartUpload).toHaveBeenCalledWith(
        expect.stringContaining('videos/channel-1/'),
        'video/mp4',
      );
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          channel_id: 'channel-1',
          title: 'movie',
          original_filename: 'movie.mp4',
          upload_id: 'upload-1',
          slug: expect.any(String) as unknown as string,
        }),
      );
      expect(result).toEqual({
        id: expect.any(String) as unknown as string,
        uploadId: 'upload-1',
        key: expect.stringContaining('videos/channel-1/') as unknown as string,
        status: 'draft',
      });
    });

    it('retries slug generation when a collision is found', async () => {
      findByUserId.mockResolvedValue(makeChannel());
      findOneBy.mockResolvedValueOnce(makeVideo()).mockResolvedValueOnce(null);
      save.mockImplementation((v: Video) =>
        Promise.resolve({ ...v, status: v.status ?? 'draft' }),
      );

      await service.initiateUpload('user-1', {
        filename: 'movie.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 1000,
      });

      expect(findOneBy).toHaveBeenCalledTimes(2);
    });
  });

  describe('getUploadPartUrls', () => {
    it('throws VideoNotFoundException when the video does not exist', async () => {
      findOneBy.mockResolvedValue(null);

      await expect(
        service.getUploadPartUrls('user-1', 'video-1', [1]),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('throws VideoNotOwnedException when the caller does not own the channel', async () => {
      findOneBy.mockResolvedValue(makeVideo());
      findByUserId.mockResolvedValue(makeChannel('other-channel'));

      await expect(
        service.getUploadPartUrls('user-1', 'video-1', [1]),
      ).rejects.toThrow(VideoNotOwnedException);
    });

    it('throws InvalidVideoStatusException when the video is not in draft status', async () => {
      findOneBy.mockResolvedValue(makeVideo({ status: 'processing' }));
      findByUserId.mockResolvedValue(makeChannel());

      await expect(
        service.getUploadPartUrls('user-1', 'video-1', [1]),
      ).rejects.toThrow(InvalidVideoStatusException);
    });

    it('presigns a URL for each requested part number', async () => {
      findOneBy.mockResolvedValue(makeVideo());
      findByUserId.mockResolvedValue(makeChannel());

      const result = await service.getUploadPartUrls(
        'user-1',
        'video-1',
        [1, 2],
      );

      expect(presignUploadPart).toHaveBeenCalledWith(
        'videos/channel-1/video-1/original.mp4',
        'upload-1',
        1,
      );
      expect(presignUploadPart).toHaveBeenCalledWith(
        'videos/channel-1/video-1/original.mp4',
        'upload-1',
        2,
      );
      expect(result).toEqual([
        { partNumber: 1, url: 'https://presigned-url' },
        { partNumber: 2, url: 'https://presigned-url' },
      ]);
    });
  });

  describe('completeUpload', () => {
    it('throws VideoNotOwnedException when the caller does not own the channel', async () => {
      findOneBy.mockResolvedValue(makeVideo());
      findByUserId.mockResolvedValue(makeChannel('other-channel'));

      await expect(
        service.completeUpload('user-1', 'video-1', []),
      ).rejects.toThrow(VideoNotOwnedException);
    });

    it('throws InvalidVideoStatusException when the video is not in draft status', async () => {
      findOneBy.mockResolvedValue(makeVideo({ status: 'ready' }));
      findByUserId.mockResolvedValue(makeChannel());

      await expect(
        service.completeUpload('user-1', 'video-1', []),
      ).rejects.toThrow(InvalidVideoStatusException);
    });

    it('completes the storage upload, flips status, and enqueues processing within one transaction', async () => {
      const video = makeVideo();
      findOneBy.mockResolvedValue(video);
      findByUserId.mockResolvedValue(makeChannel());
      const parts = [{ partNumber: 1, eTag: 'etag-1' }];

      const result = await service.completeUpload('user-1', 'video-1', parts);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(completeMultipartUpload).toHaveBeenCalledWith(
        video.original_key,
        video.upload_id,
        parts,
      );
      expect(update).toHaveBeenCalledWith(Video, video.id, {
        status: 'processing',
        upload_id: null,
      });
      expect(enqueueVideoProcessing).toHaveBeenCalledWith(
        {
          videoId: video.id,
          bucket: 'streamtube-videos',
          key: video.original_key,
        },
        queryRunner,
      );
      expect(result).toEqual({ id: video.slug, status: 'processing' });
    });
  });

  describe('reprocess', () => {
    it('throws VideoNotOwnedException when the caller does not own the channel', async () => {
      findOneBy.mockResolvedValue(makeVideo({ status: 'failed' }));
      findByUserId.mockResolvedValue(makeChannel('other-channel'));

      await expect(service.reprocess('user-1', 'video-1')).rejects.toThrow(
        VideoNotOwnedException,
      );
    });

    it('throws InvalidVideoStatusException when the video is not in failed status', async () => {
      findOneBy.mockResolvedValue(makeVideo({ status: 'ready' }));
      findByUserId.mockResolvedValue(makeChannel());

      await expect(service.reprocess('user-1', 'video-1')).rejects.toThrow(
        InvalidVideoStatusException,
      );
    });

    it('clears the failure reason, flips status, and enqueues processing within one transaction', async () => {
      const video = makeVideo({
        status: 'failed',
        failure_reason: 'ffmpeg crashed',
      });
      findOneBy.mockResolvedValue(video);
      findByUserId.mockResolvedValue(makeChannel());

      const result = await service.reprocess('user-1', 'video-1');

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(Video, video.id, {
        status: 'processing',
        failure_reason: null,
      });
      expect(enqueueVideoProcessing).toHaveBeenCalledWith(
        {
          videoId: video.id,
          bucket: 'streamtube-videos',
          key: video.original_key,
        },
        queryRunner,
      );
      expect(result).toEqual({ id: video.slug, status: 'processing' });
    });
  });

  describe('findById', () => {
    it('throws VideoNotFoundException when the video does not exist', async () => {
      findOneBy.mockResolvedValue(null);

      await expect(service.findById('user-1', 'video-1')).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('throws VideoNotOwnedException when the caller does not own the channel', async () => {
      findOneBy.mockResolvedValue(makeVideo());
      findByUserId.mockResolvedValue(makeChannel('other-channel'));

      await expect(service.findById('user-1', 'video-1')).rejects.toThrow(
        VideoNotOwnedException,
      );
    });

    it('returns the video metadata for the owning channel', async () => {
      const video = makeVideo({ status: 'ready', duration_seconds: 42 });
      findOneBy.mockResolvedValue(video);
      findByUserId.mockResolvedValue(makeChannel());

      const result = await service.findById('user-1', 'video-1');

      expect(result).toEqual({
        id: video.slug,
        status: 'ready',
        title: video.title,
        originalFilename: video.original_filename,
        mimeType: video.mime_type,
        sizeBytes: video.size_bytes,
        durationSeconds: 42,
        metadata: null,
        createdAt: video.created_at,
        updatedAt: video.updated_at,
      });
    });
  });

  describe('getStreamUrl', () => {
    it('throws InvalidVideoStatusException when the video is not ready', async () => {
      findOneBy.mockResolvedValue(makeVideo({ status: 'processing' }));
      findByUserId.mockResolvedValue(makeChannel());

      await expect(service.getStreamUrl('user-1', 'video-1')).rejects.toThrow(
        InvalidVideoStatusException,
      );
    });

    it('presigns an inline-disposition URL for a ready video', async () => {
      const video = makeVideo({ status: 'ready' });
      findOneBy.mockResolvedValue(video);
      findByUserId.mockResolvedValue(makeChannel());

      const result = await service.getStreamUrl('user-1', 'video-1');

      expect(presignGetObject).toHaveBeenCalledWith(
        video.original_key,
        'inline',
      );
      expect(result).toBe('https://presigned-get-url');
    });
  });

  describe('getDownloadUrl', () => {
    it('throws InvalidVideoStatusException when the video is not ready', async () => {
      findOneBy.mockResolvedValue(makeVideo({ status: 'processing' }));
      findByUserId.mockResolvedValue(makeChannel());

      await expect(service.getDownloadUrl('user-1', 'video-1')).rejects.toThrow(
        InvalidVideoStatusException,
      );
    });

    it('presigns an attachment-disposition URL for a ready video', async () => {
      const video = makeVideo({ status: 'ready' });
      findOneBy.mockResolvedValue(video);
      findByUserId.mockResolvedValue(makeChannel());

      const result = await service.getDownloadUrl('user-1', 'video-1');

      expect(presignGetObject).toHaveBeenCalledWith(
        video.original_key,
        'attachment',
      );
      expect(result).toBe('https://presigned-get-url');
    });
  });
});
