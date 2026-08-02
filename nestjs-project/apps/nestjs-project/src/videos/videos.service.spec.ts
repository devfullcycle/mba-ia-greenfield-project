import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { ChannelsService } from '../channels/channels.service';
import { StorageService } from '../storage/storage.service';
import storageConfig from '../config/storage.config';
import { Video } from './entities/video.entity';
import { VideosService } from './videos.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { VIDEO_PROCESSING_QUEUE } from './interfaces/process-video-job.interface';

describe('VideosService', () => {
  let service: VideosService;

  const videoRepository = {
    create: jest.fn((entity: Partial<Video>) => entity as Video),
    save: jest.fn((entity: Partial<Video>) => Promise.resolve(entity as Video)),
    findOneBy: jest.fn(),
  };
  const channelsService = {
    findByUserId: jest.fn(),
  };
  const storageService = {
    createMultipartUpload: jest.fn(),
    getUploadPartUrl: jest.fn(),
    completeMultipartUpload: jest.fn(),
    getObjectPresignedUrl: jest.fn(),
  };
  const videoProcessingQueue = {
    add: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: ChannelsService, useValue: channelsService },
        { provide: StorageService, useValue: storageService },
        {
          provide: storageConfig.KEY,
          useValue: {
            multipartPartSizeMb: 100,
            presignedUrlExpirationSeconds: 3600,
          },
        },
        {
          provide: getQueueToken(VIDEO_PROCESSING_QUEUE),
          useValue: videoProcessingQueue,
        },
      ],
    }).compile();

    service = module.get(VideosService);
  });

  const dto: CreateVideoDto = {
    originalFilename: 'movie.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 1024,
  };

  it('should create the video row with draft status and default fields', async () => {
    channelsService.findByUserId.mockResolvedValue({ id: 'channel-1' });
    storageService.createMultipartUpload.mockResolvedValue({
      uploadId: 'upload-1',
    });
    storageService.getUploadPartUrl.mockResolvedValue('https://part-url');

    const result = await service.initiateUpload('user-1', dto);

    expect(videoRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: 'channel-1',
        original_filename: 'movie.mp4',
        mime_type: 'video/mp4',
        size_bytes: 1024,
        upload_id: 'upload-1',
      }),
    );
    expect(result.uploadId).toBe('upload-1');
  });

  it('should compute exactly 1 part for a size equal to one part size', async () => {
    channelsService.findByUserId.mockResolvedValue({ id: 'channel-1' });
    storageService.createMultipartUpload.mockResolvedValue({
      uploadId: 'upload-1',
    });
    storageService.getUploadPartUrl.mockResolvedValue('https://part-url');

    const oneHundredMb = 100 * 1024 * 1024;
    const result = await service.initiateUpload('user-1', {
      ...dto,
      sizeBytes: oneHundredMb,
    });

    expect(result.parts).toHaveLength(1);
  });

  it('should compute 2 parts for a size one byte over one part size', async () => {
    channelsService.findByUserId.mockResolvedValue({ id: 'channel-1' });
    storageService.createMultipartUpload.mockResolvedValue({
      uploadId: 'upload-1',
    });
    storageService.getUploadPartUrl.mockResolvedValue('https://part-url');

    const oneHundredMbPlusOne = 100 * 1024 * 1024 + 1;
    const result = await service.initiateUpload('user-1', {
      ...dto,
      sizeBytes: oneHundredMbPlusOne,
    });

    expect(result.parts).toHaveLength(2);
    expect(result.parts.map((p) => p.partNumber)).toEqual([1, 2]);
  });

  it('should call StorageService with the computed storage key and declared mime type', async () => {
    channelsService.findByUserId.mockResolvedValue({ id: 'channel-1' });
    storageService.createMultipartUpload.mockResolvedValue({
      uploadId: 'upload-1',
    });
    storageService.getUploadPartUrl.mockResolvedValue('https://part-url');

    await service.initiateUpload('user-1', dto);

    expect(storageService.createMultipartUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^videos\/.+\/original$/),
      'video/mp4',
    );
  });

  it('should throw when the authenticated user has no channel', async () => {
    channelsService.findByUserId.mockResolvedValue(null);

    await expect(service.initiateUpload('user-1', dto)).rejects.toThrow();
  });

  describe('completeUpload', () => {
    const completeDto: CompleteUploadDto = {
      parts: [{ partNumber: 1, eTag: 'etag-1' }],
    };
    const draftVideo = () => ({
      id: 'video-1',
      channel_id: 'channel-1',
      status: 'draft',
      storage_key: 'videos/video-1/original',
      upload_id: 'upload-1',
    });

    it('should transition draft to processing and enqueue exactly one job', async () => {
      videoRepository.findOneBy.mockResolvedValue(draftVideo());
      channelsService.findByUserId.mockResolvedValue({ id: 'channel-1' });
      storageService.completeMultipartUpload.mockResolvedValue(undefined);

      const result = await service.completeUpload(
        'video-1',
        'user-1',
        completeDto,
      );

      expect(result.status).toBe('processing');
      expect(videoProcessingQueue.add).toHaveBeenCalledTimes(1);
      expect(videoProcessingQueue.add).toHaveBeenCalledWith('process-video', {
        videoId: 'video-1',
      });
    });

    it('should throw VIDEO_NOT_FOUND for an unknown video', async () => {
      videoRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.completeUpload('missing', 'user-1', completeDto),
      ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    });

    it('should throw VIDEO_NOT_OWNED when the caller does not own the video', async () => {
      videoRepository.findOneBy.mockResolvedValue(draftVideo());
      channelsService.findByUserId.mockResolvedValue({ id: 'other-channel' });

      await expect(
        service.completeUpload('video-1', 'user-1', completeDto),
      ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_OWNED' });
    });

    it('should throw VIDEO_ALREADY_UPLOADED when status is not draft', async () => {
      videoRepository.findOneBy.mockResolvedValue({
        ...draftVideo(),
        status: 'processing',
      });
      channelsService.findByUserId.mockResolvedValue({ id: 'channel-1' });

      await expect(
        service.completeUpload('video-1', 'user-1', completeDto),
      ).rejects.toMatchObject({ errorCode: 'VIDEO_ALREADY_UPLOADED' });
      expect(videoProcessingQueue.add).not.toHaveBeenCalled();
    });

    it('should throw UPLOAD_FINALIZATION_FAILED and leave the video in draft when storage rejects completion', async () => {
      videoRepository.findOneBy.mockResolvedValue(draftVideo());
      channelsService.findByUserId.mockResolvedValue({ id: 'channel-1' });
      storageService.completeMultipartUpload.mockRejectedValue(
        new Error('S3 part mismatch'),
      );

      await expect(
        service.completeUpload('video-1', 'user-1', completeDto),
      ).rejects.toMatchObject({ errorCode: 'UPLOAD_FINALIZATION_FAILED' });
      expect(videoRepository.save).not.toHaveBeenCalled();
      expect(videoProcessingQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('findForPlayback', () => {
    const baseVideo = {
      id: 'video-1',
      status: 'draft',
      original_filename: 'movie.mp4',
      duration_seconds: null,
      created_at: new Date('2026-01-01'),
      storage_key: 'videos/video-1/original',
      thumbnail_key: null,
      failure_reason: null,
    };

    it('should omit media URLs for a draft video', async () => {
      videoRepository.findOneBy.mockResolvedValue({ ...baseVideo });

      const result = await service.findForPlayback('video-1');

      expect(result.status).toBe('draft');
      expect(result.streamUrl).toBeUndefined();
      expect(result.downloadUrl).toBeUndefined();
      expect(result.thumbnailUrl).toBeUndefined();
    });

    it('should omit media URLs for a processing video', async () => {
      videoRepository.findOneBy.mockResolvedValue({
        ...baseVideo,
        status: 'processing',
      });

      const result = await service.findForPlayback('video-1');

      expect(result.status).toBe('processing');
      expect(result.streamUrl).toBeUndefined();
    });

    it('should include streamUrl, downloadUrl, and thumbnailUrl for a ready video', async () => {
      videoRepository.findOneBy.mockResolvedValue({
        ...baseVideo,
        status: 'ready',
        duration_seconds: 12.5,
        thumbnail_key: 'videos/video-1/thumbnail.jpg',
      });
      storageService.getObjectPresignedUrl.mockResolvedValue(
        'https://presigned-url',
      );

      const result = await service.findForPlayback('video-1');

      expect(result.status).toBe('ready');
      expect(result.durationSeconds).toBe(12.5);
      expect(result.streamUrl).toBe('https://presigned-url');
      expect(result.downloadUrl).toBe('https://presigned-url');
      expect(result.thumbnailUrl).toBe('https://presigned-url');
    });

    it('should include failureReason for a failed video', async () => {
      videoRepository.findOneBy.mockResolvedValue({
        ...baseVideo,
        status: 'failed',
        failure_reason: 'Unsupported codec',
      });

      const result = await service.findForPlayback('video-1');

      expect(result.status).toBe('failed');
      expect(result.failureReason).toBe('Unsupported codec');
      expect(result.streamUrl).toBeUndefined();
    });

    it('should throw VIDEO_NOT_FOUND for an unknown id', async () => {
      videoRepository.findOneBy.mockResolvedValue(null);

      await expect(service.findForPlayback('missing')).rejects.toMatchObject({
        errorCode: 'VIDEO_NOT_FOUND',
      });
    });
  });
});
