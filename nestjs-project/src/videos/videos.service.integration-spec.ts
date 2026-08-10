import type { ConfigType } from '@nestjs/config';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { PgBoss } from 'pg-boss';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { PG_BOSS, QUEUE_NAMES } from '../queue/queue.constants';
import { QueueModule } from '../queue/queue.module';
import { QueueService } from '../queue/queue.service';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, Video, RefreshToken, VerificationToken];

describe('VideosService (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let videoRepository: Repository<Video>;
  let channelsService: ChannelsService;
  let storageService: StorageService;
  let queueService: QueueService;
  let boss: PgBoss;
  let storageCfg: ConfigType<typeof storageConfig>;
  let videosService: VideosService;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    videoRepository = dataSource.getRepository(Video);
    channelsService = new ChannelsService(dataSource);

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, queueConfig],
        }),
        StorageModule,
        QueueModule,
      ],
    }).compile();

    storageService = module.get(StorageService);
    queueService = module.get(QueueService);
    boss = module.get(PG_BOSS);
    storageCfg = module.get(storageConfig.KEY);
    await queueService.onModuleInit();

    videosService = new VideosService(
      videoRepository,
      dataSource,
      channelsService,
      storageService,
      queueService,
      storageCfg,
    );
  });

  afterAll(async () => {
    await queueService.onApplicationShutdown();
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let userCounter = 0;
  async function createOwnerUser(): Promise<string> {
    const user = await userRepository.save(
      userRepository.create({
        email: `vid_svc_${++userCounter}@example.com`,
        password: 'hashed',
      }),
    );
    await channelsService.createChannel(user.id, user.email);
    return user.id;
  }

  async function initiateDraftVideo(userId: string) {
    return videosService.initiateUpload(userId, {
      filename: 'movie.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 1000,
    });
  }

  async function fetchJobFor(
    videoId: string,
  ): Promise<{ videoId: string; bucket: string; key: string } | undefined> {
    const jobs = await boss.fetch<{
      videoId: string;
      bucket: string;
      key: string;
    }>(QUEUE_NAMES.VIDEO_PROCESSING, { batchSize: 50 });
    return jobs.find((job) => job.data.videoId === videoId)?.data;
  }

  describe('initiateUpload', () => {
    it('persists a draft video row with the storage upload id', async () => {
      const userId = await createOwnerUser();

      const result = await initiateDraftVideo(userId);

      expect(result.status).toBe('draft');
      const persisted = await videoRepository.findOneBy({ slug: result.id });
      expect(persisted?.status).toBe('draft');
      expect(persisted?.upload_id).toBe(result.uploadId);
      expect(persisted?.original_key).toBe(result.key);
    });
  });

  describe('completeUpload', () => {
    it('completes the storage upload, flips status to processing, and enqueues a fetchable job atomically', async () => {
      const userId = await createOwnerUser();
      const initiated = await initiateDraftVideo(userId);
      const partUrl = await storageService.presignUploadPart(
        initiated.key,
        initiated.uploadId,
        1,
      );
      const uploadResponse = await fetch(partUrl, {
        method: 'PUT',
        body: new Uint8Array(Buffer.from('hello from the integration test')),
      });
      expect(uploadResponse.ok).toBe(true);
      const eTag = uploadResponse.headers.get('etag')!;

      const result = await videosService.completeUpload(userId, initiated.id, [
        { partNumber: 1, eTag },
      ]);

      expect(result).toEqual({ id: initiated.id, status: 'processing' });
      const persisted = await videoRepository.findOneBy({
        slug: initiated.id,
      });
      expect(persisted?.status).toBe('processing');
      expect(persisted?.upload_id).toBeNull();

      const jobData = await fetchJobFor(persisted!.id);
      expect(jobData).toEqual({
        videoId: persisted!.id,
        bucket: storageCfg.bucket,
        key: initiated.key,
      });
    });

    it('rolls back the status change and leaves no job behind when storage completion fails', async () => {
      const userId = await createOwnerUser();
      const initiated = await initiateDraftVideo(userId);
      jest
        .spyOn(storageService, 'completeMultipartUpload')
        .mockRejectedValueOnce(new Error('storage down'));

      await expect(
        videosService.completeUpload(userId, initiated.id, [
          { partNumber: 1, eTag: 'bogus-etag' },
        ]),
      ).rejects.toThrow('storage down');

      const persisted = await videoRepository.findOneBy({
        slug: initiated.id,
      });
      expect(persisted?.status).toBe('draft');
      expect(persisted?.upload_id).toBe(initiated.uploadId);

      const jobData = await fetchJobFor(persisted!.id);
      expect(jobData).toBeUndefined();
    });
  });
});
