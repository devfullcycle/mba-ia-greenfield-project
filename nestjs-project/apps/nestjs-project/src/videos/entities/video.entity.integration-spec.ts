import { DataSource, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video } from './video.entity';

const ALL_ENTITIES = [User, Channel, Video];

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
        name: 'Chan',
        nickname: `chan_${counter}`,
        user_id: user.id,
      }),
    );
  }

  function buildVideo(channelId: string, overrides: Partial<Video> = {}) {
    return videoRepository.create({
      channel_id: channelId,
      original_filename: 'movie.mp4',
      mime_type: 'video/mp4',
      size_bytes: 1024,
      storage_key: 'videos/some-id/original',
      ...overrides,
    });
  }

  it('should default status to draft', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(buildVideo(channel.id));

    expect(video.status).toBe('draft');
  });

  it('should reject a status value outside the enum', async () => {
    const channel = await createChannel();

    await expect(
      videoRepository.save(
        buildVideo(channel.id, { status: 'bogus' as Video['status'] }),
      ),
    ).rejects.toThrow();
  });

  it('should reject a channel_id that does not exist in channels', async () => {
    await expect(
      videoRepository.save(buildVideo('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow();
  });

  it('should allow null thumbnail_key, duration_seconds, upload_id, and failure_reason', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(
      buildVideo(channel.id, {
        thumbnail_key: null,
        duration_seconds: null,
        upload_id: null,
        failure_reason: null,
      }),
    );

    expect(video.thumbnail_key).toBeNull();
    expect(video.duration_seconds).toBeNull();
    expect(video.upload_id).toBeNull();
    expect(video.failure_reason).toBeNull();
  });

  it('should load the related channel via the ManyToOne relation', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      buildVideo(channel.id, { storage_key: 'videos/rel/original' }),
    );

    const found = await videoRepository.findOne({
      where: { storage_key: 'videos/rel/original' },
      relations: ['channel'],
    });

    expect(found?.channel.nickname).toBe(channel.nickname);
  });

  it('should load related videos via the channel OneToMany relation', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      buildVideo(channel.id, { storage_key: 'videos/a/original' }),
    );
    await videoRepository.save(
      buildVideo(channel.id, { storage_key: 'videos/b/original' }),
    );

    const found = await channelRepository.findOne({
      where: { id: channel.id },
      relations: ['videos'],
    });

    expect(found?.videos).toHaveLength(2);
  });
});
