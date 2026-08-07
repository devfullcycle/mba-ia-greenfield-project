import type { Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { StorageService } from '../storage/storage.service';
import { Video } from './entities/video.entity';
import { VideoStatus } from './video-status';
import {
  FileTooLargeException,
  InvalidVideoStateException,
  NotVideoOwnerException,
  UnsupportedMediaTypeException,
  VideoNotFoundException,
} from './exceptions/video.exceptions';
import { PublicIdService } from './services/public-id.service';
import { VideoQueueService } from './services/video-queue.service';
import { VideosService } from './videos.service';

describe('VideosService', () => {
  let service: VideosService;
  let videos: {
    create: jest.Mock;
    save: jest.Mock;
    findOneBy: jest.Mock;
    existsBy: jest.Mock;
  };
  let channels: { findOneBy: jest.Mock };
  let storage: {
    createMultipartUpload: jest.Mock;
    presignUploadPart: jest.Mock;
    completeMultipartUpload: jest.Mock;
    headObject: jest.Mock;
  };
  let publicIds: { generateUnique: jest.Mock };
  let queue: { enqueueProcessing: jest.Mock };

  const config = {
    maxSizeBytes: 10_737_418_240,
    uploadPartSizeBytes: 100_000_000,
    thumbnailTimestampSeconds: 1,
    processingConcurrency: 2,
    processingAttempts: 5,
  };

  beforeEach(() => {
    videos = {
      create: jest.fn((v) => v as Video),
      save: jest.fn(async (v) => ({ id: 'vid-1', ...v }) as Video),
      findOneBy: jest.fn(),
      existsBy: jest.fn().mockResolvedValue(false),
    };
    channels = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'chan-1' } as Channel),
    };
    storage = {
      createMultipartUpload: jest.fn().mockResolvedValue('upload-1'),
      presignUploadPart: jest.fn(
        async (_k, _u, n) => `https://minio/part/${n}`,
      ),
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
      headObject: jest
        .fn()
        .mockResolvedValue({ contentLength: 250, contentType: 'video/mp4' }),
    };
    publicIds = { generateUnique: jest.fn().mockResolvedValue('pubABCDEFGHI') };
    queue = { enqueueProcessing: jest.fn().mockResolvedValue(undefined) };

    service = new VideosService(
      videos as unknown as Repository<Video>,
      channels as unknown as Repository<Channel>,
      config,
      storage as unknown as StorageService,
      publicIds as unknown as PublicIdService,
      queue as unknown as VideoQueueService,
    );
  });

  describe('initiateUpload', () => {
    const baseDto = {
      title: 'Clip',
      filename: 'clip.mp4',
      contentType: 'video/mp4',
      fileSize: 250_000_000,
    };

    it('rejects a non-video content type', async () => {
      await expect(
        service.initiateUpload('user-1', {
          ...baseDto,
          contentType: 'image/png',
        }),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    });

    it('rejects a file larger than the maximum', async () => {
      await expect(
        service.initiateUpload('user-1', {
          ...baseDto,
          fileSize: config.maxSizeBytes + 1,
        }),
      ).rejects.toBeInstanceOf(FileTooLargeException);
    });

    it('creates a draft and returns one presigned URL per part', async () => {
      const result = await service.initiateUpload('user-1', baseDto);

      // 250MB / 100MB = 3 parts
      expect(result.parts).toHaveLength(3);
      expect(result.status).toBe(VideoStatus.DRAFT);
      expect(result.uploadId).toBe('upload-1');
      expect(storage.createMultipartUpload).toHaveBeenCalledWith(
        'videos/pubABCDEFGHI/source',
        'video/mp4',
      );
      expect(videos.save).toHaveBeenCalled();
    });
  });

  describe('completeUpload', () => {
    const draft = {
      id: 'vid-1',
      public_id: 'pubABCDEFGHI',
      channel_id: 'chan-1',
      status: VideoStatus.DRAFT,
      storage_key: 'videos/pubABCDEFGHI/source',
      upload_id: 'upload-1',
    } as Video;

    it('throws when the video does not exist', async () => {
      videos.findOneBy.mockResolvedValue(null);
      await expect(
        service.completeUpload('user-1', 'missing', {
          parts: [{ partNumber: 1, etag: 'e' }],
        }),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });

    it('throws when the caller is not the owner', async () => {
      videos.findOneBy.mockResolvedValue({ ...draft, channel_id: 'other' });
      await expect(
        service.completeUpload('user-1', 'vid-1', {
          parts: [{ partNumber: 1, etag: 'e' }],
        }),
      ).rejects.toBeInstanceOf(NotVideoOwnerException);
    });

    it('throws when the video is not in draft', async () => {
      videos.findOneBy.mockResolvedValue({
        ...draft,
        status: VideoStatus.PROCESSING,
      });
      await expect(
        service.completeUpload('user-1', 'vid-1', {
          parts: [{ partNumber: 1, etag: 'e' }],
        }),
      ).rejects.toBeInstanceOf(InvalidVideoStateException);
    });

    it('finalizes, flips to processing and enqueues', async () => {
      videos.findOneBy.mockResolvedValue({ ...draft });
      const result = await service.completeUpload('user-1', 'vid-1', {
        parts: [{ partNumber: 1, etag: 'etag-1' }],
      });

      expect(storage.completeMultipartUpload).toHaveBeenCalledWith(
        'videos/pubABCDEFGHI/source',
        'upload-1',
        [{ partNumber: 1, etag: 'etag-1' }],
      );
      expect(storage.headObject).toHaveBeenCalled();
      expect(queue.enqueueProcessing).toHaveBeenCalledWith('vid-1');
      expect(result.status).toBe(VideoStatus.PROCESSING);
    });
  });
});
