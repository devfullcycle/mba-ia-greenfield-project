import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { Video, VideoStatus } from './entities/video.entity';
import {
  FileTooLargeException,
  ForbiddenVideoAccessException,
  InvalidUploadStateException,
  MultipartCompletionFailedException,
  UploadAlreadyCompletedException,
  VideoNotFoundException,
  VideoNotReadyException,
} from './exceptions/video.exceptions';
import { VideosService } from './videos.service';

function makeDto(
  overrides: Partial<InitiateUploadDto> = {},
): InitiateUploadDto {
  return {
    original_filename: 'video.mp4',
    content_type: 'video/mp4',
    size_bytes: 25 * 1024 * 1024, // 25MB
    ...overrides,
  };
}

function makeProducer(): any {
  return { emitProcessingJob: jest.fn().mockResolvedValue(undefined) };
}

function makeVideo(overrides: Partial<Video> = {}): Video {
  const video = new Video();
  video.id = 'video-uuid';
  video.public_id = 'pub123456789'.slice(0, 12);
  video.channel_id = 'channel-1';
  video.status = VideoStatus.RASCUNHO;
  video.original_filename = 'video.mp4';
  video.original_key = 'videos/channel-1/video-uuid/original.mp4';
  video.upload_id = 'upload-1';
  video.thumbnail_key = null;
  video.duration_seconds = null;
  video.width = null;
  video.height = null;
  video.codec = null;
  video.bitrate = null;
  video.size_bytes = null;
  video.processing_error = null;
  video.created_at = new Date();
  video.updated_at = new Date();
  return Object.assign(video, overrides);
}

