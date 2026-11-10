import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UnrecoverableError, Worker, type Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import videoConfig from '../config/video.config';
import { CreateUsersAndChannels1775687773260 } from '../database/migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from '../database/migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1794273602577 } from '../database/migrations/1794273602577-CreateVideos';
import { VIDEO_PROCESSING_QUEUE } from '../queue/queue.constants';
import { QueueModule } from '../queue/queue.module';
import { VideoProcessingQueue } from '../queue/video-processing.queue';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video, type VideoStatus } from '../videos/entities/video.entity';
import { VideoPublicIdService } from '../videos/video-public-id.service';
import { videoSourceKey } from '../videos/videos.constants';
import { VideosDataModule } from '../videos/videos-data.module';
import { VideosRepository } from '../videos/videos.repository';
import { VideoReconcilerService } from './video-reconciler.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const MIGRATIONS = [
  CreateUsersAndChannels1775687773260,
  CreateAuthTokens1777579850478,
  CreateVideos1794273602577,
];

describe('VideoReconcilerService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let queue: Queue;
  let reconciler: VideoReconcilerService;
  let channel: Channel;

  beforeAll(async () => {
    const options = createTestDataSource(ALL_ENTITIES, {
      synchronize: false,
      migrations: MIGRATIONS,
    }).options;
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        ConfigModule.forFeature(videoConfig),
        TypeOrmModule.forRoot(options),
        VideosDataModule,
        QueueModule,
      ],
      providers: [VideoReconcilerService],
    }).compile();

    dataSource = module.get(DataSource);
    await dataSource.runMigrations();
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
    reconciler = module.get(VideoReconcilerService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await cleanAllTables(dataSource);
    const user = await dataSource.getRepository(User).save({
      email: `reconciler_${Date.now()}@example.com`,
      password: 'hashed',
    });
    channel = await dataSource.getRepository(Channel).save({
      name: 'Reconciler',
      nickname: `reconciler_${Date.now()}`,
      user_id: user.id,
    });
  });

  /** Inserts a video in `status` whose updated_at is `minutesAgo` in the past. */
  async function videoUpdated(
    minutesAgo: number,
    status: VideoStatus = 'PROCESSING',
  ): Promise<string> {
    const id = randomUUID();
    const repo = module.get(VideosRepository);
    const seq = await repo.reserveSeq();
    await repo.insert({
      id,
      seq,
      public_id: module.get(VideoPublicIdService).encode(seq),
      channel_id: channel.id,
      title: 'clip.mp4',
      status,
      original_filename: 'clip.mp4',
      mime_type: 'video/mp4',
      size_bytes: 1024,
      storage_key: videoSourceKey(id),
      upload_id: null,
    });
    await dataSource.query(
      `UPDATE videos SET updated_at = now() - make_interval(mins => $2) WHERE id = $1`,
      [id, minutesAgo],
    );
    return id;
  }

  async function failJobFor(videoId: string): Promise<void> {
    await module.get(VideoProcessingQueue).enqueue(videoId);
    const worker = new Worker(
      queue.name,
      () => {
        throw new UnrecoverableError('forced failure');
      },
      { connection: queue.opts.connection, prefix: queue.opts.prefix },
    );
    await new Promise<void>((resolve) =>
      worker.once('failed', () => resolve()),
    );
    await worker.close();
  }

  it('should enqueue a stale PROCESSING video that has no job', async () => {
    const id = await videoUpdated(20);

    await reconciler.reconcile();

    const job = await queue.getJob(id);
    expect(job?.name).toBe('process-video');
    expect(job?.data).toEqual({ videoId: id });
  });

  it('should remove an old failed job and re-enqueue the stale video', async () => {
    const id = await videoUpdated(20);
    await failJobFor(id);
    expect(await (await queue.getJob(id))?.getState()).toBe('failed');

    await reconciler.reconcile();

    expect(await (await queue.getJob(id))?.getState()).toBe('waiting');
  });

  it('should leave a stale video with an active job untouched (still one job)', async () => {
    const id = await videoUpdated(20);
    await module.get(VideoProcessingQueue).enqueue(id);

    const enqueued = await reconciler.reconcile();

    expect(enqueued).toBe(0);
    const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    expect(jobs.map((job) => job.id)).toEqual([id]);
  });

  it('should ignore PROCESSING videos updated less than 15 minutes ago', async () => {
    const id = await videoUpdated(5);

    await reconciler.reconcile();

    expect(await queue.getJob(id)).toBeUndefined();
  });

  it.each<VideoStatus>(['READY', 'ERROR', 'DRAFT'])(
    'should ignore stale videos in %s',
    async (status) => {
      const id = await videoUpdated(20, status);

      await reconciler.reconcile();

      expect(await queue.getJob(id)).toBeUndefined();
    },
  );

  it('should do nothing from the cron handler when the reconciler is disabled', async () => {
    expect(process.env.VIDEO_RECONCILER_ENABLED).toBe('false');
    const id = await videoUpdated(20);

    await reconciler.handleCron();

    expect(await queue.getJob(id)).toBeUndefined();
  });
});
