import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource, Repository } from 'typeorm';
import { VideosService } from './videos.service';
import { Video } from './entities/video.entity';
import { Channel } from '../channels/entities/channel.entity';
import { StorageService } from '../storage/storage.service';
import { VideoStatus, VIDEO_QUEUE_NAME } from './videos.constants';
import {
  VideoNotFoundException,
  VideoOwnershipException,
  VideoNotDraftException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import storageConfig from '../config/storage.config';
import { createTestDataSource } from '../test/create-test-data-source';
import { Readable } from 'stream';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

const mockStorageService = {
  generatePresignedPutUrl: jest.fn().mockResolvedValue('https://presigned-url'),
  getObject: jest.fn(),
  putObject: jest.fn(),
  deleteObject: jest.fn(),
  getBucketName: jest.fn().mockReturnValue('streamtube'),
};

const mockQueue = {
  add: jest.fn().mockResolvedValue({}),
  getJob: jest.fn().mockResolvedValue(null),
};

const mockStorageCfg = {
  endpoint: 'http://minio:9000',
  bucket: 'streamtube',
  accessKey: 'x',
  secretKey: 'x',
};

async function cleanTables(ds: DataSource): Promise<void> {
  await ds.query('DELETE FROM "refresh_tokens"');
  await ds.query('DELETE FROM "verification_tokens"');
  await ds.query('DELETE FROM "videos"');
  await ds.query('DELETE FROM "channels"');
  await ds.query('DELETE FROM "users"');
}

describe('VideosService (integration)', () => {
  let module: TestingModule;
  let service: VideosService;
  let dataSource: DataSource;
  let userRepo: Repository<User>;
  let channelRepo: Repository<Channel>;
  let videoRepo: Repository<Video>;

  let testUser: User;
  let testChannel: Channel;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepo = dataSource.getRepository(User);
    channelRepo = dataSource.getRepository(Channel);
    videoRepo = dataSource.getRepository(Video);

    module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: videoRepo },
        { provide: getRepositoryToken(Channel), useValue: channelRepo },
        { provide: getQueueToken(VIDEO_QUEUE_NAME), useValue: mockQueue },
        { provide: StorageService, useValue: mockStorageService },
        { provide: storageConfig.KEY, useValue: mockStorageCfg },
      ],
    }).compile();

    service = module.get(VideosService);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await cleanTables(dataSource);
    testUser = await userRepo.save(
      userRepo.create({
        email: `svc_int_${Date.now()}@test.com`,
        password: 'hash',
      }),
    );
    testChannel = await channelRepo.save(
      channelRepo.create({
        name: 'Test',
        nickname: `nick_${Date.now()}`,
        user_id: testUser.id,
      }),
    );
  });

  // ── initiateUpload ──────────────────────────────────────────────────────────

  describe('initiateUpload (US1+US5)', () => {
    it('two videos with same title receive distinct UUIDs (US5)', async () => {
      const dto = {
        title: 'Duplicate Title',
        file_size: 1024,
        mime_type: 'video/mp4',
      };
      const r1 = await service.initiateUpload(testUser.id, dto);
      const r2 = await service.initiateUpload(testUser.id, dto);

      expect(r1.id).not.toBe(r2.id);
    });

    it('storage_key is NOT NULL after creation', async () => {
      await service.initiateUpload(testUser.id, {
        title: 'Test',
        file_size: 1024,
        mime_type: 'video/mp4',
      });

      const videos = await videoRepo.find();
      expect(videos[0].storage_key).not.toBeNull();
      expect(videos[0].storage_key).toMatch(/^videos\/.+\/original\./);
    });

    it('initial status is draft', async () => {
      await service.initiateUpload(testUser.id, {
        title: 'Test',
        file_size: 1024,
        mime_type: 'video/mp4',
      });

      const videos = await videoRepo.find();
      expect(videos[0].status).toBe(VideoStatus.DRAFT);
    });

    it('channel_id references the correct channel', async () => {
      await service.initiateUpload(testUser.id, {
        title: 'Test',
        file_size: 1024,
        mime_type: 'video/mp4',
      });

      const videos = await videoRepo.find();
      expect(videos[0].channel_id).toBe(testChannel.id);
    });
  });

  // ── confirmUpload ───────────────────────────────────────────────────────────

  describe('confirmUpload (US2)', () => {
    it('should transition draft to processing in DB', async () => {
      const { id } = await service.initiateUpload(testUser.id, {
        title: 'T',
        file_size: 1,
        mime_type: 'video/mp4',
      });

      const result = await service.confirmUpload(id, testUser.id);

      const video = await videoRepo.findOne({ where: { id } });
      expect(video!.status).toBe(VideoStatus.PROCESSING);
      expect(result.status).toBe(VideoStatus.PROCESSING);
    });

    it('should throw BadRequestException for video already in processing', async () => {
      const { id } = await service.initiateUpload(testUser.id, {
        title: 'T',
        file_size: 1,
        mime_type: 'video/mp4',
      });
      await service.confirmUpload(id, testUser.id);

      await expect(service.confirmUpload(id, testUser.id)).rejects.toThrow(
        VideoNotDraftException,
      );
    });

    it('should throw VideoOwnershipException for different user', async () => {
      const otherUser = await userRepo.save(
        userRepo.create({
          email: `other_${Date.now()}@test.com`,
          password: 'hash',
        }),
      );
      const { id } = await service.initiateUpload(testUser.id, {
        title: 'T',
        file_size: 1,
        mime_type: 'video/mp4',
      });

      await expect(service.confirmUpload(id, otherUser.id)).rejects.toThrow(
        VideoOwnershipException,
      );
    });
  });

  // ── findById ────────────────────────────────────────────────────────────────

  describe('findById (US3)', () => {
    it('should return existing video', async () => {
      const { id } = await service.initiateUpload(testUser.id, {
        title: 'T',
        file_size: 1,
        mime_type: 'video/mp4',
      });

      const result = await service.findById(id);

      expect(result.id).toBe(id);
    });

    it('should throw VideoNotFoundException for unknown UUID', async () => {
      await expect(
        service.findById('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('should not include error_cause in public view', async () => {
      const { id } = await service.initiateUpload(testUser.id, {
        title: 'T',
        file_size: 1,
        mime_type: 'video/mp4',
      });
      await videoRepo.update(id, { error_cause: 'internal error' });

      const result = await service.findById(id);

      expect(result).not.toHaveProperty('error_cause');
    });
  });

  // ── listChannelVideos / updateTitle / deleteVideo ───────────────────────────

  describe('listChannelVideos (US6)', () => {
    it('should return paginated videos with has_next_page', async () => {
      for (let i = 0; i < 25; i++) {
        await service.initiateUpload(testUser.id, {
          title: `Video ${i}`,
          file_size: 1,
          mime_type: 'video/mp4',
        });
      }

      const result = await service.listChannelVideos(
        testChannel.id,
        testUser.id,
        { page: 1, limit: 20 },
      );

      expect(result.items).toHaveLength(20);
      expect(result.total).toBe(25);
      expect(result.has_next_page).toBe(true);
    });

    it('should throw VideoOwnershipException for different user', async () => {
      const otherUser = await userRepo.save(
        userRepo.create({
          email: `other2_${Date.now()}@test.com`,
          password: 'hash',
        }),
      );

      await expect(
        service.listChannelVideos(testChannel.id, otherUser.id, {
          page: 1,
          limit: 20,
        }),
      ).rejects.toThrow(VideoOwnershipException);
    });
  });

  describe('updateTitle (US6)', () => {
    it('should persist new title without changing id', async () => {
      const { id } = await service.initiateUpload(testUser.id, {
        title: 'Original',
        file_size: 1,
        mime_type: 'video/mp4',
      });

      const result = await service.updateTitle(id, testUser.id, {
        title: 'Updated',
      });

      expect(result.id).toBe(id);
      const db = await videoRepo.findOne({ where: { id } });
      expect(db!.title).toBe('Updated');
    });
  });

  describe('deleteVideo (US6)', () => {
    it('should remove video from DB', async () => {
      const { id } = await service.initiateUpload(testUser.id, {
        title: 'T',
        file_size: 1,
        mime_type: 'video/mp4',
      });

      await service.deleteVideo(id, testUser.id);

      await expect(service.findById(id)).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('should throw VideoOwnershipException for different user', async () => {
      const otherUser = await userRepo.save(
        userRepo.create({
          email: `other3_${Date.now()}@test.com`,
          password: 'hash',
        }),
      );
      const { id } = await service.initiateUpload(testUser.id, {
        title: 'T',
        file_size: 1,
        mime_type: 'video/mp4',
      });

      await expect(service.deleteVideo(id, otherUser.id)).rejects.toThrow(
        VideoOwnershipException,
      );
    });
  });

  // ── downloadVideo ───────────────────────────────────────────────────────────

  describe('downloadVideo (US4)', () => {
    it('should return stream and filename for a ready video', async () => {
      const { id } = await service.initiateUpload(testUser.id, {
        title: 'Meu Vídeo',
        file_size: 1,
        mime_type: 'video/mp4',
      });
      await videoRepo.update(id, { status: VideoStatus.READY });

      mockStorageService.getObject.mockResolvedValueOnce({
        stream: Readable.from(['data']),
        contentType: 'video/mp4',
        contentLength: 4,
      });

      const result = await service.downloadVideo(id);

      expect(result.filename).toMatch(/\.mp4$/);
      expect(result.contentType).toBe('video/mp4');
      expect(result.contentLength).toBe(4);
    });

    it('should throw VideoNotReadyException when status is draft', async () => {
      const { id } = await service.initiateUpload(testUser.id, {
        title: 'T',
        file_size: 1,
        mime_type: 'video/mp4',
      });

      await expect(service.downloadVideo(id)).rejects.toThrow(
        VideoNotReadyException,
      );
    });

    it('should throw VideoNotFoundException for unknown UUID', async () => {
      await expect(
        service.downloadVideo('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(VideoNotFoundException);
    });
  });
});
