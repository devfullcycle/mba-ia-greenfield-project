import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import databaseConfig from '../config/database.config';
import storageConfig from '../config/storage.config';
import { QueueService } from '../queue/queue.service';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { VideoStatus } from '../videos/videos.constants';
import { FfmpegService } from './ffmpeg.service';
import { VideoProcessingHandler } from './video-processing.handler';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideoProcessingHandler (integration)', () => {
  let module: TestingModule;
  let handler: VideoProcessingHandler;
  let storage: StorageService;
  let dataSource: DataSource;
  let channel: Channel;
  let workDir: string;
  let videoBytes: Buffer;
  const keys: string[] = [];
  let counter = 0;

  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'handler-spec-'));
    const videoPath = join(workDir, 'clip.mp4');
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=2:size=160x120:rate=10',
      '-pix_fmt',
      'yuv420p',
      videoPath,
    ]);
    videoBytes = readFileSync(videoPath);

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [databaseConfig, storageConfig],
        }),
        TypeOrmModule.forRootAsync({
          useFactory: () => ({
            ...createTestDataSource(ALL_ENTITIES).options,
            autoLoadEntities: true,
          }),
        }),
        TypeOrmModule.forFeature([Video]),
        StorageModule,
      ],
      providers: [
        FfmpegService,
        VideoProcessingHandler,
        // The handler only registers the worker on bootstrap, which this spec never runs.
        { provide: QueueService, useValue: { work: jest.fn() } },
      ],
    }).compile();
    handler = module.get(VideoProcessingHandler);
    storage = module.get(StorageService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await Promise.all(keys.map((key) => storage.deleteObject(key)));
    await cleanAllTables(dataSource);
    rmSync(workDir, { recursive: true, force: true });
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource
      .getRepository(User)
      .save({ email: 'owner@example.com', password: 'hashed' });
    channel = await dataSource
      .getRepository(Channel)
      .save({ name: 'Owner', nickname: 'owner', user_id: user.id });
  });

  const createProcessingVideo = async (body: Buffer) => {
    const publicId = `handlr${String(++counter).padStart(5, '0')}`;
    const video = await dataSource.getRepository(Video).save({
      public_id: publicId,
      channel_id: channel.id,
      status: VideoStatus.PROCESSING,
      original_filename: 'clip.mp4',
      size_bytes: body.length,
      storage_key: `videos/${publicId}/original`,
    });
    keys.push(video.storage_key, `videos/${publicId}/thumbnail.jpg`);
    await storage.putObject(video.storage_key, body, 'video/mp4');
    return video;
  };

  const job = (videoId: string, overrides = {}) => ({
    id: 'job-1',
    data: { videoId },
    retryCount: 0,
    retryLimit: 3,
    ...overrides,
  });

  const reload = (id: string) =>
    dataSource.getRepository(Video).findOneByOrFail({ id });

  it('should fill duration, metadata and thumbnail and mark a valid video ready', async () => {
    const video = await createProcessingVideo(videoBytes);

    await handler.handle(job(video.id));

    const processed = await reload(video.id);
    expect(processed.status).toBe(VideoStatus.READY);
    expect(processed.duration_seconds).toBeCloseTo(2, 0);
    expect(Array.isArray(processed.metadata?.streams)).toBe(true);
    expect(processed.thumbnail_key).toBe(
      `videos/${video.public_id}/thumbnail.jpg`,
    );
    expect(await storage.headObject(processed.thumbnail_key!)).not.toBeNull();
  });

  it('should keep the video ready and not rewrite the thumbnail on a duplicate delivery', async () => {
    const video = await createProcessingVideo(videoBytes);
    await handler.handle(job(video.id));
    const before = await reload(video.id);
    const putSpy = jest.spyOn(storage, 'putObject');

    await handler.handle(job(video.id));

    const after = await reload(video.id);
    expect(after.status).toBe(VideoStatus.READY);
    expect(after.updated_at).toEqual(before.updated_at);
    expect(putSpy).not.toHaveBeenCalled();
    putSpy.mockRestore();
  });

  it('should leave the video processing while retries remain and failed after the last one', async () => {
    const video = await createProcessingVideo(
      Buffer.from('definitely not a video'),
    );

    await expect(
      handler.handle(job(video.id, { retryCount: 0 })),
    ).rejects.toThrow();
    expect((await reload(video.id)).status).toBe(VideoStatus.PROCESSING);

    await expect(
      handler.handle(job(video.id, { retryCount: 3 })),
    ).rejects.toThrow();
    expect((await reload(video.id)).status).toBe(VideoStatus.FAILED);
  });
});
