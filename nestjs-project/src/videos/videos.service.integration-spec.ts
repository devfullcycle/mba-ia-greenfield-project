import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import { VIDEO_PROCESSING_QUEUE } from '../queue/queue.constants';
import { QueueModule } from '../queue/queue.module';
import { VideoProcessingProducer } from '../queue/video-processing.producer';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { ProcessingStatus, PublicationState } from './video.enums';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

const STORAGE_CONFIG = {
  maxSizeBytes: 10 * 1024 * 1024 * 1024,
  partSizeBytes: 64 * 1024 * 1024,
} as never;

describe('VideosService.initUpload (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let storageService: { createMultipartUpload: jest.Mock };
  let service: VideosService;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    storageService = {
      createMultipartUpload: jest.fn().mockResolvedValue('upload-1'),
    };
    service = new VideosService(
      videoRepository,
      new ChannelsService(dataSource),
      storageService as unknown as StorageService,
      {} as never,
      {} as never,
      STORAGE_CONFIG,
    );
  });

  let counter = 0;
  async function createUserWithChannel(): Promise<{
    user: User;
    channel: Channel;
  }> {
    const n = ++counter;
    const user = await userRepository.save(
      userRepository.create({
        email: `uploader_${n}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: `Uploader ${n}`,
        nickname: `uploader_${n}`,
        user_id: user.id,
      }),
    );
    return { user, channel };
  }

  const dto = {
    originalFilename: 'clip.mp4',
    contentType: 'video/mp4',
    sizeBytes: 200 * 1024 * 1024,
  };

  it('should persist the draft owned by the caller channel with the multipart uploadId', async () => {
    const { user, channel } = await createUserWithChannel();

    const result = await service.initUpload(user.id, dto);

    const stored = await videoRepository.findOneByOrFail({
      publicId: result.id,
    });
    expect(stored.channelId).toBe(channel.id);
    expect(stored.processingStatus).toBe(ProcessingStatus.UPLOADING);
    expect(stored.publicationState).toBe(PublicationState.DRAFT);
    expect(stored.uploadId).toBe('upload-1');
    expect(stored.objectKey).toBe(`videos/${stored.id}/original.mp4`);
    expect(stored.originalFilename).toBe('clip.mp4');
    expect(stored.sizeBytes).toBe(String(dto.sizeBytes));
    expect(result.partCount).toBe(4);
  });

  it('should generate a distinct publicId for every upload', async () => {
    const { user } = await createUserWithChannel();

    const first = await service.initUpload(user.id, dto);
    const second = await service.initUpload(user.id, dto);

    expect(first.id).not.toBe(second.id);
    expect(await videoRepository.count()).toBe(2);
  });

  it('should not leave a draft behind when the storage fails', async () => {
    const { user } = await createUserWithChannel();
    storageService.createMultipartUpload.mockRejectedValueOnce(
      new Error('storage down'),
    );

    await expect(service.initUpload(user.id, dto)).rejects.toThrow(
      'storage down',
    );

    expect(await videoRepository.count()).toBe(0);
  });

  it('should not create a row for a rejected request', async () => {
    const { user } = await createUserWithChannel();

    await expect(
      service.initUpload(user.id, { ...dto, contentType: 'application/pdf' }),
    ).rejects.toThrow();

    expect(await videoRepository.count()).toBe(0);
  });
});

describe('VideosService.completeUpload (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let queueModule: TestingModule;
  let queue: Queue<{ videoId: string }>;
  let storageService: {
    completeMultipartUpload: jest.Mock;
    headObject: jest.Mock;
  };
  let service: VideosService;
  const queuedJobIds: string[] = [];

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);

    queueModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        QueueModule,
      ],
    }).compile();
    queue = queueModule.get<Queue<{ videoId: string }>>(
      getQueueToken(VIDEO_PROCESSING_QUEUE),
    );
  });

  afterAll(async () => {
    for (const id of queuedJobIds) {
      const job = await queue.getJob(id);
      await job?.remove().catch(() => undefined);
    }
    await queueModule.close();
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    storageService = {
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
      headObject: jest.fn().mockResolvedValue({ contentLength: 1000 }),
    };
    service = new VideosService(
      videoRepository,
      new ChannelsService(dataSource),
      storageService as unknown as StorageService,
      queueModule.get(VideoProcessingProducer),
      {} as never,
      STORAGE_CONFIG,
    );
  });

  async function createUploadingVideo(): Promise<{ user: User; video: Video }> {
    const user = await userRepository.save(
      userRepository.create({
        email: `completer_${Date.now()}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Completer',
        nickname: `completer_${Date.now()}`,
        user_id: user.id,
      }),
    );
    const video = await videoRepository.save(
      videoRepository.create({
        publicId: 'cmpltvideo1',
        channelId: channel.id,
        originalFilename: 'clip.mp4',
        contentType: 'video/mp4',
        sizeBytes: '1000',
        objectKey: 'videos/x/original.mp4',
        uploadId: 'upload-1',
      }),
    );
    queuedJobIds.push(video.id);
    return { user, video };
  }

  const parts = [{ partNumber: 1, etag: '"etag-1"' }];

  it('should move the video to PROCESSING in the database and enqueue exactly one job', async () => {
    const { user, video } = await createUploadingVideo();

    await service.completeUpload(user.id, 'cmpltvideo1', { parts });

    const stored = await videoRepository.findOneByOrFail({ id: video.id });
    expect(stored.processingStatus).toBe(ProcessingStatus.PROCESSING);
    expect(stored.uploadId).toBeNull();
    const job = await queue.getJob(video.id);
    expect(job?.data).toEqual({ videoId: video.id });
  });

  it('should not create a second job when complete is called twice', async () => {
    const { user, video } = await createUploadingVideo();

    await service.completeUpload(user.id, 'cmpltvideo1', { parts });
    await service.completeUpload(user.id, 'cmpltvideo1', { parts });

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    expect(jobs.filter((job) => job.data.videoId === video.id)).toHaveLength(1);
    expect(storageService.completeMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it('should persist FAILED with a failureReason and enqueue nothing when the size differs', async () => {
    const { user, video } = await createUploadingVideo();
    storageService.headObject.mockResolvedValueOnce({ contentLength: 10 });

    await expect(
      service.completeUpload(user.id, 'cmpltvideo1', { parts }),
    ).rejects.toThrow();

    const stored = await videoRepository.findOneByOrFail({ id: video.id });
    expect(stored.processingStatus).toBe(ProcessingStatus.FAILED);
    expect(stored.failureReason).toEqual(expect.any(String));
    expect(await queue.getJob(video.id)).toBeUndefined();
  });
});
