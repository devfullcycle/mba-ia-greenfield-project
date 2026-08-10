import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Channel } from '../../channels/entities/channel.entity';
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
        email: `vid_user_${++counter}@example.com`,
        password: 'password',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `Channel ${counter}`,
        nickname: `nickname_${counter}`,
        user_id: user.id,
      }),
    );
  }

  it('should save a video and verify default values', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(
      videoRepository.create({
        title: 'Video Title',
        unique_url_id: 'abc123xyz789',
        channel_id: channel.id,
      }),
    );

    expect(video.id).toBeDefined();
    expect(video.status).toBe(VideoStatus.DRAFT);
    expect(video.created_at).toBeDefined();
    expect(video.updated_at).toBeDefined();
  });

  it('should enforce unique unique_url_id constraint', async () => {
    const channel = await createChannel();
    const uniqueUrlId = 'unique-url-1';

    await videoRepository.save(
      videoRepository.create({
        title: 'Video One',
        unique_url_id: uniqueUrlId,
        channel_id: channel.id,
      }),
    );

    await expect(
      videoRepository.save(
        videoRepository.create({
          title: 'Video Two',
          unique_url_id: uniqueUrlId,
          channel_id: channel.id,
        }),
      ),
    ).rejects.toThrow();
  });

  it('should establish one-to-many relationship: channel has videos', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      videoRepository.create({
        title: 'Video One',
        unique_url_id: 'url-1',
        channel_id: channel.id,
      }),
    );
    await videoRepository.save(
      videoRepository.create({
        title: 'Video Two',
        unique_url_id: 'url-2',
        channel_id: channel.id,
      }),
    );

    const foundChannel = await channelRepository.findOne({
      where: { id: channel.id },
      relations: ['videos'],
    });

    expect(foundChannel?.videos).toHaveLength(2);
    expect(foundChannel?.videos.map((v) => v.title)).toContain('Video One');
    expect(foundChannel?.videos.map((v) => v.title)).toContain('Video Two');
  });
});
