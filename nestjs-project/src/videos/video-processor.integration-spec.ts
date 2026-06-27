import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Job } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import storageConfig from '../config/storage.config';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { Video } from './entities/video.entity';
import { FfmpegService } from './processing/ffmpeg.service';
import { VideoProcessor } from './video-processor';
import {
  PROCESS_VIDEO_JOB,
  ProcessVideoJobData,
  storageKey,
  VideoStatus,
} from './videos.constants';

const execFileAsync = promisify(execFile);

async function generateSampleClip(
  path: string,
  seconds: number,
): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc=duration=${seconds}:size=160x120:rate=15`,
    '-pix_fmt',
    'yuv420p',
    path,
  ]);
}

function makeJob(
  videoId: string,
  overrides: Partial<{ attempts: number; attemptsMade: number }> = {},
): Job<ProcessVideoJobData> {
  const { attempts = 3, attemptsMade = 0 } = overrides;
  return {
    name: PROCESS_VIDEO_JOB,
    data: { videoId },
    opts: { attempts },
    attemptsMade,
  } as unknown as Job<ProcessVideoJobData>;
}

describe('VideoProcessor (integration, real DB + MinIO + ffmpeg)', () => {
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let channels: Repository<Channel>;
  let users: Repository<User>;
  let storage: StorageService;
  let processor: VideoProcessor;
  let channelId: string;
  let workDir: string;
  let samplePath: string;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    dataSource = createTestDataSource([User, Channel, Video]);
    await dataSource.initialize();
    videos = dataSource.getRepository(Video);
    channels = dataSource.getRepository(Channel);
    users = dataSource.getRepository(User);

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();
    await moduleRef.init();
    storage = moduleRef.get(StorageService);

    processor = new VideoProcessor(videos, storage, new FfmpegService());

    workDir = await mkdtemp(join(tmpdir(), 'processor-it-'));
    samplePath = join(workDir, 'sample.mp4');
    await generateSampleClip(samplePath, 2);
  }, 60000);

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
    await moduleRef.close();
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);

    const user = await users.save(
      users.create({ email: `u-${Date.now()}@example.com`, password: 'x' }),
    );
    const channel = await channels.save(
      channels.create({
        name: 'ch',
        nickname: `nick-${Date.now()}`,
        user_id: user.id,
      }),
    );
    channelId = channel.id;
  });

  async function seedProcessingVideo(key: string): Promise<Video> {
    return videos.save(
      videos.create({
        public_id: `pub-${Date.now()}`,
        channel_id: channelId,
        title: 'processing video',
        status: VideoStatus.PROCESSING,
        storage_key: key,
      }),
    );
  }

  it('processes a real video to READY with metadata and thumbnail', async () => {
    const sample = await readFile(samplePath);
    const video = await seedProcessingVideo('UNSET');
    const key = storageKey.original(video.id, 'sample.mp4');
    await storage.putObject(key, sample, 'video/mp4');
    video.storage_key = key;
    await videos.save(video);

    await processor.process(makeJob(video.id));

    const updated = await videos.findOneByOrFail({ id: video.id });
    expect(updated.status).toBe(VideoStatus.READY);
    expect(updated.duration_seconds).toBe(2);
    expect(updated.error_reason).toBeNull();
    expect(updated.thumbnail_key).toBe(storageKey.thumbnail(video.id));
    expect(updated.metadata).toMatchObject({ width: 160, height: 120 });

    const head = await storage.headObject(updated.thumbnail_key as string);
    expect(head.contentType).toBe('image/jpeg');
    expect(head.contentLength).toBeGreaterThan(0);
  }, 60000);

  it('is idempotent — skips a video already READY', async () => {
    const video = await seedProcessingVideo('whatever');
    video.status = VideoStatus.READY;
    await videos.save(video);

    await expect(processor.process(makeJob(video.id))).resolves.toBeUndefined();

    const updated = await videos.findOneByOrFail({ id: video.id });
    expect(updated.status).toBe(VideoStatus.READY);
    expect(updated.thumbnail_key).toBeNull();
  }, 30000);

  it('marks the video ERROR after the final attempt fails on corrupt input', async () => {
    const video = await seedProcessingVideo('UNSET');
    const key = storageKey.original(video.id, 'corrupt.mp4');
    await storage.putObject(key, Buffer.from('not-a-real-video'), 'video/mp4');
    video.storage_key = key;
    await videos.save(video);

    const job = makeJob(video.id, { attempts: 3, attemptsMade: 0 });
    await expect(processor.process(job)).rejects.toBeDefined();

    let failure: Error;
    try {
      await processor.process(job);
    } catch (error) {
      failure = error as Error;
    }

    // simulate BullMQ exhausting all retries before invoking the failed handler
    const finalJob = makeJob(video.id, { attempts: 3, attemptsMade: 3 });
    await processor.onFailed(finalJob, failure!);

    const updated = await videos.findOneByOrFail({ id: video.id });
    expect(updated.status).toBe(VideoStatus.ERROR);
    expect(updated.error_reason).toBeTruthy();
  }, 60000);

  it('does not mark ERROR while retries remain', async () => {
    const video = await seedProcessingVideo('whatever');

    const transientJob = makeJob(video.id, { attempts: 3, attemptsMade: 1 });
    await processor.onFailed(transientJob, new Error('transient'));

    const updated = await videos.findOneByOrFail({ id: video.id });
    expect(updated.status).toBe(VideoStatus.PROCESSING);
    expect(updated.error_reason).toBeNull();
  }, 30000);
});