describe('VideosService', () => {
  describe('initiateUpload', () => {
    it('throws FileTooLargeException when size_bytes exceeds 10GB, without touching storage or the repository', async () => {
      const createMultipartUpload = jest.fn();
      const repository: any = { create: jest.fn(), save: jest.fn() };
      const storageService: any = { createMultipartUpload };
      const service = new VideosService(
        repository,
        storageService,
        makeProducer(),
      );

      await expect(
        service.initiateUpload(
          'channel-1',
          makeDto({ size_bytes: 10 * 1024 * 1024 * 1024 + 1 }),
        ),
      ).rejects.toThrow(FileTooLargeException);
      expect(createMultipartUpload).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('computes partCount as ceil(size_bytes / 10MB)', async () => {
      const repository: any = {
        create: jest.fn((v) => v),
        save: jest.fn((v) => v),
      };
      const storageService: any = {
        createMultipartUpload: jest
          .fn()
          .mockResolvedValue({ uploadId: 'upload-1' }),
        getUploadPartUrls: jest.fn().mockResolvedValue([]),
      };
      const service = new VideosService(
        repository,
        storageService,
        makeProducer(),
      );

      // 25MB / 10MB per part => 3 parts
      await service.initiateUpload('channel-1', makeDto());

      expect(storageService.getUploadPartUrls).toHaveBeenCalledWith(
        expect.any(String),
        'upload-1',
        3,
      );
    });

    it('builds the storage key as videos/{channelId}/{videoId}/original.<ext>', async () => {
      const repository: any = {
        create: jest.fn((v) => v),
        save: jest.fn((v) => v),
      };
      const storageService: any = {
        createMultipartUpload: jest
          .fn()
          .mockResolvedValue({ uploadId: 'upload-1' }),
        getUploadPartUrls: jest.fn().mockResolvedValue([]),
      };
      const service = new VideosService(
        repository,
        storageService,
        makeProducer(),
      );

      await service.initiateUpload(
        'channel-42',
        makeDto({ original_filename: 'clip.mov' }),
      );

      const [key] = storageService.createMultipartUpload.mock.calls[0];
      expect(key).toMatch(/^videos\/channel-42\/[0-9a-f-]{36}\/original\.mov$/);
    });

    it('persists a rascunho video row and returns id/upload_id/parts', async () => {
      const repository: any = {
        create: jest.fn((v) => v),
        save: jest.fn((v) => v),
      };
      const parts = [{ part_number: 1, url: 'https://signed-url' }];
      const storageService: any = {
        createMultipartUpload: jest
          .fn()
          .mockResolvedValue({ uploadId: 'upload-1' }),
        getUploadPartUrls: jest.fn().mockResolvedValue(parts),
      };
      const service = new VideosService(
        repository,
        storageService,
        makeProducer(),
      );

      const result = await service.initiateUpload('channel-1', makeDto());

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          channel_id: 'channel-1',
          original_filename: 'video.mp4',
          upload_id: 'upload-1',
        }),
      );
      expect(result.upload_id).toBe('upload-1');
      expect(result.parts).toBe(parts);
      expect(result.id).toHaveLength(12);
    });
  });

  describe('completeUpload', () => {
    const dto: CompleteUploadDto = { parts: [{ part_number: 1, etag: 'e1' }] };

    it('throws VideoNotFoundException when the video does not exist', async () => {
      const repository: any = { findOne: jest.fn().mockResolvedValue(null) };
      const service = new VideosService(repository, {} as any, makeProducer());

      await expect(
        service.completeUpload('channel-1', 'missing', dto),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('throws ForbiddenVideoAccessException when the caller does not own the video', async () => {
      const video = makeVideo({ channel_id: 'other-channel' });
      const repository: any = { findOne: jest.fn().mockResolvedValue(video) };
      const service = new VideosService(repository, {} as any, makeProducer());

      await expect(
        service.completeUpload('channel-1', video.public_id, dto),
      ).rejects.toThrow(ForbiddenVideoAccessException);
    });

    it('throws UploadAlreadyCompletedException when status is not rascunho', async () => {
      const video = makeVideo({ status: VideoStatus.PROCESSANDO });
      const repository: any = { findOne: jest.fn().mockResolvedValue(video) };
      const service = new VideosService(repository, {} as any, makeProducer());

      await expect(
        service.completeUpload('channel-1', video.public_id, dto),
      ).rejects.toThrow(UploadAlreadyCompletedException);
    });

    it('wraps a storage failure as MultipartCompletionFailedException', async () => {
      const video = makeVideo();
      const repository: any = {
        findOne: jest.fn().mockResolvedValue(video),
        save: jest.fn(),
      };
      const storageService: any = {
        completeMultipartUpload: jest
          .fn()
          .mockRejectedValue(new Error('ETag mismatch')),
      };
      const service = new VideosService(
        repository,
        storageService,
        makeProducer(),
      );

      await expect(
        service.completeUpload('channel-1', video.public_id, dto),
      ).rejects.toThrow(MultipartCompletionFailedException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('wraps a getObjectSize failure as MultipartCompletionFailedException too', async () => {
      const video = makeVideo();
      const repository: any = {
        findOne: jest.fn().mockResolvedValue(video),
        save: jest.fn(),
      };
      const storageService: any = {
        completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
        getObjectSize: jest
          .fn()
          .mockRejectedValue(new Error('object not found')),
      };
      const service = new VideosService(
        repository,
        storageService,
        makeProducer(),
      );

      await expect(
        service.completeUpload('channel-1', video.public_id, dto),
      ).rejects.toThrow(MultipartCompletionFailedException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('transitions to processando, clears upload_id, and emits exactly one processing job', async () => {
      const video = makeVideo();
      const repository: any = {
        findOne: jest.fn().mockResolvedValue(video),
        save: jest.fn((v) => v),
      };
      const storageService: any = {
        completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
        getObjectSize: jest.fn().mockResolvedValue(2048),
      };
      const producer = makeProducer();
      const service = new VideosService(repository, storageService, producer);

      const result = await service.completeUpload(
        'channel-1',
        video.public_id,
        dto,
      );

      expect(result.status).toBe(VideoStatus.PROCESSANDO);
      expect(storageService.getObjectSize).toHaveBeenCalledWith(
        video.original_key,
      );
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: VideoStatus.PROCESSANDO,
          upload_id: null,
          size_bytes: '2048',
        }),
      );
      expect(producer.emitProcessingJob).toHaveBeenCalledTimes(1);
      expect(producer.emitProcessingJob).toHaveBeenCalledWith(
        video.id,
        video.original_key,
      );
    });
  });

  describe('abortUpload', () => {
    it('throws VideoNotFoundException when the video does not exist', async () => {
      const repository: any = { findOne: jest.fn().mockResolvedValue(null) };
      const service = new VideosService(repository, {} as any, makeProducer());

      await expect(service.abortUpload('channel-1', 'missing')).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('throws ForbiddenVideoAccessException when the caller does not own the video', async () => {
      const video = makeVideo({ channel_id: 'other-channel' });
      const repository: any = { findOne: jest.fn().mockResolvedValue(video) };
      const service = new VideosService(repository, {} as any, makeProducer());

      await expect(
        service.abortUpload('channel-1', video.public_id),
      ).rejects.toThrow(ForbiddenVideoAccessException);
    });

    it('throws InvalidUploadStateException when status is not rascunho', async () => {
      const video = makeVideo({ status: VideoStatus.PROCESSANDO });
      const repository: any = { findOne: jest.fn().mockResolvedValue(video) };
      const service = new VideosService(repository, {} as any, makeProducer());

      await expect(
        service.abortUpload('channel-1', video.public_id),
      ).rejects.toThrow(InvalidUploadStateException);
    });

    it('aborts the storage upload and deletes the video row on the happy path', async () => {
      const video = makeVideo();
      const repository: any = {
        findOne: jest.fn().mockResolvedValue(video),
        remove: jest.fn().mockResolvedValue(video),
      };
      const storageService: any = {
        abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
      };
      const service = new VideosService(
        repository,
        storageService,
        makeProducer(),
      );

      await service.abortUpload('channel-1', video.public_id);

      expect(storageService.abortMultipartUpload).toHaveBeenCalledWith(
        video.original_key,
        video.upload_id,
      );
      expect(repository.remove).toHaveBeenCalledWith(video);
    });
  });

  describe('findByPublicId', () => {
    it('throws VideoNotFoundException when the video does not exist', async () => {
      const repository: any = { findOne: jest.fn().mockResolvedValue(null) };
      const service = new VideosService(repository, {} as any, makeProducer());

      await expect(
        service.findByPublicId('missing', 'channel-1'),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('returns a pronto video for an anonymous requester', async () => {
      const video = makeVideo({ status: VideoStatus.PRONTO });
      const repository: any = { findOne: jest.fn().mockResolvedValue(video) };
      const service = new VideosService(repository, {} as any, makeProducer());

      const result = await service.findByPublicId(video.public_id);

      expect(result).toBe(video);
    });

    it('returns a non-pronto video for its owner', async () => {
      const video = makeVideo({ status: VideoStatus.PROCESSANDO });
      const repository: any = { findOne: jest.fn().mockResolvedValue(video) };
      const service = new VideosService(repository, {} as any, makeProducer());

      const result = await service.findByPublicId(
        video.public_id,
        video.channel_id,
      );

      expect(result).toBe(video);
    });

    it('throws VideoNotFoundException for a non-pronto video requested anonymously', async () => {
      const video = makeVideo({ status: VideoStatus.PROCESSANDO });
      const repository: any = { findOne: jest.fn().mockResolvedValue(video) };
      const service = new VideosService(repository, {} as any, makeProducer());

      await expect(service.findByPublicId(video.public_id)).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('throws VideoNotFoundException for a non-pronto video requested by a non-owner', async () => {
      const video = makeVideo({ status: VideoStatus.PROCESSANDO });
      const repository: any = { findOne: jest.fn().mockResolvedValue(video) };
      const service = new VideosService(repository, {} as any, makeProducer());

      await expect(
        service.findByPublicId(video.public_id, 'other-channel'),
      ).rejects.toThrow(VideoNotFoundException);
    });
  });

  describe('getStreamUrl / getDownloadUrl', () => {
    it('throws VideoNotFoundException when the video is not visible to the requester', async () => {
      const video = makeVideo({ status: VideoStatus.PROCESSANDO });
      const repository: any = { findOne: jest.fn().mockResolvedValue(video) };
      const service = new VideosService(repository, {} as any, makeProducer());

      await expect(service.getStreamUrl(video.public_id)).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('throws VideoNotReadyException when the video is visible but not pronto (even for the owner)', async () => {
      const video = makeVideo({ status: VideoStatus.PROCESSANDO });
      const repository: any = { findOne: jest.fn().mockResolvedValue(video) };
      const service = new VideosService(repository, {} as any, makeProducer());

      await expect(
        service.getStreamUrl(video.public_id, video.channel_id),
      ).rejects.toThrow(VideoNotReadyException);
    });

    it('getStreamUrl returns a presigned URL without a content-disposition override', async () => {
      const video = makeVideo({ status: VideoStatus.PRONTO });
      const repository: any = { findOne: jest.fn().mockResolvedValue(video) };
      const storageService: any = {
        getPresignedGetUrl: jest
          .fn()
          .mockResolvedValue('https://signed-stream'),
      };
      const service = new VideosService(
        repository,
        storageService,
        makeProducer(),
      );

      const url = await service.getStreamUrl(video.public_id);

      expect(url).toBe('https://signed-stream');
      expect(storageService.getPresignedGetUrl).toHaveBeenCalledWith(
        video.original_key,
        { expiresIn: 900 },
      );
    });

    it('getDownloadUrl returns a presigned URL with an attachment content-disposition', async () => {
      const video = makeVideo({ status: VideoStatus.PRONTO });
      const repository: any = { findOne: jest.fn().mockResolvedValue(video) };
      const storageService: any = {
        getPresignedGetUrl: jest
          .fn()
          .mockResolvedValue('https://signed-download'),
      };
      const service = new VideosService(
        repository,
        storageService,
        makeProducer(),
      );

      const url = await service.getDownloadUrl(video.public_id);

      expect(url).toBe('https://signed-download');
      expect(storageService.getPresignedGetUrl).toHaveBeenCalledWith(
        video.original_key,
        {
          expiresIn: 900,
          responseContentDisposition: `attachment; filename="${video.original_filename}"`,
        },
      );
    });
  });
});
