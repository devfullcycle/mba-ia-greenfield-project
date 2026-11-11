import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { Channel } from '../../src/channels/entities/channel.entity';
import { VIDEO_PROCESSING_QUEUE } from '../../src/queue/queue.constants';
import { VideoProcessingQueue } from '../../src/queue/video-processing.queue';
import { StorageService } from '../../src/storage/storage.service';
import { cleanAllTables } from '../../src/test/create-test-data-source';
import { User } from '../../src/users/entities/user.entity';
import { Video } from '../../src/videos/entities/video.entity';
import { VideoPublicIdService } from '../../src/videos/video-public-id.service';
import {
  videoSourceKey,
  videoThumbnailKey,
} from '../../src/videos/videos.constants';
import { VideosDataModule } from '../../src/videos/videos-data.module';
import { VideosRepository } from '../../src/videos/videos.repository';
import { WorkerModule } from '../../src/worker.module';

jest.setTimeout(90_000);

const FIXTURES = join(__dirname, 'fixtures');
const POLL_INTERVAL_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('video-processing', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let storage: StorageService;
  let queue: Queue;
  let channel: Channel;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [WorkerModule, VideosDataModule],
    }).compile();
    // init() runs lifecycle hooks, which starts the BullMQ worker in this process.
    await module.init();
    dataSource = module.get(DataSource);
    storage = module.get(StorageService);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await cleanAllTables(dataSource);
    const user = await dataSource.getRepository(User).save({
      email: `worker_${Date.now()}@example.com`,
      password: 'hashed',
    });
    channel = await dataSource.getRepository(Channel).save({
      name: 'Worker',
      nickname: `worker_${Date.now()}`,
      user_id: user.id,
    });
  });

  /** Uploads a fixture as the source object of a PROCESSING video and enqueues it. */
  async function processFixture(fixture: string): Promise<string> {
    const id = randomUUID();
    const content = readFileSync(join(FIXTURES, fixture));
    const videosRepository = module.get(VideosRepository);
    const seq = await videosRepository.reserveSeq();
    await storage.putObject(videoSourceKey(id), content, 'video/mp4');
    await videosRepository.insert({
      id,
      seq,
      public_id: module.get(VideoPublicIdService).encode(seq),
      channel_id: channel.id,
      title: fixture,
      status: 'PROCESSING',
      original_filename: fixture,
      mime_type: 'video/mp4',
      size_bytes: content.length,
      storage_key: videoSourceKey(id),
      upload_id: null,
    });
    await module.get(VideoProcessingQueue).enqueue(id);
    return id;
  }

  async function waitUntilSettled(id: string): Promise<Video> {
    for (;;) {
      const video = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id });
      if (video.status !== 'PROCESSING') return video;
      await sleep(POLL_INTERVAL_MS);
    }
  }

  async function waitUntilJobGone(id: string): Promise<void> {
    while (await queue.getJob(id)) await sleep(POLL_INTERVAL_MS);
  }

  test('processa-mp4-valido-ate-ready-com-metadados-e-thumbnail', async () => {
    const id = await processFixture('sample.mp4');

    const video = await waitUntilSettled(id);

    expect(video.status).toBe('READY');
    expect(video.duration_seconds).toBeGreaterThan(0);
    expect(video.width).toBe(640);
    expect(video.height).toBe(360);
    expect(video.codec).toBe('h264');
    expect(video.error_reason).toBeNull();
    expect(video.thumbnail_key).toBe(videoThumbnailKey(id));
    const thumbnail = await storage.headObject(video.thumbnail_key!);
    expect(thumbnail.contentType).toBe('image/jpeg');
    expect(thumbnail.contentLength).toBeGreaterThan(0);
  });

  test('mp4-falso-termina-em-error-invalid-file-sem-retentativas', async () => {
    const id = await processFixture('fake.mp4');

    const video = await waitUntilSettled(id);

    expect(video.status).toBe('ERROR');
    expect(video.error_reason).toBe('INVALID_FILE');
    const job = await queue.getJob(id);
    expect(await job?.getState()).toBe('failed');
    expect(job?.attemptsMade).toBe(1);
  });

  test('reprocessar-video-ready-nao-altera-linha-nem-thumbnail', async () => {
    const id = await processFixture('sample.mp4');
    const ready = await waitUntilSettled(id);
    await waitUntilJobGone(id);
    const thumbnailBefore = await storage.headObject(ready.thumbnail_key!);
    // S3 LastModified has 1s resolution: make a rewrite observable.
    await sleep(1100);

    await module.get(VideoProcessingQueue).enqueue(id);
    await waitUntilJobGone(id);

    const after = await dataSource.getRepository(Video).findOneByOrFail({ id });
    expect(after.updated_at).toEqual(ready.updated_at);
    expect(after.status).toBe('READY');
    const thumbnailAfter = await storage.headObject(ready.thumbnail_key!);
    expect(thumbnailAfter.lastModified).toEqual(thumbnailBefore.lastModified);
  });
});
