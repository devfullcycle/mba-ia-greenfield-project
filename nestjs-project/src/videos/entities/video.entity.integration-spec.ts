import { DataSource, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { VideoStatus } from '../enums/video-status.enum';
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
    counter += 1;
    const user = await userRepository.save(
      userRepository.create({
        email: `video_user_${counter}@example.com`,
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

  it('should enforce unique constraint on slug', async () => {
    const channel = await createChannel();

    await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        title: 'Video One',
        slug: 'abc12345678',
        storage_key: 'videos/abc12345678/original',
      }),
    );

    await expect(
      videoRepository.save(
        videoRepository.create({
          channel_id: channel.id,
          title: 'Video Two',
          slug: 'abc12345678',
          storage_key: 'videos/abc12345678-2/original',
        }),
      ),
    ).rejects.toThrow();
  });

  it('should default status to draft when not provided', async () => {
    const channel = await createChannel();

    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        title: 'Video',
        slug: 'defaultstat',
        storage_key: 'videos/defaultstat/original',
      }),
    );

    expect(video.status).toBe(VideoStatus.DRAFT);
  });

  it('should enforce NOT NULL constraint on storage_key', async () => {
    const channel = await createChannel();

    await expect(
      videoRepository.save(
        videoRepository.create({
          channel_id: channel.id,
          title: 'Video',
          slug: 'nostoragek1',
        } as Partial<Video>),
      ),
    ).rejects.toThrow();
  });

  it('should enforce FK constraint from channel_id to channels.id', async () => {
    await expect(
      videoRepository.save(
        videoRepository.create({
          channel_id: '00000000-0000-0000-0000-000000000000',
          title: 'Video',
          slug: 'nochannelfk',
          storage_key: 'videos/nochannelfk/original',
        }),
      ),
    ).rejects.toThrow();
  });

  it('should reject deleting a channel that still has videos (no cascade delete)', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        title: 'Video',
        slug: 'nocascade01',
        storage_key: 'videos/nocascade01/original',
      }),
    );

    await expect(
      channelRepository.delete({ id: channel.id }),
    ).rejects.toThrow();
  });

  it('should load the related channel via the ManyToOne relation', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        title: 'Video',
        slug: 'relloadtest',
        storage_key: 'videos/relloadtest/original',
      }),
    );

    const found = await videoRepository.findOne({
      where: { slug: 'relloadtest' },
      relations: ['channel'],
    });

    expect(found?.channel.nickname).toBe(channel.nickname);
  });
});
