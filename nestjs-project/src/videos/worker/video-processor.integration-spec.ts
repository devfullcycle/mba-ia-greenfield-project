import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource, Repository } from 'typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import storageConfig from '../../config/storage.config';
import { StorageService } from '../../storage/storage.service';
import { StorageModule } from '../../storage/storage.module';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { Video, VideoStatus } from '../entities/video.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { User } from '../../users/entities/user.entity';
import { VideoProcessor } from './video-processor';

const execFileAsync = promisify(execFile);

describe('VideoProcessor (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let storageService: StorageService;
  let processor: VideoProcessor;
  let channelId: string;
  const samplePath = path.join('/tmp', 'video-processor-sample.mp4');

  beforeAll(async () => {
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=2:size=320x240:rate=10',
      '-pix_fmt',
      'yuv420p',
      samplePath,
    ]);

    dataSource = createTestDataSource([User, Channel, Video]);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
      providers: [
        { provide: getRepositoryToken(Video), useValue: videoRepository },
      ],
    }).compile();

    storageService = module.get(StorageService);
    processor = new VideoProcessor(
      videoRepository,
      storageService,
      module.get(storageConfig.KEY),
    );

    await cleanAllTables(dataSource);

    const userRepository = dataSource.getRepository(User);
    const user = await userRepository.save(
      userRepository.create({
        email: 'videoprocessor@example.com',
        password: 'hashedpassword',
        is_confirmed: true,
      }),
    );

    const channelRepository = dataSource.getRepository(Channel);
    const channel = await channelRepository.save(
      channelRepository.create({
        user_id: user.id,
        nickname: 'videoprocessor',
        name: 'Video Processor Channel',
        description: null,
      }),
    );
    channelId = channel.id;
  });

  afterAll(async () => {
    await fs.promises.unlink(samplePath).catch(() => {});
    await cleanAllTables(dataSource);
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM videos');
  });

  it('extracts metadata, generates a thumbnail, and marks the video ready', async () => {
    const storageKey = `videos/${Date.now()}-sample.mp4`;
    const fileBuffer = await fs.promises.readFile(samplePath);
    await storageService.uploadBuffer(
      'videos',
      storageKey,
      fileBuffer,
      'video/mp4',
    );

    const video = await videoRepository.save(
      videoRepository.create({
        url_code: 'integrat123',
        title: 'Integration Test Video',
        description: null,
        status: VideoStatus.PROCESSING,
        channel_id: channelId,
        original_filename: 'sample.mp4',
        storage_key: storageKey,
      }),
    );

    await processor.process({
      id: 'job-integration',
      data: {
        videoId: video.id,
        urlCode: video.url_code,
        storageKey,
      },
    } as any);

    const updated = await videoRepository.findOne({ where: { id: video.id } });
    expect(updated?.status).toBe(VideoStatus.READY);
    expect(updated?.duration_seconds).toBeGreaterThan(0);
    expect(updated?.resolution_width).toBe(320);
    expect(updated?.resolution_height).toBe(240);
    expect(updated?.thumbnail_key).toBe(
      `thumbnails/thumb-${video.url_code}.jpg`,
    );

    const thumbHead = await storageService.headObject(
      'thumbnails',
      `thumbnails/thumb-${video.url_code}.jpg`,
    );
    expect(thumbHead.ContentLength).toBeGreaterThan(0);
  });

  it('marks the video as error when the storage key does not exist', async () => {
    const video = await videoRepository.save(
      videoRepository.create({
        url_code: 'integraterr1',
        title: 'Integration Error Video',
        description: null,
        status: VideoStatus.PROCESSING,
        channel_id: channelId,
        original_filename: 'missing.mp4',
        storage_key: 'videos/does-not-exist.mp4',
      }),
    );

    await expect(
      processor.process({
        id: 'job-integration-err',
        data: {
          videoId: video.id,
          urlCode: video.url_code,
          storageKey: 'videos/does-not-exist.mp4',
        },
      } as any),
    ).rejects.toThrow();

    const updated = await videoRepository.findOne({ where: { id: video.id } });
    expect(updated?.status).toBe(VideoStatus.ERROR);
    expect(updated?.status_details).toBeTruthy();
  });
});
