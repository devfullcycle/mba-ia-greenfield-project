import {
  InvalidVideoStateException,
  StorageUploadFailedException,
  VideoAccessDeniedException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import { Channel } from '../channels/entities/channel.entity';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosService } from './videos.service';

const CONFIG = {
  bucketVideos: 'videos',
  bucketThumbnails: 'thumbnails',
};

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  const channel = new Channel();
  channel.id = 'channel-1';
  channel.name = 'chan';
  channel.nickname = 'chan';
  channel.user_id = 'user-1';
  channel.description = null;
  channel.created_at = new Date();
  channel.updated_at = new Date();
  return Object.assign(channel, overrides);
}

function makeVideo(overrides: Partial<Video> = {}): Video {
  const video = new Video();
  video.id = 'video-1';
  video.url_code = 'abc123456789';
  video.title = 'My Video';
  video.description = null;
  video.status = VideoStatus.DRAFT;
  video.status_details = null;
  video.channel_id = 'channel-1';
  video.channel = makeChannel();
  video.original_filename = 'my_video.mp4';
  video.storage_key = 'raw-videos/abc123456789-my_video.mp4';
  video.thumbnail_key = null;
  video.duration_seconds = null;
  video.size_bytes = null;
  video.resolution_width = null;
  video.resolution_height = null;
  video.codec = null;
  video.created_at = new Date();
  video.updated_at = new Date();
  return Object.assign(video, overrides);
}

