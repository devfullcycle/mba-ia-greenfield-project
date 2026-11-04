import { DataSource, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from './video.entity';

describe('Video Entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource([User, Channel, Video]);
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

  async function createChannelFixture(suffix = '1'): Promise<Channel> {
    const user = await userRepository.save(
      userRepository.create({
        email: `creator_${suffix}@example.com`,
        password: 'hashed_password',
        is_confirmed: true,
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `channel_${suffix}`,
        nickname: `channel_${suffix}`,
        user_id: user.id,
      }),
    );
  }

  it('persists a video with default draft status and 10GB size_bytes', async () => {
    const channel = await createChannelFixture('1');
    const tenGb = 10 * 1024 * 1024 * 1024; // 10,737,418,240

    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        slug: 'AbCdEf12345',
        title: 'My 10GB 4K Video',
        description: 'Testing large video persistence',
        storage_key: 'videos/test-uuid/original.mp4',
        original_filename: '4k-master.mp4',
        mime_type: 'video/mp4',
        size_bytes: tenGb,
      }),
    );

    expect(video.id).toBeDefined();
    expect(video.status).toBe(VideoStatus.DRAFT);
    expect(video.size_bytes).toBe(tenGb);
    expect(video.thumbnail_key).toBeNull();
    expect(video.duration_seconds).toBeNull();
    expect(video.created_at).toBeInstanceOf(Date);
    expect(video.updated_at).toBeInstanceOf(Date);

    const loaded = await videoRepository.findOne({
      where: { id: video.id },
      relations: ['channel'],
    });
    expect(loaded).not.toBeNull();
    expect(loaded!.size_bytes).toBe(tenGb);
    expect(typeof loaded!.size_bytes).toBe('number');
    expect(loaded!.channel.id).toBe(channel.id);
  });

  it('enforces unique constraint on slug', async () => {
    const channel = await createChannelFixture('2');

    await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        slug: 'UniqueSlug1',
        title: 'Video 1',
        storage_key: 'videos/1/original.mp4',
        original_filename: 'v1.mp4',
        mime_type: 'video/mp4',
        size_bytes: 1024,
      }),
    );

    await expect(
      videoRepository.save(
        videoRepository.create({
          channel_id: channel.id,
          slug: 'UniqueSlug1',
          title: 'Video 2',
          storage_key: 'videos/2/original.mp4',
          original_filename: 'v2.mp4',
          mime_type: 'video/mp4',
          size_bytes: 2048,
        }),
      ),
    ).rejects.toThrow();
  });

  it('cascades deletion when the parent channel is deleted', async () => {
    const channel = await createChannelFixture('3');

    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        slug: 'CascadeSlug',
        title: 'Cascade Video',
        storage_key: 'videos/cascade/original.mp4',
        original_filename: 'cascade.mp4',
        mime_type: 'video/mp4',
        size_bytes: 4096,
      }),
    );

    await channelRepository.delete({ id: channel.id });

    const remaining = await videoRepository.findOneBy({ id: video.id });
    expect(remaining).toBeNull();
  });
});
