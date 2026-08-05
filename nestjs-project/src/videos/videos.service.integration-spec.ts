import { DataSource, Repository } from 'typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import storageConfig from '../config/storage.config';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { QueueModule } from '../queue/queue.module';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { Channel } from '../channels/entities/channel.entity';
import { ChannelsService } from '../channels/channels.service';
import { User } from '../users/entities/user.entity';
import {
  InvalidVideoStateException,
  StorageUploadFailedException,
  VideoAccessDeniedException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosService } from './videos.service';

describe('VideosService (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let storageService: StorageService;
  let queue: Queue;
  let service: VideosService;
  let module: TestingModule;
  let userId: string;
  let channelId: string;

  beforeAll(async () => {
    dataSource = createTestDataSource([User, Channel, Video]);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
        QueueModule,
      ],
    }).compile();

    storageService = module.get(StorageService);
    queue = module.get(getQueueToken('video-processing'));

    await cleanAllTables(dataSource);

    const user = await userRepository.save(
      userRepository.create({
        email: 'videosservice@example.com',
        password: 'hashedpassword',
        is_confirmed: true,
      }),
    );
    userId = user.id;

    const channel = await channelRepository.save(
      channelRepository.create({
        user_id: user.id,
        nickname: 'videosservice',
        name: 'Videos Service Channel',
        description: null,
      }),
    );
    channelId = channel.id;

    service = new VideosService(
      videoRepository,
      new ChannelsService(dataSource),
      storageService,
      storageConfig(),
      queue,
    );
  });

  afterAll(async () => {
    await queue.close();
    await module.close();
    await cleanAllTables(dataSource);
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM videos');
  });

  describe('uploadInit', () => {
    it('persists a draft video and returns a real presigned upload URL', async () => {
      const result = await service.uploadInit(userId, {
        title: 'Integration Video',
        originalFilename: 'clip.mp4',
      });

      const persisted = await videoRepository.findOneBy({
        id: result.videoId,
      });
      expect(persisted?.status).toBe(VideoStatus.DRAFT);
      expect(persisted?.channel_id).toBe(channelId);
      expect(result.uploadUrl).toContain(result.storageKey);
    });

    it('throws VideoAccessDeniedException for a user without a channel', async () => {
      await expect(
        service.uploadInit('00000000-0000-0000-0000-000000000000', {
          title: 'Video',
          originalFilename: 'clip.mp4',
        }),
      ).rejects.toThrow(VideoAccessDeniedException);
    });
  });

  describe('uploadComplete', () => {
    it('transitions a draft video to processing and enqueues a real job', async () => {
      const buffer = Buffer.from('fake-video-bytes');
      const storageKey = `raw-videos/completetest-${Date.now()}.mp4`;
      await storageService.uploadBuffer(
        storageConfig().bucketVideos,
        storageKey,
        buffer,
        'video/mp4',
      );

      const video = await videoRepository.save(
        videoRepository.create({
          url_code: 'complettest1',
          title: 'Complete Test',
          description: null,
          status: VideoStatus.DRAFT,
          channel_id: channelId,
          original_filename: 'clip.mp4',
          storage_key: storageKey,
        }),
      );

      const result = await service.uploadComplete(userId, video.url_code);
      expect(result.status).toBe(VideoStatus.PROCESSING);

      const jobCounts = await queue.getJobCounts('waiting', 'active');
      expect(jobCounts.waiting + jobCounts.active).toBeGreaterThan(0);
    });

    it('throws StorageUploadFailedException when the storage object does not exist', async () => {
      const video = await videoRepository.save(
        videoRepository.create({
          url_code: 'missingfile1',
          title: 'Missing File',
          description: null,
          status: VideoStatus.DRAFT,
          channel_id: channelId,
          original_filename: 'clip.mp4',
          storage_key: 'raw-videos/does-not-exist.mp4',
        }),
      );

      await expect(
        service.uploadComplete(userId, video.url_code),
      ).rejects.toThrow(StorageUploadFailedException);
    });

    it('throws InvalidVideoStateException when the video is not a draft', async () => {
      const video = await videoRepository.save(
        videoRepository.create({
          url_code: 'notdraft1234',
          title: 'Not Draft',
          description: null,
          status: VideoStatus.READY,
          channel_id: channelId,
          original_filename: 'clip.mp4',
          storage_key: 'raw-videos/whatever.mp4',
        }),
      );

      await expect(
        service.uploadComplete(userId, video.url_code),
      ).rejects.toThrow(InvalidVideoStateException);
    });

    it('throws VideoNotFoundException for an unknown urlCode', async () => {
      await expect(
        service.uploadComplete(userId, 'doesnotexist'),
      ).rejects.toThrow(VideoNotFoundException);
    });
  });

  describe('getByUrlCode', () => {
    it('returns the video with channel details loaded from the database', async () => {
      const video = await videoRepository.save(
        videoRepository.create({
          url_code: 'getbyurl1234',
          title: 'Get By Url',
          description: 'desc',
          status: VideoStatus.READY,
          channel_id: channelId,
          original_filename: 'clip.mp4',
          storage_key: 'raw-videos/whatever.mp4',
        }),
      );

      const result = await service.getByUrlCode(video.url_code);

      expect(result.title).toBe('Get By Url');
      expect(result.channel.id).toBe(channelId);
      expect(result.channel.nickname).toBe('videosservice');
    });
  });

  describe('stream and download', () => {
    it('streams a byte range and returns a download redirect URL for a ready video', async () => {
      const buffer = Buffer.from('0123456789'.repeat(20));
      const storageKey = `raw-videos/streamtest-${Date.now()}.mp4`;
      await storageService.uploadBuffer(
        storageConfig().bucketVideos,
        storageKey,
        buffer,
        'video/mp4',
      );

      const video = await videoRepository.save(
        videoRepository.create({
          url_code: 'streamtest12',
          title: 'Stream Test',
          description: null,
          status: VideoStatus.READY,
          channel_id: channelId,
          original_filename: 'clip.mp4',
          storage_key: storageKey,
        }),
      );

      const streamed = await service.stream(video.url_code, 'bytes=0-9');
      expect(streamed.status).toBe(206);
      expect(streamed.headers['Content-Range']).toBeDefined();

      const downloadUrl = await service.download(video.url_code);
      expect(downloadUrl).toContain(storageKey);
    });

    it('throws VideoNotReadyException when streaming a draft video', async () => {
      const video = await videoRepository.save(
        videoRepository.create({
          url_code: 'draftstream1',
          title: 'Draft Stream',
          description: null,
          status: VideoStatus.DRAFT,
          channel_id: channelId,
          original_filename: 'clip.mp4',
          storage_key: 'raw-videos/whatever.mp4',
        }),
      );

      await expect(service.stream(video.url_code, undefined)).rejects.toThrow(
        VideoNotReadyException,
      );
    });
  });
});
