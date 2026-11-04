import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import { ChannelsService } from '../channels/channels.service';
import storageConfig from '../config/storage.config';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

const CONFIG = {
  endpoint: 'minio',
  port: 9000,
  accessKey: 'minioadmin',
  secretKey: 'minioadmin',
  bucketVideos: 'videos',
  bucketThumbnails: 'thumbnails',
  useSsl: false,
} as ConfigType<typeof storageConfig>;

describe('VideosService (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let service: VideosService;
  let storageService: { uploadStream: jest.Mock };
  let queue: { add: jest.Mock };

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);

    storageService = {
      uploadStream: jest
        .fn()
        .mockImplementation(async (_key: string, stream: Readable) => {
          for await (const _chunk of stream) {
            void _chunk;
            // Drain the stream so the underlying file handle is released.
          }
        }),
    };
    queue = { add: jest.fn().mockResolvedValue({}) };
    service = new VideosService(
      videoRepository,
      storageService as unknown as StorageService,
      new ChannelsService(dataSource),
      queue as unknown as Queue,
      CONFIG,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    jest.clearAllMocks();
  });

  let counter = 0;

  async function createUserAndChannel(): Promise<{
    userId: string;
    channelId: string;
  }> {
    const user = await userRepository.save(
      userRepository.create({
        email: `upload_user_${++counter}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Upload Channel',
        nickname: `uploadchan${counter}`,
        user_id: user.id,
      }),
    );
    return { userId: user.id, channelId: channel.id };
  }

  it('persists the video with storage_key, processing status and channel', async () => {
    const { userId, channelId } = await createUserAndChannel();
    const dir = await mkdtemp(join(tmpdir(), 'videos-integration-'));
    const filePath = join(dir, 'clip.mp4');
    await writeFile(filePath, 'video content');
    const file = {
      originalname: 'clip.mp4',
      mimetype: 'video/mp4',
      path: filePath,
      buffer: Buffer.alloc(0),
    } as Express.Multer.File;

    const video = await service.uploadVideo(userId, file);

    const persisted = await videoRepository.findOneByOrFail({ id: video.id });
    expect(persisted.channel_id).toBe(channelId);
    expect(persisted.original_filename).toBe('clip.mp4');
    expect(persisted.status).toBe(VideoStatus.PROCESSING);
    expect(persisted.storage_key).toBe(`videos/${video.id}/clip.mp4`);
    expect(storageService.uploadStream).toHaveBeenCalledWith(
      `videos/${video.id}/clip.mp4`,
      expect.anything(),
      'video/mp4',
      'videos',
    );
    expect(queue.add).toHaveBeenCalledWith(
      'process-video',
      expect.objectContaining({ videoId: video.id }),
      { jobId: `video-${video.id}` },
    );

    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });
});
