import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { ChannelsModule } from '../channels/channels.module';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video, VideoStatus } from './entities/video.entity';
import { VIDEO_PROCESSING_QUEUE, VideosService } from './videos.service';

describe('VideosService (integration — PostgreSQL + MinIO + Redis)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let videosService: VideosService;
  let channelsService: ChannelsService;
  let storageService: StorageService;
  let videoQueue: Queue;
  let userRepository: Repository<User>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    const ds = createTestDataSource([User, Channel, Video]);

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, queueConfig],
        }),
        TypeOrmModule.forRoot(ds.options),
        TypeOrmModule.forFeature([User, Channel, Video]),
        BullModule.forRootAsync({
          imports: [ConfigModule],
          inject: [queueConfig.KEY],
          useFactory: (qCfg: ConfigType<typeof queueConfig>) => ({
            prefix: `${qCfg.prefix}-svc-int`,
            connection: {
              host: qCfg.redisHost,
              port: qCfg.redisPort,
            },
          }),
        }),
        BullModule.registerQueue({
          name: VIDEO_PROCESSING_QUEUE,
        }),
        ChannelsModule,
        StorageModule,
      ],
      providers: [VideosService],
    }).compile();

    await moduleRef.init();

    dataSource = moduleRef.get(DataSource);
    videosService = moduleRef.get(VideosService);
    channelsService = moduleRef.get(ChannelsService);
    storageService = moduleRef.get(StorageService);
    videoQueue = moduleRef.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
    userRepository = dataSource.getRepository(User);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await videoQueue?.obliterate({ force: true }).catch(() => undefined);
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await videoQueue.drain(true);
  });

  async function createUserWithChannel(email: string): Promise<User> {
    const user = await userRepository.save(
      userRepository.create({
        email,
        password: 'hashed_password',
        is_confirmed: true,
      }),
    );
    await channelsService.createChannel(user.id, email);
    return user;
  }

  it('pre-registers a draft video on initiateUpload, uploads part via presigned URL, completes upload, and enqueues BullMQ job', async () => {
    const user = await createUserWithChannel('uploader@example.com');
    const payloadBytes = Buffer.alloc(128 * 1024, 0x42); // 128KB

    const initRes = await videosService.initiateUpload(user.id, {
      title: 'Integration Test Video',
      description: 'Uploaded directly to MinIO',
      original_filename: 'integration.mp4',
      mime_type: 'video/mp4',
      size_bytes: payloadBytes.length,
    });

    expect(initRes.status).toBe(VideoStatus.DRAFT);
    expect(initRes.slug).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(initRes.presigned_urls).toHaveLength(1);

    const draftInDb = await videoRepository.findOneBy({ id: initRes.id });
    expect(draftInDb).not.toBeNull();
    expect(draftInDb!.status).toBe(VideoStatus.DRAFT);

    // Upload part 1 directly to MinIO using the presigned URL
    const putRes = await fetch(initRes.presigned_urls[0].upload_url, {
      method: 'PUT',
      body: payloadBytes,
    });
    expect(putRes.ok).toBe(true);
    const etag = putRes.headers.get('etag')!;

    // Complete the upload
    const completeRes = await videosService.completeUpload(
      user.id,
      initRes.id,
      {
        parts: [{ part_number: 1, etag }],
      },
    );

    expect(completeRes.status).toBe(VideoStatus.PROCESSING);

    const updatedInDb = await videoRepository.findOneBy({ id: initRes.id });
    expect(updatedInDb!.status).toBe(VideoStatus.PROCESSING);
    expect(updatedInDb!.upload_id).toBeNull();

    const job = await videoQueue.getJob(`video-${initRes.id}`);
    expect(job).toBeDefined();
    expect(job!.data).toEqual({
      videoId: initRes.id,
      storageKey: initRes.storage_key,
    });

    await storageService.deleteObject(initRes.storage_key);
  });

  it('aborts a draft upload and deletes the draft record from DB', async () => {
    const user = await createUserWithChannel('aborter@example.com');

    const initRes = await videosService.initiateUpload(user.id, {
      title: 'To Be Aborted',
      original_filename: 'abort.mp4',
      mime_type: 'video/mp4',
      size_bytes: 1024 * 1024,
    });

    await videosService.abortUpload(user.id, initRes.id);

    const inDb = await videoRepository.findOneBy({ id: initRes.id });
    expect(inDb).toBeNull();
  });
});
