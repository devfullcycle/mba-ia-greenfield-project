import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
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
        name: `Channel ${counter}`,
        nickname: `chan${counter}`,
        user_id: user.id,
      }),
    );
  }

  function baseVideoAttrs(channelId: string) {
    return {
      channel_id: channelId,
      title: 'My Video',
      original_file_name: 'my-video.mp4',
      mime_type: 'video/mp4',
      size_in_bytes: 1024,
      storage_key: `videos/${channelId}/${crypto.randomUUID()}/original.mp4`,
    };
  }

  it('should persist with status defaulting to draft', async () => {
    const channel = await createChannel();

    const video = await videoRepository.save(
      videoRepository.create(baseVideoAttrs(channel.id)),
    );

    expect(video.status).toBe(VideoStatus.DRAFT);
    expect(video.thumbnail_key).toBeNull();
    expect(video.duration_seconds).toBeNull();
  });

  it('should enforce the channel_id foreign key constraint', async () => {
    await expect(
      videoRepository.save(
        videoRepository.create(
          baseVideoAttrs('00000000-0000-0000-0000-000000000000'),
        ),
      ),
    ).rejects.toThrow();
  });

  it('should enforce unique storage_key constraint', async () => {
    const channel = await createChannel();
    const attrs = baseVideoAttrs(channel.id);

    await videoRepository.save(videoRepository.create(attrs));

    await expect(
      videoRepository.save(
        videoRepository.create({ ...attrs, title: 'Duplicate key video' }),
      ),
    ).rejects.toThrow();
  });

  it('should persist and read every VideoStatus enum value', async () => {
    const channel = await createChannel();
    const statuses = Object.values(VideoStatus);

    for (const status of statuses) {
      const video = await videoRepository.save(
        videoRepository.create({
          ...baseVideoAttrs(channel.id),
          storage_key: `videos/${channel.id}/${crypto.randomUUID()}/original.mp4`,
          status,
        }),
      );
      expect(video.status).toBe(status);
    }
  });

  it('should load the related channel via the ManyToOne relation', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      videoRepository.create(baseVideoAttrs(channel.id)),
    );

    const found = await videoRepository.findOne({
      where: { channel_id: channel.id },
      relations: ['channel'],
    });

    expect(found?.channel.nickname).toBe(channel.nickname);
  });
});
