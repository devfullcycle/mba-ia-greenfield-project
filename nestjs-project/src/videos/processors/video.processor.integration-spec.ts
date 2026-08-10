import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Job } from 'bullmq';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';

import { VideoProcessor } from './video.processor';
import { Video, VideoStatus } from '../entities/video.entity';
import { StorageService } from '../services/storage.service';
import { Channel } from '../../channels/entities/channel.entity';
import { User } from '../../users/entities/user.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import {
  createTestDataSource,
  cleanAllTables,
} from '../../test/create-test-data-source';
import storageConfig from '../../config/storage.config';
import { envValidationSchema } from '../../config/env.validation';

describe('VideoProcessor (integration)', () => {
  let processor: VideoProcessor;
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let storageService: StorageService;

  const dummyLocalPath = '/tmp/dummy-video.mp4';
  const testBucketVideos = process.env.STORAGE_BUCKET_VIDEOS || 'videos';
  const testBucketThumbnails =
    process.env.STORAGE_BUCKET_THUMBNAILS || 'thumbnails';

  beforeAll(async () => {
    // 1. Generate a real dummy 2-second mp4 video using ffmpeg on the host/container
    execSync(
      `ffmpeg -y -f lavfi -i testsrc=duration=2:size=320x240:rate=30 -pix_fmt yuv420p ${dummyLocalPath}`,
      { stdio: 'ignore' },
    );

    const entities = [User, Channel, Video, RefreshToken, VerificationToken];
    dataSource = createTestDataSource(entities);
    await dataSource.initialize();

    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig],
          validationSchema: envValidationSchema,
          validationOptions: { allowUnknown: true, abortEarly: false },
        }),
        TypeOrmModule.forRoot(dataSource.options),
        TypeOrmModule.forFeature([Video]),
      ],
      providers: [VideoProcessor, StorageService],
    }).compile();

    processor = module.get<VideoProcessor>(VideoProcessor);
    storageService = module.get<StorageService>(StorageService);
  });

  afterAll(async () => {
    await dataSource.destroy();
    if (fs.existsSync(dummyLocalPath)) {
      try {
        fs.unlinkSync(dummyLocalPath);
      } catch {
        // ignore error
      }
    }
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  it('should process video: download, extract duration, upload thumbnail, and mark READY', async () => {
    // 1. Create User, Channel, and Video Draft
    const user = await userRepository.save(
      userRepository.create({
        email: 'worker_test@example.com',
        password: 'password',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Worker Test Channel',
        nickname: 'worker_nick',
        user_id: user.id,
      }),
    );
    const videoKey = 'videos/test-worker-video/video.mp4';
    const video = await videoRepository.save(
      videoRepository.create({
        title: 'Worker Integration Test Video',
        unique_url_id: 'workerurlid1',
        status: VideoStatus.DRAFT,
        video_key: videoKey,
        channel_id: channel.id,
      }),
    );

    // 2. Upload dummy video to MinIO storage
    const videoBuffer = fs.readFileSync(dummyLocalPath);
    await storageService.uploadBuffer(
      testBucketVideos,
      videoKey,
      videoBuffer,
      'video/mp4',
    );

    // 3. Run the processor on the job
    const mockJob = {
      data: {
        videoId: video.id,
        videoKey: videoKey,
      },
    } as unknown as Job<{ videoId: string; videoKey: string }>;

    await processor.process(mockJob);

    // 4. Verify Database state
    const dbVideo = await videoRepository.findOne({ where: { id: video.id } });
    expect(dbVideo).toBeDefined();
    expect(dbVideo!.status).toBe(VideoStatus.READY);
    expect(dbVideo!.duration).toBeGreaterThan(0); // Should be ~2 seconds
    expect(dbVideo!.thumbnail_key).toBe(`thumbnails/${video.id}/thumbnail.jpg`);

    // 5. Verify Thumbnail was successfully uploaded to MinIO
    const result = await storageService.getObjectStream(
      testBucketThumbnails,
      dbVideo!.thumbnail_key!,
    );
    expect(result.contentType).toBe('image/jpeg');
    expect(result.contentLength).toBeGreaterThan(0);
  });

  it('should handle failures: mark video as FAILED and store failure reason', async () => {
    const user = await userRepository.save(
      userRepository.create({
        email: 'worker_fail@example.com',
        password: 'password',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Worker Test Channel 2',
        nickname: 'worker_nick_2',
        user_id: user.id,
      }),
    );
    // Non-existent key to trigger S3 download failure
    const videoKey = 'videos/non-existent-key/video.mp4';
    const video = await videoRepository.save(
      videoRepository.create({
        title: 'Worker Fail Test Video',
        unique_url_id: 'workerurlid2',
        status: VideoStatus.DRAFT,
        video_key: videoKey,
        channel_id: channel.id,
      }),
    );

    const mockJob = {
      data: {
        videoId: video.id,
        videoKey: videoKey,
      },
    } as unknown as Job<{ videoId: string; videoKey: string }>;

    await expect(processor.process(mockJob)).rejects.toThrow();

    const dbVideo = await videoRepository.findOne({ where: { id: video.id } });
    expect(dbVideo!.status).toBe(VideoStatus.FAILED);
    expect(dbVideo!.failure_reason).toBeDefined();
    expect(dbVideo!.failure_reason).toContain('does not exist');
  });
});
