import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { VideosService } from './videos.service';
import { Video } from './entities/video.entity';
import { Channel } from '../channels/entities/channel.entity';
import { StorageService } from '../storage/storage.service';
import { VideoStatus, VIDEO_QUEUE_NAME } from './videos.constants';
import {
  ChannelRequiredException,
  VideoNotFoundException,
  VideoNotDraftException,
  VideoNotReadyException,
  VideoOwnershipException,
  VideoRangeNotSatisfiableException,
  VideoUploadEnqueueException,
} from '../common/exceptions/domain.exception';
import storageConfig from '../config/storage.config';

const mockStorageCfg = {
  endpoint: 'http://minio:9000',
  bucket: 'streamtube',
  accessKey: 'x',
  secretKey: 'x',
};

const mockStorageService = {
  generatePresignedPutUrl: jest
    .fn()
    .mockResolvedValue('https://minio/presigned-url'),
  getObject: jest.fn(),
  putObject: jest.fn(),
  deleteObject: jest.fn(),
  getBucketName: jest.fn().mockReturnValue('streamtube'),
};

const mockQueue = {
  add: jest.fn().mockResolvedValue({}),
  getJob: jest.fn(),
};

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'channel-uuid',
    user_id: 'user-uuid',
    name: 'Test',
    nickname: 'test',
    description: null,
    created_at: new Date(),
    updated_at: new Date(),
    user: null as any,
    ...overrides,
  };
}

function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'video-uuid',
    title: 'Test Video',
    status: VideoStatus.DRAFT,
    channel_id: 'channel-uuid',
    storage_key: 'videos/video-uuid/original.mp4',
    thumbnail_key: null,
    duration_seconds: null,
    processing_metadata: null,
    error_cause: null,
    created_at: new Date(),
    updated_at: new Date(),
    channel: makeChannel(),
    ...overrides,
  };
}

