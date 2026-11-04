import * as crypto from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let counter = 0;

  async function createChannel(): Promise<Channel> {
    const user = await userRepository.save(
      userRepository.create({
        email: `video_user_${++counter}@example.com`,
        password: 'hashed',
      }),
    );

    return channelRepository.save(
      channelRepository.create({
        name: 'Video Channel',
        nickname: `videochan${counter}`,
        user_id: user.id,
      }),
    );
  }

  it('defaults status to pending_upload', async () => {
    const channel = await createChannel();

    const video = await videoRepository.save(
      videoRepository.create({
        original_filename: 'video.mp4',
        channel_id: channel.id,
      }),
    );

    expect(video.status).toBe(VideoStatus.PENDING_UPLOAD);
  });

  it('allows nullable title, storage_key, thumbnail_key and duration_seconds', async () => {
    const channel = await createChannel();

    const video = await videoRepository.save(
      videoRepository.create({
        title: null,
        description: null,
        duration_seconds: null,
        original_filename: 'video.mp4',
        storage_key: null,
        thumbnail_key: null,
        error_message: null,
        channel_id: channel.id,
      }),
    );

    const found = await videoRepository.findOneByOrFail({ id: video.id });
    expect(found.title).toBeNull();
    expect(found.storage_key).toBeNull();
    expect(found.thumbnail_key).toBeNull();
    expect(found.duration_seconds).toBeNull();
    expect(found.error_message).toBeNull();
  });

  it('rejects a video without original_filename', async () => {
    const channel = await createChannel();

    await expect(
      videoRepository.save(
        videoRepository.create({
          original_filename: null as unknown as string,
          channel_id: channel.id,
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects a video with a channel_id that does not exist', async () => {
    await expect(
      videoRepository.save(
        videoRepository.create({
          original_filename: 'video.mp4',
          channel_id: crypto.randomUUID(),
        }),
      ),
    ).rejects.toThrow();
  });

  it('creates an index on channel_id', async () => {
    const result = await dataSource.query<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'videos'
         AND indexdef LIKE '%(channel_id)%'`,
    );

    expect(result.length).toBeGreaterThan(0);
  });
});
