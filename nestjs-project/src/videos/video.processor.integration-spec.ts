import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { StorageService } from './storage.service';
import { Video, VideoStatus } from './video.entity';
import { VideoProcessor } from './video.processor';
import { VIDEO_PROCESSING_QUEUE, VIDEO_PROCESS_JOB } from './videos.constants';

const ALL_ENTITIES = [User, Channel, Video];
const VALID_FIXTURE = join(__dirname, 'fixtures', 'sample.mp4');
const INVALID_FIXTURE = join(__dirname, 'fixtures', 'invalid.mp4');
const POLL_INTERVAL_MS = 300;
const POLL_TIMEOUT_MS = 30000;

async function createTestModule(): Promise<TestingModule> {
  const ds = createTestDataSource(ALL_ENTITIES);
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [storageConfig, queueConfig],
      }),
      TypeOrmModule.forRoot(ds.options),
      TypeOrmModule.forFeature([Video]),
      BullModule.forRootAsync({
        imports: [ConfigModule],
        inject: [queueConfig.KEY],
        useFactory: (cfg: ReturnType<typeof queueConfig>) => ({
          connection: { host: cfg.host, port: cfg.port },
        }),
      }),
      BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
    ],
    providers: [StorageService, VideoProcessor],
  }).compile();
}

async function waitForStatus(
  dataSource: DataSource,
  videoId: string,
  terminalStatuses: VideoStatus[],
): Promise<Video> {
  const videoRepository = dataSource.getRepository(Video);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const video = await videoRepository.findOneByOrFail({ id: videoId });
    if (terminalStatuses.includes(video.status)) {
      return video;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(
    `Video ${videoId} did not reach status ${terminalStatuses.join('/')} within ${POLL_TIMEOUT_MS}ms`,
  );
}

describe('VideoProcessor (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let storageService: StorageService;
  let queue: Queue;

  beforeAll(async () => {
    module = await createTestModule();
    await module.init();
    dataSource = module.get(DataSource);
    storageService = module.get(StorageService);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  }, 30000);

  afterAll(async () => {
    await queue.close();
    await dataSource.destroy();
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await queue.obliterate({ force: true });
  });

  let counter = 0;
  async function createChannel(): Promise<Channel> {
    const userRepository = dataSource.getRepository(User);
    const channelRepository = dataSource.getRepository(Channel);
    const user = await userRepository.save(
      userRepository.create({
        email: `video_proc_${++counter}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `Channel ${counter}`,
        nickname: `vproc${counter}`,
        user_id: user.id,
      }),
    );
  }

  async function createUploadedVideo(fixturePath: string): Promise<Video> {
    const channel = await createChannel();
    const videoId = randomUUID();
    const storageKey = `videos/${channel.id}/${videoId}/original.mp4`;
    await storageService.uploadFile(storageKey, fixturePath, 'video/mp4');

    const videoRepository = dataSource.getRepository(Video);
    const fixtureBytes = await readFile(fixturePath);
    return videoRepository.save(
      videoRepository.create({
        id: videoId,
        channel_id: channel.id,
        title: 'clip',
        original_file_name: 'clip.mp4',
        mime_type: 'video/mp4',
        size_in_bytes: fixtureBytes.length,
        storage_key: storageKey,
        status: VideoStatus.UPLOADED,
      }),
    );
  }

  it('extracts duration, generates a thumbnail, and transitions to ready for a valid video', async () => {
    const video = await createUploadedVideo(VALID_FIXTURE);

    await queue.add(VIDEO_PROCESS_JOB, { videoId: video.id }, { attempts: 1 });

    const processed = await waitForStatus(dataSource, video.id, [
      VideoStatus.READY,
      VideoStatus.FAILED,
    ]);

    expect(processed.status).toBe(VideoStatus.READY);
    expect(processed.duration_seconds).toBeGreaterThan(0);
    expect(processed.thumbnail_key).toBeTruthy();

    const thumbnailUrl = await storageService.getPresignedReadUrl(
      processed.thumbnail_key!,
    );
    const response = await fetch(thumbnailUrl);
    expect(response.ok).toBe(true);
  }, 30000);

  it('transitions to failed with a failure reason after exhausting attempts for an invalid file', async () => {
    const video = await createUploadedVideo(INVALID_FIXTURE);

    await queue.add(VIDEO_PROCESS_JOB, { videoId: video.id }, { attempts: 1 });

    const processed = await waitForStatus(dataSource, video.id, [
      VideoStatus.READY,
      VideoStatus.FAILED,
    ]);

    expect(processed.status).toBe(VideoStatus.FAILED);
    expect(processed.failure_reason).toBeTruthy();
  }, 30000);
});