describe('VideosService', () => {
  let service: VideosService;
  let videoRepo: jest.Mocked<Repository<Video>>;
  let channelRepo: jest.Mocked<Repository<Channel>>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideosService,
        {
          provide: getRepositoryToken(Video),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            findAndCount: jest.fn(),
            remove: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Channel),
          useValue: { findOne: jest.fn() },
        },
        { provide: getQueueToken(VIDEO_QUEUE_NAME), useValue: mockQueue },
        { provide: StorageService, useValue: mockStorageService },
        { provide: storageConfig.KEY, useValue: mockStorageCfg },
      ],
    }).compile();

    service = module.get(VideosService);
    videoRepo = module.get(getRepositoryToken(Video));
    channelRepo = module.get(getRepositoryToken(Channel));
  });

  // ── initiateUpload ──────────────────────────────────────────────────────────

  describe('initiateUpload', () => {
    it('should create draft video and return upload_url and storage_key', async () => {
      const channel = makeChannel();
      channelRepo.findOne = jest.fn().mockResolvedValue(channel);
      videoRepo.create = jest.fn().mockReturnValue(makeVideo());
      videoRepo.save = jest.fn().mockResolvedValue(makeVideo());

      const result = await service.initiateUpload('user-uuid', {
        title: 'My Video',
        file_size: 1024,
        mime_type: 'video/mp4',
      });

      expect(result.upload_url).toBeDefined();
      expect(result.storage_key).toMatch(/^videos\/.+\/original\.mp4$/);
      expect(result.status).toBe(VideoStatus.DRAFT);
    });

    it('should derive extension from mime_type', async () => {
      channelRepo.findOne = jest.fn().mockResolvedValue(makeChannel());
      videoRepo.create = jest.fn().mockReturnValue(makeVideo());
      videoRepo.save = jest.fn().mockResolvedValue(makeVideo());

      const result = await service.initiateUpload('user-uuid', {
        title: 'My Video',
        file_size: 1024,
        mime_type: 'video/webm',
      });

      expect(result.storage_key).toMatch(/\.webm$/);
    });

    it('should throw ChannelRequiredException when user has no channel', async () => {
      channelRepo.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        service.initiateUpload('user-uuid', {
          title: 'My Video',
          file_size: 1024,
          mime_type: 'video/mp4',
        }),
      ).rejects.toThrow(ChannelRequiredException);
    });
  });

  // ── confirmUpload ───────────────────────────────────────────────────────────

  describe('confirmUpload', () => {
    it('should transition draft to processing and enqueue job', async () => {
      const video = makeVideo({ status: VideoStatus.DRAFT });
      videoRepo.findOne = jest.fn().mockResolvedValue(video);
      videoRepo.save = jest
        .fn()
        .mockResolvedValue({ ...video, status: VideoStatus.PROCESSING });

      const result = await service.confirmUpload('video-uuid', 'user-uuid');

      expect(mockQueue.add).toHaveBeenCalledWith(
        VIDEO_QUEUE_NAME,
        expect.objectContaining({ videoId: 'video-uuid' }),
        expect.objectContaining({ jobId: 'video-uuid', attempts: 3 }),
      );
      expect(result.status).toBe(VideoStatus.PROCESSING);
    });

    it('should throw VideoNotFoundException when video does not exist', async () => {
      videoRepo.findOne = jest.fn().mockResolvedValue(null);

      await expect(
        service.confirmUpload('missing', 'user-uuid'),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('should throw VideoOwnershipException when user is not owner', async () => {
      const video = makeVideo({
        channel: makeChannel({ user_id: 'other-user' }),
      });
      videoRepo.findOne = jest.fn().mockResolvedValue(video);

      await expect(
        service.confirmUpload('video-uuid', 'user-uuid'),
      ).rejects.toThrow(VideoOwnershipException);
    });

    it('should throw VideoNotDraftException when video is not draft', async () => {
      const video = makeVideo({ status: VideoStatus.PROCESSING });
      videoRepo.findOne = jest.fn().mockResolvedValue(video);

      await expect(
        service.confirmUpload('video-uuid', 'user-uuid'),
      ).rejects.toThrow(VideoNotDraftException);
    });

    it('should throw VideoUploadEnqueueException and keep draft status when queue fails', async () => {
      const video = makeVideo({ status: VideoStatus.DRAFT });
      videoRepo.findOne = jest.fn().mockResolvedValue(video);
      mockQueue.add.mockRejectedValueOnce(new Error('Redis down'));

      await expect(
        service.confirmUpload('video-uuid', 'user-uuid'),
      ).rejects.toThrow(VideoUploadEnqueueException);
      expect(videoRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── findById ────────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('should return public view of video', async () => {
      videoRepo.findOne = jest.fn().mockResolvedValue(makeVideo());

      const result = await service.findById('video-uuid');

      expect(result.id).toBe('video-uuid');
      expect(result).not.toHaveProperty('error_cause');
    });

    it('should build thumbnail_url when thumbnail_key is set', async () => {
      videoRepo.findOne = jest
        .fn()
        .mockResolvedValue(
          makeVideo({ thumbnail_key: 'videos/v/thumbnail.jpg' }),
        );

      const result = await service.findById('video-uuid');

      expect(result.thumbnail_url).toBe(
        'http://minio:9000/streamtube/videos/v/thumbnail.jpg',
      );
    });

    it('should return null thumbnail_url when thumbnail_key is null', async () => {
      videoRepo.findOne = jest
        .fn()
        .mockResolvedValue(makeVideo({ thumbnail_key: null }));

      const result = await service.findById('video-uuid');

      expect(result.thumbnail_url).toBeNull();
    });

    it('should throw VideoNotFoundException for unknown id', async () => {
      videoRepo.findOne = jest.fn().mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(
        VideoNotFoundException,
      );
    });
  });

  // ── streamVideo ─────────────────────────────────────────────────────────────

  describe('streamVideo', () => {
    it('should return stream for ready video', async () => {
      videoRepo.findOne = jest
        .fn()
        .mockResolvedValue(makeVideo({ status: VideoStatus.READY }));
      mockStorageService.getObject.mockResolvedValue({
        stream: {},
        contentType: 'video/mp4',
        contentLength: 1024,
      });

      const result = await service.streamVideo('video-uuid');

      expect(result.statusCode).toBe(200);
    });

    it('should return 206 statusCode for range request', async () => {
      videoRepo.findOne = jest
        .fn()
        .mockResolvedValue(makeVideo({ status: VideoStatus.READY }));
      mockStorageService.getObject.mockResolvedValue({
        stream: {},
        contentType: 'video/mp4',
        contentLength: 512,
        contentRange: 'bytes 0-511/1024',
      });

      const result = await service.streamVideo('video-uuid', 'bytes=0-511');

      expect(result.statusCode).toBe(206);
      expect(result.contentRange).toBe('bytes 0-511/1024');
    });

    it('should throw VideoNotReadyException for draft video', async () => {
      videoRepo.findOne = jest
        .fn()
        .mockResolvedValue(makeVideo({ status: VideoStatus.DRAFT }));

      await expect(service.streamVideo('video-uuid')).rejects.toThrow(
        VideoNotReadyException,
      );
    });

    it('should throw VideoRangeNotSatisfiableException when storage returns 416', async () => {
      videoRepo.findOne = jest
        .fn()
        .mockResolvedValue(makeVideo({ status: VideoStatus.READY }));
      const rangeError = Object.assign(new Error('InvalidRange'), {
        $metadata: { httpStatusCode: 416 },
      });
      mockStorageService.getObject.mockRejectedValue(rangeError);

      await expect(
        service.streamVideo('video-uuid', 'bytes=99999-99999'),
      ).rejects.toThrow(VideoRangeNotSatisfiableException);
    });
  });

  // ── listChannelVideos ───────────────────────────────────────────────────────

  describe('listChannelVideos', () => {
    it('should return paginated videos in descending order', async () => {
      channelRepo.findOne = jest.fn().mockResolvedValue(makeChannel());
      videoRepo.findAndCount = jest
        .fn()
        .mockResolvedValue([[makeVideo(), makeVideo()], 2]);

      const result = await service.listChannelVideos(
        'channel-uuid',
        'user-uuid',
        { page: 1, limit: 20 },
      );

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.has_next_page).toBe(false);
    });

    it('should calculate has_next_page correctly', async () => {
      channelRepo.findOne = jest.fn().mockResolvedValue(makeChannel());
      videoRepo.findAndCount = jest.fn().mockResolvedValue([[makeVideo()], 25]);

      const result = await service.listChannelVideos(
        'channel-uuid',
        'user-uuid',
        { page: 1, limit: 20 },
      );

      expect(result.has_next_page).toBe(true);
    });

    it('should throw VideoOwnershipException for wrong user', async () => {
      channelRepo.findOne = jest
        .fn()
        .mockResolvedValue(makeChannel({ user_id: 'other' }));

      await expect(
        service.listChannelVideos('channel-uuid', 'user-uuid', {
          page: 1,
          limit: 20,
        }),
      ).rejects.toThrow(VideoOwnershipException);
    });
  });

  // ── updateTitle ──────────────────────────────────────────────────────────────

  describe('updateTitle', () => {
    it('should update title and keep id unchanged', async () => {
      const video = makeVideo();
      videoRepo.findOne = jest.fn().mockResolvedValue(video);
      videoRepo.save = jest
        .fn()
        .mockResolvedValue({ ...video, title: 'New Title' });

      const result = await service.updateTitle('video-uuid', 'user-uuid', {
        title: 'New Title',
      });

      expect(result.id).toBe('video-uuid');
      expect(result.title).toBe('New Title');
    });

    it('should throw VideoOwnershipException for wrong user', async () => {
      videoRepo.findOne = jest
        .fn()
        .mockResolvedValue(
          makeVideo({ channel: makeChannel({ user_id: 'other' }) }),
        );

      await expect(
        service.updateTitle('video-uuid', 'user-uuid', { title: 'x' }),
      ).rejects.toThrow(VideoOwnershipException);
    });
  });

  // ── deleteVideo ──────────────────────────────────────────────────────────────

  describe('deleteVideo', () => {
    it('should delete video, storage files, and cancel job', async () => {
      const video = makeVideo({ thumbnail_key: 'videos/v/thumbnail.jpg' });
      videoRepo.findOne = jest.fn().mockResolvedValue(video);
      videoRepo.remove = jest.fn().mockResolvedValue(video);
      const mockJob = { remove: jest.fn() };
      mockQueue.getJob.mockResolvedValue(mockJob);

      await service.deleteVideo('video-uuid', 'user-uuid');

      expect(mockStorageService.deleteObject).toHaveBeenCalledWith(
        video.storage_key,
      );
      expect(mockStorageService.deleteObject).toHaveBeenCalledWith(
        video.thumbnail_key,
      );
      expect(mockJob.remove).toHaveBeenCalled();
      expect(videoRepo.remove).toHaveBeenCalled();
    });

    it('should tolerate missing thumbnail_key', async () => {
      const video = makeVideo({ thumbnail_key: null });
      videoRepo.findOne = jest.fn().mockResolvedValue(video);
      videoRepo.remove = jest.fn().mockResolvedValue(video);
      mockQueue.getJob.mockResolvedValue(null);

      await service.deleteVideo('video-uuid', 'user-uuid');

      expect(mockStorageService.deleteObject).toHaveBeenCalledTimes(1);
    });
  });

  // ── downloadVideo ────────────────────────────────────────────────────────────

  describe('downloadVideo', () => {
    it('should return stream with filename for ready video', async () => {
      videoRepo.findOne = jest
        .fn()
        .mockResolvedValue(
          makeVideo({ status: VideoStatus.READY, title: 'My Video' }),
        );
      mockStorageService.getObject.mockResolvedValue({
        stream: {},
        contentType: 'video/mp4',
        contentLength: 2048,
      });

      const result = await service.downloadVideo('video-uuid');

      expect(result.filename).toContain('mp4');
    });

    it('should throw VideoNotReadyException for processing video', async () => {
      videoRepo.findOne = jest
        .fn()
        .mockResolvedValue(makeVideo({ status: VideoStatus.PROCESSING }));

      await expect(service.downloadVideo('video-uuid')).rejects.toThrow(
        VideoNotReadyException,
      );
    });

    it('should throw VideoNotFoundException for unknown id', async () => {
      videoRepo.findOne = jest.fn().mockResolvedValue(null);

      await expect(service.downloadVideo('missing')).rejects.toThrow(
        VideoNotFoundException,
      );
    });
  });
});