describe('VideosService', () => {
  let videoRepository: any;
  let channelsService: any;
  let storageService: any;
  let queue: any;
  let service: VideosService;

  beforeEach(() => {
    videoRepository = {
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => v),
      findOne: jest.fn(),
    };
    channelsService = {
      findByUserId: jest.fn(),
    };
    storageService = {
      getPresignedUploadUrl: jest.fn(),
      getPresignedDownloadUrl: jest.fn(),
      headObject: jest.fn(),
      getObjectStream: jest.fn(),
    };
    queue = {
      add: jest.fn(),
    };
    service = new VideosService(
      videoRepository,
      channelsService,
      storageService,
      CONFIG as any,
      queue,
    );
  });

  describe('uploadInit', () => {
    it('creates a draft video and returns a presigned upload URL', async () => {
      channelsService.findByUserId.mockResolvedValue(makeChannel());
      storageService.getPresignedUploadUrl.mockResolvedValue(
        'https://storage/upload-url',
      );

      const result = await service.uploadInit('user-1', {
        title: 'My Video',
        originalFilename: 'my_video.mp4',
      });

      expect(videoRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'My Video',
          status: VideoStatus.DRAFT,
          channel_id: 'channel-1',
        }),
      );
      expect(result.uploadUrl).toBe('https://storage/upload-url');
      expect(result.storageKey).toMatch(/^raw-videos\/.+-my_video\.mp4$/);
      expect(result.urlCode).toHaveLength(12);
    });

    it('throws VideoAccessDeniedException when the user has no channel', async () => {
      channelsService.findByUserId.mockResolvedValue(null);

      await expect(
        service.uploadInit('user-1', {
          title: 'My Video',
          originalFilename: 'my_video.mp4',
        }),
      ).rejects.toThrow(VideoAccessDeniedException);
    });
  });

  describe('uploadComplete', () => {
    it('marks the video as processing and enqueues a job', async () => {
      const video = makeVideo({ status: VideoStatus.DRAFT });
      videoRepository.findOne.mockResolvedValue(video);
      channelsService.findByUserId.mockResolvedValue(makeChannel());
      storageService.headObject.mockResolvedValue({});

      const result = await service.uploadComplete('user-1', video.url_code);

      expect(storageService.headObject).toHaveBeenCalledWith(
        'videos',
        video.storage_key,
      );
      expect(queue.add).toHaveBeenCalledWith(
        'process-video',
        {
          videoId: video.id,
          urlCode: video.url_code,
          storageKey: video.storage_key,
        },
        expect.objectContaining({ attempts: 3 }),
      );
      expect(result.status).toBe(VideoStatus.PROCESSING);
    });

    it('throws VideoNotFoundException when the urlCode does not exist', async () => {
      videoRepository.findOne.mockResolvedValue(null);

      await expect(service.uploadComplete('user-1', 'nope')).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('throws VideoAccessDeniedException when the channel does not own the video', async () => {
      const video = makeVideo({ channel_id: 'other-channel' });
      videoRepository.findOne.mockResolvedValue(video);
      channelsService.findByUserId.mockResolvedValue(makeChannel());

      await expect(
        service.uploadComplete('user-1', video.url_code),
      ).rejects.toThrow(VideoAccessDeniedException);
    });

    it('throws InvalidVideoStateException when the video is not in draft', async () => {
      const video = makeVideo({ status: VideoStatus.READY });
      videoRepository.findOne.mockResolvedValue(video);
      channelsService.findByUserId.mockResolvedValue(makeChannel());

      await expect(
        service.uploadComplete('user-1', video.url_code),
      ).rejects.toThrow(InvalidVideoStateException);
    });

    it('throws StorageUploadFailedException when the file is missing in storage', async () => {
      const video = makeVideo({ status: VideoStatus.DRAFT });
      videoRepository.findOne.mockResolvedValue(video);
      channelsService.findByUserId.mockResolvedValue(makeChannel());
      storageService.headObject.mockRejectedValue(new Error('not found'));

      await expect(
        service.uploadComplete('user-1', video.url_code),
      ).rejects.toThrow(StorageUploadFailedException);
    });
  });

  describe('getByUrlCode', () => {
    it('returns video metadata without a thumbnail URL when none is set', async () => {
      const video = makeVideo({ status: VideoStatus.READY });
      videoRepository.findOne.mockResolvedValue(video);

      const result = await service.getByUrlCode(video.url_code);

      expect(result.thumbnailUrl).toBeNull();
      expect(result.channel.nickname).toBe('chan');
    });

    it('resolves a presigned thumbnail URL when thumbnail_key is set', async () => {
      const video = makeVideo({
        status: VideoStatus.READY,
        thumbnail_key: 'thumbnails/thumb-abc.jpg',
      });
      videoRepository.findOne.mockResolvedValue(video);
      storageService.getPresignedDownloadUrl.mockResolvedValue(
        'https://storage/thumb-url',
      );

      const result = await service.getByUrlCode(video.url_code);

      expect(storageService.getPresignedDownloadUrl).toHaveBeenCalledWith(
        'thumbnails',
        'thumbnails/thumb-abc.jpg',
      );
      expect(result.thumbnailUrl).toBe('https://storage/thumb-url');
    });

    it('throws VideoNotFoundException when the urlCode does not exist', async () => {
      videoRepository.findOne.mockResolvedValue(null);

      await expect(service.getByUrlCode('nope')).rejects.toThrow(
        VideoNotFoundException,
      );
    });
  });

  describe('stream', () => {
    it('returns a 206 partial stream when a Range header is present', async () => {
      const video = makeVideo({ status: VideoStatus.READY });
      videoRepository.findOne.mockResolvedValue(video);
      storageService.getObjectStream.mockResolvedValue({
        stream: 'stream-object',
        contentLength: 1024,
        contentRange: 'bytes 0-1023/10485760',
        acceptRanges: 'bytes',
        contentType: 'video/mp4',
      });

      const result = await service.stream(video.url_code, 'bytes=0-1023');

      expect(storageService.getObjectStream).toHaveBeenCalledWith(
        'videos',
        video.storage_key,
        'bytes=0-1023',
      );
      expect(result.status).toBe(206);
      expect(result.headers['Content-Range']).toBe('bytes 0-1023/10485760');
    });

    it('throws VideoNotReadyException when the video is still a draft', async () => {
      const video = makeVideo({ status: VideoStatus.DRAFT });
      videoRepository.findOne.mockResolvedValue(video);

      await expect(service.stream(video.url_code, undefined)).rejects.toThrow(
        VideoNotReadyException,
      );
    });

    it('throws VideoNotReadyException when the video failed processing', async () => {
      const video = makeVideo({ status: VideoStatus.ERROR });
      videoRepository.findOne.mockResolvedValue(video);

      await expect(service.stream(video.url_code, undefined)).rejects.toThrow(
        VideoNotReadyException,
      );
    });
  });

  describe('download', () => {
    it('returns a presigned download URL for a ready video', async () => {
      const video = makeVideo({ status: VideoStatus.READY });
      videoRepository.findOne.mockResolvedValue(video);
      storageService.getPresignedDownloadUrl.mockResolvedValue(
        'https://storage/download-url',
      );

      const result = await service.download(video.url_code);

      expect(storageService.getPresignedDownloadUrl).toHaveBeenCalledWith(
        'videos',
        video.storage_key,
        video.original_filename,
      );
      expect(result).toBe('https://storage/download-url');
    });

    it('throws VideoNotReadyException when the video is still a draft', async () => {
      const video = makeVideo({ status: VideoStatus.DRAFT });
      videoRepository.findOne.mockResolvedValue(video);

      await expect(service.download(video.url_code)).rejects.toThrow(
        VideoNotReadyException,
      );
    });
  });
});
