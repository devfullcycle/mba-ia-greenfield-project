import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { Repository, DataSource } from 'typeorm';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { VideosService } from './videos.service';
import { Video, VideoStatus } from './entities/video.entity';
import { StorageService } from './services/storage.service';
import { ChannelsService } from '../channels/channels.service';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import {
  createTestDataSource,
  cleanAllTables,
} from '../test/create-test-data-source';
import storageConfig from '../config/storage.config';
import { envValidationSchema } from '../config/env.validation';

describe('VideosService (integration)', () => {
  let service: VideosService;
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-id' }),
  };

  const mockStorageService = {
    initializeMultipartUpload: jest
      .fn()
      .mockResolvedValue({ uploadId: 'mock-upload-id' }),
    generatePresignedUploadPartUrl: jest
      .fn()
      .mockResolvedValue('http://mock-signed-url'),
    completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
    abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
  };

  let userCounter = 0;
  async function createTestChannel(): Promise<{
    user: User;
    channel: Channel;
  }> {
    const user = await userRepository.save(
      userRepository.create({
        email: `uploader_${++userCounter}@example.com`,
        password: 'hashed-password',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: `Uploader Chan ${userCounter}`,
        nickname: `uploader_nick_${userCounter}`,
        user_id: user.id,
      }),
    );
    return { user, channel };
  }

  beforeAll(async () => {
    const entities = [User, Channel, Video, RefreshToken, VerificationToken];
    dataSource = createTestDataSource(entities);
    await dataSource.initialize();

    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig],
          validationSchema: envValidationSchema,
          validationOptions: { allowUnknown: true, abortEarly: false },
        }),
        TypeOrmModule.forRoot(dataSource.options),
        TypeOrmModule.forFeature([Video]),
      ],
      providers: [
        VideosService,
        ChannelsService,
        { provide: StorageService, useValue: mockStorageService },
        { provide: getQueueToken('video-processing'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<VideosService>(VideosService);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    jest.clearAllMocks();
  });

  describe('initiateUpload', () => {
    it('should initiate video upload and save draft in database', async () => {
      const { user, channel } = await createTestChannel();
      const dto = {
        title: 'Integration Test Video',
        description: 'Test description',
        fileName: 'my-movie.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 102400,
      };

      const result = await service.initiateUpload(user.id, dto);

      expect(result.videoId).toBeDefined();
      expect(result.unique_url_id).toHaveLength(12);
      expect(result.uploadId).toBe('mock-upload-id');
      expect(result.key).toContain(`videos/${result.unique_url_id}/video.mp4`);

      // Verify DB entity
      const dbVideo = await videoRepository.findOne({
        where: { id: result.videoId },
      });
      expect(dbVideo).toBeDefined();
      expect(dbVideo!.title).toBe(dto.title);
      expect(dbVideo!.description).toBe(dto.description);
      expect(dbVideo!.status).toBe(VideoStatus.DRAFT);
      expect(dbVideo!.channel_id).toBe(channel.id);

      expect(mockStorageService.initializeMultipartUpload).toHaveBeenCalledWith(
        expect.any(String),
        result.key,
        dto.mimeType,
      );
    });

    it('should throw ForbiddenException if user has no channel', async () => {
      const u = await userRepository.save(
        userRepository.create({
          email: 'nochannel@example.com',
          password: 'pass',
        }),
      );
      const dto = {
        title: 'Video',
        fileName: 'a.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 100,
      };

      await expect(service.initiateUpload(u.id, dto)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('generatePresignedPartUrl', () => {
    it('should return signed URL for draft video belonging to the user', async () => {
      const { user, channel } = await createTestChannel();
      const video = await videoRepository.save(
        videoRepository.create({
          title: 'My Video',
          unique_url_id: '123456789abc',
          status: VideoStatus.DRAFT,
          video_key: 'videos/123456789abc/video.mp4',
          channel_id: channel.id,
        }),
      );

      const dto = { partNumber: 1, uploadId: 'upload-id-123' };
      const res = await service.generatePresignedPartUrl(
        user.id,
        video.id,
        dto,
      );

      expect(res.url).toBe('http://mock-signed-url');
      expect(
        mockStorageService.generatePresignedUploadPartUrl,
      ).toHaveBeenCalledWith(
        expect.any(String),
        video.video_key,
        dto.uploadId,
        dto.partNumber,
      );
    });

    it('should reject if user does not own the video', async () => {
      const { channel } = await createTestChannel();
      const otherUser = await userRepository.save(
        userRepository.create({ email: 'other@example.com', password: 'pass' }),
      );
      const video = await videoRepository.save(
        videoRepository.create({
          title: 'My Video',
          unique_url_id: '123456789abc',
          status: VideoStatus.DRAFT,
          video_key: 'videos/123456789abc/video.mp4',
          channel_id: channel.id,
        }),
      );

      await expect(
        service.generatePresignedPartUrl(otherUser.id, video.id, {
          partNumber: 1,
          uploadId: 'upload-id-123',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject if video is not in DRAFT status', async () => {
      const { user, channel } = await createTestChannel();
      const video = await videoRepository.save(
        videoRepository.create({
          title: 'My Video',
          unique_url_id: '123456789abc',
          status: VideoStatus.PROCESSING,
          video_key: 'videos/123456789abc/video.mp4',
          channel_id: channel.id,
        }),
      );

      await expect(
        service.generatePresignedPartUrl(user.id, video.id, {
          partNumber: 1,
          uploadId: 'upload-id-123',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('completeUpload', () => {
    it('should complete S3 upload, mark as PROCESSING and enqueue job', async () => {
      const { user, channel } = await createTestChannel();
      const video = await videoRepository.save(
        videoRepository.create({
          title: 'My Video',
          unique_url_id: '123456789abc',
          status: VideoStatus.DRAFT,
          video_key: 'videos/123456789abc/video.mp4',
          channel_id: channel.id,
        }),
      );

      const dto = {
        uploadId: 'upload-id-123',
        parts: [{ ETag: 'etag-1', PartNumber: 1 }],
      };

      const res = await service.completeUpload(user.id, video.id, dto);

      expect(res.success).toBe(true);
      expect(res.status).toBe(VideoStatus.PROCESSING);

      // Verify db state
      const dbVideo = await videoRepository.findOne({
        where: { id: video.id },
      });
      expect(dbVideo!.status).toBe(VideoStatus.PROCESSING);

      // Verify StorageService call
      expect(mockStorageService.completeMultipartUpload).toHaveBeenCalledWith(
        expect.any(String),
        video.video_key,
        dto.uploadId,
        dto.parts,
      );

      // Verify Queue publication
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-video',
        { videoId: video.id, videoKey: video.video_key },
        expect.any(Object),
      );
    });
  });
});
