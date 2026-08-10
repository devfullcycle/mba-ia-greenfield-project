import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ChannelRequiredException,
  VideoAccessDeniedException,
  VideoInvalidStatusException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/entities/channel.entity';
import { StorageService } from '../storage/storage.service';
import { VideoQueueService } from '../queue/video-queue.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { UploadCompleteDto } from './dto/upload-complete.dto';
import { Video } from './entities/video.entity';
import { VideoStatus } from './enums/video-status.enum';
import { VideosService } from './videos.service';

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  const channel = new Channel();
  channel.id = 'channel-id';
  channel.name = 'Test Channel';
  channel.nickname = 'testchannel';
  channel.description = null;
  channel.user_id = 'owner-user-id';
  channel.created_at = new Date();
  channel.updated_at = new Date();
  return Object.assign(channel, overrides);
}

function makeVideo(overrides: Partial<Video> = {}): Video {
  const video = new Video();
  video.id = 'video-id';
  video.channel_id = 'channel-id';
  video.title = 'My Video';
  video.slug = 'abc12345def';
  video.status = VideoStatus.DRAFT;
  video.upload_id = 'upload-id';
  video.storage_key = 'videos/abc12345def/original';
  video.thumbnail_key = null;
  video.duration_seconds = null;
  video.metadata = null;
  video.error_message = null;
  video.created_at = new Date();
  video.updated_at = new Date();
  video.channel = makeChannel();
  return Object.assign(video, overrides);
}

