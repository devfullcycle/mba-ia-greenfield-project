import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import storageConfig from '../config/storage.config';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import { VideoProcessingProducer } from '../queue/video-processing.producer';
import { StorageModule } from '../storage/storage.module';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideosService (integration)', () => {
  let dataSource: DataSource;
  let videosService: VideosService;
  let producer: { emitProcessingJob: jest.Mock };
  let counter = 0;

  beforeAll(async () => {
    const testDataSource = createTestDataSource(ALL_ENTITIES);
    producer = { emitProcessingJob: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        TypeOrmModule.forRoot(testDataSource.options),
        TypeOrmModule.forFeature([Video]),
        StorageModule,
      ],
      providers: [
        VideosService,
        { provide: VideoProcessingProducer, useValue: producer },
      ],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    videosService = moduleRef.get(VideosService);
  }, 30000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  async function createChannel(): Promise<Channel> {
    counter += 1;
    const userRepository = dataSource.getRepository(User);
    const channelRepository = dataSource.getRepository(Channel);
    const user = await userRepository.save(
      userRepository.create({
        email: `video_svc_${counter}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `Channel ${counter}`,
        nickname: `vsvc_${counter}`,
        user_id: user.id,
      }),
    );
  }

  it('persists a Video row with status rascunho and the expected fields', async () => {
    const channel = await createChannel();

    const result = await videosService.initiateUpload(channel.id, {
      original_filename: 'my-video.mp4',
      content_type: 'video/mp4',
      size_bytes: 5 * 1024 * 1024,
    });

    expect(result.parts).toHaveLength(1);
    expect(result.upload_id).toBeTruthy();

    const videoRepository = dataSource.getRepository(Video);
    const saved = await videoRepository.findOne({
      where: { public_id: result.id },
    });
    expect(saved).not.toBeNull();
    expect(saved!.status).toBe(VideoStatus.RASCUNHO);
    expect(saved!.channel_id).toBe(channel.id);
    expect(saved!.original_filename).toBe('my-video.mp4');
    expect(saved!.upload_id).toBe(result.upload_id);
  }, 30000);

  it('completes an upload end-to-end: uploads a real part to MinIO, transitions to processando, and emits one job', async () => {
    const channel = await createChannel();
    const initiated = await videosService.initiateUpload(channel.id, {
      original_filename: 'complete-me.mp4',
      content_type: 'video/mp4',
      size_bytes: 1024,
    });

    const putResponse = await fetch(initiated.parts[0].url, {
      method: 'PUT',
      body: 'a'.repeat(1024),
    });
    const etag = putResponse.headers.get('etag')!;

    const result = await videosService.completeUpload(
      channel.id,
      initiated.id,
      {
        parts: [{ part_number: 1, etag }],
      },
    );

    expect(result.status).toBe(VideoStatus.PROCESSANDO);

    const videoRepository = dataSource.getRepository(Video);
    const saved = await videoRepository.findOne({
      where: { public_id: initiated.id },
    });
    expect(saved!.status).toBe(VideoStatus.PROCESSANDO);
    expect(saved!.upload_id).toBeNull();
    expect(saved!.size_bytes).toBe('1024');
    expect(producer.emitProcessingJob).toHaveBeenCalledTimes(1);
  }, 30000);
});
