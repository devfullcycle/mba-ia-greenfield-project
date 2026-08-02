import * as fs from 'fs';
import * as path from 'path';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Job } from 'bullmq';
import storageConfig from '../../../nestjs-project/src/config/storage.config';
import { StorageModule } from '../../../nestjs-project/src/storage/storage.module';
import { StorageService } from '../../../nestjs-project/src/storage/storage.service';
import { Channel } from '../../../nestjs-project/src/channels/entities/channel.entity';
import { User } from '../../../nestjs-project/src/users/entities/user.entity';
import { Video } from '../../../nestjs-project/src/videos/entities/video.entity';
import { ProcessVideoJobData } from '../../../nestjs-project/src/videos/interfaces/process-video-job.interface';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../../nestjs-project/src/test/create-test-data-source';
import { VideoProcessorService } from './video-processor.service';

const ALL_ENTITIES = [User, Channel, Video];
const FIXTURES_DIR = path.join(
  __dirname,
  '../../../nestjs-project/test/fixtures',
);
const FIXTURE_PATH = path.join(FIXTURES_DIR, 'sample.mp4');
const CORRUPTED_FIXTURE_PATH = path.join(FIXTURES_DIR, 'corrupted.mp4');

describe('VideoProcessorService (integration)', () => {
  let dataSource: DataSource;
  let storageService: StorageService;
  let processor: VideoProcessorService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        TypeOrmModule.forFeature(ALL_ENTITIES),
        StorageModule,
      ],
      providers: [VideoProcessorService],
    }).compile();

    dataSource = module.get(DataSource);
    storageService = module.get(StorageService);
    processor = module.get(VideoProcessorService);
  }, 30000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let counter = 0;
  async function createProcessingVideo(
    fixturePath = FIXTURE_PATH,
  ): Promise<Video> {
    const userRepository = dataSource.getRepository(User);
    const channelRepository = dataSource.getRepository(Channel);
    const videoRepository = dataSource.getRepository(Video);

    const user = await userRepository.save(
      userRepository.create({
        email: `worker_${++counter}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Chan',
        nickname: `worker_chan_${counter}`,
        user_id: user.id,
      }),
    );
    return videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        original_filename: 'sample.mp4',
        mime_type: 'video/mp4',
        size_bytes: fs.statSync(fixturePath).size,
        status: 'processing',
        storage_key: `videos/${channel.id}-test/original`,
      }),
    );
  }

  it('should process a real video fixture end to end and mark it ready with duration and thumbnail', async () => {
    const video = await createProcessingVideo();
    const fixtureBuffer = fs.readFileSync(FIXTURE_PATH);
    await storageService.putObject(
      video.storage_key,
      fixtureBuffer,
      'video/mp4',
    );

    const job = { data: { videoId: video.id } } as Job<ProcessVideoJobData>;
    await processor.process(job);

    const videoRepository = dataSource.getRepository(Video);
    const saved = await videoRepository.findOneByOrFail({ id: video.id });

    expect(saved.status).toBe('ready');
    expect(saved.duration_seconds).toBeGreaterThan(0);
    expect(saved.duration_seconds).toBeLessThan(10);
    expect(saved.thumbnail_key).toBe(`videos/${video.id}/thumbnail.jpg`);

    const thumbnailUrl = await storageService.getObjectPresignedUrl(
      saved.thumbnail_key!,
    );
    const response = await fetch(thumbnailUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
  }, 30000);

  it('should mark a corrupted/non-video file as failed with a failure reason', async () => {
    const video = await createProcessingVideo(CORRUPTED_FIXTURE_PATH);
    const fixtureBuffer = fs.readFileSync(CORRUPTED_FIXTURE_PATH);
    await storageService.putObject(
      video.storage_key,
      fixtureBuffer,
      'video/mp4',
    );

    const job = { data: { videoId: video.id } } as Job<ProcessVideoJobData>;
    await processor.process(job);

    const videoRepository = dataSource.getRepository(Video);
    const saved = await videoRepository.findOneByOrFail({ id: video.id });

    expect(saved.status).toBe('failed');
    expect(saved.failure_reason).toBeTruthy();
    expect(saved.duration_seconds).toBeNull();
    expect(saved.thumbnail_key).toBeNull();
  }, 30000);
});
