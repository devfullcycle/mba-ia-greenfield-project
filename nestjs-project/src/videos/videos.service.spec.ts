import { getQueueToken } from '@nestjs/bullmq';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import {
  FileTooLargeException,
  InvalidVideoStatusTransitionException,
  UnsupportedMediaTypeException,
  UploadPartInvalidException,
  VideoNotFoundException,
} from './exceptions/video.exception';
import { StorageService } from './storage.service';
import { Video, VideoStatus } from './video.entity';
import { VIDEO_PROCESSING_QUEUE, VIDEO_PROCESS_JOB } from './videos.constants';
import { VideosService } from './videos.service';

describe('VideosService', () => {
  let videosService: VideosService;
  let videoRepository: jest.Mocked<Repository<Video>>;
  let storageService: jest.Mocked<StorageService>;
  let queue: jest.Mocked<Queue>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        {
          provide: getRepositoryToken(Video),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: StorageService,
          useValue: {
            initiateMultipartUpload: jest.fn(),
            getPresignedPartUploadUrl: jest.fn(),
            completeMultipartUpload: jest.fn(),
            getPresignedReadUrl: jest.fn(),
          },
        },
        {
          provide: getQueueToken(VIDEO_PROCESSING_QUEUE),
          useValue: { add: jest.fn() },
        },
      ],
    }).compile();

    videosService = module.get(VideosService);
    videoRepository = module.get(getRepositoryToken(Video));
    storageService = module.get(StorageService);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  describe('initiateUpload', () => {
    const validDto = {
      originalFileName: 'my-video.mp4',
      mimeType: 'video/mp4',
      sizeInBytes: 1024,
    };

    it('throws UnsupportedMediaTypeException for a mimeType outside the allowlist', async () => {
      await expect(
        videosService.initiateUpload('channel-1', {
          ...validDto,
          mimeType: 'application/pdf',
        }),
      ).rejects.toThrow(UnsupportedMediaTypeException);
      expect(storageService.initiateMultipartUpload).not.toHaveBeenCalled();
    });

    it('throws FileTooLargeException when sizeInBytes exceeds 10GB', async () => {
      await expect(
        videosService.initiateUpload('channel-1', {
          ...validDto,
          sizeInBytes: 10 * 1024 * 1024 * 1024 + 1,
        }),
      ).rejects.toThrow(FileTooLargeException);
      expect(storageService.initiateMultipartUpload).not.toHaveBeenCalled();
    });

    it('persists a draft video and returns the uploadId on success', async () => {
      storageService.initiateMultipartUpload.mockResolvedValue('upload-123');
      videoRepository.create.mockImplementation(
        (input) => input as unknown as Video,
      );
      videoRepository.save.mockImplementation((input) =>
        Promise.resolve({ ...input, id: (input as Video).id } as Video),
      );

      const result = await videosService.initiateUpload('channel-1', validDto);

      expect(result.status).toBe(VideoStatus.DRAFT);
      expect(result.uploadId).toBe('upload-123');
      expect(videoRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          channel_id: 'channel-1',
          status: VideoStatus.DRAFT,
          upload_id: 'upload-123',
        }),
      );
    });
  });

  describe('getPartUploadUrl', () => {
    it('throws UploadPartInvalidException for a partNumber below 1', async () => {
      await expect(
        videosService.getPartUploadUrl('video-1', 'channel-1', {
          partNumber: 0,
        }),
      ).rejects.toThrow(UploadPartInvalidException);
      expect(videoRepository.findOne).not.toHaveBeenCalled();
    });

    it('throws VideoNotFoundException when the video does not belong to the channel', async () => {
      videoRepository.findOne.mockResolvedValue({
        id: 'video-1',
        channel_id: 'other-channel',
      } as Video);

      await expect(
        videosService.getPartUploadUrl('video-1', 'channel-1', {
          partNumber: 1,
        }),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('returns a presigned URL for the owner', async () => {
      videoRepository.findOne.mockResolvedValue({
        id: 'video-1',
        channel_id: 'channel-1',
        storage_key: 'videos/channel-1/video-1/original.mp4',
        upload_id: 'upload-123',
      } as Video);
      storageService.getPresignedPartUploadUrl.mockResolvedValue(
        'https://minio/presigned-part-url',
      );

      const result = await videosService.getPartUploadUrl(
        'video-1',
        'channel-1',
        { partNumber: 1 },
      );

      expect(result.url).toBe('https://minio/presigned-part-url');
    });
  });

  describe('completeUpload', () => {
    const parts = [{ partNumber: 1, etag: 'abc' }];

    it('throws InvalidVideoStatusTransitionException when the video is not in draft', async () => {
      videoRepository.findOne.mockResolvedValue({
        id: 'video-1',
        channel_id: 'channel-1',
        status: VideoStatus.UPLOADED,
        upload_id: 'upload-123',
      } as Video);

      await expect(
        videosService.completeUpload('video-1', 'channel-1', { parts }),
      ).rejects.toThrow(InvalidVideoStatusTransitionException);
    });

    it('completes the multipart upload, marks uploaded, and enqueues processing', async () => {
      const video = {
        id: 'video-1',
        channel_id: 'channel-1',
        status: VideoStatus.DRAFT,
        storage_key: 'videos/channel-1/video-1/original.mp4',
        upload_id: 'upload-123',
      } as Video;
      videoRepository.findOne.mockResolvedValue(video);
      videoRepository.save.mockImplementation((input) =>
        Promise.resolve(input as Video),
      );

      const result = await videosService.completeUpload(
        'video-1',
        'channel-1',
        { parts },
      );

      expect(storageService.completeMultipartUpload).toHaveBeenCalledWith(
        video.storage_key,
        'upload-123',
        parts,
      );
      expect(result.status).toBe(VideoStatus.UPLOADED);
      expect(queue.add).toHaveBeenCalledWith(
        VIDEO_PROCESS_JOB,
        { videoId: 'video-1' },
        expect.objectContaining({ attempts: 3 }),
      );
    });
  });
});
