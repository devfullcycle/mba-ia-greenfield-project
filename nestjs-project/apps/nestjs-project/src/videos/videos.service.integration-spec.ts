import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';
import type { Queue } from 'bullmq';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import storageConfig from '../config/storage.config';
import queueConfig from '../config/queue.config';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { Video } from './entities/video.entity';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';
import {
  ProcessVideoJobData,
  VIDEO_PROCESSING_QUEUE,
} from './interfaces/process-video-job.interface';

const ALL_ENTITIES = [User, Channel, Video];

describe('VideosService (integration)', () => {
  let dataSource: DataSource;
  let videosService: VideosService;
  let videoProcessingQueue: Queue<ProcessVideoJobData>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, queueConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosModule,
      ],
    }).compile();

    dataSource = module.get(DataSource);
    videosService = module.get(VideosService);
    videoProcessingQueue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  }, 30000);

  afterAll(async () => {
    await videoProcessingQueue.close();
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await videoProcessingQueue.drain(true);
  });

  let counter = 0;
  async function createUserWithChannel(): Promise<{ userId: string }> {
    const userRepository = dataSource.getRepository(User);
    const channelRepository = dataSource.getRepository(Channel);
    const user = await userRepository.save(
      userRepository.create({
        email: `video_svc_${++counter}@example.com`,
        password: 'hashed',
      }),
    );
    await channelRepository.save(
      channelRepository.create({
        name: 'Chan',
        nickname: `chan_svc_${counter}`,
        user_id: user.id,
      }),
    );
    return { userId: user.id };
  }

  it('should persist a draft video with the correct channel_id and storage_key convention', async () => {
    const { userId } = await createUserWithChannel();

    const result = await videosService.initiateUpload(userId, {
      originalFilename: 'clip.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 2048,
    });

    const videoRepository = dataSource.getRepository(Video);
    const saved = await videoRepository.findOneByOrFail({ id: result.id });

    expect(saved.status).toBe('draft');
    expect(saved.storage_key).toBe(`videos/${result.id}/original`);

    const channelRepository = dataSource.getRepository(Channel);
    const channel = await channelRepository.findOneByOrFail({
      user_id: userId,
    });
    expect(saved.channel_id).toBe(channel.id);
  });

  it('should return part URLs that are usable for a real PutObject part upload against MinIO', async () => {
    const { userId } = await createUserWithChannel();

    const result = await videosService.initiateUpload(userId, {
      originalFilename: 'clip.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 2048,
    });

    expect(result.parts).toHaveLength(1);
    const response = await fetch(result.parts[0].url, {
      method: 'PUT',
      body: Buffer.from('integration test bytes'),
    });
    expect(response.status).toBe(200);
  }, 15000);

  it('should transition to processing and enqueue exactly one real job in Redis on completion', async () => {
    const { userId } = await createUserWithChannel();

    const initiated = await videosService.initiateUpload(userId, {
      originalFilename: 'clip.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 2048,
    });

    const uploadResponse = await fetch(initiated.parts[0].url, {
      method: 'PUT',
      body: Buffer.from('integration test bytes'),
    });
    const eTag = uploadResponse.headers.get('etag')!;

    const result = await videosService.completeUpload(initiated.id, userId, {
      parts: [{ partNumber: 1, eTag }],
    });

    expect(result.status).toBe('processing');

    const videoRepository = dataSource.getRepository(Video);
    const saved = await videoRepository.findOneByOrFail({ id: initiated.id });
    expect(saved.status).toBe('processing');
    expect(saved.upload_id).toBeNull();

    // A real video-worker container may already be consuming this same
    // Redis queue, so the job may have moved past "waiting" (active,
    // completed) by the time this assertion runs — check across all
    // non-failed states instead of assuming it's still queued.
    const jobs = await videoProcessingQueue.getJobs([
      'waiting',
      'active',
      'completed',
    ]);
    const matchingJobs = jobs.filter(
      (job) => job.data.videoId === initiated.id,
    );
    expect(matchingJobs).toHaveLength(1);
  }, 20000);
});