describe('VideosService', () => {
  let videosService: VideosService;
  let videoRepository: jest.Mocked<Repository<Video>>;
  let channelsService: jest.Mocked<ChannelsService>;
  let storageService: jest.Mocked<StorageService>;
  let videoQueueService: jest.Mocked<VideoQueueService>;

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
            update: jest.fn(),
          },
        },
        {
          provide: ChannelsService,
          useValue: { findByUserId: jest.fn() },
        },
        {
          provide: StorageService,
          useValue: {
            createMultipartUpload: jest.fn(),
            generatePartPresignedUrls: jest.fn(),
            completeMultipartUpload: jest.fn(),
            generatePresignedGetUrl: jest.fn(),
          },
        },
        {
          provide: VideoQueueService,
          useValue: { publishProcessingJob: jest.fn() },
        },
      ],
    }).compile();

    videosService = module.get(VideosService);
    videoRepository = module.get(getRepositoryToken(Video));
    channelsService = module.get(ChannelsService);
    storageService = module.get(StorageService);
    videoQueueService = module.get(VideoQueueService);
  });

  describe('createDraft', () => {
    const dto: CreateVideoDto = {
      title: 'My Video',
      file_name: 'video.mp4',
      file_size: 250_000_000,
      content_type: 'video/mp4',
    };

    it('throws ChannelRequiredException when the user has no channel', async () => {
      channelsService.findByUserId.mockResolvedValue(null);

      await expect(videosService.createDraft('user-id', dto)).rejects.toThrow(
        ChannelRequiredException,
      );
      expect(storageService.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('creates a draft with an 11-char slug, draft status and derived storage_key', async () => {
      const channel = makeChannel();
      channelsService.findByUserId.mockResolvedValue(channel);
      storageService.createMultipartUpload.mockResolvedValue('upload-id-1');
      storageService.generatePartPresignedUrls.mockResolvedValue([
        { partNumber: 1, uploadUrl: 'http://minio:9000/part-1' },
        { partNumber: 2, uploadUrl: 'http://minio:9000/part-2' },
        { partNumber: 3, uploadUrl: 'http://minio:9000/part-3' },
      ]);
      videoRepository.create.mockImplementation(
        (input) => Object.assign(new Video(), input) as Video,
      );
      videoRepository.save.mockImplementation((video) =>
        Promise.resolve(Object.assign(video as Video, { id: 'new-video-id' })),
      );

      const result = await videosService.createDraft('user-id', dto);

      expect(channelsService.findByUserId).toHaveBeenCalledWith('user-id');
      expect(result.slug).toHaveLength(11);
      expect(result.storage_key).toBe(`videos/${result.slug}/original`);
      expect(result.part_size).toBe(100_000_000);
      expect(result.parts).toHaveLength(3);

      const savedVideo = videoRepository.save.mock.calls[0][0] as Video;
      expect(savedVideo.status).toBe(VideoStatus.DRAFT);
      expect(savedVideo.channel_id).toBe(channel.id);
    });
  });

  describe('markUploadComplete', () => {
    const dto: UploadCompleteDto = {
      parts: [{ part_number: 1, etag: 'etag-1' }],
    };

    it('throws VideoNotFoundException when the video does not exist', async () => {
      videoRepository.findOne.mockResolvedValue(null);

      await expect(
        videosService.markUploadComplete('video-id', 'owner-user-id', dto),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('throws VideoAccessDeniedException when the video belongs to a different user', async () => {
      videoRepository.findOne.mockResolvedValue(makeVideo());

      await expect(
        videosService.markUploadComplete('video-id', 'someone-else', dto),
      ).rejects.toThrow(VideoAccessDeniedException);
      expect(storageService.completeMultipartUpload).not.toHaveBeenCalled();
    });

    it('throws VideoInvalidStatusException when the video is not in draft status', async () => {
      videoRepository.findOne.mockResolvedValue(
        makeVideo({ status: VideoStatus.PROCESSING }),
      );

      await expect(
        videosService.markUploadComplete('video-id', 'owner-user-id', dto),
      ).rejects.toThrow(VideoInvalidStatusException);
      expect(storageService.completeMultipartUpload).not.toHaveBeenCalled();
    });

    it('completes the upload, transitions to processing and publishes the job', async () => {
      const video = makeVideo();
      videoRepository.findOne.mockResolvedValue(video);
      videoRepository.save.mockImplementation((v) =>
        Promise.resolve(v as Video),
      );

      await videosService.markUploadComplete('video-id', 'owner-user-id', dto);

      expect(storageService.completeMultipartUpload).toHaveBeenCalledWith(
        video.storage_key,
        'upload-id',
        [{ ETag: 'etag-1', PartNumber: 1 }],
      );
      expect(video.status).toBe(VideoStatus.PROCESSING);
      expect(video.upload_id).toBeNull();
      expect(videoQueueService.publishProcessingJob).toHaveBeenCalledWith({
        videoId: video.id,
        storageKey: video.storage_key,
        channelId: video.channel_id,
        slug: video.slug,
      });
    });
  });

  describe('markProcessingReady', () => {
    it('updates status, duration, thumbnail_key and metadata', async () => {
      videoRepository.update.mockResolvedValue({ affected: 1 } as any);

      await videosService.markProcessingReady('video-id', {
        duration_seconds: 120,
        thumbnail_key: 'videos/abc12345def/thumbnail.jpg',
        metadata: { codec: 'h264' },
      });

      expect(videoRepository.update).toHaveBeenCalledWith('video-id', {
        status: VideoStatus.READY,
        duration_seconds: 120,
        thumbnail_key: 'videos/abc12345def/thumbnail.jpg',
        metadata: { codec: 'h264' },
      });
    });
  });

  describe('markProcessingError', () => {
    it('updates status to error with the given message', async () => {
      videoRepository.update.mockResolvedValue({ affected: 1 } as any);

      await videosService.markProcessingError('video-id', 'ffmpeg exploded');

      expect(videoRepository.update).toHaveBeenCalledWith('video-id', {
        status: VideoStatus.ERROR,
        error_message: 'ffmpeg exploded',
      });
    });
  });

  describe('findBySlug', () => {
    it('returns the video when it exists', async () => {
      const video = makeVideo();
      videoRepository.findOne.mockResolvedValue(video);

      const result = await videosService.findBySlug('abc12345def');

      expect(result).toBe(video);
      expect(videoRepository.findOne).toHaveBeenCalledWith({
        where: { slug: 'abc12345def' },
        relations: ['channel'],
      });
    });

    it('throws VideoNotFoundException when the video does not exist', async () => {
      videoRepository.findOne.mockResolvedValue(null);

      await expect(videosService.findBySlug('unknown-slug')).rejects.toThrow(
        VideoNotFoundException,
      );
    });
  });

  describe('getVideoDetails', () => {
    it('returns thumbnail_url as null when the video has no thumbnail yet', async () => {
      videoRepository.findOne.mockResolvedValue(
        makeVideo({ status: VideoStatus.DRAFT, thumbnail_key: null }),
      );

      const result = await videosService.getVideoDetails('abc12345def');

      expect(result.status).toBe(VideoStatus.DRAFT);
      expect(result.thumbnail_url).toBeNull();
      expect(storageService.generatePresignedGetUrl).not.toHaveBeenCalled();
    });

    it('returns a pre-signed thumbnail_url when thumbnail_key is set', async () => {
      videoRepository.findOne.mockResolvedValue(
        makeVideo({
          status: VideoStatus.READY,
          thumbnail_key: 'videos/abc12345def/thumbnail.jpg',
        }),
      );
      storageService.generatePresignedGetUrl.mockResolvedValue({
        url: 'http://minio:9000/streamtube-videos/videos/abc12345def/thumbnail.jpg?signed',
        expiresAt: new Date(),
      });

      const result = await videosService.getVideoDetails('abc12345def');

      expect(storageService.generatePresignedGetUrl).toHaveBeenCalledWith(
        'videos/abc12345def/thumbnail.jpg',
        3600,
      );
      expect(result.thumbnail_url).toBe(
        'http://minio:9000/streamtube-videos/videos/abc12345def/thumbnail.jpg?signed',
      );
    });
  });

  describe('getStreamUrl', () => {
    it('throws VideoNotReadyException when the video is not ready', async () => {
      videoRepository.findOne.mockResolvedValue(
        makeVideo({ status: VideoStatus.PROCESSING }),
      );

      await expect(videosService.getStreamUrl('abc12345def')).rejects.toThrow(
        VideoNotReadyException,
      );
      expect(storageService.generatePresignedGetUrl).not.toHaveBeenCalled();
    });

    it('returns a pre-signed streaming URL for a ready video', async () => {
      const video = makeVideo({ status: VideoStatus.READY });
      videoRepository.findOne.mockResolvedValue(video);
      const expiresAt = new Date('2026-01-01T00:00:00.000Z');
      storageService.generatePresignedGetUrl.mockResolvedValue({
        url: 'http://minio:9000/streamtube-videos/videos/abc12345def/original?signed',
        expiresAt,
      });

      const result = await videosService.getStreamUrl('abc12345def');

      expect(storageService.generatePresignedGetUrl).toHaveBeenCalledWith(
        video.storage_key,
        3600,
      );
      expect(result.url).toBe(
        'http://minio:9000/streamtube-videos/videos/abc12345def/original?signed',
      );
      expect(result.expires_at).toBe(expiresAt.toISOString());
    });
  });

  describe('getDownloadUrl', () => {
    it('throws VideoNotReadyException when the video is not ready', async () => {
      videoRepository.findOne.mockResolvedValue(
        makeVideo({ status: VideoStatus.DRAFT }),
      );

      await expect(videosService.getDownloadUrl('abc12345def')).rejects.toThrow(
        VideoNotReadyException,
      );
      expect(storageService.generatePresignedGetUrl).not.toHaveBeenCalled();
    });

    it('requests a Content-Disposition: attachment presigned URL for a ready video', async () => {
      const video = makeVideo({ status: VideoStatus.READY, title: 'My Video' });
      videoRepository.findOne.mockResolvedValue(video);
      storageService.generatePresignedGetUrl.mockResolvedValue({
        url: 'http://minio:9000/streamtube-videos/videos/abc12345def/original?signed&response-content-disposition=attachment',
        expiresAt: new Date(),
      });

      const result = await videosService.getDownloadUrl('abc12345def');

      expect(storageService.generatePresignedGetUrl).toHaveBeenCalledWith(
        video.storage_key,
        300,
        'attachment; filename="My Video"',
      );
      expect(result.url).toContain('response-content-disposition=attachment');
    });
  });
});
