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
import { Video, VideoStatus } from './video.entity';
import { VIDEO_PROCESSING_QUEUE, VIDEO_PROCESS_JOB } from './videos.constants';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, Video];

async function createVideosTestModule(): Promise<TestingModule> {
  const ds = createTestDataSource(ALL_ENTITIES);
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [storageConfig, queueConfig],
      }),
      TypeOrmModule.forRoot(ds.options),
      BullModule.forRootAsync({
        imports: [ConfigModule],
        inject: [queueConfig.KEY],
        useFactory: (cfg: ReturnType<typeof queueConfig>) => ({
          connection: { host: cfg.host, port: cfg.port },
        }),
      }),
      VideosModule,
    ],
  }).compile();
}

describe('VideosService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let videosService: VideosService;
  let queue: Queue;

  beforeAll(async () => {
    module = await createVideosTestModule();
    dataSource = module.get(DataSource);
    videosService = module.get(VideosService);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

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
        email: `video_int_${++counter}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `Channel ${counter}`,
        nickname: `vint${counter}`,
        user_id: user.id,
      }),
    );
  }

  it('persists a draft video with a real storage_key and enqueues processing after complete-upload', async () => {
    const channel = await createChannel();

    const initiated = await videosService.initiateUpload(channel.id, {
      originalFileName: 'clip.mp4',
      mimeType: 'video/mp4',
      sizeInBytes: 1024,
    });

    expect(initiated.status).toBe(VideoStatus.DRAFT);

    const videoRepository = dataSource.getRepository(Video);
    const persisted = await videoRepository.findOneBy({ id: initiated.id });
    expect(persisted).not.toBeNull();
    expect(persisted!.storage_key).toContain(channel.id);

    const { url } = await videosService.getPartUploadUrl(
      initiated.id,
      channel.id,
      { partNumber: 1 },
    );
    const putResponse = await fetch(url, { method: 'PUT', body: 'fake-mp4' });
    expect(putResponse.ok).toBe(true);
    const etag = putResponse.headers.get('etag')!;

    const completed = await videosService.completeUpload(
      initiated.id,
      channel.id,
      { parts: [{ partNumber: 1, etag }] },
    );

    expect(completed.status).toBe(VideoStatus.UPLOADED);

    const jobs = await queue.getJobs(['waiting', 'active', 'completed']);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe(VIDEO_PROCESS_JOB);
    expect(jobs[0].data).toEqual({ videoId: initiated.id });
  });
});
