import { DataSource, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video } from './video.entity';

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

  let userCounter = 0;
  async function createChannel(): Promise<Channel> {
    const user = await userRepository.save(
      userRepository.create({
        email: `video_ent_${++userCounter}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `Chan${userCounter}`,
        nickname: `chan${userCounter}`,
        user_id: user.id,
      }),
    );
  }

  function baseVideoAttrs(channelId: string) {
    return {
      slug: channelId.slice(0, 11),
      channel_id: channelId,
      title: 'Movie',
      original_filename: 'movie.mp4',
      mime_type: 'video/mp4',
      size_bytes: '1024',
      original_key: `videos/${channelId}/some-id/original.mp4`,
    };
  }

  it('defaults status to draft', async () => {
    const channel = await createChannel();

    const video = await videoRepository.save(
      videoRepository.create(baseVideoAttrs(channel.id)),
    );

    expect(video.status).toBe('draft');
  });

  it('rejects an invalid status value', async () => {
    const channel = await createChannel();

    await expect(
      dataSource.query(
        `INSERT INTO "videos" ("channel_id", "slug", "title", "status", "original_filename", "mime_type", "size_bytes", "original_key")
         VALUES ($1, $2, 'Movie', 'bogus', 'movie.mp4', 'video/mp4', '1024', 'videos/x/y/original.mp4')`,
        [channel.id, channel.id.slice(0, 11)],
      ),
    ).rejects.toThrow();
  });

  it('rejects a duplicate slug', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      videoRepository.create(baseVideoAttrs(channel.id)),
    );

    await expect(
      videoRepository.save(
        videoRepository.create({
          ...baseVideoAttrs(channel.id),
          original_key: `videos/${channel.id}/other-id/original.mp4`,
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects a non-existent channel_id', async () => {
    await expect(
      videoRepository.save(
        videoRepository.create(
          baseVideoAttrs('00000000-0000-0000-0000-000000000000'),
        ),
      ),
    ).rejects.toThrow();
  });

  it('allows thumbnail_key, duration_seconds, metadata, failure_reason, and upload_id to be null', async () => {
    const channel = await createChannel();

    const video = await videoRepository.save(
      videoRepository.create({
        ...baseVideoAttrs(channel.id),
        thumbnail_key: null,
        duration_seconds: null,
        metadata: null,
        failure_reason: null,
        upload_id: null,
      }),
    );

    expect(video.thumbnail_key).toBeNull();
    expect(video.duration_seconds).toBeNull();
    expect(video.metadata).toBeNull();
    expect(video.failure_reason).toBeNull();
    expect(video.upload_id).toBeNull();
  });
});
