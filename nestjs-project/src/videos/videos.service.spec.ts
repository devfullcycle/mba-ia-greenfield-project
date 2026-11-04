import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Repository } from 'typeorm';
import type { ChannelsService } from '../channels/channels.service';
import {
  ChannelNotFoundException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import storageConfig from '../config/storage.config';
import type { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosService } from './videos.service';

const CONFIG = {
  endpoint: 'minio',
  port: 9000,
  accessKey: 'minioadmin',
  secretKey: 'minioadmin',
  bucketVideos: 'videos',
  bucketThumbnails: 'thumbnails',
  useSsl: false,
} as ConfigType<typeof storageConfig>;

function buildVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: null,
    description: null,
    status: VideoStatus.READY,
    duration_seconds: 10,
    original_filename: 'video.mp4',
    storage_key: 'videos/1/video.mp4',
    thumbnail_key: null,
    error_message: null,
    channel_id: 'channel-1',
    created_at: new Date(),
    updated_at: new Date(),
    channel: undefined as never,
    ...overrides,
  };
}

describe('VideosService', () => {
  let repository: jest.Mocked<Repository<Video>>;
  let storageService: {
    uploadStream: jest.Mock;
    getObjectStream: jest.Mock;
  };
  let channelsService: { findByUserId: jest.Mock };
  let queue: { add: jest.Mock };
  let service: VideosService;

  beforeEach(() => {
    let savedId = 'video-1';
    repository = {
      create: jest.fn((data: Partial<Video>) => ({ ...data }) as Video),
      save: jest.fn(async (video: Video) => {
        if (!video.id) {
          video.id = savedId;
          savedId = 'video-2';
        }
        return video;
      }),
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<Video>>;

    storageService = {
      uploadStream: jest
        .fn()
        .mockImplementation(async (_key: string, stream: Readable) => {
          for await (const _chunk of stream) {
            void _chunk;
            // Drain the stream so the underlying file handle is released.
          }
        }),
      getObjectStream: jest.fn(),
    };
    channelsService = {
      findByUserId: jest.fn().mockResolvedValue({ id: 'channel-1' }),
    };
    queue = { add: jest.fn().mockResolvedValue({}) };

    service = new VideosService(
      repository,
      storageService as unknown as StorageService,
      channelsService as unknown as ChannelsService,
      queue as unknown as Queue,
      CONFIG,
    );
  });

  describe('uploadVideo', () => {
    it('creates the video, uploads it, sets storage_key and queues processing', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'videos-service-'));
      const filePath = join(dir, 'upload.bin');
      await writeFile(filePath, 'video content');
      const file = {
        originalname: 'My Video.mp4',
        mimetype: 'video/mp4',
        path: filePath,
        buffer: Buffer.alloc(0),
      } as Express.Multer.File;

      const result = await service.uploadVideo('user-1', file);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: VideoStatus.PENDING_UPLOAD,
          original_filename: 'My Video.mp4',
          channel_id: 'channel-1',
        }),
      );
      expect(storageService.uploadStream).toHaveBeenCalledWith(
        'videos/video-1/My_Video.mp4',
        expect.any(Readable),
        'video/mp4',
        'videos',
      );
      expect(result.status).toBe(VideoStatus.PROCESSING);
      expect(result.storage_key).toBe('videos/video-1/My_Video.mp4');
      expect(queue.add).toHaveBeenCalledWith(
        'process-video',
        {
          videoId: 'video-1',
          storageKey: 'videos/video-1/My_Video.mp4',
          bucket: 'videos',
        },
        { jobId: 'video-video-1' },
      );
      expect(existsSync(filePath)).toBe(false);

      await rm(dir, { recursive: true, force: true, maxRetries: 3 });
    });

    it('throws ChannelNotFoundException when the user has no channel', async () => {
      channelsService.findByUserId.mockResolvedValueOnce(null);

      await expect(
        service.uploadVideo('user-1', {} as Express.Multer.File),
      ).rejects.toBeInstanceOf(ChannelNotFoundException);

      expect(repository.save).not.toHaveBeenCalled();
    });

    it('keeps the video saved when publishing the job fails', async () => {
      queue.add.mockRejectedValueOnce(new Error('redis down'));
      const dir = await mkdtemp(join(tmpdir(), 'videos-service-'));
      const filePath = join(dir, 'upload.bin');
      await writeFile(filePath, 'video content');
      const file = {
        originalname: 'video.mp4',
        mimetype: 'video/mp4',
        path: filePath,
        buffer: Buffer.alloc(0),
      } as Express.Multer.File;

      const result = await service.uploadVideo('user-1', file);

      expect(result.status).toBe(VideoStatus.PROCESSING);
      expect(result.storage_key).toBe('videos/video-1/video.mp4');

      await rm(dir, { recursive: true, force: true, maxRetries: 3 });
    });
  });

  describe('findVideoById', () => {
    it('throws VideoNotFoundException for a non-UUID id', async () => {
      await expect(service.findVideoById('not-a-uuid')).rejects.toBeInstanceOf(
        VideoNotFoundException,
      );
      expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('throws VideoNotFoundException when the video does not exist', async () => {
      repository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.findVideoById('11111111-1111-4111-8111-111111111111'),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });

    it('returns the video when it exists', async () => {
      const video = buildVideo();
      repository.findOne.mockResolvedValueOnce(video);

      await expect(service.findVideoById(video.id)).resolves.toBe(video);
    });
  });

  describe('streamVideo', () => {
    it('throws VideoNotReadyException when the video is not ready', async () => {
      repository.findOne.mockResolvedValueOnce(
        buildVideo({ status: VideoStatus.PROCESSING, storage_key: null }),
      );

      await expect(
        service.streamVideo('11111111-1111-4111-8111-111111111111'),
      ).rejects.toBeInstanceOf(VideoNotReadyException);
    });

    it('returns a 200 stream without a Range header', async () => {
      const body = Readable.from('video');
      repository.findOne.mockResolvedValueOnce(buildVideo());
      storageService.getObjectStream.mockResolvedValueOnce({
        stream: body,
        contentLength: 5,
        contentType: 'video/mp4',
      });

      const result = await service.streamVideo(
        '11111111-1111-4111-8111-111111111111',
      );

      expect(result.status).toBe(200);
      expect(result.stream).toBe(body);
      expect(result.headers).toMatchObject({
        'Content-Type': 'video/mp4',
        'Content-Length': 5,
        'Accept-Ranges': 'bytes',
      });
      expect(result.headers['Content-Range']).toBeUndefined();
    });

    it('returns a 206 stream when storage reports a content range', async () => {
      repository.findOne.mockResolvedValueOnce(buildVideo());
      storageService.getObjectStream.mockResolvedValueOnce({
        stream: Readable.from('vid'),
        contentLength: 3,
        contentRange: 'bytes 0-2/5',
        contentType: 'video/mp4',
      });

      const result = await service.streamVideo(
        '11111111-1111-4111-8111-111111111111',
        'bytes=0-2',
      );

      expect(result.status).toBe(206);
      expect(result.headers['Content-Range']).toBe('bytes 0-2/5');
    });
  });

  describe('downloadVideo', () => {
    it('returns the stream, filename and length', async () => {
      repository.findOne.mockResolvedValueOnce(
        buildVideo({ original_filename: 'clip.mp4' }),
      );
      storageService.getObjectStream.mockResolvedValueOnce({
        stream: Readable.from('video'),
        contentLength: 5,
        contentType: 'video/mp4',
      });

      const result = await service.downloadVideo(
        '11111111-1111-4111-8111-111111111111',
      );

      expect(result.filename).toBe('clip.mp4');
      expect(result.contentLength).toBe(5);
    });
  });
});
